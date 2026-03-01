/**
 * minimal-opencode.js — 使用原生 spawn 调用 opencode CLI 并解析流式 NDJSON 输出。
 * 参考 bugfix-windows-shell-special-chars.md，不使用 PTY。
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
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__dirname, 'minimal-opencode.js');

/**
 * 从文本中提取完整的 JSON 对象
 * 处理 JSON 中可能包含的换行符和 ANSI 转义序列
 * 参考 minimal-claude.js 的实现
 * 
 * @param {string} text - 输入文本
 * @returns {{ objects: string[], remaining: string }} - 提取的 JSON 对象数组和剩余文本
 */
function extractJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    
    // 跳过 ANSI 转义序列
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
    
    // 跳过 \r
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

/**
 * 解析单个 JSON 对象
 * opencode 事件类型：
 * - session: 会话信息，包含 session ID（用于保持上下文）
 * - step_start: 步骤开始
 * - text: 文本输出，part.text 包含实际文本
 * - tool_use: 工具调用，part.state.output 包含工具输出
 * - step_finish: 步骤结束
 * - permission_request: 权限请求（需要确认）
 * 
 * @param {string} jsonStr - JSON 字符串
 * @param {Object} callbacks - 回调函数
 * @param {Function} [callbacks.onOutput] - 输出回调 (stream, data)
 * @param {Function} [callbacks.onToolUse] - 工具调用回调
 * @param {Function} [onSession] - 会话回调 (sessionId)
 */
function parseJsonObject(jsonStr, callbacks, onSession) {
  const { onOutput, onToolUse } = callbacks;
  
  try {
    const obj = JSON.parse(jsonStr);
    
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
      onOutput && onOutput('stdout', obj.part.text);
    } else if (obj.type === 'tool_use') {
      const toolName = obj.part?.tool || 'tool';
      const state = obj.part?.state || {};
      const title = obj.part?.title || state.title || toolName;
      const status = state.status || 'completed';
      const input = state.input || {};
      const output = state.output || '';
      const callID = obj.part?.callID || '';
      // 通过专门的 onToolUse 回调发送
      console.log('[minimal-opencode] tool_use detected:', toolName, title, status);
      if (onToolUse) {
        onToolUse({ tool: toolName, title, status, input, output, callID });
      } else {
        console.log('[minimal-opencode] WARNING: onToolUse callback not provided!');
      }
    } else if (obj.type === 'permission_request') {
      onOutput && onOutput('stderr', `[权限请求] ${obj.description || JSON.stringify(obj)}\n`);
    } else if (obj.type === 'step_start' || obj.type === 'step_finish') {
      // 步骤事件，不需要特殊处理
    } else if (obj.message) {
      // 兼容 { message: '...' } 格式
      if (typeof obj.message === 'string') {
        onOutput && onOutput('stdout', obj.message);
      } else if (obj.message.content) {
        onOutput && onOutput('stdout', obj.message.content);
      }
    }
  } catch (e) {
    console.log('[minimal-opencode] JSON parse error:', e.message, 'json length:', jsonStr.length);
  }
}

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
 * 使用原生 spawn（不使用 PTY），参考 bugfix-windows-shell-special-chars.md。
 * 
 * @param {string} prompt - 用户输入的提示词
 * @param {Object} options - 配置选项
 * @param {Function} options.onOutput - 输出回调 (stream, data)
 * @param {Function} options.onExit - 退出回调 (code, signal)
 * @param {Function} [options.onSession] - 会话回调 (sessionId)，当检测到 session ID 时调用
 * @param {Function} [options.onToolUse] - 工具调用回调 ({ tool, title, status, output })
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
export function runOpencodeCli(prompt, { onOutput, onExit, onSession, onToolUse, continue: shouldContinue = true, sessionId, cwd } = {}) {
  const callbacks = { onOutput, onToolUse };
  
  const sessionConfig = buildSessionArgs({ continue: shouldContinue, sessionId });
  let sessionDetected = false;
  const wrappedOnSession = (sid) => {
    sessionDetected = true;
    onSession && onSession(sid);
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
  console.log('[minimal-opencode] ========== FULL PROMPT START ==========');
  console.log('[minimal-opencode] FULL PROMPT (%d chars):', prompt?.length || 0);
  console.log(prompt);
  console.log('[minimal-opencode] ========== FULL PROMPT END ==========');
  console.log('[minimal-opencode] session config:', sessionConfig.logInfo);

  // Windows 上需要 shell: true 来调用 .cmd 文件
  // 转义 prompt 中的双引号（Windows cmd.exe 使用 "" 转义）
  // 将换行符替换为空格，避免 cmd.exe 解析问题
  // 注意：只对 prompt 加引号，选项不加引号
  const escapedPrompt = (prompt || '').replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
  const cmdStr = `opencode ${baseArgs.join(' ')} "${escapedPrompt}"`;
  
  // 打印完整命令（不截断）
  console.log('[minimal-opencode] ========== SPAWN COMMAND START ==========');
  console.log('[minimal-opencode] command length: %d chars', cmdStr.length);
  console.log('[minimal-opencode] command:\n%s', cmdStr);
  console.log('[minimal-opencode] ========== SPAWN COMMAND END ==========');
  console.log('[minimal-opencode] Working directory:', workDir);

  const child = spawn(cmdStr, [], {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: workDir,
    shell: true,
  });

  let stdoutBuf = '';
  let chunkNum = 0;
  
  child.stdout.on('data', (chunk) => {
    const data = chunk.toString();
    const s = stdoutBuf + data;
    const { objects, remaining } = extractJsonObjects(s);
    
    console.log('[minimal-opencode] chunk %d: %d chars, %d JSON objects, buffer %d chars',
      chunkNum++, data.length, objects.length, remaining.length);
    
    for (const obj of objects) {
      parseJsonObject(obj, callbacks, wrappedOnSession);
    }
    stdoutBuf = remaining;
  });
  
  child.stdout.on('end', () => {
    if (stdoutBuf.trim()) {
      const { objects } = extractJsonObjects(stdoutBuf);
      console.log('[minimal-opencode] stdout end: %d remaining JSON objects', objects.length);
      for (const obj of objects) {
        parseJsonObject(obj, callbacks, wrappedOnSession);
      }
    }
  });
  
  child.stderr.on('data', (chunk) => {
    onOutput && onOutput('stderr', chunk.toString());
  });
  
  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      onOutput && onOutput('stderr', '未找到 opencode CLI。请先安装并确保 "opencode" 已加入系统 PATH。\n');
    } else {
      onOutput && onOutput('stderr', err.message + '\n');
    }
    handleExit(-1, err.message);
  });
  
  child.on('exit', (code, signal) => {
    console.log('[minimal-opencode] child exit: code=%s signal=%s', code, signal);
    handleExit(code, signal);
  });
  
  console.log('[minimal-opencode] spawn pid:', child.pid, sessionConfig.logInfo);
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
