# Phase 4.2: Intent Router（意图路由器）

## 概述

Intent Router 是 A2A 架构的核心决策组件，负责：
1. **意图识别** - 理解用户想要什么
2. **路由决策** - 决定走简单聊天还是 A2A 协作
3. **Agent 选择** - 选择合适的 Agent 或组合
4. **模式切换** - 在单 Agent 和 A2A 模式间切换

> **阶段说明**：本阶段在 A2A 基础协议（4.1）完成后实现，为 Agent 间通信提供智能路由能力。

## 架构位置

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户输入                                  │
│                    "@Claude 写个登录模块"                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Intent Router（意图路由器）                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Parser     │  │  Classifier  │  │   Decision   │          │
│  │  (@mention   │──→│  (意图识别)   │──→│   Engine     │          │
│  │   解析)      │  │              │  │  (路由决策)   │          │
│  └──────────────┘  └──────────────┘  └──────┬───────┘          │
│                                             │                   │
│                              ┌──────────────┼──────────────┐   │
│                              ▼              ▼              ▼   │
│  ┌────────────────────────────────────────────────────────────┐│
│  │                      路由结果                                ││
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐   ││
│  │  │ 简单聊天    │  │ 单 Agent    │  │ A2A 协作            │   ││
│  │  │ (直接回复)  │  │ (本地执行)  │  │ (创建 Task)        │   ││
│  │  └────────────┘  └────────────┘  └────────────────────┘   ││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. 意图分类器（Intent Classifier）

```javascript
// server/services/intent/classifier.js

const IntentTypes = {
  // 简单聊天类（不触发 A2A）
  GREETING: 'greeting',           // 问候: "你好"
  CHITCHAT: 'chitchat',           // 闲聊: "今天天气怎样"
  QUESTION: 'question',           // 知识问答: "什么是 JWT"
  
  // 单 Agent 执行类（本地执行，不触发 A2A）
  CODE_GENERATION: 'code_gen',    // 代码生成: "写个排序函数"
  EXPLAIN: 'explain',             // 解释: "解释这段代码"
  REFACTOR: 'refactor',           // 重构: "优化这段代码"
  
  // A2A 协作类（触发 Task）
  MULTI_STEP_TASK: 'multi_step',  // 多步骤任务: "设计并 review 登录模块"
  NEEDS_REVIEW: 'needs_review',   // 需要审查: "写代码并检查"
  NEEDS_EXPERT: 'needs_expert',   // 需要专家: "设计数据库"
  DELEGATION: 'delegation',       // 显式委托: "让 @Reviewer 检查"
  
  // 主动开口类（Agent 自主触发）
  PROACTIVE: 'proactive',         // 由 Agent 自主决定
};

class IntentClassifier {
  constructor() {
    this.rules = this.initRules();
  }

  initRules() {
    return [
      // 问候类
      {
        type: IntentTypes.GREETING,
        patterns: [/^(你好|嗨|hello|hi)\b/i, /^(早上|下午|晚上)好/i],
        priority: 10,
      },
      // 闲聊类
      {
        type: IntentTypes.CHITCHAT,
        patterns: [/天气/, /新闻/, /今天星期几/],
        priority: 10,
      },
      // 知识问答
      {
        type: IntentTypes.QUESTION,
        patterns: [/^(什么|怎么|为什么|如何)\b/, /^(解释|说明)一下/],
        priority: 20,
      },
      // 需要审查（触发 A2A）
      {
        type: IntentTypes.NEEDS_REVIEW,
        patterns: [
          /review|审查|检查.*代码/,
          /写.*代码.*检查/,
          /生成.*review/,
          /code.*review/i,
        ],
        priority: 80,
        requiresA2A: true,
        suggestedAgents: ['reviewer', 'code-checker'],
      },
      // 需要专家（触发 A2A）
      {
        type: IntentTypes.NEEDS_EXPERT,
        patterns: [
          /设计.*(架构|数据库|系统)/,
          /优化.*性能/,
          /安全.*(检查|审计)/,
        ],
        priority: 80,
        requiresA2A: true,
        suggestedAgents: ['architect', 'security-expert'],
      },
      // 多步骤任务（触发 A2A）
      {
        type: IntentTypes.MULTI_STEP_TASK,
        patterns: [
          /并.*(review|检查|测试)/,
          /然后.*(优化|改进)/,
          /先.*再.*最后/,
        ],
        priority: 90,
        requiresA2A: true,
        suggestedAgents: ['orchestrator'],
      },
      // 显式委托（触发 A2A）
      {
        type: IntentTypes.DELEGATION,
        patterns: [
          /让\s*@/,
          /请\s*@.*(帮忙|检查|review)/,
          /交给\s*@/,
        ],
        priority: 100,
        requiresA2A: true,
        extractTargetAgent: true,
      },
    ];
  }

  // 分类意图
  classify(message, context = {}) {
    const results = [];

    for (const rule of this.rules) {
      for (const pattern of rule.patterns) {
        if (pattern.test(message)) {
          results.push({
            type: rule.type,
            priority: rule.priority,
            requiresA2A: rule.requiresA2A || false,
            suggestedAgents: rule.suggestedAgents || [],
            matchedPattern: pattern.source,
          });
          break;
        }
      }
    }

    // 按优先级排序
    results.sort((a, b) => b.priority - a.priority);

    // 返回最高优先级的结果
    return results[0] || {
      type: IntentTypes.CODE_GENERATION,
      priority: 50,
      requiresA2A: false,
      suggestedAgents: [],
    };
  }

  // 基于 LLM 的高级分类（备用）
  async classifyWithLLM(message, availableAgents) {
    const prompt = `
分析用户意图，选择最合适的处理方式：

用户消息: "${message}"

可用 Agent:
${availableAgents.map(a => `- ${a.name}: ${a.role}`).join('\n')}

请判断：
1. 意图类型: [greeting|chitchat|question|code_gen|needs_review|needs_expert|multi_step|delegation]
2. 是否需要 A2A 协作: [yes|no]
3. 如果需要，推荐哪个 Agent: [agent_name|none]
4. 置信度: [0-100]

返回 JSON 格式。
`;

    // 调用当前 Agent 进行意图识别
    // 实际实现时调用 LLM
    return {
      type: 'code_gen',
      requiresA2A: false,
      suggestedAgent: null,
      confidence: 85,
    };
  }
}

export { IntentClassifier, IntentTypes };
```

### 2. 决策引擎（Decision Engine）

```javascript
// server/services/intent/decisionEngine.js

import { IntentTypes } from './classifier.js';

const RoutingMode = {
  DIRECT_REPLY: 'direct_reply',       // 直接回复（问候、闲聊）
  LOCAL_EXECUTION: 'local',           // 本地执行（代码生成、解释）
  A2A_COLLABORATION: 'a2a',           // A2A 协作（创建 Task）
  ORCHESTRATION: 'orchestration',     // 编排模式（多 Agent 协作）
};

class DecisionEngine {
  constructor(agentRegistry) {
    this.agentRegistry = agentRegistry;
    this.thresholds = {
      a2aConfidence: 70,      // A2A 置信度阈值
      complexity: 3,          // 复杂度阈值
    };
  }

  // 核心决策方法
  async decide(message, context) {
    const { intent, currentAgent, conversationHistory } = context;

    // 1. 简单意图直接回复
    if (this.isDirectReply(intent)) {
      return {
        mode: RoutingMode.DIRECT_REPLY,
        reason: '简单意图，直接回复',
        executor: currentAgent,
      };
    }

    // 2. 显式要求 A2A
    if (intent.requiresA2A) {
      const targetAgent = await this.selectTargetAgent(intent, message);
      return {
        mode: RoutingMode.A2A_COLLABORATION,
        reason: `需要 ${targetAgent?.name || '专家'} 协助`,
        executor: currentAgent,
        collaborators: [targetAgent],
        workflow: this.designWorkflow(intent, currentAgent, targetAgent),
      };
    }

    // 3. 基于复杂度判断
    const complexity = this.assessComplexity(message, conversationHistory);
    if (complexity >= this.thresholds.complexity) {
      const targetAgent = await this.selectTargetAgent(intent, message);
      return {
        mode: RoutingMode.A2A_COLLABORATION,
        reason: `任务复杂度高 (${complexity}/5)，建议协作`,
        executor: currentAgent,
        collaborators: [targetAgent],
        workflow: this.designWorkflow(intent, currentAgent, targetAgent),
      };
    }

    // 4. 默认本地执行
    return {
      mode: RoutingMode.LOCAL_EXECUTION,
      reason: '本地可处理',
      executor: currentAgent,
    };
  }

  // 判断是否直接回复
  isDirectReply(intent) {
    return [
      IntentTypes.GREETING,
      IntentTypes.CHITCHAT,
      IntentTypes.QUESTION,
    ].includes(intent.type);
  }

  // 选择目标 Agent
  async selectTargetAgent(intent, message) {
    // 1. 显式指定的 Agent
    if (intent.type === IntentTypes.DELEGATION) {
      const mentioned = this.extractMentionedAgent(message);
      if (mentioned) return mentioned;
    }

    // 2. 基于建议列表选择
    if (intent.suggestedAgents?.length > 0) {
      return this.agentRegistry.findByRole(intent.suggestedAgents[0]);
    }

    // 3. 基于消息内容匹配
    return this.agentRegistry.findBestMatch(message);
  }

  // 评估任务复杂度
  assessComplexity(message, history) {
    let score = 1;

    // 长度因素
    if (message.length > 100) score += 1;
    if (message.length > 300) score += 1;

    // 多步骤关键词
    if (/先.*再.*然后/.test(message)) score += 1;
    if (/并.*且/.test(message)) score += 1;

    // 涉及多个领域
    if (/数据库.*接口|前端.*后端/.test(message)) score += 1;

    // 历史上下文复杂
    if (history?.length > 10) score += 1;

    return Math.min(5, score);
  }

  // 设计工作流
  designWorkflow(intent, sourceAgent, targetAgent) {
    switch (intent.type) {
      case IntentTypes.NEEDS_REVIEW:
        return {
          steps: [
            { agent: sourceAgent, action: 'generate_code' },
            { agent: targetAgent, action: 'review_code' },
            { agent: sourceAgent, action: 'summarize_review' },
          ],
        };

      case IntentTypes.MULTI_STEP_TASK:
        return {
          steps: [
            { agent: sourceAgent, action: 'design' },
            { agent: targetAgent, action: 'implement' },
            { agent: sourceAgent, action: 'review' },
          ],
        };

      default:
        return {
          steps: [
            { agent: sourceAgent, action: 'prepare' },
            { agent: targetAgent, action: 'execute' },
            { agent: sourceAgent, action: 'finalize' },
          ],
        };
    }
  }

  // 提取 @提及的 Agent
  extractMentionedAgent(message) {
    const mentionMatch = message.match(/@(\w+)/);
    if (mentionMatch) {
      return this.agentRegistry.findByName(mentionMatch[1]);
    }
    return null;
  }
}

export { DecisionEngine, RoutingMode };
```

### 3. Intent Router 主入口

```javascript
// server/services/intent/router.js

import { IntentClassifier } from './classifier.js';
import { DecisionEngine, RoutingMode } from './decisionEngine.js';
import a2aTaskManager from '../a2a/a2aTaskManager.js';
import proactiveService from '../proactive/proactiveService.js';
import logger from '../../logger.js';

class IntentRouter {
  constructor(agentRegistry) {
    this.classifier = new IntentClassifier();
    this.decisionEngine = new DecisionEngine(agentRegistry);
    this.agentRegistry = agentRegistry;
  }

  // 主路由方法
  async route(message, context) {
    logger.log('[IntentRouter] Routing message: "%s..."', message.slice(0, 50));

    // 1. 意图识别
    const intent = this.classifier.classify(message, context);
    logger.log('[IntentRouter] Intent: %s (A2A: %s)', intent.type, intent.requiresA2A);

    // 2. 决策
    const decision = await this.decisionEngine.decide(message, {
      intent,
      currentAgent: context.currentAgent,
      conversationHistory: context.history,
    });

    logger.log('[IntentRouter] Decision: %s - %s', decision.mode, decision.reason);

    // 3. 执行
    return this.execute(decision, message, context);
  }

  // 根据决策执行
  async execute(decision, message, context) {
    switch (decision.mode) {
      case RoutingMode.DIRECT_REPLY:
        return this.handleDirectReply(decision, message, context);

      case RoutingMode.LOCAL_EXECUTION:
        return this.handleLocalExecution(decision, message, context);

      case RoutingMode.A2A_COLLABORATION:
        return this.handleA2ACollaboration(decision, message, context);

      case RoutingMode.ORCHESTRATION:
        return this.handleOrchestration(decision, message, context);

      default:
        throw new Error(`Unknown routing mode: ${decision.mode}`);
    }
  }

  // 直接回复
  async handleDirectReply(decision, message, context) {
    return {
      type: 'direct',
      executor: decision.executor.id,
      execute: async () => {
        // 直接调用 Agent 生成回复
        return decision.executor.generateReply(message);
      },
    };
  }

  // 本地执行
  async handleLocalExecution(decision, message, context) {
    return {
      type: 'local',
      executor: decision.executor.id,
      execute: async (onStream) => {
        // 本地 spawn Agent 进程
        return decision.executor.execute(message, onStream);
      },
    };
  }

  // A2A 协作
  async handleA2ACollaboration(decision, message, context) {
    const { executor, collaborators, workflow } = decision;
    const targetAgent = collaborators[0];

    // 创建 A2A Task
    const task = a2aTaskManager.createTask({
      sessionId: context.sessionId,
      sourceAgentId: executor.id,
      targetAgentId: targetAgent.id,
      input: {
        text: message,
        workflow,
        context: context.history,
      },
    });

    // 通知用户正在协调
    proactiveService.sendProactiveMessage({
      type: 'a2a_started',
      agentId: executor.id,
      conversationId: context.conversationId,
      content: {
        title: '正在协调',
        body: `${executor.name} 正在请求 ${targetAgent.name} 协助...`,
        taskId: task.id,
      },
    });

    return {
      type: 'a2a',
      taskId: task.id,
      executor: executor.id,
      target: targetAgent.id,
      workflow,
      execute: async (onUpdate) => {
        // 启动 A2A 工作流
        return this.executeA2AWorkflow(task, workflow, onUpdate);
      },
    };
  }

  // 编排模式（多 Agent）
  async handleOrchestration(decision, message, context) {
    // 复杂的多 Agent 协作场景
    // 例如: 设计 → 实现 → 测试 → Review
    return {
      type: 'orchestration',
      workflow: decision.workflow,
      execute: async (onUpdate) => {
        // 顺序执行多个 A2A Task
        for (const step of decision.workflow.steps) {
          onUpdate?.({ step: step.action, agent: step.agent.name });
          // 执行每个步骤...
        }
      },
    };
  }

  // 执行 A2A 工作流
  async executeA2AWorkflow(task, workflow, onUpdate) {
    for (const step of workflow.steps) {
      onUpdate?.({
        type: 'step_start',
        step: step.action,
        agent: step.agent.name,
      });

      // 执行步骤...
      await step.agent.execute(step.action);

      onUpdate?.({
        type: 'step_complete',
        step: step.action,
        agent: step.agent.name,
      });
    }

    return task;
  }
}

export default IntentRouter;
```

### 4. 集成到 WebSocket 处理

```javascript
// server/websocket.js (修改)

import IntentRouter from './services/intent/router.js';

// 初始化 Intent Router
const intentRouter = new IntentRouter(agentRegistry);

// 处理 send 动作
async function handleSend(ws, data) {
  const { agentId, text, conversationId } = data;
  const currentAgent = agentRegistry.get(agentId);

  // 使用 Intent Router 路由消息
  const routeResult = await intentRouter.route(text, {
    currentAgent,
    sessionId: data.sessionId,
    conversationId,
    history: await getConversationHistory(conversationId),
  });

  // 根据路由结果处理
  switch (routeResult.type) {
    case 'direct':
    case 'local':
      // 原有逻辑：本地执行
      handleLocalExecution(ws, routeResult, text);
      break;

    case 'a2a':
      // A2A 模式：创建 Task 并通知
      handleA2AExecution(ws, routeResult);
      break;

    case 'orchestration':
      // 编排模式
      handleOrchestration(ws, routeResult);
      break;
  }
}

// 本地执行（原有逻辑）
async function handleLocalExecution(ws, routeResult, text) {
  const { executor, execute } = routeResult;
  
  // 启动 Agent
  agentRunner.run(executor, onOutput, onExit);
  agentRunner.sendInput(executor, text);
}

// A2A 执行
async function handleA2AExecution(ws, routeResult) {
  const { taskId, executor, target, workflow, execute } = routeResult;

  // 通知客户端 A2A 开始
  ws.send(JSON.stringify({
    type: 'a2a_started',
    taskId,
    executor,
    target,
    workflow: workflow.steps.map(s => ({ agent: s.agent.name, action: s.action })),
  }));

  // 执行 A2A 工作流
  await execute((update) => {
    ws.send(JSON.stringify({
      type: 'a2a_update',
      taskId,
      ...update,
    }));
  });

  // A2A 完成
  ws.send(JSON.stringify({
    type: 'a2a_completed',
    taskId,
  }));
}
```

## 决策流程图

```
用户输入: "@Claude 写个登录模块并 review"
         │
         ▼
┌─────────────────────┐
│   Intent Classifier  │
│   - 匹配到关键词:     │
│     "写" + "review"  │
│   - 意图: MULTI_STEP │
│   - requiresA2A: true│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Decision Engine    │
│   - 复杂度: 4/5      │
│   - 推荐: Reviewer   │
│   - 决策: A2A_COLLAB │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Workflow Design    │
│   Step1: Claude 写   │
│   Step2: Reviewer    │
│   Step3: Claude 汇总 │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Execute            │
│   - 创建 A2A Task    │
│   - 通知用户         │
│   - 开始执行         │
└─────────────────────┘
```

## 配置示例

```javascript
// config/intent-router.config.js

export default {
  classifier: {
    // 使用规则还是 LLM
    mode: 'rule', // 'rule' | 'llm' | 'hybrid'
    
    // LLM 配置
    llm: {
      model: 'claude-3-opus',
      temperature: 0.1,
    },
  },
  
  decision: {
    // 复杂度阈值
    complexityThreshold: 3,
    
    // A2A 置信度阈值
    a2aConfidenceThreshold: 70,
    
    // 强制 A2A 的关键词
    forceA2AKeywords: [
      'review', '检查', '审查',
      '优化', '重构', '设计',
    ],
    
    // 强制本地执行的关键词
    forceLocalKeywords: [
      '解释', '什么是', '说明',
      '你好', '谢谢',
    ],
  },
  
  agents: {
    // Agent 角色映射
    roleMapping: {
      'reviewer': ['CodeReviewer', 'Reviewer'],
      'architect': ['Architect', 'Designer'],
      'security': ['SecurityExpert'],
    },
  },
};
```

## 下一步

1. 实现基础 Intent Classifier（规则版）
2. 集成到 WebSocket 处理流程
3. 添加 A2A 模式的前端 UI
4. 收集数据训练 LLM 分类器
