import { spawn } from 'child_process';
import path from 'path';
import db from '../db.js';
import logger from '../logger.js';
import { runClaudeCli as runClaudeCliImpl } from '../../minimal-claude.js';
import { runOpencodeCli as runOpencodeCliImpl } from '../../minimal-opencode.js';

const runs = new Map();

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
    return true;
  }
  return false;
}

export function sendInput(agentId, text) {
  const key = String(agentId);
  const proc = runs.get(key);
  if (proc && proc.process && proc.process.stdin && !proc.process.stdin.destroyed) {
    proc.process.stdin.write(text + '\n');
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

  child.stdout.on('data', (data) => {
    logger.log('[agentRunner] agentId=%s stdout: %d chars', agentId, data.length);
    onOutput('stdout', data.toString());
  });
  child.stderr.on('data', (data) => {
    logger.log('[agentRunner] agentId=%s stderr: %d chars', agentId, data.length);
    onOutput('stderr', data.toString());
  });
  child.on('error', (err) => {
    logger.log('[agentRunner] agentId=%s error: %s', agentId, err.message);
    runs.delete(key);
    onOutput('stderr', err.message + '\n');
    onExit && onExit(-1, err.message);
  });
  child.on('exit', (code, signal) => {
    logger.log('[agentRunner] agentId=%s exit: code=%s signal=%s', agentId, code, signal);
    runs.delete(key);
    onExit && onExit(code ?? -1, signal);
  });

  return true;
}

/**
 * 内置 Claude CLI：一问一答，每次 send 触发一次进程，流式回传解析后的 stdout。
 * 调用前由 websocket 确认 agent.builtin_key === 'claude-cli'。
 */
export function runClaudeCli(agentId, prompt, onOutput, onExit) {
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
  logger.log('[agentRunner] runClaudeCli() starting: agentId=%s prompt=%s', agentId, prompt.substring(0, 50) + '...');
  const { child } = runClaudeCliImpl(prompt, {
    onOutput,
    onExit: (code, signal) => {
      logger.log('[agentRunner] runClaudeCli() exit: agentId=%s code=%s signal=%s', agentId, code, signal);
      runs.delete(key);
      onExit && onExit(code, signal);
    },
  });
  runs.set(key, { process: child });
  return true;
}

export function runOpencodeCli(agentId, prompt, onOutput, onExit) {
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
  
  // 使用 agent 的 session_id（如果有）来保持会话上下文
  const sessionId = agent.session_id || null;
  logger.log('[agentRunner] runOpencodeCli() starting: agentId=%s prompt=%s sessionId=%s', 
    agentId, prompt.substring(0, 50) + '...', sessionId || '(none)');
  
  const { child } = runOpencodeCliImpl(prompt, {
    onOutput,
    onExit: (code, signal) => {
      logger.log('[agentRunner] runOpencodeCli() exit: agentId=%s code=%s signal=%s', agentId, code, signal);
      runs.delete(key);
      onExit && onExit(code, signal);
    },
    // 当检测到新的 session ID 时，保存到数据库
    onSession: (newSessionId) => {
      if (newSessionId && newSessionId !== sessionId) {
        logger.log('[agentRunner] saving new session_id for agentId=%s: %s', agentId, newSessionId);
        db.prepare('UPDATE agents SET session_id = ? WHERE id = ?').run(newSessionId, agentId);
      }
    },
    sessionId,
    continue: !sessionId, // 如果没有指定 sessionId，则使用 --continue
  });
  runs.set(key, { process: child });
  return true;
}
