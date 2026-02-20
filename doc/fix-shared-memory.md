# 共享记忆系统问题修复日志

## 问题 1: Logger 格式化失败

### 现象
```
[2026-02-20 14:21:47] [agentRunner] runClaudeCli() starting: agentId=%s prompt=%s sessionId=%s 1 ...
```
`%s` 没有被替换。

### 原因
logger.js 实现：
```javascript
const log = (...args) => console.log(`[${timestamp()}]`, ...args);
```

console.log 的 printf 格式化只对第一个参数生效。由于时间戳是第一个参数，格式化字符串作为第二个参数就不会被处理。

### 修复
使用 Node.js 的 `util.format` 进行格式化：
```javascript
import util from 'util';

const log = (...args) => {
  const msg = args.length > 1 && typeof args[0] === 'string' && args[0].includes('%')
    ? util.format(...args)
    : args.join(' ');
  console.log(`[${timestamp()}] ${msg}`);
};
```

---

## 问题 2: assistant 消息记录

### 分析
assistant 消息通过 App.jsx 的 onExit 回调发送到 `/api/messages`，会触发 recordEvent。

流程：
1. Agent 输出流式返回 -> streamingRef 收集
2. Agent 退出 -> onExit 调用
3. POST /api/messages (role: assistant, task_id: selectedConversationId)
4. chats.js 保存消息并调用 recordEvent

### 潜在问题
- conversationId 依赖前端状态，可能不准确
- 如果用户切换对话时 Agent 还在运行，消息会保存到错误的对话

### 待确认
需要实际测试验证 assistant 消息是否正确记录到 shared_events。

---

## 问题 3: Claude CLI 有输出但前端收不到

### 现象
- 直接运行 `node minimal-claude.js "2+2等于多少"` 有输出
- 通过页面调用 Agent 无输出

### 根因分析

1. **Windows PTY 参数解析问题**：prompt 中的 `---` 被 shell 解析为选项
2. **PTY 换行符丢失**：PTY 输出中多个 JSON 对象粘在一起，没有换行符分隔
3. **JSON 对象位置计算错误**：使用 stripAnsi 后位置偏移，导致 remaining 计算错误

日志证据：
```
chunk 5: 2018 chars, found 1 JSON objects, buffer 133 chars
buffer 以 "web-artifacts-builder..." 开头（没有 {）
```

### 修复

1. **参数转义**：正确转义 Windows shell 特殊字符
2. **JSON 边界解析**：不依赖换行符，通过 `{}` 括号匹配提取完整 JSON 对象
3. **位置跟踪**：在原始文本上解析，记录每个对象的 start 位置，用最后一个对象的 end 位置计算 remaining

```javascript
function extractJsonObjects(text) {
  // 跳过 ANSI 控制字符但不影响位置计算
  // 通过 depth 计数匹配 {} 边界
  // 记录每个对象的 start 位置
  // 用最后一个对象的 start + length 计算 consumed
  return { objects, remaining: text.substring(consumed) };
}
```

---

## 修复记录

### 2026-02-21
- 修复 logger.js 格式化问题
- 修复 Windows PTY 参数转义
- 修复 PTY 换行符丢失：使用 JSON 边界解析替代换行符分割
- 修复 JSON 对象位置计算：在原始文本上跟踪位置，正确计算 remaining
