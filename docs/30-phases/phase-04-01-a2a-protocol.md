# Phase 4.1: A2A 协议实现

## 参考实现

基于 Google A2A 协议规范：
- 规范文档: https://a2a-protocol.org/latest/specification
- 官方示例: https://github.com/google/A2A/tree/main/samples

## 核心组件实现

### 1. Agent Card 端点

每个 Agent 必须在 `/.well-known/agent.json` 暴露能力描述：

```javascript
// server/routes/a2a.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// GET /.well-known/agent.json
router.get('/.well-known/agent.json', (req, res) => {
  const agentCard = {
    name: 'Co-Agent Platform',
    description: 'Multi-agent collaboration platform',
    url: `${req.protocol}://${req.get('host')}`,
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    authentication: {
      schemes: ['none'], // 后续支持 Bearer
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [], // 动态加载
  };

  // 加载所有 Agent 的技能
  const agents = db.prepare('SELECT * FROM agents WHERE status = ?').all('active');
  agentCard.skills = agents.map(agent => ({
    id: `agent-${agent.id}`,
    name: agent.name,
    description: agent.role || 'General purpose agent',
    tags: agent.responsibilities ? JSON.parse(agent.responsibilities) : [],
    examples: [],
    inputModes: ['text'],
    outputModes: ['text'],
  }));

  res.json(agentCard);
});

export default router;
```

### 2. Task 管理

```javascript
// server/services/a2aTaskManager.js
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import logger from '../logger.js';

class A2ATaskManager {
  constructor() {
    this.activeTasks = new Map(); // taskId -> task info
    this.subscribers = new Map(); // taskId -> [response objects]
  }

  // 创建新任务
  createTask({ sessionId, sourceAgentId, targetAgentId, input }) {
    const taskId = uuidv4();
    const task = {
      id: taskId,
      sessionId,
      sourceAgentId,
      targetAgentId,
      status: 'submitted',
      input,
      output: null,
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 持久化到数据库
    db.prepare(`
      INSERT INTO a2a_tasks (id, session_id, source_agent_id, target_agent_id, status, input)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(taskId, sessionId, sourceAgentId, targetAgentId, 'submitted', JSON.stringify(input));

    this.activeTasks.set(taskId, task);
    logger.log('[A2A] Task created: %s', taskId);

    return task;
  }

  // 更新任务状态
  updateTaskStatus(taskId, status, output = null) {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      logger.error('[A2A] Task not found: %s', taskId);
      return null;
    }

    task.status = status;
    task.updatedAt = new Date().toISOString();
    if (output) {
      task.output = output;
    }

    // 更新数据库
    db.prepare('UPDATE a2a_tasks SET status = ?, output = ?, updated_at = ? WHERE id = ?')
      .run(status, output ? JSON.stringify(output) : null, task.updatedAt, taskId);

    // 通知订阅者
    this.notifySubscribers(taskId, { type: 'status', status, output });

    return task;
  }

  // 添加任务历史
  addTaskHistory(taskId, message) {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    task.history.push({
      ...message,
      timestamp: new Date().toISOString(),
    });

    // 通知订阅者
    this.notifySubscribers(taskId, { type: 'message', message });
  }

  // 订阅任务更新 (SSE)
  subscribe(taskId, res) {
    if (!this.subscribers.has(taskId)) {
      this.subscribers.set(taskId, []);
    }
    this.subscribers.get(taskId).push(res);

    // 清理断开连接
    res.on('close', () => {
      this.unsubscribe(taskId, res);
    });
  }

  unsubscribe(taskId, res) {
    const subs = this.subscribers.get(taskId);
    if (subs) {
      const idx = subs.indexOf(res);
      if (idx > -1) subs.splice(idx, 1);
    }
  }

  notifySubscribers(taskId, data) {
    const subs = this.subscribers.get(taskId);
    if (!subs || subs.length === 0) return;

    const sseData = `data: ${JSON.stringify(data)}\n\n`;
    subs.forEach(res => {
      res.write(sseData);
    });
  }

  // 获取任务
  getTask(taskId) {
    return this.activeTasks.get(taskId) || 
      db.prepare('SELECT * FROM a2a_tasks WHERE id = ?').get(taskId);
  }

  // 取消任务
  cancelTask(taskId) {
    return this.updateTaskStatus(taskId, 'canceled');
  }
}

export default new A2ATaskManager();
```

### 3. A2A 任务端点

```javascript
// server/routes/a2a.js (续)
import taskManager from '../services/a2aTaskManager.js';
import agentRunner from '../services/agentRunner.js';

// POST /a2a/tasks/send
router.post('/tasks/send', async (req, res) => {
  try {
    const { sessionId, sourceAgentId, targetAgentId, input } = req.body;

    // 创建任务
    const task = taskManager.createTask({
      sessionId,
      sourceAgentId,
      targetAgentId,
      input,
    });

    // 启动目标 Agent 处理
    taskManager.updateTaskStatus(task.id, 'working');

    // 调用 Agent Runner
    let accumulatedOutput = '';
    
    agentRunner.run(targetAgentId, 
      // onOutput
      (stream, data) => {
        accumulatedOutput += data;
        taskManager.addTaskHistory(task.id, {
          role: 'agent',
          content: data,
          agentId: targetAgentId,
        });
      },
      // onExit
      (code) => {
        taskManager.updateTaskStatus(task.id, code === 0 ? 'completed' : 'failed', {
          text: accumulatedOutput,
          exitCode: code,
        });
      }
    );

    // 发送输入
    agentRunner.sendInput(targetAgentId, input.text || input);

    res.json({
      id: task.id,
      status: task.status,
      sessionId: task.sessionId,
    });
  } catch (e) {
    logger.error('[A2A] Error creating task:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /a2a/tasks/sendSubscribe (SSE)
router.post('/tasks/sendSubscribe', async (req, res) => {
  try {
    const { sessionId, sourceAgentId, targetAgentId, input } = req.body;

    // 设置 SSE 头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 创建任务
    const task = taskManager.createTask({
      sessionId,
      sourceAgentId,
      targetAgentId,
      input,
    });

    // 订阅任务更新
    taskManager.subscribe(task.id, res);

    // 发送初始状态
    res.write(`data: ${JSON.stringify({ type: 'status', status: 'submitted', taskId: task.id })}\n\n`);

    // 启动处理
    taskManager.updateTaskStatus(task.id, 'working');

    let accumulatedOutput = '';
    
    agentRunner.run(targetAgentId,
      (stream, data) => {
        accumulatedOutput += data;
        taskManager.addTaskHistory(task.id, {
          role: 'agent',
          content: data,
          agentId: targetAgentId,
        });
      },
      (code) => {
        taskManager.updateTaskStatus(task.id, code === 0 ? 'completed' : 'failed', {
          text: accumulatedOutput,
          exitCode: code,
        });
        // 结束 SSE
        res.end();
      }
    );

    agentRunner.sendInput(targetAgentId, input.text || input);

  } catch (e) {
    logger.error('[A2A] Error in sendSubscribe:', e);
    res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
    res.end();
  }
});

// GET /a2a/tasks/:id
router.get('/tasks/:id', (req, res) => {
  const task = taskManager.getTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  res.json(task);
});

// POST /a2a/tasks/:id/cancel
router.post('/tasks/:id/cancel', (req, res) => {
  const task = taskManager.cancelTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  res.json(task);
});
```

### 4. Agent 发现

```javascript
// POST /a2a/agents/search
router.post('/agents/search', (req, res) => {
  try {
    const { query, capabilities } = req.body;

    // 搜索本地 Agent
    let sql = 'SELECT * FROM agents WHERE status = ?';
    const params = ['active'];

    if (query) {
      sql += ' AND (name LIKE ? OR role LIKE ?)';
      params.push(`%${query}%`, `%${query}%`);
    }

    const agents = db.prepare(sql).all(...params);

    // 转换为 A2A 格式
    const results = agents.map(agent => ({
      id: `agent-${agent.id}`,
      name: agent.name,
      description: agent.role || 'General purpose agent',
      endpoint: `/a2a/agents/${agent.id}`,
      capabilities: {
        streaming: true,
      },
    }));

    res.json({ agents: results });
  } catch (e) {
    logger.error('[A2A] Error searching agents:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /a2a/agents/:id
router.get('/agents/:id', (req, res) => {
  try {
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json({
      id: `agent-${agent.id}`,
      name: agent.name,
      description: agent.role || 'General purpose agent',
      endpoint: `/a2a/agents/${agent.id}`,
      cliCommand: agent.cli_command,
      capabilities: {
        streaming: true,
      },
      skills: agent.responsibilities ? JSON.parse(agent.responsibilities) : [],
    });
  } catch (e) {
    logger.error('[A2A] Error getting agent:', e);
    res.status(500).json({ error: e.message });
  }
});
```

## 客户端 A2A 调用

```javascript
// client/services/a2aClient.js
const API_BASE = '/a2a';

export class A2AClient {
  // 获取 Agent Card
  async getAgentCard(url) {
    const response = await fetch(`${url}/.well-known/agent.json`);
    return response.json();
  }

  // 发送任务
  async sendTask({ targetEndpoint, sessionId, sourceAgentId, targetAgentId, input }) {
    const response = await fetch(`${targetEndpoint}/tasks/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, sourceAgentId, targetAgentId, input }),
    });
    return response.json();
  }

  // 发送任务并订阅 (SSE)
  async sendTaskSubscribe({ targetEndpoint, sessionId, sourceAgentId, targetAgentId, input, onMessage }) {
    const response = await fetch(`${targetEndpoint}/tasks/sendSubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, sourceAgentId, targetAgentId, input }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            onMessage(data);
          } catch (e) {
            console.error('Failed to parse SSE data:', e);
          }
        }
      }
    }
  }

  // 搜索 Agent
  async searchAgents(query) {
    const response = await fetch(`${API_BASE}/agents/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    return response.json();
  }
}

export default new A2AClient();
```

## 数据库 Schema

```sql
-- A2A 任务表
CREATE TABLE a2a_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  source_agent_id INTEGER,
  target_agent_id INTEGER,
  status TEXT DEFAULT 'submitted',
  input TEXT,
  output TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_a2a_tasks_session ON a2a_tasks(session_id);
CREATE INDEX idx_a2a_tasks_status ON a2a_tasks(status);
CREATE INDEX idx_a2a_tasks_source ON a2a_tasks(source_agent_id);
CREATE INDEX idx_a2a_tasks_target ON a2a_tasks(target_agent_id);
```

## 下一步

1. 实现 A2A 服务端点
2. 添加 SSE 支持到现有 WebSocket 架构
3. 实现 Agent 发现机制
4. 集成到 ChatPanel 的 @mention 功能
