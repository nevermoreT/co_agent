import { spawn } from 'child_process';
import path from 'path';
import db from '../db.js';
import logger from '../logger.js';
import { runClaudeCli as runClaudeCliImpl } from '../../minimal-claude.js';
import { runOpencodeCli as runOpencodeCliImpl } from '../../minimal-opencode.js';
import * as sessionManager from './sessionManager.js';
import * as memoryManager from './memoryManager.js';

const runs = new Map();

// 进程超时清理机制：30分钟无活动自动清理
const PROCESS_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const processTimestamps = new Map();

// 定期检查并清理超时进程
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processTimestamps.entries()) {
    if (now - timestamp > PROCESS_TIMEOUT) {
      logger.log('[agentRunner] Cleaning up stale process: agentId=%s', key);
      const proc = runs.get(key);
      if (proc && proc.process) {
        try {
          proc.process.kill();
        } catch (err) {
          logger.error('[agentRunner] Error killing stale process:', err);
        }
      }
      runs.delete(key);
      processTimestamps.delete(key);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

function updateProcessTimestamp(agentId) {
  processTimestamps.set(String(agentId), Date.now());
}

function parseCommand(cliCommand) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < cliCommand.length; i++) {
    const c = cliCommand[i];
    if (c === '"' || c === "'") {
      inQuotes = !inQuotes;
    } else if ((c === ' ' || c === '\t') && !inQuotes) {
      if (current) {
        parts.push(current.replace(/^["']|["']$/g, ''));
        current = '';
      }
    } else {
      current += c;
    }
  }
  if (current) parts.push(current.replace(/^["']|["']$/g, ''));
  if (parts.length === 0) return { command: '', args: [] };
  return { command: parts[0], args: parts.slice(1) };
}

export function isRunning(agentId) {
  return runs.has(String(agentId));
}

export function getRunningAgentIds() {
  return Array.from(runs.keys()).map(Number);
}

export function stop(agentId) {
  const key = String(agentId);
  const proc = runs.get(key);
  if (proc && proc.process) {
    proc.process.kill();
    runs.delete(key);
    processTimestamps.delete(key);
    return true;
  }
  return false;
}

export function sendInput(agentId, text) {
  const key = String(agentId);
  const proc = runs.get(key);
  if (proc && proc.process && proc.process.stdin && !proc.process.stdin.destroyed) {
    proc.process.stdin.write(text + '\n');
    updateProcessTimestamp(agentId);
    return true;
  }
  return false;
}

export function run(agentId, onOutput, onExit) {
  const key = String(agentId);
  if (runs.has(key)) {
    logger.log('[agentRunner] run() blocked: agentId=%s already running', agentId);
    return false;
  }
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) {
    logger.log('[agentRunner] run() failed: agentId=%s not found', agentId);
    onExit && onExit(-1, 'agent not found');
    return false;
  }
  const { command, args } = parseCommand(agent.cli_command);
  if (!command) {
    logger.log('[agentRunner] run() failed: agentId=%s invalid cli_command', agentId);
    onExit && onExit(-1, 'invalid cli_command');
    return false;
  }
  logger.log('[agentRunner] run() starting: agentId=%s command=%s args=%o', agentId, command, args);
  const cwd = agent.cli_cwd
    ? path.isAbsolute(agent.cli_cwd)
      ? agent.cli_cwd
      : path.resolve(process.cwd(), agent.cli_cwd)
    : undefined;

  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: cwd || undefined,
    shell: false,
  });

  const proc = { process: child };
  runs.set(key, proc);
  updateProcessTimestamp(agentId);

  child.stdout.on('data', (data) => {
    logger.log('[agentRunner] agentId=%s stdout: %d chars', agentId, data.length);
    updateProcessTimestamp(agentId);
    onOutput('stdout', data.toString());
  });
  child.stderr.on('data', (data) => {
    logger.log('[agentRunner] agentId=%s stderr: %d chars', agentId, data.length);
    updateProcessTimestamp(agentId);
    onOutput('stderr', data.toString());
  });
  child.on('error', (err) => {
    logger.log('[agentRunner] agentId=%s error: %s', agentId, err.message);
    runs.delete(key);
    processTimestamps.delete(key);
    onOutput('stderr', err.message + '\n');
    onExit && onExit(-1, err.message);
  });
  child.on('exit', (code, signal) => {
    logger.log('[agentRunner] agentId=%s exit: code=%s signal=%s', agentId, code, signal);
    runs.delete(key);
    processTimestamps.delete(key);
    onExit && onExit(code ?? -1, signal);
  });

  return true;
}

/**
 * 内置 Claude CLI：一问一答，每次 send 触发一次进程，流式回传解析后的 stdout。
 * 调用前由 websocket 确认 agent.builtin_key === 'claude-cli'。
 * 
 * 会话管理：
 * - 使用 sessionManager 管理每个 agent 在每个对话中的 session
 * - 使用 memoryManager 提供记忆上下文
 */
export function runClaudeCli(agentId, prompt, onOutput, onExit, conversationId) {
  const key = String(agentId);
  if (runs.has(key)) {
    logger.log('[agentRunner] runClaudeCli() blocked: agentId=%s already running', agentId);
    return false;
  }
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent || agent.builtin_key !== 'claude-cli') {
    logger.log('[agentRunner] runClaudeCli() failed: agentId=%s not found or not claude-cli', agentId);
    onExit && onExit(-1, 'agent not found or not claude-cli');
    return false;
  }

  // 构建上下文，避免使用括号和引号（Windows shell 特殊字符会导致 prompt 丢失）
  // 详见 doc/bugfix-windows-shell-special-chars.md
  const memoryContext = memoryManager.buildAgentContext(agentId, conversationId);
  
  // 调试日志
  logger.log('[agentRunner] runClaudeCli() memoryContext (%d chars):', memoryContext?.length || 0);
  if (memoryContext) {
    logger.log('[agentRunner] runClaudeCli() memoryContext content: %s', memoryContext);
  }
  
  let enrichedPrompt;
  if (memoryContext) {
    enrichedPrompt = `${prompt} - 上下文: ${memoryContext}`;
  } else {
    enrichedPrompt = prompt;
  }

  const sessionId = sessionManager.getSession(agentId, conversationId);
  logger.log('[agentRunner] runClaudeCli() agentId=%d convId=%d promptLen=%d sessionId=%s',
    agentId, conversationId, enrichedPrompt.length, sessionId || '(new)');

  const { child } = runClaudeCliImpl(enrichedPrompt, {
    onOutput,
    onExit: (code, signal) => {
      logger.log('[agentRunner] runClaudeCli() exit: agentId=%s code=%s signal=%s', agentId, code, signal);
      runs.delete(key);
      processTimestamps.delete(key);
      onExit && onExit(code, signal);
    },
    onSession: (newSessionId) => {
      logger.log('[agentRunner] runClaudeCli() onSession: agentId=%d convId=%d sessionId=%s', agentId, conversationId, newSessionId);
      if (newSessionId && conversationId) {
        sessionManager.saveSession(agentId, conversationId, newSessionId);
      }
    },
    sessionId,
    // 如果有 sessionId 则恢复会话，否则开始新会话（不使用 --continue）
    continue: false,
  });
  runs.set(key, { process: child, conversationId });
  updateProcessTimestamp(agentId);
  return true;
}

export function runOpencodeCli(agentId, prompt, onOutput, onExit, conversationId) {
  const key = String(agentId);
  if (runs.has(key)) {
    logger.log('[agentRunner] runOpencodeCli() blocked: agentId=%s already running', agentId);
    return false;
  }
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent || agent.builtin_key !== 'opencode-cli') {
    logger.log('[agentRunner] runOpencodeCli() failed: agentId=%s not found or not opencode-cli', agentId);
    onExit && onExit(-1, 'agent not found or not opencode-cli');
    return false;
  }
  
  const memoryContext = memoryManager.buildAgentContext(agentId, conversationId);
  let enrichedPrompt;
  if (memoryContext) {
    // 避免使用括号和引号（Windows shell 特殊字符）
    enrichedPrompt = `${prompt} - 上下文: ${memoryContext}`;
  } else {
    enrichedPrompt = prompt;
  }

  const sessionId = sessionManager.getSession(agentId, conversationId);
  logger.log('[agentRunner] runOpencodeCli() agentId=%d convId=%d promptLen=%d sessionId=%s',
    agentId, conversationId, enrichedPrompt.length, sessionId || '(new)');

  const { child } = runOpencodeCliImpl(enrichedPrompt, {
    onOutput,
    onExit: (code, signal) => {
      logger.log('[agentRunner] runOpencodeCli() exit: agentId=%s code=%s signal=%s', agentId, code, signal);
      runs.delete(key);
      processTimestamps.delete(key);
      onExit && onExit(code, signal);
    },
    onSession: (newSessionId) => {
      logger.log('[agentRunner] runOpencodeCli() onSession: agentId=%d convId=%d sessionId=%s', agentId, conversationId, newSessionId);
      if (newSessionId && conversationId) {
        sessionManager.saveSession(agentId, conversationId, newSessionId);
      }
    },
    sessionId,
    // 如果有 sessionId 则恢复会话，否则开始新会话（不使用 --continue）
    continue: false,
  });
  runs.set(key, { process: child, conversationId });
  updateProcessTimestamp(agentId);
  return true;
}
