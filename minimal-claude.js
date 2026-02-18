/**
 * minimal-claude.js — 使用 spawn 或 node-pty 调用 Claude CLI 并解析流式 NDJSON 输出。
 * 优先使用 node-pty（伪终端）以解除子进程 stdout 缓冲，避免“卡住无输出”；可被服务端 import 或直接运行。
 */
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__dirname, 'minimal-claude.js');

let ptySpawn = null;
try {
  const require = createRequire(import.meta.url);
  const pty = require('node-pty');
  ptySpawn = pty.spawn;
} catch (_) {
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

function parseNdjsonLine(line, onOutput) {
  const raw = stripAnsi(line);
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    if (obj.type === 'assistant' && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === 'text' && block.text) {
          onOutput('stdout', block.text);
        }
      }
    }
  } catch (_) {}
}

function processPtyData(data, stdoutBuf, onOutput) {
  const s = stdoutBuf.current + data;
  const lines = s.split(/\r?\n/);
  stdoutBuf.current = lines.pop() ?? '';
  for (const line of lines) parseNdjsonLine(line, onOutput);
}

/**
 * 运行 Claude CLI（-p prompt, stream-json），解析 NDJSON 并回调 onOutput('stdout'|'stderr', text)。
 * 若已安装 node-pty 则用 PTY 启动以解除缓冲；否则用普通 spawn（可能因缓冲无即时输出）。
 */
export function runClaudeCli(prompt, { onOutput, onExit }) {
  const escaped = (prompt || '').replace(/"/g, '""');
  const isWin = process.platform === 'win32';
  const cmd = isWin
    ? `claude -p "${escaped}" --output-format stream-json --verbose --permission-mode acceptEdits`
    : ['-p', prompt || '', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'];

  if (ptySpawn) {
    // 使用伪终端，子进程认为在写 TTY，通常不会全缓冲，可避免“卡住”
    const file = isWin ? (process.env.COMSPEC || 'cmd.exe') : 'claude';
    const args = isWin ? ['/c', cmd] : ['-p', prompt || '', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'];
    const ptyProcess = ptySpawn(file, args, {
      name: 'xterm-256color',
      cols: 8192, // 足够宽，避免 PTY 在行内插入 \r\n 把一条 NDJSON 拆成多行导致解析失败
      rows: 24,
      cwd: process.cwd(),
      env: process.env,
    });
    const stdoutBuf = { current: '' };
    ptyProcess.on('data', (data) => {
      processPtyData(data, stdoutBuf, onOutput);
    });
    ptyProcess.on('exit', (code, signal) => {
      if (stdoutBuf.current.trim()) parseNdjsonLine(stdoutBuf.current, onOutput);
      onExit && onExit(code ?? -1, signal);
    });
    console.log('[minimal-claude] PTY spawned, pid:', ptyProcess.pid);
    return { child: { pid: ptyProcess.pid, kill: (sig) => ptyProcess.kill(sig) } };
  }

  // 回退：普通 spawn（stdout 可能被缓冲）
  const child = isWin
    ? spawn(cmd, [], { stdio: ['inherit', 'pipe', 'pipe'], shell: true })
    : spawn('claude', cmd, { stdio: ['inherit', 'pipe', 'pipe'] });

  let stdoutBuf = '';
  child.stdout.on('data', (chunk) => {
    const s = stdoutBuf + chunk.toString();
    const lines = s.split(/\r?\n/);
    stdoutBuf = lines.pop() ?? '';
    for (const line of lines) parseNdjsonLine(line, onOutput);
  });
  child.stdout.on('end', () => {
    if (stdoutBuf) parseNdjsonLine(stdoutBuf, onOutput);
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
  console.log('[minimal-claude] spawn (no PTY) pid:', child.pid);
  return { child };
}

if (isMain) {
  const prompt = process.argv[2];
  if (!prompt) {
    console.error('Usage: node minimal-claude.js "your question"');
    process.exit(1);
  }
  runClaudeCli(prompt, {
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
