# Phase 4: A2A 与主动开口机制 - 设计决策记录

## 概述

本文档记录了 Phase 4 实现过程中的关键设计决策、问题讨论和解决方案。这些决策影响了 A2A 协议和主动开口机制的实现方式。

---

## 核心设计问题与决策

### 1. 简单聊天 vs A2A Task 的区分

#### 问题
> "简单聊天如何跟 task 区分？简单对话也会触发 A2A 吗？"

#### 决策

**明确区分两种交互模式：**

| 维度 | 简单聊天 (Chat) | A2A Task |
|------|----------------|----------|
| **触发方式** | 用户直接发送消息 | 显式的 `@Agent` 提及或程序化调用 |
| **生命周期** | 无明确生命周期，持续对话 | 有明确的创建→执行→完成/失败流程 |
| **状态追踪** | 不需要专门追踪 | 需要追踪 submitted/working/completed/failed 状态 |
| **持久化** | 普通消息记录 | 独立的 a2a_tasks 表 |
| **适用场景** | 日常问答、闲聊 | 需要明确交付物的协作任务 |

**实现策略：**

```javascript
// 简单聊天 - 直接通过 WebSocket 发送
ws.send(JSON.stringify({
  type: 'chat',
  agentId: 1,
  text: '你好，帮我看看这段代码'
}));

// A2A Task - 通过 A2A API 创建任务
fetch('/a2a/tasks/send', {
  method: 'POST',
  body: JSON.stringify({
    sessionId: 'conv-123',
    sourceAgentId: 1,  // 发起方
    targetAgentId: 2,  // 目标方
    input: {
      text: '请 review 这段代码',
      code: 'function foo() {...}'
    }
  })
});
```

**关键区别：**
- **简单聊天** = 用户与 Agent 的直接交互，不经过 A2A 协议层
- **A2A Task** = Agent 之间的正式协作，有任务 ID、状态流转、可追踪

---

### 2. 何时触发 A2A？

#### 决策矩阵

```
用户消息
    │
    ├── 包含 @Agent 提及？
    │       ├── YES → 创建 A2A Task
    │       │           ├── 本地 Agent → 直接调用
    │       │           └── 远程 Agent → HTTP A2A 调用
    │       │
    │       └── NO → 简单聊天
    │               └── 直接发送到当前选中的 Agent
    │
    └── 是系统命令？
            ├── YES → 本地处理
            └── NO → 继续判断
```

**触发规则：**

1. **显式触发**（推荐）
   - 用户输入 `@Claude 帮我 review 这段代码`
   - 系统自动创建 A2A Task，源 Agent 为当前对话 Agent，目标 Agent 为 Claude

2. **隐式触发**（可选，需配置）
   - Agent 分析用户意图，判断需要其他 Agent 协助
   - 例如：用户问"这个 UI 设计怎么样？"，当前 Agent 自动 @Designer

3. **程序化触发**
   - Agent 在思考过程中决定调用其他 Agent
   - 例如：代码 Agent 发现需要视觉设计，主动创建 A2A Task

---

### 3. A2A 任务的数据流

#### 完整流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   用户输入   │────→│  意图识别   │────→│  路由决策   │
└─────────────┘     └─────────────┘     └─────────────┘
                                                │
                        ┌───────────────────────┼───────────────────────┐
                        │                       │                       │
                        ▼                       ▼                       ▼
                ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
                │  简单聊天   │         │ 本地 A2A    │         │ 远程 A2A    │
                │             │         │ Task        │         │ Task        │
                └─────────────┘         └──────┬──────┘         └──────┬──────┘
                                               │                       │
                                               ▼                       ▼
                                       ┌─────────────┐         ┌─────────────┐
                                       │ AgentRunner │         │ HTTP Client │
                                       │.run()       │         │ POST /tasks │
                                       └─────────────┘         └─────────────┘
```

#### 数据存储区分

```sql
-- 简单聊天消息 - 现有表
CREATE TABLE global_messages (
  id INTEGER PRIMARY KEY,
  role TEXT,           -- 'user' | 'assistant'
  content TEXT,
  agent_id INTEGER,    -- 哪个 Agent 回复的
  task_id INTEGER,     -- 关联的对话 ID
  created_at TEXT
);

-- A2A Task - 新增表
CREATE TABLE a2a_tasks (
  id TEXT PRIMARY KEY,           -- UUID
  session_id TEXT,               -- 关联的会话
  source_agent_id INTEGER,       -- 发起方
  target_agent_id INTEGER,       -- 目标方
  status TEXT,                   -- submitted | working | completed | failed
  input TEXT,                    -- JSON
  output TEXT,                   -- JSON
  created_at TEXT,
  updated_at TEXT
);

-- A2A Task 历史 - 与 global_messages 关联
CREATE TABLE a2a_task_history (
  id INTEGER PRIMARY KEY,
  task_id TEXT,
  message_id INTEGER,            -- 关联到 global_messages
  timestamp TEXT
);
```

---

### 4. 会话 (Conversation) 与 A2A Task 的关系

#### 问题
> "一个会话里可以有多个 A2A Task 吗？Task 完成后对话继续吗？"

#### 决策

**一对多关系：**
- 一个 `conversation` 可以包含多个 `a2a_tasks`
- 每个 A2A Task 都是独立的协作单元
- Task 完成后，对话可以继续

**示例场景：**

```
会话 #123: "开发登录功能"
│
├── 消息 1: 用户:"我需要开发登录功能"
├── 消息 2: Agent:"好的，我来设计"
│
├── A2A Task #1: BackendAgent → FrontendAgent
│   ├── "请设计登录 API"
│   └── 状态: completed
│
├── 消息 3: FrontendAgent:"API 设计好了，我来实现 UI"
│
├── A2A Task #2: FrontendAgent → DesignerAgent
│   ├── "请设计登录页面 UI"
│   └── 状态: working
│
└── 消息 4: DesignerAgent:"这是设计稿..."
```

**实现要点：**
- A2A Task 通过 `session_id` 字段关联到 conversation
- Task 完成后，结果可以自动或手动转发到 conversation
- 用户可以选择是否查看 Task 的详细执行过程

---

### 5. Agent 如何知道自己被 A2A 调用了？

#### 决策

**两种方式：**

**方式 A：系统提示词注入（推荐）**

```javascript
// 当 Agent 被 A2A 调用时，修改其 system prompt
const a2aContext = `
你被另一个 Agent 调用。
任务 ID: ${taskId}
来源 Agent: ${sourceAgentName}
调用原因: ${taskDescription}

请专注于完成此任务，完成后系统会自动通知调用方。
`;

agentRunner.run(agentId, onOutput, onExit, a2aContext);
```

**方式 B：特殊消息格式**

```javascript
// 发送特殊标记的消息
agentRunner.sendInput(agentId, `[A2A_TASK_START]
Task ID: ${taskId}
Source: ${sourceAgentName}
Content: ${userInput}
[A2A_TASK_END]`);
```

**选择：** 使用方式 A，通过系统提示词让 Agent 了解上下文更自然。

---

### 6. A2A 任务的权限和安全性

#### 问题
> "任何 Agent 都可以调用任何其他 Agent 吗？需要权限控制吗？"

#### 决策

**第一阶段：本地信任（当前实现）**
- 所有本地 Agent 互相信任
- 不需要额外权限验证
- 适合小团队、内部使用场景

**第二阶段：细粒度权限（未来扩展）**

```javascript
// Agent 权限配置
const agentPermissions = {
  'claude-cli': {
    canInvoke: ['codex-cli', 'designer-cli'],  // 可以调用谁
    canBeInvokedBy: ['user', 'orchestrator'],  // 可以被谁调用
    maxConcurrentTasks: 3,
    allowedOperations: ['code_review', 'architecture_design']
  }
};
```

---

### 7. Task 的可见性

#### 问题
> "用户能看到 A2A Task 的执行过程吗？还是只能看到结果？"

#### 决策

**可配置的可视化级别：**

```typescript
enum TaskVisibility {
  HIDDEN = 'hidden',           // 完全隐藏，只显示结果
  SUMMARY = 'summary',         // 显示摘要（"Claude 正在请求 CodeReview..."）
  STREAMING = 'streaming',     // 实时显示 Task 的流式输出
  FULL = 'full',               // 完整展示，包括中间思考过程
}
```

**默认策略：**
- **本地 Agent 间调用**：显示摘要 + 可展开查看详情
- **远程 Agent 调用**：显示摘要（因为可能涉及网络延迟）

**UI 设计：**

```
┌─────────────────────────────────────┐
│ 💬 Claude 正在请求 CodeReview       │  ← 摘要（始终显示）
│ ▼                                   │
│ ┌─────────────────────────────────┐ │
│ │ 📝 Task #task-123               │ │  ← 详情（可展开）
│ │ Status: working                 │ │
│ │ Output: 正在分析代码...          │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

---

### 8. 循环调用防护

#### 问题
> "Agent A 调用 Agent B，Agent B 又调用 Agent A，会不会死循环？"

#### 决策

**多层防护机制：**

```javascript
// 1. 调用链深度限制
const MAX_A2A_CHAIN_DEPTH = 5;

// 2. 调用链追踪
const callChain = [taskId1, taskId2, taskId3];
if (callChain.length > MAX_A2A_CHAIN_DEPTH) {
  throw new Error('A2A call chain too deep');
}

// 3. 循环检测
if (callChain.includes(currentTaskId)) {
  throw new Error('Circular A2A call detected');
}

// 4. 任务超时
const A2A_TASK_TIMEOUT = 5 * 60 * 1000; // 5分钟
```

**实现位置：** `server/services/a2a/a2aTaskManager.js`

---

### 9. Task 失败处理

#### 决策

**失败场景处理：**

| 失败原因 | 处理方式 | 用户通知 |
|---------|---------|---------|
| 目标 Agent 未启动 | 自动重试 3 次，然后失败 | 通知用户重新启动 Agent |
| 目标 Agent 崩溃 | 标记为 failed，记录错误日志 | 通知用户查看日志 |
| 任务超时 | 取消任务，释放资源 | 通知用户任务超时 |
| 调用链超限 | 拒绝执行，返回错误 | 通知用户简化请求 |

**失败重试策略：**

```javascript
const retryPolicy = {
  maxRetries: 3,
  backoffMultiplier: 2,
  initialDelay: 1000, // 1秒
  maxDelay: 10000,    // 10秒
};
```

---

### 10. 与现有 @mention 功能的整合

#### 决策

**增强现有 @mention，支持 A2A：**

```javascript
// 解析 @mention
const mention = parseMention('@Claude review this code');
// => { agentName: 'Claude', text: 'review this code' }

// 判断处理方式
if (isLocalAgent(mention.agentName)) {
  // 本地 Agent：创建 A2A Task
  const task = await a2aTaskManager.createTask({
    sourceAgentId: currentAgentId,
    targetAgentId: getAgentId(mention.agentName),
    input: { text: mention.text }
  });
} else {
  // 远程 Agent：HTTP A2A 调用
  const remoteAgent = await discoverAgent(mention.agentName);
  await a2aClient.sendTask({
    targetEndpoint: remoteAgent.endpoint,
    ...
  });
}
```

---

## 总结

### 关键决策回顾

1. **简单聊天 ≠ A2A Task**：只有显式 @mention 或程序化调用才创建 Task
2. **会话与 Task 一对多**：一个对话可以包含多个协作任务
3. **本地优先**：第一阶段只支持本地 Agent 间 A2A
4. **可见性可配置**：用户可以选择查看 Task 执行过程的详细程度
5. **多层安全防护**：调用链深度限制 + 循环检测 + 超时机制

### 下一步行动

1. ✅ 实现 A2A Task 管理器
2. ✅ 实现 A2A 服务端点
3. ⏳ 增强 @mention 解析，支持 A2A Task 创建
4. ⏳ 实现 Task 可视化 UI
5. ⏳ 添加循环调用防护
6. ⏳ 实现主动开口机制

---

## 附录：术语表

| 术语 | 定义 |
|-----|------|
| **A2A** | Agent-to-Agent，Agent 间通信协议 |
| **Task** | A2A 中的工作单元，有明确的生命周期 |
| **Agent Card** | Agent 的能力描述文件 |
| **Simple Chat** | 用户与 Agent 的直接对话，不经过 A2A |
| **Call Chain** | A2A 调用链，记录 Task 之间的调用关系 |
| **Proactive Speaking** | Agent 主动向用户发送消息的能力 |
