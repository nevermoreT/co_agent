/**
 * minimal-claude.js — 使用 spawn 或 node-pty 调用 Claude CLI 并解析流式 NDJSON 输出。
 * 优先使用 node-pty（伪终端）以解除子进程 stdout 缓冲，避免"卡住无输出"；可被服务端 import 或直接运行。
 * 
 * 会话管理参数说明：
 * - --continue / -c: 继续该项目下最近的会话
 * - --resume <id> / -r <id>: 恢复指定的会话 ID
 * - --session-id <uuid>: 使用指定的 session ID（必须是有效 UUID）
 * - --output-format stream-json: 输出 NDJSON 格式，便于解析
 * 
 * 会话机制：
 * - Claude CLI 会在 ~/.claude/ 下存储会话数据
 * - 使用 --continue 会找到该项目下最近的会话并继续
 * - 使用 --resume <id> 可以恢复具体的会话
 */
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__dirname, 'minimal-claude.js');

let ptySpawn = null;
try {
  const require = createRequire(import.meta.url);
  const pty = require('node-pty');
  ptySpawn = pty.spawn;
} catch {
  // node-pty 未安装或原生模块加载失败时使用普通 spawn
}

/** 去掉 PTY 输出的 ANSI 转义与 \r，否则整行不是合法 JSON 会解析失败 */
function stripAnsi(s) {
  return String(s)
    .replace(/\r/g, '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .trim();
}

/**
 * 解析 Claude CLI NDJSON 行，提取文本内容
 * Claude CLI 事件类型：
 * - assistant: 助手回复，message.content 包含内容块
 * - system: 系统消息，可能包含 session ID
 * - result: 最终结果
 * 
 * @param {string} line - NDJSON 行
 * @param {Function} onOutput - 输出回调 (stream, data)
 * @param {Function} onSession - 会话回调 (sessionId)
 */
function parseNdjsonLine(line, onOutput, onSession) {
  const raw = stripAnsi(line);
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    
    if (obj.type === 'system' && obj.session_id) {
      onSession && onSession(obj.session_id);
    }
    
    if (obj.type === 'result' && obj.session_id) {
      onSession && onSession(obj.session_id);
    }
    
    if (obj.type === 'assistant' && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === 'text' && block.text) {
          onOutput('stdout', block.text);
        }
      }
    }
  } catch (e) {
    console.error('[minimal-claude] JSON parse failed:', e.message, 'line length:', raw.length);
  }
}

function extractJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    
    if (c === '\x1b') {
      let j = i + 1;
      if (j < text.length && text[j] === '[') {
        j++;
        while (j < text.length && /[0-9;]/.test(text[j])) j++;
        if (j < text.length && /[A-Za-z]/.test(text[j])) j++;
        i = j - 1;
        continue;
      } else if (j < text.length && text[j] === ']') {
        const endBell = text.indexOf('\x07', j);
        const endEsc = text.indexOf('\x1b\\', j);
        if (endBell !== -1 && (endEsc === -1 || endBell < endEsc)) {
          i = endBell;
        } else if (endEsc !== -1) {
          i = endEsc + 1;
        } else {
          i = j;
        }
        continue;
      }
    }
    
    if (c === '\r') continue;
    
    if (escape) {
      escape = false;
      continue;
    }
    
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    
    if (c === '"') {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push({ text: text.substring(start, i + 1), start });
        start = -1;
      }
    }
  }
  
  const lastObj = objects[objects.length - 1];
  const consumed = lastObj ? lastObj.start + lastObj.text.length : 0;
  const remaining = text.substring(consumed);
  
  return { objects: objects.map(o => o.text), remaining };
}

function processPtyData(data, stdoutBuf, onOutput, onSession, chunkNum) {
  const s = stdoutBuf.current + data;
  const { objects, remaining } = extractJsonObjects(s);
  
  for (const obj of objects) {
    parseNdjsonLine(obj, onOutput, onSession);
  }
  
  stdoutBuf.current = remaining;
  console.log('[minimal-claude] chunk %d: %d chars, %d JSON objects, buffer %d chars', 
    chunkNum.val, data.length, objects.length, remaining.length);
  chunkNum.val++;
}

/**
 * 构建会话相关参数
 * @param {Object} options - 会话选项
 * @param {boolean} options.continue - 是否继续上一个会话
 * @param {string} options.sessionId - 指定会话 ID
 * @returns {Object} { args: string[], logInfo: string }
 */
function buildSessionArgs({ continue: shouldContinue, sessionId }) {
  // 优先使用指定的 sessionId
  if (sessionId) {
    // Claude CLI 使用 --resume 来恢复指定会话
    return {
      args: ['--resume', sessionId],
      logInfo: `session: ${sessionId}`,
    };
  }
  // 否则使用 --continue 继续最近的会话
  if (shouldContinue) {
    return {
      args: ['--continue'],
      logInfo: 'continue: true',
    };
  }
  // 不保持会话，但生成一个新的 session-id 以便后续追踪
  // Claude CLI 要求 session-id 必须是有效的 UUID
  return {
    args: ['--session-id', randomUUID()],
    logInfo: 'new session',
  };
}

/**
 * 运行 Claude CLI，解析 NDJSON 并回调 onOutput('stdout'|'stderr', text)。
 * 若已安装 node-pty 则用 PTY 启动以解除缓冲；否则用普通 spawn。
 * 
 * @param {string} prompt - 用户输入的提示词
 * @param {Object} options - 配置选项
 * @param {Function} options.onOutput - 输出回调 (stream, data)
 * @param {Function} options.onExit - 退出回调 (code, signal)
 * @param {Function} [options.onSession] - 会话回调 (sessionId)，当检测到 session ID 时调用
 * @param {boolean} [options.continue=true] - 是否继续上一个会话（保持上下文）
 * @param {string} [options.sessionId] - 指定会话 ID（优先于 continue）
 * @param {string} [options.cwd] - 工作目录（确保会话在同一项目下）
 * 
 * 会话管理说明：
 * 1. sessionId 优先：如果提供了 sessionId，使用 --resume <id> 恢复具体会话
 * 2. continue 次之：如果没有 sessionId 但 continue=true，使用 --continue 继续最近的会话
 * 3. Claude CLI 会在 ~/.claude/ 下存储会话数据
 * 4. onSession 回调会在检测到 session ID 时触发，可用于保存 session ID
 * 
 * 使用示例：
 * ```javascript
 * // 继续最近的会话，并获取新的 session ID
 * runClaudeCli('hello', { 
 *   continue: true,
 *   onSession: (sessionId) => console.log('Session:', sessionId)
 * });
 * 
 * // 指定具体的会话 ID
 * runClaudeCli('hello', { sessionId: 'abc123' });
 * 
 * // 开启全新会话
 * runClaudeCli('hello', { continue: false });
 * ```
 */
export function runClaudeCli(prompt, { onOutput, onExit, onSession, continue: shouldContinue = true, sessionId, cwd } = {}) {
  const isWin = process.platform === 'win32';
  
  const sessionConfig = buildSessionArgs({ continue: shouldContinue, sessionId });
  
  const escapeForShell = (arg) => {
    if (!arg) return '""';
    const escaped = arg.replace(/\n/g, ' ').replace(/\r/g, '');
    if (escaped.includes(' ') || escaped.includes('"') || escaped.includes("'") || escaped.includes('&') || escaped.includes('|')) {
      return '"' + escaped.replace(/"/g, '""') + '"';
    }
    return escaped;
  };

  const args = [
    ...sessionConfig.args,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'acceptEdits'
  ];

  const workDir = cwd || process.cwd();

  if (ptySpawn) {
    const cmdArgs = [...args, '-p', prompt || ''];
    
    if (isWin) {
      const cmdStr = 'claude ' + cmdArgs.map(escapeForShell).join(' ');
      console.log('[minimal-claude] PTY command:', cmdStr.substring(0, 100) + (cmdStr.length > 100 ? '...' : ''));
      
      const ptyProcess = ptySpawn(process.env.COMSPEC || 'cmd.exe', ['/c', cmdStr], {
        name: 'xterm-256color',
        cols: 8192,
        rows: 24,
        cwd: workDir,
        env: process.env,
      });
      const stdoutBuf = { current: '' };
      const lineNumber = { val: 0 };
      ptyProcess.on('data', (data) => {
        processPtyData(data, stdoutBuf, onOutput, onSession, lineNumber);
      });
      ptyProcess.on('exit', (code, signal) => {
        if (stdoutBuf.current.trim()) {
          const { objects } = extractJsonObjects(stdoutBuf.current);
          for (const obj of objects) parseNdjsonLine(obj, onOutput, onSession);
        }
        onExit && onExit(code ?? -1, signal);
      });
      console.log('[minimal-claude] PTY spawned, pid:', ptyProcess.pid, sessionConfig.logInfo);
      return { child: { pid: ptyProcess.pid, kill: (sig) => ptyProcess.kill(sig) } };
    } else {
      const ptyProcess = ptySpawn('claude', cmdArgs, {
        name: 'xterm-256color',
        cols: 8192,
        rows: 24,
        cwd: workDir,
        env: process.env,
      });
      const stdoutBuf = { current: '' };
      const lineNumber = { val: 0 };
      ptyProcess.on('data', (data) => {
        processPtyData(data, stdoutBuf, onOutput, onSession, lineNumber);
      });
      ptyProcess.on('exit', (code, signal) => {
        if (stdoutBuf.current.trim()) {
          const { objects } = extractJsonObjects(stdoutBuf.current);
          for (const obj of objects) parseNdjsonLine(obj, onOutput, onSession);
        }
        onExit && onExit(code ?? -1, signal);
      });
      console.log('[minimal-claude] PTY spawned, pid:', ptyProcess.pid, sessionConfig.logInfo);
      return { child: { pid: ptyProcess.pid, kill: (sig) => ptyProcess.kill(sig) } };
    }
  }

  const child = spawn('claude', [...args, '-p', prompt || ''], { 
    stdio: ['inherit', 'pipe', 'pipe'], 
    cwd: workDir 
  });

  let stdoutBuf = '';
  child.stdout.on('data', (chunk) => {
    const s = stdoutBuf + chunk.toString();
    const { objects, remaining } = extractJsonObjects(s);
    for (const obj of objects) {
      parseNdjsonLine(obj, onOutput, onSession);
    }
    stdoutBuf = remaining;
  });
  child.stdout.on('end', () => {
    if (stdoutBuf.trim()) {
      const { objects } = extractJsonObjects(stdoutBuf);
      for (const obj of objects) parseNdjsonLine(obj, onOutput, onSession);
    }
  });
  child.stderr.on('data', (chunk) => onOutput('stderr', chunk.toString()));
  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      onOutput('stderr', '未找到 Claude CLI。请先安装并确保 "claude" 已加入系统 PATH。\n');
    } else {
      onOutput('stderr', err.message + '\n');
    }
    onExit && onExit(-1, err.message);
  });
  child.on('exit', (code, signal) => {
    onExit && onExit(code ?? -1, signal);
  });
  console.log('[minimal-claude] spawn (no PTY) pid:', child.pid, sessionConfig.logInfo);
  return { child };
}

if (isMain) {
  // 解析命令行参数
  const args = process.argv.slice(2);
  let prompt = null;
  let sessionId = null;
  let shouldContinue = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-continue') {
      shouldContinue = false;
    } else if (arg === '-r' || arg === '--resume') {
      sessionId = args[++i];
    } else if (!arg.startsWith('-')) {
      prompt = arg;
    }
  }

  if (!prompt) {
    console.error('Usage: node minimal-claude.js [options] "your question"');
    console.error('');
    console.error('Options:');
    console.error('  --no-continue     Start a new session instead of continuing');
    console.error('  -r, --resume <id> Resume a specific session by ID');
    console.error('');
    console.error('Examples:');
    console.error('  node minimal-claude.js "hello"                    # Continue recent session');
    console.error('  node minimal-claude.js --no-continue "hello"     # Start new session');
    console.error('  node minimal-claude.js -r abc123 "hello"         # Use specific session');
    process.exit(1);
  }
  
  runClaudeCli(prompt, {
    continue: shouldContinue,
    sessionId,
    onOutput: (stream, data) => {
      if (stream === 'stdout') process.stdout.write(data);
      else process.stderr.write(data);
    },
    onSession: (sid) => {
      console.log('[minimal-claude] session ID:', sid);
    },
    onExit: (code) => {
      if (code !== 0) console.error(`Exited with code ${code}`);
      console.log();
      process.exit(code ?? 0);
    },
  });
}
