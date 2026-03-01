# CLI JSON 输出格式分析

本文档记录 Claude CLI 和 Opencode CLI 的 NDJSON 输出格式，以及当前实现的解析方式。

## 1. Claude CLI (`--output-format stream-json`)

### 当前解析的事件类型

| type | 结构 | 说明 | 当前处理 |
|------|------|------|---------|
| `assistant` | `{ type: "assistant", message: { content: [{type: "text", text: "..."}] } }` | 助手回复 | ✅ 提取 `text` 输出到 stdout |
| `system` | `{ type: "system", session_id: "..." }` | 系统消息 | ✅ 提取 `session_id` |
| `result` | `{ type: "result", session_id: "..." }` | 最终结果 | ✅ 提取 `session_id` |

### 当前解析逻辑

```javascript
// minimal-claude.js: parseNdjsonLine()
function parseNdjsonLine(line, onOutput, onSession) {
  const obj = JSON.parse(raw);
  
  // 1. 检测 session_id（用于持久化会话）
  if (obj.type === 'system' && obj.session_id) {
    onSession(obj.session_id);
  }
  if (obj.type === 'result' && obj.session_id) {
    onSession(obj.session_id);
  }
  
  // 2. 提取文本内容
  if (obj.type === 'assistant' && obj.message?.content) {
    for (const block of obj.message.content) {
      if (block.type === 'text' && block.text) {
        onOutput('stdout', block.text);
      }
    }
  }
}
```

### 可能的其他事件类型（未处理）

```json
// 用户消息
{ "type": "user", "message": { "content": [...] } }

// 思考过程（extended thinking）
{ "type": "thinking", "thinking": "..." }

// 工具使用
{ "type": "tool_use", "name": "...", "input": {...} }
{ "type": "tool_result", "tool_use_id": "...", "content": "..." }

// 错误
{ "type": "error", "error": { "type": "...", "message": "..." } }

// 流式消息控制
{ "type": "message_start", "message": {...} }
{ "type": "message_delta", "delta": {...} }
{ "type": "message_stop" }

// 内容块流式控制
{ "type": "content_block_start", "index": 0, "content_block": {...} }
{ "type": "content_block_delta", "index": 0, "delta": {...} }
{ "type": "content_block_stop", "index": 0 }
```

---

## 2. Opencode CLI (`--format json`)

### 当前解析的事件类型

| type | 结构 | 说明 | 当前处理 |
|------|------|------|---------|
| `session` | `{ type: "session", id: "..." }` | 会话信息 | ✅ 提取 `id` 作为 session_id |
| `text` | `{ type: "text", part: { text: "..." } }` | 文本输出 | ✅ 提取 `part.text` 输出到 stdout |
| `tool_use` | `{ type: "tool_use", part: { tool: "...", state: { title: "...", output: "..." } } }` | 工具调用 | ✅ 格式化输出 `[title]\noutput` |
| `step_start` | `{ type: "step_start", step_id: "..." }` | 步骤开始 | ❌ 忽略 |
| `step_finish` | `{ type: "step_finish", step_id: "..." }` | 步骤结束 | ❌ 忽略 |
| `permission_request` | `{ type: "permission_request", description: "..." }` | 权限请求 | ✅ 输出到 stderr |

### 当前解析逻辑

```javascript
// minimal-opencode.js: parseNdjsonLine()
function parseNdjsonLine(line, onOutput, onSession) {
  const obj = JSON.parse(raw);
  
  if (obj.type === 'session' && obj.id) {
    // 会话 ID，用于持久化
    onSession(obj.id);
  } else if (obj.type === 'text' && obj.part?.text) {
    // 文本输出
    onOutput('stdout', obj.part.text);
  } else if (obj.type === 'tool_use' && obj.part?.state?.output) {
    // 工具调用结果
    const toolName = obj.part.tool || 'tool';
    const title = obj.part.state.title || toolName;
    onOutput('stdout', `\n[${title}]\n${obj.part.state.output}\n`);
  } else if (obj.type === 'permission_request') {
    // 权限请求（需要用户确认）
    onOutput('stderr', `[权限请求] ${obj.description || JSON.stringify(obj)}\n`);
  }
  // step_start, step_finish 等被忽略
}
```

### 可能的其他事件类型（未处理）

```json
// 错误
{ "type": "error", "message": "..." }

// 进度更新
{ "type": "progress", "percent": 50 }

// 状态变化
{ "type": "status", "status": "thinking" | "reading" | "writing" | "..." }

// 文件操作
{ "type": "file_read", "path": "...", "content": "..." }
{ "type": "file_write", "path": "...", "bytes": 1234 }

// Bash 命令
{ "type": "bash", "command": "...", "exit_code": 0, "output": "..." }
```

---

## 3. 通用处理流程

### NDJSON 解析流程

```
1. 接收原始数据流（可能包含 ANSI 转义序列）
2. 按 \r?\n 分割为独立行
3. 对每行调用 stripAnsi() 移除 ANSI 转义
4. 尝试 JSON.parse()
5. 根据 type 字段分发处理
6. 调用对应的回调函数（onOutput / onSession）
```

### stripAnsi 实现

```javascript
function stripAnsi(s) {
  return String(s)
    .replace(/\r/g, '')                              // 移除 \r
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')          // 移除 CSI 序列
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // 移除 OSC 序列
    .replace(/\x1b\?[0-9;]*[A-Za-z]/g, '')          // 移除 ? 序列
    .replace(/\[\?[0-9;]*[A-Za-z]/g, '')            // 移除 [? 序列
    .trim();
}
```

---

## 4. 会话管理

### Claude CLI 会话参数

| 参数 | 说明 |
|------|------|
| `--continue` / `-c` | 继续最近的会话 |
| `--resume <id>` / `-r <id>` | 恢复指定会话 |
| `--session-id <uuid>` | 使用指定的 UUID 作为会话 ID |

### Opencode CLI 会话参数

| 参数 | 说明 |
|------|------|
| `--continue` / `-c` | 继续最近的会话 |
| `--session <id>` / `-s <id>` | 使用指定会话 ID |

### Session ID 检测时机

- **Claude CLI**: 在 `system` 或 `result` 事件的 `session_id` 字段
- **Opencode CLI**: 在 `session` 事件的 `id` 字段

---

## 5. 未来增强建议

### 5.1 完整事件类型支持

可以扩展解析逻辑，支持更多事件类型：

```javascript
// 增强版 Claude CLI 解析
switch (obj.type) {
  case 'system':
  case 'result':
    if (obj.session_id) onSession(obj.session_id);
    break;
  case 'assistant':
  case 'message_delta':
    extractText(obj).forEach(text => onOutput('stdout', text));
    break;
  case 'thinking':
    onOutput('stderr', `[思考] ${obj.thinking}\n`);
    break;
  case 'tool_use':
    onOutput('stderr', `[工具] ${obj.name}\n`);
    break;
  case 'error':
    onOutput('stderr', `[错误] ${obj.error?.message}\n`);
    break;
}
```

### 5.2 结构化输出

将不同类型的事件存储到数据库，便于后续分析：

```sql
CREATE TABLE cli_events (
  id INTEGER PRIMARY KEY,
  agent_id INTEGER,
  type TEXT,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 5.3 工具调用追踪

记录工具调用历史，支持：

- 查看工具调用链
- 调试工具执行结果
- 统计工具使用频率

---

## 6. 参考资料

- Claude CLI: `claude --help`
- Opencode CLI 文档: https://opencode.ai/docs/cli
- 测试 Mock 数据: `test/mocks/cliMock.js`
