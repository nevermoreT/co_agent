# Phase 4.4: 主动开口机制

## 概述

主动开口机制允许 Agent 在没有用户输入的情况下，主动向对话发送消息。这是实现真正"智能体协作"的关键能力。

> **阶段说明**：本阶段为高阶特性，在 A2A 基础协议、Agent 间通信、提及防护机制全部完成后实现。

## 使用场景

### 1. 任务完成通知
```
用户: "@Claude 帮我写一个登录模块"
[Claude 开始工作...]
[几分钟后...]
Claude: "✅ 登录模块已完成！包含：
        - JWT 认证
        - 密码加密
        - 登录表单
        需要我解释实现细节吗？"
```

### 2. 请求协助
```
Claude: "我在设计数据库结构时遇到了选择困难。
        @DatabaseExpert 你觉得用户表应该用 UUID 还是自增 ID？"
```

### 3. 重要提醒
```
SecurityAgent: "⚠️ 检测到代码中使用了明文存储密码，
              建议立即修改为 bcrypt 加密！"
```

### 4. 定期报告
```
BuildAgent: "📊 每日构建报告 (2026-03-01)
            - 构建时间: 2m 34s
            - 测试通过率: 98/100
            - 代码覆盖率: 87%"
```

### 5. Agent 间协作
```
Claude: "我完成了 API 设计，@Reviewer 请帮我 review 一下"
[Reviewer 开始工作...]
Reviewer: "发现 2 个问题：
          1. 缺少错误处理
          2. 建议添加限流
          @Claude 请修复"
Claude: "已修复，请再次确认"
```

## 架构设计

```
┌────────────────────────────────────────────────────────────────┐
│                    主动开口机制架构                              │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│  │   Trigger    │───→│   Decision   │───→│   Message    │     │
│  │   Sources    │    │   Engine     │    │   Builder    │     │
│  └──────────────┘    └──────────────┘    └──────────────┘     │
│         │                   │                   │              │
│         ▼                   ▼                   ▼              │
│  ┌──────────────────────────────────────────────────────┐     │
│  │                  Proactive Service                    │     │
│  │         (WebSocket / Server-Sent Events)              │     │
│  └──────────────────────────────────────────────────────┘     │
│                              │                                 │
│                              ▼                                 │
│  ┌──────────────────────────────────────────────────────┐     │
│  │                   Frontend (React)                    │     │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐      │     │
│  │  │   Toast    │  │   Badge    │  │   Sound    │      │     │
│  │  │  Notification│  │  Indicator │  │   Alert    │      │     │
│  │  └────────────┘  └────────────┘  └────────────┘      │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. 触发源 (Trigger Sources)

```javascript
// server/services/proactive/triggerSources.js

export const TriggerSources = {
  // 任务完成
  TASK_COMPLETE: 'task_complete',
  
  // 时间触发
  SCHEDULED: 'scheduled',
  
  // 事件触发
  EVENT: 'event',
  
  // Agent 间调用
  A2A_INVOCATION: 'a2a_invocation',
  
  // 错误/异常
  ERROR: 'error',
  
  // 用户提及
  USER_MENTION: 'user_mention',
};

// 触发器注册表
class TriggerRegistry {
  constructor() {
    this.triggers = new Map();
  }

  register(type, handler) {
    if (!this.triggers.has(type)) {
      this.triggers.set(type, []);
    }
    this.triggers.get(type).push(handler);
  }

  async execute(type, context) {
    const handlers = this.triggers.get(type) || [];
    const results = [];
    
    for (const handler of handlers) {
      try {
        const result = await handler(context);
        if (result) results.push(result);
      } catch (e) {
        logger.error('[Proactive] Trigger handler error:', e);
      }
    }
    
    return results;
  }
}

export default new TriggerRegistry();
```

### 2. 决策引擎

```javascript
// server/services/proactive/decisionEngine.js

class DecisionEngine {
  constructor() {
    this.rules = [];
  }

  // 添加决策规则
  addRule(rule) {
    this.rules.push(rule);
  }

  // 评估是否应该主动开口
  async shouldSpeak({ agentId, triggerType, context, conversationId }) {
    // 检查用户设置
    const config = this.getAgentConfig(agentId);
    if (!config.proactiveEnabled) {
      return { shouldSpeak: false, reason: 'disabled' };
    }

    // 检查频率限制
    const lastProactive = await this.getLastProactiveTime(agentId, conversationId);
    if (lastProactive && Date.now() - lastProactive < config.minInterval) {
      return { shouldSpeak: false, reason: 'rate_limited' };
    }

    // 评估重要性
    const importance = this.calculateImportance(triggerType, context);
    if (importance < config.minImportance) {
      return { shouldSpeak: false, reason: 'low_importance' };
    }

    // 检查当前对话状态
    const conversationState = await this.getConversationState(conversationId);
    if (conversationState.isUserTyping) {
      return { shouldSpeak: false, reason: 'user_typing', delay: 5000 };
    }

    return { 
      shouldSpeak: true, 
      importance,
      suggestedDelay: this.calculateDelay(importance),
    };
  }

  calculateImportance(triggerType, context) {
    const importanceMap = {
      [TriggerSources.ERROR]: 10,
      [TriggerSources.TASK_COMPLETE]: 7,
      [TriggerSources.A2A_INVOCATION]: 6,
      [TriggerSources.USER_MENTION]: 8,
      [TriggerSources.SCHEDULED]: 4,
      [TriggerSources.EVENT]: 5,
    };

    let importance = importanceMap[triggerType] || 5;

    // 根据上下文调整
    if (context.urgent) importance += 2;
    if (context.requiresAction) importance += 1;
    if (context.isDuplicate) importance -= 3;

    return Math.min(10, Math.max(1, importance));
  }

  calculateDelay(importance) {
    // 重要性越高，延迟越短
    if (importance >= 9) return 0;
    if (importance >= 7) return 1000;
    if (importance >= 5) return 3000;
    return 5000;
  }

  getAgentConfig(agentId) {
    // 从数据库获取 Agent 配置
    const config = db.prepare('SELECT proactive_config FROM agents WHERE id = ?').get(agentId);
    return config ? JSON.parse(config.proactive_config) : {
      proactiveEnabled: true,
      minInterval: 30000, // 30秒
      minImportance: 3,
    };
  }

  async getLastProactiveTime(agentId, conversationId) {
    const row = db.prepare(`
      SELECT created_at FROM proactive_messages 
      WHERE agent_id = ? AND conversation_id = ? 
      ORDER BY created_at DESC LIMIT 1
    `).get(agentId, conversationId);
    
    return row ? new Date(row.created_at).getTime() : null;
  }

  async getConversationState(conversationId) {
    // 可以从 WebSocket 管理器获取实时状态
    return {
      isUserTyping: false, // TODO: 实现检测
      lastActivity: Date.now(),
    };
  }
}

export default new DecisionEngine();
```

### 3. 消息构建器

```javascript
// server/services/proactive/messageBuilder.js

class MessageBuilder {
  buildProactiveMessage({ type, agentId, content, context, options = {} }) {
    const base = {
      id: uuidv4(),
      type: 'proactive',
      subType: type,
      agentId,
      content: this.formatContent(content, type),
      metadata: {
        timestamp: new Date().toISOString(),
        importance: context.importance || 5,
        source: context.source,
        ...options.metadata,
      },
    };

    // 根据类型添加特定格式
    switch (type) {
      case TriggerSources.TASK_COMPLETE:
        return this.buildTaskCompleteMessage(base, content, context);
      
      case TriggerSources.A2A_INVOCATION:
        return this.buildA2AMessage(base, content, context);
      
      case TriggerSources.ERROR:
        return this.buildErrorMessage(base, content, context);
      
      case TriggerSources.SCHEDULED:
        return this.buildScheduledMessage(base, content, context);
      
      default:
        return base;
    }
  }

  buildTaskCompleteMessage(base, content, context) {
    return {
      ...base,
      content: {
        type: 'task_complete',
        title: '✅ 任务完成',
        body: content.summary || content,
        details: content.details,
        actions: [
          { label: '查看详情', action: 'view_task', taskId: context.taskId },
          { label: '继续对话', action: 'continue' },
        ],
      },
    };
  }

  buildA2AMessage(base, content, context) {
    return {
      ...base,
      content: {
        type: 'a2a_invocation',
        title: `@${context.targetAgentName}`,
        body: content,
        mentions: [context.targetAgentId],
        actions: [
          { label: '查看对话', action: 'view_thread', threadId: context.threadId },
        ],
      },
    };
  }

  buildErrorMessage(base, content, context) {
    return {
      ...base,
      content: {
        type: 'alert',
        level: 'error',
        title: '⚠️ ' + (content.title || '发现问题'),
        body: content.message || content,
        actions: content.actions || [],
      },
    };
  }

  buildScheduledMessage(base, content, context) {
    return {
      ...base,
      content: {
        type: 'report',
        title: content.title,
        body: content.body,
        timestamp: content.timestamp,
      },
    };
  }

  formatContent(content, type) {
    if (typeof content === 'string') {
      return { text: content };
    }
    return content;
  }
}

export default new MessageBuilder();
```

### 4. 主动消息服务

```javascript
// server/services/proactive/proactiveService.js
import triggerRegistry from './triggerSources.js';
import decisionEngine from './decisionEngine.js';
import messageBuilder from './messageBuilder.js';
import websocket from '../../websocket.js';
import db from '../../db.js';
import logger from '../../logger.js';

class ProactiveService {
  constructor() {
    this.scheduledTasks = new Map();
    this.initDefaultTriggers();
  }

  initDefaultTriggers() {
    // 注册任务完成触发器
    triggerRegistry.register(TriggerSources.TASK_COMPLETE, async (context) => {
      const decision = await decisionEngine.shouldSpeak({
        agentId: context.agentId,
        triggerType: TriggerSources.TASK_COMPLETE,
        context,
        conversationId: context.conversationId,
      });

      if (decision.shouldSpeak) {
        return this.sendProactiveMessage({
          type: TriggerSources.TASK_COMPLETE,
          agentId: context.agentId,
          conversationId: context.conversationId,
          content: {
            summary: `任务 "${context.taskName}" 已完成`,
            details: context.output,
          },
          context: { ...context, importance: decision.importance },
        });
      }
    });

    // 注册 A2A 调用触发器
    triggerRegistry.register(TriggerSources.A2A_INVOCATION, async (context) => {
      return this.sendProactiveMessage({
        type: TriggerSources.A2A_INVOCATION,
        agentId: context.sourceAgentId,
        conversationId: context.conversationId,
        content: context.message,
        context: {
          targetAgentId: context.targetAgentId,
          targetAgentName: context.targetAgentName,
          threadId: context.threadId,
        },
      });
    });
  }

  // 触发主动消息
  async trigger(type, context) {
    logger.log('[Proactive] Trigger: %s, Agent: %s', type, context.agentId);
    return triggerRegistry.execute(type, context);
  }

  // 发送主动消息
  async sendProactiveMessage({ type, agentId, conversationId, content, context }) {
    const message = messageBuilder.buildProactiveMessage({
      type,
      agentId,
      content,
      context,
    });

    // 持久化到数据库
    db.prepare(`
      INSERT INTO proactive_messages (agent_id, conversation_id, message_type, content, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      agentId,
      conversationId,
      type,
      JSON.stringify(message.content),
      JSON.stringify(message.metadata)
    );

    // 通过 WebSocket 推送
    websocket.broadcastProactiveMessage({
      conversationId,
      message,
    });

    logger.log('[Proactive] Message sent: %s to conversation %s', message.id, conversationId);
    return message;
  }

  // 调度定期任务
  schedule(agentId, cronExpression, generator) {
    // 使用 node-cron 或类似库
    const task = cron.schedule(cronExpression, async () => {
      const content = await generator();
      if (content) {
        this.trigger(TriggerSources.SCHEDULED, {
          agentId,
          content,
        });
      }
    });

    this.scheduledTasks.set(`${agentId}-${cronExpression}`, task);
    return task;
  }

  // 取消调度
  unschedule(agentId, cronExpression) {
    const key = `${agentId}-${cronExpression}`;
    const task = this.scheduledTasks.get(key);
    if (task) {
      task.stop();
      this.scheduledTasks.delete(key);
    }
  }

  // 获取未读消息
  getUnreadMessages(conversationId, agentId = null) {
    let sql = 'SELECT * FROM proactive_messages WHERE conversation_id = ? AND is_read = 0';
    const params = [conversationId];

    if (agentId) {
      sql += ' AND agent_id = ?';
      params.push(agentId);
    }

    sql += ' ORDER BY created_at DESC';

    return db.prepare(sql).all(...params);
  }

  // 标记已读
  markAsRead(messageId) {
    db.prepare('UPDATE proactive_messages SET is_read = 1 WHERE id = ?').run(messageId);
  }
}

export default new ProactiveService();
```

### 5. WebSocket 扩展

```javascript
// server/websocket.js (扩展)

// 添加主动消息广播方法
websocket.broadcastProactiveMessage = ({ conversationId, message }) => {
  const data = JSON.stringify({
    type: 'proactive',
    conversationId,
    message,
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // 可以添加过滤：只发送给订阅了该对话的客户端
      client.send(data);
    }
  });
};
```

## 前端实现

### 1. Proactive Message Hook

```javascript
// client/hooks/useProactiveMessages.js
import { useState, useEffect, useCallback } from 'react';
import { useWs } from './useWs';

export function useProactiveMessages(conversationId) {
  const [messages, setMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const { ws } = useWs();

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'proactive' && data.conversationId === conversationId) {
        setMessages(prev => [data.message, ...prev]);
        setUnreadCount(prev => prev + 1);
        
        // 显示通知
        showNotification(data.message);
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, conversationId]);

  const showNotification = (message) => {
    // 浏览器通知
    if (Notification.permission === 'granted') {
      new Notification(message.content.title || '新消息', {
        body: message.content.body || message.content.text,
      });
    }
  };

  const markAsRead = useCallback((messageId) => {
    fetch(`/api/proactive/${messageId}/read`, { method: 'POST' });
    setUnreadCount(prev => Math.max(0, prev - 1));
  }, []);

  const markAllAsRead = useCallback(() => {
    fetch(`/api/proactive/conversations/${conversationId}/read`, { method: 'POST' });
    setUnreadCount(0);
  }, [conversationId]);

  return { messages, unreadCount, markAsRead, markAllAsRead };
}
```

### 2. Proactive Toast 组件

```javascript
// client/components/ProactiveToast.jsx
import { useEffect, useState } from 'react';
import './ProactiveToast.css';

export default function ProactiveToast({ message, onClose, onAction }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, 5000);

    return () => clearTimeout(timer);
  }, [onClose]);

  const handleAction = (action) => {
    onAction?.(action);
    onClose();
  };

  if (!visible) return null;

  return (
    <div className={`proactive-toast importance-${message.metadata.importance}`}>
      <div className="toast-header">
        <span className="toast-icon">{getIcon(message.subType)}</span>
        <span className="toast-title">{message.content.title}</span>
        <button className="toast-close" onClick={onClose}>×</button>
      </div>
      <div className="toast-body">{message.content.body}</div>
      {message.content.actions && (
        <div className="toast-actions">
          {message.content.actions.map((action, idx) => (
            <button key={idx} onClick={() => handleAction(action)}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function getIcon(type) {
  const icons = {
    task_complete: '✅',
    a2a_invocation: '🔔',
    alert: '⚠️',
    scheduled: '📊',
    default: '💬',
  };
  return icons[type] || icons.default;
}
```

## 数据库 Schema

```sql
-- 主动消息表
CREATE TABLE proactive_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  conversation_id INTEGER,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (conversation_id) REFERENCES tasks(id)
);

CREATE INDEX idx_proactive_agent ON proactive_messages(agent_id);
CREATE INDEX idx_proactive_conversation ON proactive_messages(conversation_id);
CREATE INDEX idx_proactive_unread ON proactive_messages(is_read, created_at);

-- Agent 主动配置表
CREATE TABLE agent_proactive_config (
  agent_id INTEGER PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  min_interval_ms INTEGER DEFAULT 30000,
  min_importance INTEGER DEFAULT 3,
  allowed_types TEXT, -- JSON 数组
  schedule_config TEXT, -- JSON
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
```

## 集成到现有流程

### 在 Agent 完成任务时触发

```javascript
// server/services/agentRunner.js (修改)
import proactiveService from './proactive/proactiveService.js';

// 在进程退出时
child.on('exit', (code) => {
  onExit?.(code);
  
  // 触发主动消息
  proactiveService.trigger(TriggerSources.TASK_COMPLETE, {
    agentId,
    conversationId: currentConversationId,
    taskName: currentTaskName,
    output: accumulatedOutput,
    exitCode: code,
  });
});
```

### 在 A2A 调用时触发

```javascript
// 当 Agent A 调用 Agent B 时
proactiveService.trigger(TriggerSources.A2A_INVOCATION, {
  sourceAgentId: agentA.id,
  targetAgentId: agentB.id,
  targetAgentName: agentB.name,
  conversationId: currentConversationId,
  message: '需要你的帮助...',
});
```

## 下一步

1. 实现触发器框架
2. 添加决策引擎
3. 实现消息构建器
4. 集成到 WebSocket
5. 前端 Toast 组件
