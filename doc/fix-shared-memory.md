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

## 修复记录

### 2026-02-20
- 修复 logger.js 格式化问题
- 分析 assistant 消息流程
