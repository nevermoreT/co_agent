# Bugfix 记录：Claude CLI 对话无返回与 already running

本文档记录集成 Claude CLI 内置 Agent 后，针对「对话框内看不到任何返回」「重复发送导致误清空流式内容」以及 PTY 相关问题的排查与修复。

---

## 1. 对话内看不到任何返回（早期）

### 现象
在中间��话栏选择 Claude CLI 发送消息后，没有任何流式或最终回复显示。

### 修复内容

#### 1.1 minimal-claude.js：stdout 缓冲与 stderr 转发

| 项 | 说明 |
|----|------|
| **文件** | `minimal-claude.js` |
| **改动** | 去掉 readline，改为手动按行缓冲 stdout；在 `child.stdout` 的 `end` 中处理剩余缓冲，避免最后一行无换行时漏解析 |
| **stderr** | 将子进程 stdio 设为 `['inherit','pipe','pipe']`，对 `child.stderr` 的 `data` 事件调用 `onOutput('stderr', data)`，错误/进度会在同一对话流中显示 |

#### 1.2 服务端调试日志

| 项 | 说明 |
|----|------|
| **文件** | `server/websocket.js` |
| **改动** | 对 claude-cli 的 stdout 输出打印字符数，对进程退出打印 agentId/code/signal，便于确认是否有 output/exit |

---

## 2. 重复发送导致「already running」并误清空流式内容

### 现象
日志出现：
- `[claude-cli] exit agentId=1 code=-1 signal=SIGTERM`
- `[claude-cli] exit agentId=1 code=-1 signal=already running`

第二次请求在「已在运行」时被拒绝，但前端仍收到一次 `exit`，误以为进程结束，清空当前流式内容。

### 根因
`agentRunner.runClaudeCli()` 在检测到 `runs.has(key)` 时，除返回 `false` 外还调用了 `onExit(-1, 'already running')`。前端对所有 `type: 'exit'` 都做「进程结束」处理（清空 streaming、写入 assistant 等），因此被这次「假 exit」触发，导致正在显示的内容被清掉。

### 修复内容

| 项 | 说明 |
|----|------|
| **文件** | `server/services/agentRunner.js` |
| **改动** | 在 `runClaudeCli()` 的「already running」分支中**不再调用** `onExit`，仅 `return false`。错误提示由 WebSocket 层通过 `type: 'error'` 发送（如 "Claude CLI start failed (already running?)"） |

效果：
- 用户在前端只看到错误提示，不会误清空正在进行的回复
- 真正进程结束时的 `exit` 仍正常上报，逻辑不变
- 通过日志可以清楚看到 already running 的检测和拒绝

---

## 3. PTY 下 spawn 后卡住、无 stdout（缓冲）

### 现象
日志有 `[minimal-claude] PTY spawned, pid: xxx` 或 `child process spawned`，但之后无任何 stdout，进程长时间无输出或直到退出才一次性收到。

### 根因
子进程在**非 TTY**（普通 pipe）下运行时，很多 CLI 会对 stdout 做全缓冲，不 flush 则 Node 收不到 `data`。

### 修复内容

| 项 | 说明 |
|----|------|
| **依赖** | 新增 `node-pty` |
| **文件** | `minimal-claude.js` |
| **改动** | 若已安装 `node-pty`，则用 **PTY** 启动子进程（Windows: `cmd.exe /c "claude ..."`，非 Windows: 直接 `claude` + 参数），子进程认为在写 TTY 从而不全缓冲；否则回退为普通 `spawn` |

---

## 4. PTY 输出带 ANSI 转义导致 JSON 解析失败

### 现象
PTY 有数据到达，但对话框仍无内容；或调试时看到 `parse fail`，raw 内容里夹杂 `\x1b[32m` 等。

### 根因
PTY 下子进程会输出 ANSI 转义（颜色、标题等），整行不再是纯 JSON，`JSON.parse` 报错。

### 修复内容

| 项 | 说明 |
|----|------|
| **文件** | `minimal-claude.js` |
| **改动** | 增加 `stripAnsi()`：解析前去掉 `\r`、`\x1b\[...letter]`、OSC 序列等，再 `trim` 后 `JSON.parse` |

---

## 5. PTY cols=80 导致 NDJSON 被拆行、解析全部失败

### 现象
日志中大量 `parse fail`，preview 可见同一句 JSON 被拆成多段，例如：
- `{"type":"assistant","message":{"content":[{"text":"I'm ready to help you with th`
- `is multi-agent collaboration platform...`

### 根因
PTY 设置了 `cols: 80`，终端在 80 列处自动插入 `\r\n` 换行，一条完整 NDJSON 被拆成多行，每行都是不完整 JSON，解析全部失败。

### 修复内容

| 项 | 说明 |
|----|------|
| **文件** | `minimal-claude.js` |
| **改动** | PTY 选项将 `cols: 80` 改为 **`cols: 8192`**，避免在行内换行，保证按 `\r?\n` 拆分后每行是完整 NDJSON |

---

## 涉及文件一览

| 文件 | 变更摘要 |
|------|----------|
| `minimal-claude.js` | 手动 stdout 缓冲、结尾无换行处理、stderr 转发；node-pty 优先 PTY 启动；stripAnsi；cols: 8192 |
| `server/websocket.js` | claude-cli 的 output/exit 日志 |
| `server/services/agentRunner.js` | runClaudeCli 在 already running 时不调用 onExit |
| `package.json` | 依赖 `node-pty` |

---

## 建议使用方式

- 等待当前条回复完成后再发下一条；重复发送会收到「已在运行」类错误，流式内容不会被清空。
- 若仍无输出：确认本机已安装 Claude CLI 且 `claude` 在 PATH 中；后端终端查看是否有 `[minimal-claude] PTY spawned` 或 `spawn (no PTY)` 以及 `[claude-cli] exit`，便于区分环境/缓冲/解析问题。

