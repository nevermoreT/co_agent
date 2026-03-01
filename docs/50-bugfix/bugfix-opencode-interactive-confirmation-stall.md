# Bugfix: OpenCode CLI 交互确认模式卡死问题

## 问题描述

在使用 opencode CLI 进行对话时，可能会陷入交互确认模式，导致页面无法进一步进行对话。

## 问题分析

### 1. 问题现象

- 当 opencode CLI 执行某些操作时，进程会卡住，不再输出任何内容
- 前端 WebSocket 连接保持，但无法收到新的输出
- 进程不会退出，也不会继续执行

### 2. 根本原因

#### 原因 A: stdin 继承问题

在 `minimal-opencode.js` 第 98 行：

```javascript
const child = isWin
    ? spawn(cmd, [], { stdio: ['inherit', 'pipe', 'pipe'], shell: true })
```

`stdio: ['inherit', 'pipe', 'pipe']` 意味着 stdin 是从父进程继承的。当 opencode 需要用户确认时，它会尝试从 stdin 读取用户输入，但由于：

1. 父进程（Node.js 服务器）没有 stdin 输入
2. opencode 进程一直在等待 stdin 输入

导致进程永久卡住。

#### 原因 B: PTY 模式下的 TUI 启动

当使用 node-pty 启动 opencode 时：

```javascript
const ptyProcess = ptySpawn(file, args, {
  name: 'xterm-256color',
  cols: 8192,
  rows: 24,
  ...
});
```

PTY 会创建一个完整的伪终端环境，opencode 可能会检测到 TTY 并尝试启动 TUI（终端用户界面）模式，而不是非交互式 JSON 输出模式。

### 3. 对比 Claude CLI

`minimal-claude.js` 使用了 `--permission-mode acceptEdits` 参数：

```javascript
const cmd = isWin
    ? `claude -p "${escaped}" --output-format stream-json --verbose --permission-mode acceptEdits`
```

这个参数告诉 Claude CLI 自动接受编辑操作，不需要用户确认。但 opencode CLI 没有类似的参数。

### 4. OpenCode 的权限系统分析

根据 opencode 源代码分析（`internal/permission/permission.go`）：

- opencode 有一个权限服务 `permission.Service`
- 当工具执行需要权限时，会调用 `Request()` 方法
- `Request()` 方法会发送一个权限请求并等待响应：`resp := <-respCh`
- 在非交互模式下，`AutoApproveSession()` 会自动批准所有权限请求

但问题是：`opencode run` 命令是否正确地调用了 `AutoApproveSession()`？

根据 `internal/app/app.go` 的代码：

```go
func (a *App) RunNonInteractive(ctx context.Context, prompt string, outputFormat string, quiet bool) error {
    // ...
    // Automatically approve all permission requests for this non-interactive session
    a.Permissions.AutoApproveSession(sess.ID)
    // ...
}
```

`RunNonInteractive` 方法会自动批准权限。但这个方法是通过 `opencode -p "prompt"` 调用的，而不是 `opencode run`。

经过实际测试，`opencode run --format json "prompt"` 在命令行中直接运行时可以正常工作，工具使用也会自动批准。问题可能出在我们的包装器实现上。

## 修复方案

### 方案 1: 修改 stdin 配置（推荐）

将 stdin 从 `'inherit'` 改为 `'pipe'` 或 `'ignore'`，让 opencode 无法从 stdin 读取：

```javascript
// 修改前
const child = isWin
    ? spawn(cmd, [], { stdio: ['inherit', 'pipe', 'pipe'], shell: true })

// 修改后
const child = isWin
    ? spawn(cmd, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: true })
```

或者使用 `'ignore'`：

```javascript
const child = isWin
    ? spawn(cmd, [], { stdio: ['ignore', 'pipe', 'pipe'], shell: true })
```

### 方案 2: 立即关闭 stdin

在 spawn 后立即关闭 stdin：

```javascript
const child = spawn(cmd, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: true });
child.stdin.end(); // 立即关闭 stdin
```

### 方案 3: 检测并处理非 JSON 输出

在 `parseNdjsonLine` 中添加对非 JSON 输出的处理，可能是权限确认请求：

```javascript
function parseNdjsonLine(line, onOutput) {
  const raw = stripAnsi(line);
  if (!raw) return;
  
  // 检测是否是权限确认请求
  if (raw.includes('permission') || raw.includes('confirm') || raw.includes('[Y/n]')) {
    onOutput('stderr', `[权限请求] ${raw}\n`);
    return;
  }
  
  try {
    const obj = JSON.parse(raw);
    // ... 处理 JSON 输出
  } catch (_) {
    // 非 JSON 输出，记录到 stderr
    onOutput('stderr', raw + '\n');
  }
}
```

### 方案 4: 添加超时机制

为进程添加超时机制，避免永久卡住：

```javascript
export function runOpencodeCli(prompt, { onOutput, onExit, timeout = 300000 }) {
  // ... spawn 代码
  
  const timeoutId = setTimeout(() => {
    onOutput('stderr', '\n[超时] 操作超时，正在终止进程...\n');
    child.kill();
  }, timeout);
  
  child.on('exit', (code, signal) => {
    clearTimeout(timeoutId);
    onExit && onExit(code ?? -1, signal);
  });
}
```

## 实施的修复

### 修复 1: 修改 stdin 配置

**文件**: `minimal-opencode.js`

**修改内容**（第 104-109 行）:
```javascript
// 修改前
const child = isWin
    ? spawn(cmd, [], { stdio: ['inherit', 'pipe', 'pipe'], shell: true })
    : spawn('opencode', cmd, { stdio: ['inherit', 'pipe', 'pipe'] });

// 修改后
const child = isWin
    ? spawn(cmd, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: true })
    : spawn('opencode', cmd, { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.end();
```

**效果**: 这确保 opencode 无法从 stdin 读取任何内容，避免等待用户输入导致卡死。

### 修复 2: 增强 stripAnsi 函数

**文件**: `minimal-opencode.js`

**修改内容**（第 22-31 行）:
```javascript
// 修改前
function stripAnsi(s) {
  return String(s)
    .replace(/\r/g, '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .trim();
}

// 修改后
function stripAnsi(s) {
  return String(s)
    .replace(/\r/g, '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\?[0-9;]*[A-Za-z]/g, '')  // 新增：处理 \x1b? 开头的序列
    .replace(/\[\?[0-9;]*[A-Za-z]/g, '')    // 新增：处理 [? 开头的序列（如 [?25h）
    .trim();
}
```

**效果**: 更好地清除 PTY 输出的 ANSI 转义序列，避免这些序列被误判为交互提示。

### 修复 3: 增强 parseNdjsonLine

**文件**: `minimal-opencode.js`

**修改内容**（第 42-61 行）:
```javascript
// 修改后
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
      // 新增：处理权限请求事件
      onOutput('stderr', `[权限请求] ${obj.description || JSON.stringify(obj)}\n`);
    }
  } catch (_) {
    // 新增：检测可能的交互提示
    if (raw.includes('permission') || raw.includes('confirm') || raw.includes('[Y/n]') || raw.includes('?')) {
      onOutput('stderr', `[交互提示] ${raw}\n`);
    }
  }
}
```

**效果**: 
- 添加对 `permission_request` 事件类型的处理
- 检测可能的交互提示并输出到 stderr，便于调试

## 测试验证

### 测试 1: 基本问答

```bash
node minimal-opencode.js "what is 3+3"
```

**预期**: 正常输出结果
**实际**: 
```
[minimal-opencode] PTY spawned, pid: 17756

6
```
✅ 通过

### 测试 2: 文件列表

```bash
node minimal-opencode.js "list files in current directory"
```

**预期**: 正常输出文件列表
**实际**: 正常输出了目录内容和文件列表
✅ 通过

### 测试 3: 工具调用

```bash
node minimal-opencode.js "run npm run"
```

**预期**: 正常执行并输出结果，不会卡住
**实际**: 正常输出了 npm scripts 列表
✅ 通过

## 修复总结

| 问题 | 原因 | 修复方案 |
|------|------|----------|
| 进程卡死 | stdin 继承导致 opencode 等待输入 | 改用 `stdio: ['pipe', ...]` 并立即关闭 stdin |
| ANSI 序列干扰 | stripAnsi 未处理所有转义序列 | 添加对 `\x1b?` 和 `[?` 序列的处理 |
| 调试困难 | 无法看到交互提示 | 增强 parseNdjsonLine 检测并输出交互提示 |

## 相关文件

- `minimal-opencode.js` - OpenCode CLI 包装器
- `server/services/agentRunner.js` - Agent 运行服务
- `internal/permission/permission.go` - OpenCode 权限系统（opencode 源码）
- `internal/app/app.go` - OpenCode 应用核心（opencode 源码）

## 参考资料

- [OpenCode GitHub 仓库](https://github.com/opencode-ai/opencode)
- [OpenCode 权限系统文档](https://zread.ai/opencode-ai/opencode/18-tool-system-and-execution-framework)
