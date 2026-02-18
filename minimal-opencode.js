/**
 * minimal-opencode.js — 使用 spawn 或 node-pty 调用 opencode CLI 并解析流式 NDJSON 输出。
 * 优先使用 node-pty（伪终端）以解除子进程 stdout 缓冲；可被服务端 import 或直接运行。
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
} catch (_) {
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
 * - step_start: 步骤开始
 * - text: 文本输出，part.text 包含实际文本
 * - tool_use: 工具调用，part.state.output 包含工具输出
 * - step_finish: 步骤结束
 * - permission_request: 权限请求（需要确认）
 */
function parseNdjsonLine(line, onOutput) {
  const raw = stripAnsi(line);
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    if (obj.type === 'text' && obj.part?.text) {
      onOutput('stdout', obj.part.text);
    } else if (obj.type === 'tool_use' && obj.part?.state?.output) {
      const toolName = obj.part.tool || 'tool';
      const title = obj.part.state.title || toolName;
      onOutput('stdout', `\n[${title}]\n${obj.part.state.output}\n`);
    } else if (obj.type === 'permission_request') {
      onOutput('stderr', `[权限请求] ${obj.description || JSON.stringify(obj)}\n`);
    }
  } catch (_) {
    if (raw.includes('permission') || raw.includes('confirm') || raw.includes('[Y/n]') || raw.includes('?')) {
      onOutput('stderr', `[交互提示] ${raw}\n`);
    }
  }
}

function processPtyData(data, stdoutBuf, onOutput) {
  const s = stdoutBuf.current + data;
  const lines = s.split(/\r?\n/);
  stdoutBuf.current = lines.pop() ?? '';
  for (const line of lines) parseNdjsonLine(line, onOutput);
}

/**
 * 运行 opencode CLI（run --format json），解析 NDJSON 并回调 onOutput('stdout'|'stderr', text)。
 * 若已安装 node-pty 则用 PTY 启动以解除缓冲；否则用普通 spawn。
 */
export function runOpencodeCli(prompt, { onOutput, onExit }) {
  const escaped = (prompt || '').replace(/"/g, '\\"');
  const isWin = process.platform === 'win32';
  const cmd = isWin
    ? `opencode run --format json "${escaped}"`
    : ['run', '--format', 'json', prompt || ''];

  if (ptySpawn) {
    // 使用伪终端，子进程认为在写 TTY，通常不会全缓冲
    const file = isWin ? (process.env.COMSPEC || 'cmd.exe') : 'opencode';
    const args = isWin ? ['/c', cmd] : ['run', '--format', 'json', prompt || ''];
    const ptyProcess = ptySpawn(file, args, {
      name: 'xterm-256color',
      cols: 8192, // 足够宽，避免 PTY 在行内插入 \r\n 把一条 NDJSON 拆成多行
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
    console.log('[minimal-opencode] PTY spawned, pid:', ptyProcess.pid);
    return { child: { pid: ptyProcess.pid, kill: (sig) => ptyProcess.kill(sig) } };
  }

  // 回退：普通 spawn（stdout 可能被缓冲）
  // 使用 'pipe' 而不是 'inherit' 作为 stdin，避免 opencode 等待 stdin 输入导致卡死
  const child = isWin
    ? spawn(cmd, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: true })
    : spawn('opencode', cmd, { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();

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
      onOutput('stderr', '未找到 opencode CLI。请先安装并确保 "opencode" 已加入系统 PATH。\n');
    } else {
      onOutput('stderr', err.message + '\n');
    }
    onExit && onExit(-1, err.message);
  });
  child.on('exit', (code, signal) => {
    onExit && onExit(code ?? -1, signal);
  });
  console.log('[minimal-opencode] spawn (no PTY) pid:', child.pid);
  return { child };
}

if (isMain) {
  const prompt = process.argv[2];
  if (!prompt) {
    console.error('Usage: node minimal-opencode.js "your question"');
    process.exit(1);
  }
  runOpencodeCli(prompt, {
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
