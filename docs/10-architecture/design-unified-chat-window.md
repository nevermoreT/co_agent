# 统一聊天窗口设计文档

## 概述

将原有的单 Agent 聊天窗口改造为统一聊天窗口，所有 Agent 的对话在同一个界面中进行，通过 `@AgentName` 指定对话目标。

## 设计目标

1. **统一视图**: 所有对话在一个窗口中展示，便于查看完整上下文
2. **灵活调用**: 通过 `@` 提及指定 Agent，支持带空格的 Agent 名称
3. **可扩展性**: 不强制要求 `@` Agent，允许发送普通消息，为未来功能预留空间

## 数据模型

### 新增表: `global_messages`

```sql
CREATE TABLE global_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,              -- 'user' | 'assistant'
  content TEXT NOT NULL DEFAULT '',
  agent_id INTEGER,                -- 可为空，表示普通消息
  agent_name TEXT,                 -- 冗余存储，便于显示
  task_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### API 端点

- `GET /api/messages` - 获取全局消息列表
- `POST /api/messages` - 创建新消息

## 前端架构

### 组件变更

**ChatPanel.jsx**
- 移除 Agent 选择下拉框
- 使用 `useGlobalMessages` hook 获取全局消息
- 实现 `@` 提及解析和自动补全
- 支持发送普通消息（不指定 Agent）

**App.jsx**
- 移除 `selectedAgentId` 状态
- 新增 `streamingAgentId` 追踪当前输出的 Agent

**RightPanel.jsx**
- 移除 Agent 选中状态
- 聊天记录改为显示全局消息

### 新增 Hook

**useGlobalMessages.js**
- 获取 `/api/messages` 数据
- 提供 `addMessage` 方法用于本地更新

## @提及解析算法

```javascript
const parseTargetAgent = (text) => {
  if (!text.startsWith('@')) return null;

  const textWithoutAt = text.slice(1);
  // 按名称长度降序排序，优先匹配最长的名称
  const sortedAgents = [...agents].sort((a, b) => b.name.length - a.name.length);

  for (const agent of sortedAgents) {
    const nameLower = agent.name.toLowerCase();
    const textLower = textWithoutAt.toLowerCase();

    if (textLower.startsWith(nameLower)) {
      const afterName = textWithoutAt.slice(agent.name.length);
      if (afterName === '' || afterName.startsWith(' ')) {
        return { agent, textWithoutMention: afterName.trimStart() };
      }
    }
  }
  return null;
};
```

**关键点**:
- 支持带空格的 Agent 名称（如 "Claude CLI"）
- 按名称长度降序匹配，避免短名称误匹配
- 名称后必须是空格或字符串结尾

## 消息流程

### 带 @Agent 的消息

```
用户输入: "@Claude CLI 你好"
    ↓
解析得到: agent="Claude CLI", text="你好"
    ↓
保存到 global_messages (role=user, agent_id, agent_name)
    ↓
WebSocket: start(agentId) → send(agentId, "你好")
    ↓
Agent 输出流式返回
    ↓
Agent 退出后保存到 global_messages (role=assistant, agent_id, agent_name)
```

### 普通消息（无 @Agent）

```
用户输入: "这是一条备注"
    ↓
保存到 global_messages (role=user, agent_id=null, agent_name=null)
    ↓
不触发任何 Agent
```

## 扩展性考虑

1. **多 Agent 协作**: 未来可支持一条消息 @ 多个 Agent
2. **消息类型**: `agent_id=null` 的消息可作为系统消息、备注等
3. **上下文传递**: 全局消息可作为多 Agent 共享的上下文
4. **消息过滤**: 可按 Agent 过滤显示特定对话

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `server/db.js` | 修改 | 新增 `global_messages` 表 |
| `server/routes/chats.js` | 修改 | 新增 `/api/messages` 端点 |
| `client/hooks/useGlobalMessages.js` | 新增 | 全局消息 hook |
| `client/components/ChatPanel.jsx` | 重写 | 统一聊天界面 |
| `client/components/ChatPanel.css` | 修改 | 样式调整 |
| `client/App.jsx` | 修改 | 状态管理调整 |
| `client/components/RightPanel.jsx` | 修改 | 移除选中状态 |

## 版本历史

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| 1.0 | 2026-02-18 | CodeArts | 初始版本 |
