# Phase 4.2: Agent 间互相调用机制

## 概述

实现 Agent 之间的互相调用能力。当 Agent A 在输出中 `@AgentB` 时，系统能够自动识别并触发 Agent B 执行相应任务。

## 核心场景

### 场景 1：代码实现 + 检视

```
用户: @Claude CLI 请实现用户登录功能，实现后请 @Code Reviewer 检视代码

Claude CLI: 
好的，我来实现用户登录功能...
[实现代码]
...
代码已实现完成。@Code Reviewer 请检视这段代码的安全性和最佳实践。

系统: [检测到 @Code Reviewer] → 自动触发 Code Reviewer

Code Reviewer:
收到检视请求。我来检查代码...
[检视结果]
发现 3 个问题需要修复...
```

### 场景 2：多 Agent 协作

```
用户: @Architect 请设计 API，然后 @Developer 实现它

Architect:
API 设计如下...
@Developer 请按照这个设计实现 API

系统: [检测到 @Developer] → 自动触发 Developer

Developer:
收到，开始实现...
```

## 架构设计

### 整体流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent 输出监控层                          │
│  监听所有 Agent 的输出，检测 @mention 模式                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    意图识别层 (简化版)                        │
│  判断 @mention 是否是"调用意图"还是"普通提及"                 │
│  - 规则：@AgentName 后面跟着动词/请求 = 调用意图              │
│  - 例如：@AgentB 请检查 / @AgentB 帮我 / @AgentB review      │
└────────────────────┬────────────────────────────────────────┘
                     │ 是调用意图
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    A2A Task 创建层                           │
│  - 创建 A2A Task (source=当前Agent, target=@的Agent)         │
│  - 提取上下文（当前对话、相关代码等）                         │
│  - 构建 target Agent 的 prompt                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent 执行层                              │
│  - 启动 target Agent                                         │
│  - 注入系统提示："你被 Agent A 调用，任务是..."              │
│  - 流式输出结果                                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    结果展示层                                │
│  - 在同一对话中展示 target Agent 的输出                      │
│  - 标注这是 A2A 调用的结果                                   │
└─────────────────────────────────────────────────────────────┘
```

## 详细设计

### 1. Agent 输出监控

#### 1.1 监控位置

在 `server/websocket.js` 的 `onOutput` 回调中添加监控：

```javascript
// server/websocket.js
const onOutput = (stream, data) => {
  // 原有的流式输出逻辑
  throttled.push(stream, data);
  
  // 新增：检测 @mention 调用意图
  if (stream === 'stdout') {
    detectAgentInvocation(agentId, data, conversationId);
  }
};
```

#### 1.2 @mention 检测规则

```javascript
// server/services/agentInvocationDetector.js

/**
 * 检测 Agent 输出中的 @mention 调用意图
 * 
 * @param {number} sourceAgentId - 发起调用的 Agent ID
 * @param {string} output - Agent 的输出内容
 * @param {number} conversationId - 对话 ID
 * @returns {Object|null} - 如果检测到调用意图，返回调用信息
 */
export function detectAgentInvocation(sourceAgentId, output, conversationId) {
  // 1. 查找所有 @mention
  const mentionPattern = /@(\w+(?:\s+\w+)*?)(?=\s|$|,|!|\?|\.)/g;
  const matches = [...output.matchAll(mentionPattern)];
  
  if (matches.length === 0) return null;
  
  // 2. 获取所有 Agent 名称（用于匹配）
  const agents = db.prepare('SELECT id, name FROM agents WHERE status = ?').all('active');
  
  // 3. 对每个 @mention 进行分析
  for (const match of matches) {
    const mentionedName = match[1];
    const targetAgent = findAgentByName(agents, mentionedName);
    
    if (!targetAgent) continue; // 不是有效的 Agent 名称
    
    // 4. 判断是否是调用意图
    const afterMention = output.slice(match.index + match[0].length).trim();
    const isInvocation = isInvocationIntent(afterMention);
    
    if (isInvocation) {
      return {
        sourceAgentId,
        targetAgentId: targetAgent.id,
        targetAgentName: targetAgent.name,
        invocationText: afterMention,
        fullOutput: output,
        conversationId,
      };
    }
  }
  
  return null;
}

/**
 * 判断 @mention 后的内容是否表示调用意图
 */
function isInvocationIntent(textAfterMention) {
  // 规则 1: 包含请求动词
  const requestVerbs = [
    '请', '帮我', '帮忙', '可以', '能否', '能否请',
    'please', 'help', 'can you', 'could you',
    '检查', '检视', 'review', '审查', '测试', 'test',
    '实现', 'implement', '修复', 'fix', '优化', 'optimize',
    '设计', 'design', '分析', 'analyze'
  ];
  
  const lowerText = textAfterMention.toLowerCase();
  return requestVerbs.some(verb => lowerText.includes(verb));
}

/**
 * 根据名称查找 Agent（支持模糊匹配）
 */
function findAgentByName(agents, name) {
  const nameLower = name.toLowerCase();
  
  // 精确匹配
  let found = agents.find(a => a.name.toLowerCase() === nameLower);
  if (found) return found;
  
  // 部分匹配（例如 "Code" 匹配 "Code Reviewer"）
  found = agents.find(a => a.name.toLowerCase().includes(nameLower));
  if (found) return found;
  
  return null;
}
```

### 2. A2A Task 创建与上下文构建

#### 2.1 Task 创建

```javascript
// server/services/agentInvocationExecutor.js

import a2aTaskManager from './a2a/a2aTaskManager.js';
import * as agentRunner from './agentRunner.js';
import db from '../db.js';
import logger from '../logger.js';

/**
 * 执行 Agent 间调用
 */
export async function executeAgentInvocation(invocation) {
  const {
    sourceAgentId,
    targetAgentId,
    targetAgentName,
    invocationText,
    fullOutput,
    conversationId,
  } = invocation;
  
  logger.log('[AgentInvocation] Detected: Agent %d -> Agent %d (%s)', 
    sourceAgentId, targetAgentId, invocationText);
  
  // 1. 创建 A2A Task
  const task = a2aTaskManager.createTask({
    sessionId: `conv-${conversationId}`,
    sourceAgentId,
    targetAgentId,
    conversationId,
    input: {
      type: 'agent_invocation',
      invocationText,
      sourceOutput: fullOutput,
    },
  });
  
  // 2. 更新状态为 working
  a2aTaskManager.updateTaskStatus(task.id, 'working');
  
  // 3. 构建上下文
  const context = buildInvocationContext(invocation);
  
  // 4. 执行目标 Agent
  const targetAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(targetAgentId);
  
  if (!targetAgent) {
    a2aTaskManager.updateTaskStatus(task.id, 'failed', { error: 'Target agent not found' });
    return;
  }
  
  let accumulatedOutput = '';
  
  // 根据目标 Agent 类型选择执行方式
  if (targetAgent.builtin_key === 'claude-cli') {
    await agentRunner.runClaudeCli(
      targetAgentId,
      context.prompt,
      (stream, data) => {
        accumulatedOutput += data;
        a2aTaskManager.addTaskHistory(task.id, {
          role: 'agent',
          content: data,
          agentId: targetAgentId,
          stream,
        });
        
        // 同时通过 WebSocket 推送给前端
        // (这里需要访问 WebSocket 连接，可能需要通过事件机制)
      },
      (code, signal) => {
        const status = code === 0 ? 'completed' : 'failed';
        a2aTaskManager.updateTaskStatus(task.id, status, {
          text: accumulatedOutput,
          exitCode: code,
          signal,
        });
      },
      conversationId,
      // onToolUse
      (toolData) => {
        a2aTaskManager.addTaskHistory(task.id, {
          role: 'tool_use',
          tool: toolData.tool,
          title: toolData.title,
          status: toolData.status,
          input: toolData.input,
          output: toolData.output,
          callID: toolData.callID,
        });
      }
    );
  } else if (targetAgent.builtin_key === 'opencode-cli') {
    // 类似的处理...
  }
}

/**
 * 构建调用上下文
 */
function buildInvocationContext(invocation) {
  const { sourceAgentId, targetAgentId, invocationText, conversationId, fullOutput } = invocation;
  
  // 获取源 Agent 信息
  const sourceAgent = db.prepare('SELECT name, role FROM agents WHERE id = ?').get(sourceAgentId);
  
  // 获取最近的消息历史（用于上下文）
  const recentMessages = db.prepare(`
    SELECT * FROM global_messages 
    WHERE task_id = ? 
    ORDER BY created_at DESC 
    LIMIT 10
  `).all(conversationId).reverse();
  
  // 构建系统提示
  const systemPrompt = `你被另一个 Agent 调用。

调用信息：
- 来源 Agent: ${sourceAgent.name} (${sourceAgent.role || '通用助手'})
- 调用请求: ${invocationText}

请专注于完成这个请求。完成后，系统会自动将结果返回给调用方。

如果需要更多上下文，请主动询问。`;

  // 构建用户提示
  const userPrompt = `${sourceAgent.name} 的完整输出：
---
${fullOutput}
---

${invocationText}`;
  
  return {
    systemPrompt,
    prompt: userPrompt,
    context: {
      sourceAgent: sourceAgent.name,
      invocationText,
      recentMessages,
    },
  };
}
```

### 3. 与 WebSocket 集成

#### 3.1 修改 WebSocket 处理

```javascript
// server/websocket.js

import { detectAgentInvocation } from './services/agentInvocationDetector.js';
import { executeAgentInvocation } from './services/agentInvocationExecutor.js';

// 在 Claude CLI 的 onOutput 中添加检测
const onOutput = (stream, data) => {
  if (stream === 'stdout' && typeof data === 'string' && data.length > 0) {
    logger.log('[claude-cli] stdout chunk: %d chars', data.length);
    
    // 检测 Agent 调用
    const invocation = detectAgentInvocation(id, data, convId);
    if (invocation) {
      logger.log('[websocket] Detected agent invocation: %s -> %s', 
        invocation.sourceAgentId, invocation.targetAgentName);
      
      // 异步执行调用（不阻塞当前输出）
      setImmediate(() => {
        executeAgentInvocation(invocation);
      });
    }
  }
  throttled.push(stream, data);
};
```

#### 3.2 推送 A2A 输出到前端

需要将 target Agent 的输出推送给前端。有两种方案：

**方案 A: 复用现有 WebSocket 连接**

```javascript
// 在 executeAgentInvocation 中
const onOutput = (stream, data) => {
  accumulatedOutput += data;
  
  // 推送给前端
  send({
    type: 'a2a_output',
    taskId: task.id,
    sourceAgentId,
    targetAgentId,
    stream,
    data,
  });
  
  // 同时记录到 task history
  a2aTaskManager.addTaskHistory(task.id, { ... });
};
```

**方案 B: 使用 SSE (推荐用于远程 A2A)**

对于远程 Agent 调用，使用 Server-Sent Events。

### 4. 前端展示

#### 4.1 消息类型扩展

```javascript
// 在 ChatPanel.jsx 中处理新的消息类型

const ChatMessage = memo(function ChatMessage({ m }) {
  // 检测 A2A 调用消息
  if (m.message_type === 'a2a_invocation') {
    return (
      <A2AInvocationMessage 
        sourceAgent={m.agent_name}
        targetAgent={m.metadata?.targetAgent}
        task={m.metadata?.task}
      />
    );
  }
  
  // 检测 A2A 输出消息
  if (m.message_type === 'a2a_output') {
    return (
      <A2AOutputMessage
        task={m.metadata?.task}
        content={m.content}
      />
    );
  }
  
  // ... 原有逻辑
});
```

#### 4.2 A2A 消息组件

```jsx
// client/components/A2AMessage.jsx

export function A2AInvocationMessage({ sourceAgent, targetAgent, task }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <div className="a2a-invocation-message">
      <div className="a2a-invocation-header">
        <span className="a2a-arrow">→</span>
        <span className="a2a-source">{sourceAgent}</span>
        <span className="a2a-arrow">calls</span>
        <span className="a2a-target">@{targetAgent}</span>
        <button onClick={() => setIsExpanded(!isExpanded)}>
          {isExpanded ? '▼' : '▶'}
        </button>
      </div>
      
      {isExpanded && (
        <div className="a2a-invocation-details">
          <div>Task ID: {task.id}</div>
          <div>Status: {task.status}</div>
          <div>Request: {task.input.invocationText}</div>
        </div>
      )}
    </div>
  );
}

export function A2AOutputMessage({ task, content }) {
  return (
    <div className="a2a-output-message">
      <div className="a2a-output-header">
        <span className="a2a-badge">A2A Response</span>
        <span className="a2a-agent">{task.targetAgentName}</span>
      </div>
      <div className="a2a-output-content">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  );
}
```

### 5. 防护机制

#### 5.1 调用深度限制

```javascript
// server/services/agentInvocationExecutor.js

const MAX_INVOCATION_DEPTH = 3;

function checkInvocationDepth(conversationId, sourceAgentId) {
  // 查询当前对话中的 A2A 调用链
  const tasks = db.prepare(`
    SELECT * FROM a2a_tasks 
    WHERE session_id = ? 
    AND status IN ('working', 'completed')
    ORDER BY created_at DESC
  `).all(`conv-${conversationId}`);
  
  // 构建调用图
  const callChain = buildCallChain(tasks, sourceAgentId);
  
  if (callChain.length >= MAX_INVOCATION_DEPTH) {
    throw new Error(`A2A invocation chain too deep (max ${MAX_INVOCATION_DEPTH})`);
  }
  
  return callChain;
}
```

#### 5.2 循环调用检测

```javascript
function detectCircularInvocation(conversationId, sourceAgentId, targetAgentId) {
  // 检查是否已经存在 targetAgentId -> sourceAgentId 的调用
  const existingCall = db.prepare(`
    SELECT * FROM a2a_tasks 
    WHERE session_id = ?
    AND source_agent_id = ?
    AND target_agent_id = ?
    AND status IN ('working', 'completed')
  `).get(`conv-${conversationId}`, targetAgentId, sourceAgentId);
  
  if (existingCall) {
    throw new Error(`Circular A2A invocation detected: ${sourceAgentId} -> ${targetAgentId} -> ${sourceAgentId}`);
  }
}
```

#### 5.3 速率限制

```javascript
const invocationCounts = new Map(); // agentId -> { count, resetTime }

function checkInvocationRate(agentId) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 分钟
  const maxInvocations = 10; // 每分钟最多 10 次
  
  const record = invocationCounts.get(agentId);
  
  if (!record || now - record.resetTime > windowMs) {
    invocationCounts.set(agentId, { count: 1, resetTime: now });
    return true;
  }
  
  if (record.count >= maxInvocations) {
    throw new Error(`Rate limit exceeded for agent ${agentId}`);
  }
  
  record.count++;
  return true;
}
```

### 6. 数据库 Schema 扩展

```sql
-- A2A 调用记录表（已存在，确认字段）
CREATE TABLE IF NOT EXISTS a2a_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  source_agent_id INTEGER,
  target_agent_id INTEGER,
  conversation_id INTEGER,  -- 新增：关联到 conversation
  status TEXT DEFAULT 'submitted',
  input TEXT,
  output TEXT,
  invocation_type TEXT DEFAULT 'agent_invocation',  -- 新增：调用类型
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- A2A 调用历史表（新增）
CREATE TABLE IF NOT EXISTS a2a_task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  role TEXT NOT NULL,  -- 'agent', 'tool_use', 'system'
  content TEXT,
  agent_id INTEGER,
  tool TEXT,
  timestamp TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES a2a_tasks(id)
);

CREATE INDEX idx_a2a_history_task ON a2a_task_history(task_id);
```

## 实现计划

### Phase 4.2.1: 基础调用机制（1-2 天）

- [ ] 实现 `agentInvocationDetector.js`
  - [ ] @mention 检测
  - [ ] 调用意图识别
  - [ ] Agent 名称匹配
  
- [ ] 实现 `agentInvocationExecutor.js`
  - [ ] Task 创建
  - [ ] 上下文构建
  - [ ] Agent 执行

- [ ] 集成到 WebSocket
  - [ ] 在 `onOutput` 中添加检测
  - [ ] 推送 A2A 输出到前端

### Phase 4.2.2: 前端展示（1 天）

- [ ] 实现 A2A 消息组件
  - [ ] `A2AInvocationMessage`
  - [ ] `A2AOutputMessage`
  
- [ ] 集成到 ChatPanel
  - [ ] 处理新消息类型
  - [ ] 样式设计

### Phase 4.2.3: 防护机制（1 天）

- [ ] 调用深度限制
- [ ] 循环调用检测
- [ ] 速率限制
- [ ] 单元测试

### Phase 4.2.4: 测试与优化（1 天）

- [ ] 端到端测试
- [ ] 性能优化
- [ ] 文档完善

## 测试用例

### 单元测试

```javascript
describe('AgentInvocationDetector', () => {
  it('should detect invocation intent with request verbs', () => {
    const output = '@Code Reviewer 请检查这段代码';
    const result = detectAgentInvocation(1, output, 1);
    
    expect(result).not.toBeNull();
    expect(result.targetAgentName).toBe('Code Reviewer');
    expect(result.invocationText).toContain('请检查');
  });
  
  it('should ignore casual mentions', () => {
    const output = '我觉得 @Code Reviewer 之前说的对';
    const result = detectAgentInvocation(1, output, 1);
    
    expect(result).toBeNull();
  });
  
  it('should match agent names with spaces', () => {
    const output = '@Claude CLI help me with this';
    const result = detectAgentInvocation(1, output, 1);
    
    expect(result).not.toBeNull();
    expect(result.targetAgentName).toBe('Claude CLI');
  });
});

describe('AgentInvocationExecutor', () => {
  it('should create A2A task on invocation', async () => {
    const invocation = {
      sourceAgentId: 1,
      targetAgentId: 2,
      invocationText: '请检查代码',
      conversationId: 1,
    };
    
    await executeAgentInvocation(invocation);
    
    const task = a2aTaskManager.getTask(/* ... */);
    expect(task).toBeDefined();
    expect(task.status).toBe('working');
  });
  
  it('should prevent circular invocations', () => {
    // 创建 A -> B 的调用
    // 尝试创建 B -> A 的调用
    // 应该抛出错误
  });
  
  it('should enforce max invocation depth', () => {
    // 创建 A -> B -> C 的调用链
    // 尝试创建 C -> D 的调用
    // 应该抛出错误（深度 = 4 > 3）
  });
});
```

### 集成测试

```javascript
describe('Agent-to-Agent Invocation', () => {
  it('should trigger agent invocation on @mention', async () => {
    // 1. 用户发送消息给 Agent A
    // 2. Agent A 输出包含 @AgentB 的调用意图
    // 3. 系统自动触发 Agent B
    // 4. Agent B 的输出显示在对话中
  });
  
  it('should display A2A messages correctly in UI', async () => {
    // 验证前端正确显示 A2A 调用和响应
  });
});
```

## 配置选项

```javascript
// config/a2a.js

export const A2A_CONFIG = {
  // 调用深度限制
  maxInvocationDepth: 3,
  
  // 速率限制（每分钟）
  rateLimit: {
    windowMs: 60 * 1000,
    maxInvocations: 10,
  },
  
  // 调用意图关键词
  invocationKeywords: [
    '请', '帮我', '帮我', '可以', '能否',
    'please', 'help', 'can you',
    '检查', '检视', 'review', '测试', 'test',
    '实现', 'implement', '修复', 'fix', '优化',
    '设计', 'design', '分析', 'analyze',
  ],
  
  // 是否允许 Agent 自主调用（无需用户确认）
  allowAutonomousInvocation: true,
  
  // 是否显示 A2A 调用详情
  showInvocationDetails: true,
};
```

## 风险与挑战

1. **误触发** - Agent 输出中可能包含示例 @mention，需要准确识别
2. **上下文丢失** - Agent 间调用可能丢失重要上下文
3. **性能问题** - 频繁的 Agent 间调用可能导致性能下降
4. **用户体验** - 需要清晰展示调用链，避免混淆

## 后续优化

1. **智能上下文选择** - 自动选择最相关的上下文传递给 target Agent
2. **调用确认** - 在调用前询问用户是否确认
3. **调用历史** - 可视化展示 Agent 间的调用关系图
4. **权限控制** - 细粒度的 Agent 调用权限管理

## 相关文档

- [Phase 4 Overview](./phase-04-overview.md)
- [Phase 4.1: A2A 协议实现](./phase-04-01-a2a-protocol.md)
- [Phase 4.3: 提及防护机制](./phase-04-03-mention-guard.md)
