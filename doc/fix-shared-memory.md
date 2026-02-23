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

## 问题 4: 上下文注入不相关内容

### 现象
用户问 `@Claude CLI 2+2=多少`，但 Claude 收到的上下文包含 Opencode CLI 的长回复，导致回复偏离主题。

### 根因
1. shared_events 记录了所有消息（用户和 Agent 回复）
2. Agent 回复通常很长，标题截断后仍然很长
3. excludeAgentId 排除了当前 Agent，但保留了其他 Agent 的回复

### 修复
1. **只记录用户消息**：`role === 'user'` 才记录到 shared_events
2. **移除 @Agent 前缀**：标题只显示实际内容，不显示 `@AgentName`
3. **简化标题**：截断到 50 字符
4. **移除 excludeAgentId**：只记录用户消息后无需排除

---

## 问题 5: 上下文格式导致 CLI 无法正确理解

### 现象
用户问 `2+2=多少`，Claude 回复关于 Phase 1 报告的内容，完全不相关。

### 根因分析

1. **Session 缓存污染**
   - `--continue` 恢复最近会话，该会话包含大量历史（input_tokens: 43459）
   - 之前的 session_id 被保存，后续调用用 `--resume` 恢复脏会话

2. **上下文格式问题**
   - 多行格式在 Windows PTY 中被截断
   - `###` markdown 标题被 CLI 当作标题
   - 上下文太长，喧宾夺主

3. **Prompt 结构问题**
   - 背景信息和用户问题混在一起
   - 模型优先关注开头，但背景在前面

### 修复过程

#### Step 1: 禁用 session 复用
```javascript
continue: false  // 不使用 --continue
```

#### Step 2: 简化上下文格式
从多行：
```
### 项目共识
...
### 最近对话
...
---
用户请求：xxx
```

改为单行：
```
请回答: 2+2=多少 (背景: 之前用户问过: "问题1" "问题2")
```

#### Step 3: 调整 Prompt 结构
用户问题放在最前面，背景放在后面：
```
请回答: ${prompt} (背景: ${memoryContext})
```

### 当前状态（未完全解决）

**问题**：上下文注入后，Agent 回复仍然不理想。

**可能原因**：
1. 上下文仍然太长（3条历史）
2. 背景信息格式不够清晰
3. 需要区分 System Message 和 User Message

**待尝试**：
1. 减少历史记录数（3 → 1）
2. 使用更明确的分隔符
3. 参考 OpenAI 的 System/Assistant/User Message 设计

---

## 问题 6: @Agent 前缀移除不完整

### 现象
`@Claude CLI 2+2=多少` → 标题变成 `CLI 2+2=多少`（还剩 CLI）

### 根因
正则 `/^@\S+\s+/` 只匹配到第一个空格，但 Agent 名称包含空格。

### 修复
```javascript
content.replace(/^@[A-Za-z\s]+(?=\s\S)/, '').trim()
```

---

## 修复记录

### 2026-02-20
- 修复 logger.js 格式化问题
- 修复 Windows PTY 参数转义
- 修复 PTY 换行符丢失：使用 JSON 边界解析
- 修复 JSON 对象位置计算
- 修复上下文注入：只记录用户消息，移除 @Agent 前缀
- 禁用 session 复用，避免历史污染
- 简化上下文格式为单行
- 把用户问题放在 prompt 开头
- opencode 添加完整命令日志

### 未解决
- 记忆系统上下文注入效果不理想
- 需要重新设计 Prompt 逻辑（参考 System/User Message 区分）
