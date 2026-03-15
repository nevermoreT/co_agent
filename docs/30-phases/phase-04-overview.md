# Phase 4: A2A 机制与主动开口机制

## 概述

Phase 4 是实现真正的多 Agent 协作系统的关键阶段，包含两大核心机制：

1. **A2A (Agent-to-Agent) 机制** - Agent 之间可以互相发现、通信和协作
2. **主动开口机制** - Agent 可以主动向用户或其他 Agent 发送消息，而不需要被动等待请求

## 背景与动机

### 当前系统的局限

在 Phase 3 及之前，Agent 是"被动响应"模式：
- 用户发送消息 → Agent 处理 → 返回结果
- Agent 之间无法直接通信
- 没有 Agent 自主发起对话的能力

### Cat Café 的启示

参考 [Cat Café](https://github.com/zts212653/cat-cafe-tutorials) 项目的设计：
- **布偶猫 (Claude)** - 主架构师，核心开发
- **缅因猫 (Codex)** - Code Review，安全，测试  
- **暹罗猫 (Gemini)** - 视觉设计，创意

三只猫猫可以互相协作，例如：
1. 布偶猫写代码时主动 @缅因猫 来 review
2. 缅因猫发现问题后主动反馈给布偶猫
3. 暹罗猫主动提供视觉建议

### Google A2A 协议

Google 于 2025 年 4 月开源的 [A2A 协议](https://github.com/google/A2A) 提供了标准化的 Agent 间通信方案：
- **50+ 企业支持**（Salesforce、SAP、ServiceNow 等）
- **与 MCP 互补** - MCP 连接工具，A2A 连接 Agent
- **基于 HTTP + JSON-RPC 2.0 + SSE**

## 核心概念

### 1. A2A 协议核心组件

```
┌─────────────────────────────────────────────────────────────┐
│                      A2A 协议架构                            │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  Agent Card  │  │    Task      │  │   Message    │       │
│  │  (智能体名片)  │  │   (任务)     │  │   (消息)     │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         │                 │                 │               │
│         ▼                 ▼                 ▼               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              通信机制 (HTTP + SSE)                   │   │
│  │         JSON-RPC 2.0 协议封装                       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### Agent Card（智能体名片）

每个 Agent 暴露的能力描述：
```json
{
  "name": "Claude CLI",
  "description": "代码架构师 Agent",
  "url": "http://localhost:3000/a2a/claude-cli",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "code-review",
      "name": "代码审查",
      "description": "审查代码质量和架构设计",
      "tags": ["code", "review", "architecture"]
    },
    {
      "id": "architecture-design",
      "name": "架构设计", 
      "description": "设计系统架构",
      "tags": ["architecture", "design"]
    }
  ]
}
```

#### Task（任务）

一次协作的工作单元：
```json
{
  "id": "task-123",
  "sessionId": "session-456",
  "status": "working", // pending | working | completed | failed
  "history": [
    { "role": "user", "content": "帮我设计一个登录模块" },
    { "role": "agent", "content": "我来设计...", "agentId": "claude-cli" }
  ],
  "artifacts": []
}
```

#### Message（消息）

支持多种内容类型：
```json
{
  "role": "agent",
  "content": {
    "type": "text",
    "text": "设计方案如下..."
  },
  "metadata": {
    "agentId": "claude-cli",
    "timestamp": "2026-03-01T10:00:00Z"
  }
}
```

### 2. 主动开口机制

#### 触发条件

Agent 可以在以下场景主动开口：

1. **任务完成通知**
   - 后台任务完成时主动告知用户
   - 例如："代码审查完成，发现 3 个问题"

2. **需要协助时**
   - 遇到不确定的问题主动询问
   - 例如："这个设计需要产品经理确认，@ProductManager"

3. **发现重要信息**
   - 检测到关键事件主动提醒
   - 例如："检测到性能瓶颈，建议优化"

4. **定期报告**
   - 定时任务主动汇报进度
   - 例如："每日构建报告：所有测试通过"

5. **Agent 间协作**
   - 主动 @ 其他 Agent 请求协助
   - 例如："@CodeReviewer 请帮我 review 这段代码"

#### 消息类型

```typescript
enum ProactiveMessageType {
  TASK_COMPLETE = 'task_complete',     // 任务完成
  ASSISTANCE_REQUEST = 'assistance',    // 请求协助
  ALERT = 'alert',                      // 重要提醒
  SCHEDULED_REPORT = 'scheduled',       // 定期报告
  A2A_INVOCATION = 'a2a_invocation',    // 调用其他 Agent
  A2A_RESPONSE = 'a2a_response',        // 响应其他 Agent
}
```

## 架构设计

### 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端 (React)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  ChatPanel   │  │  TaskPanel   │  │  ProactiveMessage    │  │
│  │   (聊天)      │  │   (任务)      │  │   Toast/通知         │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         │ WebSocket
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      后端 (Node.js)                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    A2A Server                               │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │ │
│  │  │ Agent Card   │  │ Task Manager │  │  Message     │       │ │
│  │  │ Endpoint     │  │              │  │  Router      │       │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘       │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                Proactive Speaking Engine                    │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │ │
│  │  │  Trigger     │  │  Scheduler   │  │  Push        │       │ │
│  │  │  Detector    │  │              │  │  Service     │       │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘       │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 数据流

#### A2A 通信流程

```
1. 发现阶段
   Agent A ──GET /.well-known/agent.json──→ Agent B
   Agent A ←────Agent Card (能力描述)─────── Agent B

2. 任务创建
   Agent A ──POST /a2a/tasks/send─────────→ Agent B
   Agent A ←────Task ID + 初始状态────────── Agent B

3. 流式响应 (SSE)
   Agent A ←────Server-Sent Events────────── Agent B
              (status updates, messages)

4. 任务完成
   Agent A ←────Task completed────────────── Agent B
```

#### 主动开口流程

```
1. 触发检测
   Agent Runner ──检测到事件──→ Trigger Detector

2. 决策判断
   Trigger Detector ──是否应该主动开口？──→ Decision Engine

3. 消息生成
   Decision Engine ──生成消息内容──→ Message Builder

4. 推送
   Message Builder ──WebSocket push──→ Frontend

5. 展示
   Frontend ──Toast/Notification──→ User
```

## API 设计

### A2A 协议端点

```
# Agent Card 发现
GET   /.well-known/agent.json

# 任务管理
POST  /a2a/tasks/send              # 发送任务
POST  /a2a/tasks/sendSubscribe     # 发送任务并订阅 (SSE)
POST  /a2a/tasks/cancel            # 取消任务
GET   /a2a/tasks/:id               # 获取任务状态

# 能力查询
POST  /a2a/agents/search           # 搜索 Agent
GET   /a2a/agents/:id              # 获取 Agent 详情
```

### 主动开口 API

```
# 内部 API
POST  /api/internal/proactive      # Agent 主动发送消息
GET   /api/internal/proactive/config  # 获取主动开口配置
PUT   /api/internal/proactive/config  # 更新配置

# WebSocket 事件
proactive:message                  # 主动消息事件
proactive:typing                   # 正在输入提示
```

## 数据库 Schema 扩展

### 新增表

```sql
-- A2A Agent 注册表（支持远程 Agent）
CREATE TABLE a2a_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,           -- Agent Card URL
  agent_card TEXT,                  -- JSON 格式的 Agent Card
  is_local INTEGER DEFAULT 1,       -- 1=本地, 0=远程
  status TEXT DEFAULT 'active',     -- active | inactive | error
  last_seen_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- A2A 任务表
CREATE TABLE a2a_tasks (
  id TEXT PRIMARY KEY,              -- UUID
  session_id TEXT,                  -- 关联的会话
  source_agent_id INTEGER,          -- 发起方
  target_agent_id INTEGER,          -- 目标方
  status TEXT DEFAULT 'pending',    -- pending | working | completed | failed
  input TEXT,                       -- 输入内容 (JSON)
  output TEXT,                      -- 输出内容 (JSON)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 主动消息记录
CREATE TABLE proactive_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  conversation_id INTEGER,
  message_type TEXT NOT NULL,       -- task_complete | assistance | alert | scheduled | a2a
  content TEXT NOT NULL,
  metadata TEXT,                    -- JSON
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Agent 间消息路由记录
CREATE TABLE a2a_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  from_agent_id INTEGER,
  to_agent_id INTEGER,
  message_content TEXT,
  direction TEXT,                   -- outgoing | incoming
  created_at TEXT DEFAULT (datetime('now'))
);
```

## 实现计划

### 阶段 4.1: A2A 基础协议 ✅ 已完成
- [x] Agent Card 端点实现
- [x] Task 生命周期管理
- [x] SSE 流式响应
- [x] 本地 Agent 注册
- [x] 单元测试与验证

### 阶段 4.2: Agent 间通信
- [ ] Agent 发现机制
- [ ] 消息路由系统
- [ ] @Agent 解析增强（支持 A2A）
- [ ] 跨 Agent 任务委托
- [ ] 意图识别与路由

### 阶段 4.3: 提及防护机制
- [ ] Mention Counter（提及计数器）
- [ ] Cycle Detector（循环检测器）
- [ ] Rate Limiter（速率限制）
- [ ] Chain Depth Guard（调用链深度限制）
- [ ] 熔断机制

### 阶段 4.4: 主动开口机制（高阶特性）
- [ ] 触发器框架
- [ ] 任务完成自动通知
- [ ] 协助请求机制
- [ ] 定期报告功能
- [ ] 前端 Toast/通知组件

## 重要设计决策

在开始 Phase 4 实现之前，我们进行了详细的设计讨论，包括：

- **简单聊天 vs A2A Task**：何时触发 A2A？如何区分？
- **会话与 Task 的关系**：一个会话可以有多个 Task 吗？
- **权限控制**：Agent 可以随便调用其他 Agent 吗？
- **循环调用防护**：如何避免 A2 → B → A 的死循环？
- **Task 可见性**：用户能看到 Task 执行过程吗？

**详细设计决策记录**：[phase-04-design-decisions.md](./phase-04-design-decisions.md)

## 参考资源

### Google A2A 协议
- GitHub: https://github.com/google/A2A
- 文档: https://a2a-protocol.org
- 规范: https://a2a-protocol.org/latest/specification

### Cat Café 项目
- GitHub: https://github.com/zts212653/cat-cafe-tutorials
- 特色: 三只猫猫协作系统

### 相关协议
- MCP (Model Context Protocol): https://github.com/modelcontextprotocol

## 风险与挑战

1. **复杂性增加** - A2A 协议引入了分布式系统的复杂性
2. **调试困难** - Agent 间通信链路追踪较复杂
3. **安全风险** - 需要验证 Agent 身份，防止恶意调用
4. **性能问题** - 多 Agent 协作可能引入延迟

## 下一步

1. 创建详细的 A2A 协议实现文档
2. 设计主动开口的触发器框架
3. 实现 Agent Card 基础端点
4. 添加 SSE 流式支持
