# Markdown 渲染与 Thinking 消息支持

## 概述

co_agent 现已支持丰富的 Markdown 渲染、Todo 列表、Thinking 消息折叠显示和多模态图片消息。

## 消息类型

系统支持三种消息类型：

| 类型 | 说明 | 渲染方式 |
|------|------|----------|
| `text` | 普通文本消息（默认） | Markdown 渲染 |
| `thinking` | 思考过程消息 | 折叠面板，点击展开 |
| `image` | 图片消息 | 图片展示 + 说明文字 |

## 后端 API 使用

### 发送消息

```javascript
POST /api/messages
Content-Type: application/json

{
  "role": "assistant",
  "content": "这是回答内容",
  "agent_id": 1,
  "agent_name": "Claude CLI",
  "task_id": 6,
  "message_type": "text"  // 或 "thinking"、"image"
}
```

### Thinking 消息示例

```javascript
{
  "role": "assistant",
  "content": "让我先分析一下用户的问题...\n\n用户询问的是关于...\n\n我需要考虑以下几点：\n1. ...",
  "agent_id": 1,
  "agent_name": "Claude CLI",
  "task_id": 6,
  "message_type": "thinking"
}
```

### 图片消息示例

```javascript
{
  "role": "assistant",
  "content": "![描述](https://example.com/image.png)",
  "agent_id": 1,
  "agent_name": "Claude CLI",
  "task_id": 6,
  "message_type": "image",
  "metadata": {
    "url": "https://example.com/image.png",
    "caption": "图片说明"
  }
}
```

## Markdown 支持

### 代码块

````markdown
```javascript
const hello = "world";
console.log(hello);
```
````

渲染为带语言标签的深色代码块。

### 任务列表（Todo）

```markdown
- [ ] 未完成的任务
- [x] 已完成的任务
```

渲染为带复选框的任务列表。

### 表格

```markdown
| 列 1 | 列 2 |
|------|------|
| 值 1 | 值 2 |
```

### 其他支持

- 标题（h1-h6）
- 列表（有序/无序）
- 引用块
- 链接
- 粗体/斜体
- 行内代码

## Thinking 消息特性

Thinking 消息会以折叠面板形式显示：

- **默认折叠**：不占用主对话空间
- **点击展开**：查看完整思考过程
- **视觉区分**：不同的背景色和边框
- **不计入上下文**：不会作为对话历史传递给后续 Agent 调用

## 前端组件

### MarkdownRenderer

```jsx
import { MarkdownRenderer } from './components/MarkdownRenderer';

<MarkdownRenderer content={markdownContent} />
```

### ThinkingMessage

```jsx
import { ThinkingMessage } from './components/MarkdownRenderer';

<ThinkingMessage 
  content={thinkingContent} 
  agentName="Claude CLI" 
/>
```

## 数据库 Schema

```sql
CREATE TABLE global_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  agent_id INTEGER,
  agent_name TEXT,
  task_id INTEGER,
  message_type TEXT DEFAULT 'text',  -- text, thinking, image
  metadata TEXT,  -- JSON string for image url, etc.
  created_at TEXT DEFAULT (datetime('now'))
);
```

## 最佳实践

### 1. Thinking 消息使用场景

- 复杂问题的分析过程
- 多步骤推理
- 代码审查思路
- 架构设计思考

### 2. 避免滥用 Thinking

- 简单回答不需要 thinking
- 过长的 thinking 会影响用户体验
- 建议 thinking 控制在 500 字符以内

### 3. 图片消息

- 使用 `metadata.url` 存储图片地址
- 使用 `metadata.caption` 添加说明
- 内容字段使用 Markdown 图片语法作为备用

## 多模态支持说明

当前模型本身已具备多模态能力，**不需要 MCP**即可处理图片：

1. **直接上传图片**：Agent 可以直接分析上传的图片
2. **图片 URL**：通过 metadata 传递图片链接
3. **Base64 编码**：支持 Base64 编码的图片数据

MCP 主要用于：
- 访问本地文件系统
- 调用外部工具/API
- 数据库访问

如果只需要图片理解功能，直接使用模型的多模态能力即可。

## 示例代码

### 后端保存 Thinking 消息

```javascript
// 在 websocket.js 或 agentRunner.js 中
db.prepare(`
  INSERT INTO global_messages (role, content, agent_id, agent_name, task_id, message_type)
  VALUES (?, ?, ?, ?, ?, 'thinking')
`).run('assistant', thinkingText, agentId, agentName, conversationId);
```

### 前端识别 Thinking

```jsx
{messages.map((m) => {
  if (m.message_type === 'thinking') {
    return <ThinkingMessage key={m.id} content={m.content} agentName={m.agent_name} />;
  }
  return <MarkdownRenderer key={m.id} content={m.content} />;
})}
```

## 相关文件

- `client/components/MarkdownRenderer.jsx` - Markdown 渲染组件
- `client/components/MarkdownRenderer.css` - 样式文件
- `client/components/ChatPanel.jsx` - 聊天面板（已更新支持）
- `server/db.js` - 数据库 Schema（已添加 message_type 字段）
- `server/routes/chats.js` - API 路由（已支持新字段）
