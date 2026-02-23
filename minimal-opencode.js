/**
 * minimal-opencode.js — 使用 spawn 或 node-pty 调用 opencode CLI 并解析流式 NDJSON 输出。
 * 优先使用 node-pty（伪终端）以解除子进程 stdout 缓冲；可被服务端 import 或直接运行。
 * 
 * 会话管理参数说明：
 * - --continue / -c: 继续该项目下最近的会话
 * - --session <id> / -s <id>: 继续指定的会话 ID
 * - --format json: 输出 NDJSON 格式，便于解析
 * - --cwd: 指定工作目录（确保会话在同一项目下）
 * 
 * 会话机制：
 * - opencode 会在 ~/.local/share/opencode/ 下存储会话数据
 * - 使用 --continue 会找到该项目下最近的会话并继续
 * - 使用 --session <id> 可以指定具体的会话 ID
 * - 可以通过 `opencode session list` 查看所有会话
 */
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__dirname, 'minimal-opencode.js');

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
    .replace(/\x1b\?[0-9;]*[A-Za-z]/g, '')
    .replace(/\[\?[0-9;]*[A-Za-z]/g, '')
    .trim();
}

/**
 * 解析 opencode NDJSON 行，提取文本内容
 * opencode 事件类型：
 * - session: 会话信息，包含 session ID（用于保持上下文）
 * - step_start: 步骤开始
 * - text: 文本输出，part.text 包含实际文本
 * - tool_use: 工具调用，part.state.output 包含工具输出
 * - step_finish: 步骤结束
 * - permission_request: 权限请求（需要确认）
 * 
 * @param {string} line - NDJSON 行
 * @param {Function} onOutput - 输出回调 (stream, data)
 * @param {Function} onSession - 会话回调 (sessionId)
 */
/**
 * 获取 opencode 最新的 session ID（通过 opencode session list）
 * @returns {Promise<string|null>} session ID 或 null
 */
async function getLatestSessionId(cwd) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    
    const child = isWin
      ? spawn('opencode session list --format json', [], { stdio: ['pipe', 'pipe', 'pipe'], shell: true, cwd })
      : spawn('opencode', ['session', 'list', '--format', 'json'], { stdio: ['pipe', 'pipe', 'pipe'], cwd });
    
    let stdout = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.on('exit', (code) => {
      console.log('[minimal-opencode] getLatestSessionId: code=%d stdout=%d chars', code, stdout.length);
      console.log('[minimal-opencode] session list RAW OUTPUT:\n', stdout);
      
      try {
        // 尝试解析为 JSON 数组
        if (stdout.trim().startsWith('[')) {
          const arr = JSON.parse(stdout);
          if (Array.isArray(arr) && arr.length > 0) {
            const latest = arr[0];
            const sid = latest.id || latest.session_id;
            if (sid && typeof sid === 'string') {
              console.log('[minimal-opencode] getLatestSessionId: found from array %s', sid);
              resolve(sid);
              return;
            }
          }
        }
        
        // 尝试按行解析 NDJSON
        const lines = stdout.split('\n').filter(l => l.trim());
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          try {
            const obj = JSON.parse(line);
            console.log('[minimal-opencode] getLatestSessionId line %d: type=%s keys=%s', i, obj.type, Object.keys(obj).join(','));
            let sid = obj.id || obj.session_id;
            if (sid && typeof sid === 'string') {
              console.log('[minimal-opencode] getLatestSessionId: found %s', sid);
              resolve(sid);
              return;
            }
          } catch {
            // 继续尝试下一行
          }
        }
      } catch (e) {
        console.log('[minimal-opencode] getLatestSessionId parse error:', e.message);
      }
      resolve(null);
    });
    child.on('error', (err) => {
      console.log('[minimal-opencode] getLatestSessionId error:', err.message);
      resolve(null);
    });
    setTimeout(() => {
      child.kill();
      resolve(null);
    }, 10000);
  });
}

function parseNdjsonLine(line, onOutput, onSession) {
  const raw = stripAnsi(line);
  if (!raw) return;
  
  try {
    const obj = JSON.parse(raw);
    
    // 打印完整的原始 JSON 用于调试
    console.log('[minimal-opencode] RAW JSON:', JSON.stringify(obj));
    
    // 检测 session ID - 支持多种格式
    let sessionId = null;
    if (obj.type === 'session') {
      sessionId = obj.id || obj.session_id;
    } else if (obj.session_id) {
      sessionId = obj.session_id;
    } else if (obj.id && typeof obj.id === 'string' && obj.id.length > 10) {
      sessionId = obj.id;
    }
    if (sessionId) {
      console.log('[minimal-opencode] detected session:', sessionId);
      onSession && onSession(sessionId);
    }
    
    // 文本输出
    if (obj.type === 'text' && obj.part?.text) {
      onOutput('stdout', obj.part.text);
    } else if (obj.type === 'tool_use' && obj.part?.state?.output) {
      const toolName = obj.part.tool || 'tool';
      const title = obj.part.state.title || toolName;
      onOutput('stdout', `\n[${title}]\n${obj.part.state.output}\n`);
    } else if (obj.type === 'permission_request') {
      onOutput('stderr', `[权限请求] ${obj.description || JSON.stringify(obj)}\n`);
    } else if (obj.type === 'step_start' || obj.type === 'step_finish') {
      // 步骤事件，不需要特殊处理
    } else if (obj.message) {
      // 兼容 { message: '...' } 格式
      if (typeof obj.message === 'string') {
        onOutput('stdout', obj.message);
      } else if (obj.message.content) {
        onOutput('stdout', obj.message.content);
      }
    }
  } catch {
    if (raw.includes('permission') || raw.includes('confirm') || raw.includes('[Y/n]') || raw.includes('?')) {
      onOutput('stderr', `[交互提示] ${raw}\n`);
    } else if (raw.startsWith('{') || raw.startsWith('[')) {
      // 记录无法解析的 JSON（调试用）
      console.log('[minimal-opencode] unparseable JSON:', raw.substring(0, 200));
    }
  }
}

function processPtyData(data, stdoutBuf, onOutput, onSession) {
  const s = stdoutBuf.current + data;
  const lines = s.split(/\r?\n/);
  stdoutBuf.current = lines.pop() ?? '';
  for (const line of lines) parseNdjsonLine(line, onOutput, onSession);
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
    return {
      args: ['--session', sessionId],
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
  // 不保持会话
  return {
    args: [],
    logInfo: 'new session',
  };
}

/**
 * 运行 opencode CLI，解析 NDJSON 并回调 onOutput('stdout'|'stderr', text)。
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
 * 1. sessionId 优先：如果提供了 sessionId，使用 --session <id> 指定具体会话
 * 2. continue 次之：如果没有 sessionId 但 continue=true，使用 --continue 继续最近的会话
 * 3. opencode 会在 ~/.local/share/opencode/ 下存储会话数据
 * 4. onSession 回调会在检测到 session ID 时触发，可用于保存 session ID
 * 5. 可以通过 `opencode session list` 查看所有会话及其 ID
 * 
 * 使用示例：
 * ```javascript
 * // 继续最近的会话，并获取新的 session ID
 * runOpencodeCli('hello', { 
 *   continue: true,
 *   onSession: (sessionId) => console.log('Session:', sessionId)
 * });
 * 
 * // 指定具体的会话 ID
 * runOpencodeCli('hello', { sessionId: 'abc123' });
 * 
 * // 开启全新会话
 * runOpencodeCli('hello', { continue: false });
 * ```
 */
export function runOpencodeCli(prompt, { onOutput, onExit, onSession, continue: shouldContinue = true, sessionId, cwd } = {}) {
  const isWin = process.platform === 'win32';
  
  const sessionConfig = buildSessionArgs({ continue: shouldContinue, sessionId });
  let sessionDetected = false;
  const wrappedOnSession = (sid) => {
    sessionDetected = true;
    onSession && onSession(sid);
  };
  
  const escapeForShell = (arg) => {
    if (!arg) return '""';
    const escaped = arg.replace(/\n/g, ' ').replace(/\r/g, '');
    if (escaped.includes(' ') || escaped.includes('"') || escaped.includes("'") || escaped.includes('&') || escaped.includes('|')) {
      return '"' + escaped.replace(/"/g, '""') + '"';
    }
    return escaped;
  };

  const baseArgs = ['run', ...sessionConfig.args, '--format', 'json'];
  const workDir = cwd || process.cwd();

  const handleExit = async (code, signal) => {
    if (!sessionDetected && !sessionId) {
      console.log('[minimal-opencode] no session detected, trying to get from session list...');
      const latestSession = await getLatestSessionId(workDir);
      if (latestSession) {
        console.log('[minimal-opencode] got session from list:', latestSession);
        onSession && onSession(latestSession);
      }
    }
    onExit && onExit(code ?? -1, signal);
  };

  // 打印完整 prompt 用于调试
  console.log('[minimal-opencode] FULL PROMPT (%d chars):', prompt?.length || 0);
  console.log(prompt);
  console.log('[minimal-opencode] session config:', sessionConfig.logInfo);

  if (ptySpawn) {
    const file = isWin ? (process.env.COMSPEC || 'cmd.exe') : 'opencode';
    
    if (isWin) {
      const escapedPrompt = escapeForShell(prompt || '');
      const cmdStr = `opencode run ${sessionConfig.args.join(' ')} --format json ${escapedPrompt}`;
      console.log('[minimal-opencode] PTY command:', cmdStr);
      
      const ptyProcess = ptySpawn(file, ['/c', cmdStr], {
        name: 'xterm-256color',
        cols: 8192,
        rows: 24,
        cwd: workDir,
        env: process.env,
      });
      const stdoutBuf = { current: '' };
      ptyProcess.on('data', (data) => {
        processPtyData(data, stdoutBuf, onOutput, wrappedOnSession);
      });
      ptyProcess.on('exit', (code, signal) => {
        if (stdoutBuf.current.trim()) parseNdjsonLine(stdoutBuf.current, onOutput, wrappedOnSession);
        handleExit(code, signal);
      });
      console.log('[minimal-opencode] PTY spawned, pid:', ptyProcess.pid, sessionConfig.logInfo);
      return { child: { pid: ptyProcess.pid, kill: (sig) => ptyProcess.kill(sig) } };
    } else {
      const fullArgs = [...baseArgs, prompt || ''];
      console.log('[minimal-opencode] PTY command: opencode', fullArgs.join(' '));
      
      const ptyProcess = ptySpawn('opencode', fullArgs, {
        name: 'xterm-256color',
        cols: 8192,
        rows: 24,
        cwd: workDir,
        env: process.env,
      });
      const stdoutBuf = { current: '' };
      ptyProcess.on('data', (data) => {
        processPtyData(data, stdoutBuf, onOutput, wrappedOnSession);
      });
      ptyProcess.on('exit', (code, signal) => {
        if (stdoutBuf.current.trim()) parseNdjsonLine(stdoutBuf.current, onOutput, wrappedOnSession);
        handleExit(code, signal);
      });
      console.log('[minimal-opencode] PTY spawned, pid:', ptyProcess.pid, sessionConfig.logInfo);
      return { child: { pid: ptyProcess.pid, kill: (sig) => ptyProcess.kill(sig) } };
    }
  }

  const cmdStr = `opencode ${baseArgs.join(' ')} "${(prompt || '').replace(/"/g, '\\"')}"`;
  console.log('[minimal-opencode] spawn command:', cmdStr);
  
  const child = isWin
    ? spawn(cmdStr, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: true, cwd: workDir })
    : spawn('opencode', [...baseArgs, prompt || ''], { stdio: ['pipe', 'pipe', 'pipe'], cwd: workDir });
  child.stdin.end();

  let stdoutBuf = '';
  child.stdout.on('data', (chunk) => {
    const s = stdoutBuf + chunk.toString();
    const lines = s.split(/\r?\n/);
    stdoutBuf = lines.pop() ?? '';
    for (const line of lines) parseNdjsonLine(line, onOutput, wrappedOnSession);
  });
  child.stdout.on('end', () => {
    if (stdoutBuf) parseNdjsonLine(stdoutBuf, onOutput, wrappedOnSession);
  });
  child.stderr.on('data', (chunk) => onOutput('stderr', chunk.toString()));
  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      onOutput('stderr', '未找到 opencode CLI。请先安装并确保 "opencode" 已加入系统 PATH。\n');
    } else {
      onOutput('stderr', err.message + '\n');
    }
    handleExit(-1, err.message);
  });
  child.on('exit', (code, signal) => {
    handleExit(code, signal);
  });
  console.log('[minimal-opencode] spawn (no PTY) pid:', child.pid, sessionConfig.logInfo);
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
    } else if (arg === '-s' || arg === '--session') {
      sessionId = args[++i];
    } else if (!arg.startsWith('-')) {
      prompt = arg;
    }
  }

  if (!prompt) {
    console.error('Usage: node minimal-opencode.js [options] "your question"');
    console.error('');
    console.error('Options:');
    console.error('  --no-continue     Start a new session instead of continuing');
    console.error('  -s, --session <id> Continue a specific session by ID');
    console.error('');
    console.error('Examples:');
    console.error('  node minimal-opencode.js "hello"                    # Continue recent session');
    console.error('  node minimal-opencode.js --no-continue "hello"     # Start new session');
    console.error('  node minimal-opencode.js -s abc123 "hello"         # Use specific session');
    process.exit(1);
  }
  
  runOpencodeCli(prompt, {
    continue: shouldContinue,
    sessionId,
    onOutput: (stream, data) => {
      if (stream === 'stdout') process.stdout.write(data);
      else process.stderr.write(data);
    },
    onExit: (code) => {
      if (code !== 0) console.error(`Exited with code ${code}`);
      console.log();
      process.exit(code ?? 0);
    },
  });
}
