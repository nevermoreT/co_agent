# Phase 4.3: Mention Guard（提及风暴防护）

## 问题描述

### Mention Storm 场景

> **阶段说明**：本阶段在 Agent 间通信（4.2）完成后实现，确保 A2A 调用的安全性和稳定性。

```
场景1: 无限循环
┌─────────┐      @B       ┌─────────┐      @A       
│ Agent A │──────────────→│ Agent B │──────────────→│
└─────────┘               └─────────┘               │
     ↑                                              │
     └──────────────────────────────────────────────┘
     
A: "我觉得用方案1" → B: "我觉得方案2更好" → A: "不对，还是方案1" → ...

场景2: 广播风暴
用户: "大家怎么看？"
  ├── Agent A: "我认为... @B 你觉得呢？"
  ├── Agent B: "我同意 @A，但 @C 有不同意见"
  ├── Agent C: "@A @B 我不认同..."
  └── 无限分支...

场景3: 链式调用
A → B → C → D → E → ... (调用链过长)
```

## 防护策略

### 1. 多层防护架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Mention Guard（提及防护层）                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Counter    │  │   Cycle      │  │   Timeout    │          │
│  │   Guard      │  │   Detector   │  │   Guard      │          │
│  │   (次数限制)  │  │   (循环检测)  │  │   (超时控制)  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                 │                 │                   │
│         └─────────────────┼─────────────────┘                   │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────┐      │
│  │                 Chain Tracker                         │      │
│  │            (调用链追踪与审计)                          │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 核心实现

### 1. Mention Counter（提及计数器）

```javascript
// server/services/guard/mentionCounter.js

class MentionCounter {
  constructor(options = {}) {
    this.limits = {
      perConversation: options.perConversation || 10,    // 单对话最大 mention 次数
      perAgent: options.perAgent || 3,                   // 单 Agent 最大被 mention 次数
      perMinute: options.perMinute || 5,                 // 每分钟最大 mention 次数
      chainDepth: options.chainDepth || 3,               // 最大调用链深度
    };
    
    // 存储: conversationId -> 计数数据
    this.conversationCounters = new Map();
    
    // 清理过期数据
    this.startCleanupInterval();
  }

  // 检查是否允许 mention
  async checkAllowance(conversationId, sourceAgentId, targetAgentId) {
    const counter = this.getOrCreateCounter(conversationId);
    
    const checks = [
      this.checkConversationLimit(counter),
      this.checkAgentLimit(counter, targetAgentId),
      this.checkRateLimit(counter),
      this.checkChainDepth(counter, sourceAgentId),
    ];
    
    for (const check of checks) {
      const result = await check;
      if (!result.allowed) {
        return result;
      }
    }
    
    return { allowed: true };
  }

  // 1. 检查对话级限制
  checkConversationLimit(counter) {
    if (counter.totalMentions >= this.limits.perConversation) {
      return {
        allowed: false,
        reason: 'CONVERSATION_LIMIT_EXCEEDED',
        message: `本对话已达到最大 mention 次数限制 (${this.limits.perConversation})`,
        current: counter.totalMentions,
        limit: this.limits.perConversation,
      };
    }
    return { allowed: true };
  }

  // 2. 检查 Agent 级限制（防止单个 Agent 被过度调用）
  checkAgentLimit(counter, targetAgentId) {
    const agentMentions = counter.agentMentions.get(targetAgentId) || 0;
    
    if (agentMentions >= this.limits.perAgent) {
      return {
        allowed: false,
        reason: 'AGENT_LIMIT_EXCEEDED',
        message: `Agent ${targetAgentId} 已被提及 ${agentMentions} 次，达到上限`,
        current: agentMentions,
        limit: this.limits.perAgent,
      };
    }
    return { allowed: true };
  }

  // 3. 检查速率限制（防止突发风暴）
  checkRateLimit(counter) {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // 清理过期记录
    counter.mentionsInMinute = counter.mentionsInMinute.filter(
      time => time > oneMinuteAgo
    );
    
    if (counter.mentionsInMinute.length >= this.limits.perMinute) {
      const oldestMention = counter.mentionsInMinute[0];
      const waitTime = Math.ceil((60000 - (now - oldestMention)) / 1000);
      
      return {
        allowed: false,
        reason: 'RATE_LIMIT_EXCEEDED',
        message: ` mention 过于频繁，请 ${waitTime} 秒后再试`,
        current: counter.mentionsInMinute.length,
        limit: this.limits.perMinute,
        retryAfter: waitTime,
      };
    }
    return { allowed: true };
  }

  // 4. 检查调用链深度（防止链式调用过长）
  checkChainDepth(counter, sourceAgentId) {
    const chain = counter.mentionChains.get(sourceAgentId) || [];
    
    if (chain.length >= this.limits.chainDepth) {
      return {
        allowed: false,
        reason: 'CHAIN_DEPTH_EXCEEDED',
        message: `调用链深度超过限制 (${this.limits.chainDepth})，避免过度递归`,
        current: chain.length,
        limit: this.limits.chainDepth,
        chain: chain.map(m => m.agentId),
      };
    }
    return { allowed: true };
  }

  // 记录一次 mention
  recordMention(conversationId, sourceAgentId, targetAgentId, metadata = {}) {
    const counter = this.getOrCreateCounter(conversationId);
    
    // 总次数
    counter.totalMentions++;
    
    // Agent 次数
    const currentAgentMentions = counter.agentMentions.get(targetAgentId) || 0;
    counter.agentMentions.set(targetAgentId, currentAgentMentions + 1);
    
    // 速率记录
    counter.mentionsInMinute.push(Date.now());
    
    // 调用链
    const sourceChain = counter.mentionChains.get(sourceAgentId) || [];
    const newChain = [...sourceChain, {
      agentId: sourceAgentId,
      timestamp: Date.now(),
      metadata,
    }];
    counter.mentionChains.set(targetAgentId, newChain);
    
    // 记录到数据库（用于审计）
    this.persistMention(conversationId, sourceAgentId, targetAgentId, metadata);
    
    return {
      total: counter.totalMentions,
      forTarget: currentAgentMentions + 1,
      chainDepth: newChain.length,
    };
  }

  // 获取或创建计数器
  getOrCreateCounter(conversationId) {
    if (!this.conversationCounters.has(conversationId)) {
      this.conversationCounters.set(conversationId, {
        totalMentions: 0,
        agentMentions: new Map(),
        mentionsInMinute: [],
        mentionChains: new Map(),
        createdAt: Date.now(),
        lastActivity: Date.now(),
      });
    }
    return this.conversationCounters.get(conversationId);
  }

  // 持久化到数据库
  async persistMention(conversationId, sourceId, targetId, metadata) {
    db.prepare(`
      INSERT INTO mention_records 
      (conversation_id, source_agent_id, target_agent_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      conversationId,
      sourceId,
      targetId,
      JSON.stringify(metadata),
      new Date().toISOString()
    );
  }

  // 清理过期数据
  startCleanupInterval() {
    setInterval(() => {
      const now = Date.now();
      const maxAge = 3600000; // 1小时
      
      for (const [conversationId, counter] of this.conversationCounters) {
        if (now - counter.lastActivity > maxAge) {
          this.conversationCounters.delete(conversationId);
        }
      }
    }, 600000); // 每10分钟清理一次
  }

  // 获取对话的 mention 统计
  getStats(conversationId) {
    const counter = this.conversationCounters.get(conversationId);
    if (!counter) return null;
    
    return {
      totalMentions: counter.totalMentions,
      agentBreakdown: Object.fromEntries(counter.agentMentions),
      recentRate: counter.mentionsInMinute.length,
      maxChainDepth: Math.max(
        ...Array.from(counter.mentionChains.values()).map(c => c.length),
        0
      ),
    };
  }
}

export default MentionCounter;
```

### 2. Cycle Detector（循环检测器）

```javascript
// server/services/guard/cycleDetector.js

class CycleDetector {
  constructor() {
    this.mentionGraphs = new Map(); // conversationId -> 有向图
  }

  // 检测是否会产生循环
  wouldCreateCycle(conversationId, sourceAgentId, targetAgentId) {
    const graph = this.getOrCreateGraph(conversationId);
    
    // 如果 target 已经指向 source，再添加 source->target 会形成环
    if (this.hasPath(graph, targetAgentId, sourceAgentId)) {
      // 找到循环路径
      const cycle = this.findCyclePath(graph, sourceAgentId, targetAgentId);
      
      return {
        wouldCycle: true,
        cycle: [...cycle, sourceAgentId], // 完整循环路径
        message: `检测到循环调用: ${cycle.join(' → ')} → ${sourceAgentId}`,
      };
    }
    
    return { wouldCycle: false };
  }

  // 使用 DFS 检查是否存在路径
  hasPath(graph, from, to, visited = new Set()) {
    if (from === to) return true;
    if (visited.has(from)) return false;
    
    visited.add(from);
    const neighbors = graph.get(from) || [];
    
    for (const neighbor of neighbors) {
      if (this.hasPath(graph, neighbor, to, visited)) {
        return true;
      }
    }
    
    return false;
  }

  // 找到循环路径
  findCyclePath(graph, source, target) {
    const visited = new Set();
    const path = [];
    
    const dfs = (current, target, currentPath) => {
      if (current === target) {
        return [...currentPath];
      }
      
      if (visited.has(current)) return null;
      visited.add(current);
      
      const neighbors = graph.get(current) || [];
      for (const neighbor of neighbors) {
        const result = dfs(neighbor, target, [...currentPath, current]);
        if (result) return result;
      }
      
      return null;
    };
    
    return dfs(target, source, []);
  }

  // 添加边到图
  addEdge(conversationId, sourceAgentId, targetAgentId) {
    const graph = this.getOrCreateGraph(conversationId);
    
    if (!graph.has(sourceAgentId)) {
      graph.set(sourceAgentId, []);
    }
    
    const neighbors = graph.get(sourceAgentId);
    if (!neighbors.includes(targetAgentId)) {
      neighbors.push(targetAgentId);
    }
  }

  // 获取或创建图
  getOrCreateGraph(conversationId) {
    if (!this.mentionGraphs.has(conversationId)) {
      this.mentionGraphs.set(conversationId, new Map());
    }
    return this.mentionGraphs.get(conversationId);
  }

  // 获取对话的 mention 拓扑
  getTopology(conversationId) {
    const graph = this.mentionGraphs.get(conversationId);
    if (!graph) return null;
    
    const nodes = new Set();
    const edges = [];
    
    for (const [source, targets] of graph) {
      nodes.add(source);
      for (const target of targets) {
        nodes.add(target);
        edges.push({ from: source, to: target });
      }
    }
    
    return {
      nodes: Array.from(nodes),
      edges,
      hasCycles: this.detectAllCycles(conversationId).length > 0,
    };
  }

  // 检测所有循环
  detectAllCycles(conversationId) {
    const graph = this.mentionGraphs.get(conversationId);
    if (!graph) return [];
    
    const cycles = [];
    const visited = new Set();
    const recursionStack = new Set();
    
    const dfs = (node, path) => {
      if (recursionStack.has(node)) {
        // 找到循环
        const cycleStart = path.indexOf(node);
        cycles.push(path.slice(cycleStart));
        return;
      }
      
      if (visited.has(node)) return;
      
      visited.add(node);
      recursionStack.add(node);
      path.push(node);
      
      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        dfs(neighbor, [...path]);
      }
      
      recursionStack.delete(node);
    };
    
    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }
    
    return cycles;
  }
}

export default CycleDetector;
```

### 3. Mention Guard（综合防护层）

```javascript
// server/services/guard/index.js

import MentionCounter from './mentionCounter.js';
import CycleDetector from './cycleDetector.js';
import logger from '../../logger.js';

class MentionGuard {
  constructor(options = {}) {
    this.counter = new MentionCounter(options);
    this.cycleDetector = new CycleDetector();
    this.timeoutMs = options.timeoutMs || 30000; // 30秒超时
    
    // 活跃的任务追踪
    this.activeTasks = new Map();
  }

  // 主入口：检查是否允许 mention
  async guard(conversationId, sourceAgentId, targetAgentId, context = {}) {
    logger.log('[MentionGuard] Checking: %s → %s in conv %s', 
      sourceAgentId, targetAgentId, conversationId);

    // 1. 检查循环
    const cycleCheck = this.cycleDetector.wouldCreateCycle(
      conversationId, sourceAgentId, targetAgentId
    );
    
    if (cycleCheck.wouldCycle) {
      logger.warn('[MentionGuard] Cycle detected: %s', cycleCheck.message);
      return {
        allowed: false,
        reason: 'CYCLE_DETECTED',
        message: cycleCheck.message,
        cycle: cycleCheck.cycle,
        suggestion: '建议换一种方式提问，或指定具体 Agent',
      };
    }

    // 2. 检查计数限制
    const counterCheck = await this.counter.checkAllowance(
      conversationId, sourceAgentId, targetAgentId
    );
    
    if (!counterCheck.allowed) {
      logger.warn('[MentionGuard] Limit exceeded: %s', counterCheck.reason);
      return {
        allowed: false,
        ...counterCheck,
        stats: this.counter.getStats(conversationId),
      };
    }

    // 3. 检查超时（如果存在进行中的任务）
    const timeoutCheck = this.checkTimeout(conversationId, sourceAgentId);
    if (!timeoutCheck.allowed) {
      return timeoutCheck;
    }

    // 所有检查通过
    return {
      allowed: true,
      stats: this.counter.getStats(conversationId),
    };
  }

  // 记录一次成功的 mention
  record(conversationId, sourceAgentId, targetAgentId, metadata = {}) {
    // 记录到计数器
    const stats = this.counter.recordMention(
      conversationId, sourceAgentId, targetAgentId, metadata
    );
    
    // 添加到循环检测图
    this.cycleDetector.addEdge(conversationId, sourceAgentId, targetAgentId);
    
    // 记录活跃任务
    const taskId = metadata.taskId;
    if (taskId) {
      this.activeTasks.set(taskId, {
        conversationId,
        sourceAgentId,
        targetAgentId,
        startTime: Date.now(),
      });
    }
    
    logger.log('[MentionGuard] Recorded: %s → %s (total: %d)',
      sourceAgentId, targetAgentId, stats.total);
    
    return stats;
  }

  // 检查超时
  checkTimeout(conversationId, agentId) {
    const now = Date.now();
    
    for (const [taskId, task] of this.activeTasks) {
      if (task.conversationId === conversationId && 
          task.targetAgentId === agentId) {
        const elapsed = now - task.startTime;
        
        if (elapsed > this.timeoutMs) {
          // 超时任务，移除
          this.activeTasks.delete(taskId);
        } else {
          // 仍在执行中
          return {
            allowed: false,
            reason: 'TASK_IN_PROGRESS',
            message: `Agent ${agentId} 正在处理其他任务，请等待`,
            taskId,
            elapsed: Math.ceil(elapsed / 1000),
            remaining: Math.ceil((this.timeoutMs - elapsed) / 1000),
          };
        }
      }
    }
    
    return { allowed: true };
  }

  // 完成任务
  completeTask(taskId) {
    this.activeTasks.delete(taskId);
  }

  // 获取防护状态报告
  getReport(conversationId) {
    return {
      counter: this.counter.getStats(conversationId),
      topology: this.cycleDetector.getTopology(conversationId),
      activeTasks: Array.from(this.activeTasks.values())
        .filter(t => t.conversationId === conversationId)
        .map(t => ({
          taskId: t.taskId,
          from: t.sourceAgentId,
          to: t.targetAgentId,
          elapsed: Date.now() - t.startTime,
        })),
    };
  }

  // 紧急熔断
  async circuitBreak(conversationId) {
    logger.warn('[MentionGuard] Circuit breaking conversation: %s', conversationId);
    
    // 清除所有活跃任务
    for (const [taskId, task] of this.activeTasks) {
      if (task.conversationId === conversationId) {
        this.activeTasks.delete(taskId);
      }
    }
    
    // 可以发送通知给前端
    return {
      action: 'CIRCUIT_BREAK',
      conversationId,
      message: '检测到异常活动，已暂时禁用 Agent 间调用',
      cooldownSeconds: 60,
    };
  }
}

export default MentionGuard;
```

## 集成到 A2A 流程

```javascript
// server/services/a2a/a2aTaskManager.js (修改)

import mentionGuard from '../guard/index.js';

class A2ATaskManager {
  async createTask({ sessionId, sourceAgentId, targetAgentId, input, conversationId }) {
    // 1. Mention Guard 检查
    const guardResult = await mentionGuard.guard(
      conversationId, sourceAgentId, targetAgentId, { input }
    );
    
    if (!guardResult.allowed) {
      // 阻止创建 Task，返回错误
      throw new A2AError(
        guardResult.reason,
        guardResult.message,
        guardResult
      );
    }
    
    // 2. 创建 Task
    const task = {
      id: uuidv4(),
      sessionId,
      sourceAgentId,
      targetAgentId,
      status: 'submitted',
      input,
      // ...
    };
    
    // 3. 记录 mention
    mentionGuard.record(conversationId, sourceAgentId, targetAgentId, {
      taskId: task.id,
      input: input.text?.slice(0, 100),
    });
    
    // 4. 存储任务
    this.activeTasks.set(task.id, task);
    
    return task;
  }
  
  // 任务完成时
  completeTask(taskId) {
    const task = this.activeTasks.get(taskId);
    if (task) {
      mentionGuard.completeTask(taskId);
      task.status = 'completed';
    }
  }
}
```

## 前端展示

```javascript
// 当 Mention Guard 阻止时
{
  type: 'mention_guard_blocked',
  reason: 'CYCLE_DETECTED',
  message: '检测到循环调用: Claude → Reviewer → Claude',
  suggestion: '建议换一种方式提问，或指定具体 Agent',
  stats: {
    totalMentions: 8,
    maxChainDepth: 3,
  }
}

// UI 展示
<div className="mention-guard-alert">
  <div className="alert-icon">⚠️</div>
  <div className="alert-content">
    <div className="alert-title">调用被阻止</div>
    <div className="alert-message">{message}</div>
    <div className="alert-suggestion">💡 {suggestion}</div>
    <div className="alert-stats">
      本对话已有 {stats.totalMentions} 次 Agent 调用
    </div>
  </div>
</div>
```

## 配置建议

```javascript
// config/mention-guard.config.js

export default {
  // 生产环境严格模式
  production: {
    perConversation: 10,    // 单对话最多 10 次 mention
    perAgent: 3,            // 单个 Agent 最多被调用 3 次
    perMinute: 5,           // 每分钟最多 5 次
    chainDepth: 3,          // 调用链深度不超过 3
    timeoutMs: 30000,       // 30秒超时
  },
  
  // 开发环境宽松模式
  development: {
    perConversation: 50,
    perAgent: 10,
    perMinute: 20,
    chainDepth: 5,
    timeoutMs: 60000,
  },
  
  // 白名单（某些 Agent 不受限制）
  whitelist: {
    agents: ['orchestrator'], // 编排器可以突破限制
    conversations: [],         // 特定对话 ID
  },
};
```

## 监控告警

```javascript
// 当触发防护时记录
logger.warn('[MentionGuard] Triggered', {
  conversationId,
  reason,
  stats,
  timestamp: new Date().toISOString(),
});

// 严重情况发送告警
if (stats.totalMentions > 20) {
  alertService.send({
    level: 'critical',
    message: `对话 ${conversationId} 出现异常高频率 mention`,
    action: '请检查是否出现逻辑错误',
  });
}
```

## 总结

| 防护机制 | 解决的问题 | 触发条件 |
|---------|-----------|---------|
| **Counter** | 过度调用 | 次数超过限制 |
| **Cycle Detector** | 无限循环 | A→B→A 循环 |
| **Rate Limiter** | 突发风暴 | 每分钟过多请求 |
| **Chain Depth** | 链式调用过长 | 调用深度 > 3 |
| **Timeout** | 任务卡死 | 超过 30 秒 |
| **Circuit Break** | 系统保护 | 紧急情况熔断 |
