# Phase 3.4: Hindsight 长期记忆服务集成

## 概述

基于 [Hindsight](https://github.com/vectorize-io/hindsight) 开源项目，为 co_agent 构建类人长期记忆系统。

### 为什么选择 Hindsight？

| 特性 | 传统 RAG | Hindsight |
|------|----------|-----------|
| 记忆结构 | 扁平化向量 | 四网络仿生结构 |
| 证据区分 | 模糊 | 明确区分事实/信念 |
| 时序关系 | 弱 | 强（时序实体图谱）|
| 推理能力 | 仅检索 | Retain + Recall + Reflect |
| 性能 | GPT-4o 60.2% | 20B 模型 83.6% |

## 核心架构

### 1. 四网络记忆结构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Hindsight Memory Bank                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐│
│  │   World     │  │ Experience  │  │   Opinion   │  │Observ-  ││
│  │   世界事实   │  │  个人经历    │  │   观点信念   │  │ation   ││
│  ├─────────────┤  ├─────────────┤  ├─────────────┤  │抽象观察 ││
│  │ 客观事实    │  │ Agent 经历  │  │ 主观判断    │  ├─────────┤│
│  │ 不变真理    │  │ 执行记录    │  │ 置信度评分  │  │多事实  ││
│  │ 通用知识    │  │ 任务历史    │  │ 偏好倾向    │  │综合洞察││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 三大核心操作

```javascript
// Retain: 存储记忆 - 将对话拆解为 5W1H 维度
// Recall: 检索记忆 - 四路召回策略（语义/时序/实体/图谱）
// Reflect: 反思推理 - 基于记忆生成新洞察
```

### 3. 与 co_agent 的集成架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      co_agent 系统架构                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Claude    │    │  Opencode   │    │  其他 Agent │         │
│  │     CLI     │    │     CLI     │    │             │         │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Layer 3: Memory                       │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │              Hindsight Adapter                   │    │   │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐            │    │   │
│  │  │  │ Retain  │ │ Recall  │ │ Reflect │            │    │   │
│  │  │  └────┬────┘ └────┬────┘ └────┬────┘            │    │   │
│  │  └───────┼───────────┼───────────┼─────────────────┘    │   │
│  │          │           │           │                       │   │
│  │          ▼           ▼           ▼                       │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │           Hindsight Server (Docker)             │    │   │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐      │    │   │
│  │  │  │  TEMPR   │  │  CARA    │  │  Vector  │      │    │   │
│  │  │  │ 时序图谱  │  │ 推理引擎 │  │  Store   │      │    │   │
│  │  │  └──────────┘  └──────────┘  └──────────┘      │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 实现设计

### 1. Hindsight 服务部署

```yaml
# docker-compose.yml
version: '3.8'
services:
  hindsight:
    image: vectorize/hindsight:latest
    ports:
      - "8888:8888"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - HINDSIGHT_EMBEDDING_MODEL=text-embedding-3-small
      - HINDSIGHT_LLM_MODEL=gpt-4o-mini
    volumes:
      - hindsight_data:/data
    restart: unless-stopped

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage

volumes:
  hindsight_data:
  qdrant_data:
```

### 2. Hindsight Adapter 服务

```javascript
// server/services/hindsightAdapter.js

import logger from '../logger.js';

const HINDSIGHT_BASE_URL = process.env.HINDSIGHT_URL || 'http://localhost:8888';

/**
 * Hindsight 长期记忆适配器
 * 将 Hindsight 的 Retain/Recall/Reflect 操作封装为 co_agent 可用的接口
 */
class HindsightAdapter {
  constructor() {
    this.baseUrl = HINDSIGHT_BASE_URL;
  }

  /**
   * Retain: 存储记忆
   * 将对话内容存储到 Hindsight 记忆库
   * 
   * @param {string} bankId - 记忆库 ID（通常为 conversationId）
   * @param {string} content - 要存储的内容
   * @param {Object} options - 可选配置
   */
  async retain(bankId, content, options = {}) {
    const { metadata = {} } = options;
    
    try {
      const response = await fetch(`${this.baseUrl}/v1/retain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bank_id: bankId,
          content,
          metadata: {
            agent_id: metadata.agentId,
            agent_name: metadata.agentName,
            conversation_id: metadata.conversationId,
            timestamp: new Date().toISOString(),
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Hindsight retain failed: ${response.statusText}`);
      }

      const result = await response.json();
      logger.log('[HindsightAdapter] retain success: bank=%s facts=%d', 
        bankId, result.facts_created || 0);
      
      return result;
    } catch (error) {
      logger.error('[HindsightAdapter] retain error:', error.message);
      throw error;
    }
  }

  /**
   * Recall: 检索记忆
   * 从记忆库中检索相关内容
   * 
   * @param {string} bankId - 记忆库 ID
   * @param {string} query - 查询内容
   * @param {Object} options - 检索选项
   */
  async recall(bankId, query, options = {}) {
    const {
      types = ['world', 'experience', 'opinion', 'observation'],
      maxResults = 10,
      tokenBudget = 1000,
    } = options;

    try {
      const response = await fetch(`${this.baseUrl}/v1/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bank_id: bankId,
          query,
          types,
          max_results: maxResults,
          token_budget: tokenBudget,
        }),
      });

      if (!response.ok) {
        throw new Error(`Hindsight recall failed: ${response.statusText}`);
      }

      const result = await response.json();
      logger.log('[HindsightAdapter] recall success: bank=%s results=%d', 
        bankId, result.memories?.length || 0);
      
      return result.memories || [];
    } catch (error) {
      logger.error('[HindsightAdapter] recall error:', error.message);
      return []; // 降级处理，返回空数组
    }
  }

  /**
   * Reflect: 反思推理
   * 基于记忆生成新的洞察和推理
   * 
   * @param {string} bankId - 记忆库 ID
   * @param {string} query - 推理问题
   * @param {Object} options - 推理选项
   */
  async reflect(bankId, query, options = {}) {
    const {
      disposition = 'balanced', // curious, cautious, balanced
      includeToolCalls = false,
    } = options;

    try {
      const response = await fetch(`${this.baseUrl}/v1/reflect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bank_id: bankId,
          query,
          disposition,
          include: {
            tool_calls: includeToolCalls,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Hindsight reflect failed: ${response.statusText}`);
      }

      const result = await response.json();
      logger.log('[HindsightAdapter] reflect success: bank=%s', bankId);
      
      return result;
    } catch (error) {
      logger.error('[HindsightAdapter] reflect error:', error.message);
      return { response: '', observations: [] };
    }
  }

  /**
   * 构建 Layer 3 上下文
   * 为 Agent 提供记忆上下文
   */
  async buildMemoryContext(agentId, conversationId, currentQuery) {
    const bankId = `conv-${conversationId}`;
    
    // 1. 检索相关记忆
    const memories = await this.recall(bankId, currentQuery, {
      maxResults: 5,
      tokenBudget: 600,
    });

    if (memories.length === 0) {
      return '';
    }

    // 2. 格式化为上下文
    let context = '## 长期记忆\n\n';
    
    // 按类型分组
    const grouped = {
      world: memories.filter(m => m.type === 'world'),
      experience: memories.filter(m => m.type === 'experience'),
      opinion: memories.filter(m => m.type === 'opinion'),
      observation: memories.filter(m => m.type === 'observation'),
    };

    if (grouped.world.length > 0) {
      context += '### 相关事实\n';
      grouped.world.forEach(m => {
        context += `- ${m.text}\n`;
      });
      context += '\n';
    }

    if (grouped.experience.length > 0) {
      context += '### 历史经历\n';
      grouped.experience.forEach(m => {
        context += `- ${m.text}\n`;
      });
      context += '\n';
    }

    if (grouped.opinion.length > 0) {
      context += '### 已有判断\n';
      grouped.opinion.forEach(m => {
        const confidence = m.confidence ? ` (${Math.round(m.confidence * 100)}%)` : '';
        context += `- ${m.text}${confidence}\n`;
      });
      context += '\n';
    }

    if (grouped.observation.length > 0) {
      context += '### 综合洞察\n';
      grouped.observation.forEach(m => {
        context += `- ${m.text}\n`;
      });
    }

    return context.trim();
  }

  /**
   * 存储对话消息
   * 在对话结束后调用，将关键信息存入长期记忆
   */
  async storeConversationMemory(conversationId, messages, agentId, agentName) {
    const bankId = `conv-${conversationId}`;
    
    // 提取关键内容
    const keyContent = this.extractKeyContent(messages);
    
    if (!keyContent) {
      return null;
    }

    // 存储到 Hindsight
    return await this.retain(bankId, keyContent, {
      metadata: {
        agentId,
        agentName,
        conversationId,
        messageType: 'conversation_summary',
      },
    });
  }

  /**
   * 提取关键内容
   * 从消息中提取值得长期记忆的内容
   */
  extractKeyContent(messages) {
    const importantPatterns = [
      /决定|确定|选择|方案|结论/,
      /重要|关键|注意|记住/,
      /完成|解决|实现|修复/,
      /问题|错误|bug|issue/i,
    ];

    const keyMessages = messages.filter(m => {
      if (m.role === 'user') return false;
      return importantPatterns.some(p => p.test(m.content || ''));
    });

    if (keyMessages.length === 0) {
      return null;
    }

    // 构建摘要
    const parts = keyMessages.map(m => {
      const agent = m.agent_name || 'Agent';
      const content = m.content?.substring(0, 200) || '';
      return `${agent}: ${content}`;
    });

    return parts.join('\n\n');
  }
}

// 单例导出
export const hindsightAdapter = new HindsightAdapter();
export default hindsightAdapter;
```

### 3. 集成到 AgentRunner

```javascript
// server/services/agentRunner.js 修改

import hindsightAdapter from './hindsightAdapter.js';

// 在 runClaudeCli 中添加记忆上下文
export async function runClaudeCli(agentId, prompt, onOutput, onExit, conversationId) {
  // ... 现有代码 ...

  // Layer 3: 长期记忆（Hindsight）
  let memoryContext = '';
  try {
    memoryContext = await hindsightAdapter.buildMemoryContext(
      agentId, 
      conversationId, 
      prompt
    );
  } catch (e) {
    logger.error('[agentRunner] Hindsight context error:', e.message);
  }

  // 构建完整上下文
  let enrichedPrompt = prompt;
  if (memoryContext) {
    enrichedPrompt = `${memoryContext}\n\n## 当前问题\n${prompt}`;
  }

  // ... 继续执行 ...
}

// 在进程退出时存储记忆
const onExit = async (code, signal) => {
  // ... 现有清理逻辑 ...

  // 存储到长期记忆
  if (conversationId && content.trim()) {
    try {
      await hindsightAdapter.storeConversationMemory(
        conversationId,
        [{ role: 'assistant', content, agent_name: agentName }],
        agentId,
        agentName
      );
    } catch (e) {
      logger.error('[agentRunner] Store memory error:', e.message);
    }
  }

  // ... 调用原始 onExit ...
};
```

### 4. API 路由

```javascript
// server/routes/hindsight.js

import express from 'express';
import hindsightAdapter from '../services/hindsightAdapter.js';

const router = express.Router();

// 存储记忆
router.post('/retain', async (req, res) => {
  try {
    const { bankId, content, metadata } = req.body;
    const result = await hindsightAdapter.retain(bankId, content, { metadata });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 检索记忆
router.post('/recall', async (req, res) => {
  try {
    const { bankId, query, types, maxResults, tokenBudget } = req.body;
    const memories = await hindsightAdapter.recall(bankId, query, {
      types,
      maxResults,
      tokenBudget,
    });
    res.json({ memories });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 反思推理
router.post('/reflect', async (req, res) => {
  try {
    const { bankId, query, disposition } = req.body;
    const result = await hindsightAdapter.reflect(bankId, query, { disposition });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取记忆上下文
router.get('/context/:conversationId', async (req, res) => {
  try {
    const { agentId } = req.query;
    const { query } = req.query;
    const context = await hindsightAdapter.buildMemoryContext(
      agentId,
      req.params.conversationId,
      query
    );
    res.json({ context });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
```

### 5. 环境配置

```bash
# .env 添加
HINDSIGHT_URL=http://localhost:8888
HINDSIGHT_ENABLED=true
```

## 记忆存储策略

### 触发条件

```javascript
// server/services/memoryTrigger.js

export const MEMORY_TRIGGERS = {
  // 任务完成时存储
  onTaskComplete: {
    enabled: true,
    minContentLength: 50,
  },

  // 发现重要决策时存储
  onDecision: {
    enabled: true,
    patterns: [/决定|确定|选择|方案/],
  },

  // 错误修复时存储
  onBugFix: {
    enabled: true,
    patterns: [/修复|解决|fix|resolve/i],
  },

  // 定期摘要存储
  periodicSummary: {
    enabled: true,
    interval: 10, // 每 10 条消息
  },
};

export function shouldStoreMemory(content, context) {
  // 用户消息不存储
  if (context.role === 'user') return false;

  // 内容太短不存储
  if ((content?.length || 0) < 20) return false;

  // 检查是否包含重要信息
  const hasImportantInfo = MEMORY_TRIGGERS.onDecision.patterns
    .some(p => p.test(content));

  return hasImportantInfo;
}
```

## 降级策略

当 Hindsight 服务不可用时，自动降级到本地记忆系统：

```javascript
// server/services/memoryFallback.js

import db from '../db.js';

/**
 * 本地记忆降级方案
 * 当 Hindsight 不可用时使用 SQLite 存储
 */
export class LocalMemoryFallback {
  async recall(conversationId, query) {
    // 从 conversation_summaries 表检索
    const summaries = db.prepare(`
      SELECT * FROM conversation_summaries 
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(conversationId);

    // 从共识知识检索
    const consensus = db.prepare(`
      SELECT * FROM consensus_knowledge
      WHERE value LIKE ? OR context LIKE ?
      LIMIT 5
    `).all(`%${query}%`, `%${query}%`);

    return [...summaries, ...consensus].map(item => ({
      type: item.key ? 'consensus' : 'summary',
      text: item.summary || item.value,
      confidence: item.confidence ? item.confidence / 100 : 0.5,
    }));
  }

  async retain(conversationId, content) {
    // 存储到 conversation_summaries
    db.prepare(`
      INSERT INTO conversation_summaries 
      (conversation_id, summary, created_at)
      VALUES (?, ?, datetime('now'))
    `).run(conversationId, content);

    return { success: true };
  }
}
```

## 部署步骤

### Step 1: 部署 Hindsight 服务

```bash
# 克隆 Hindsight
git clone https://github.com/vectorize-io/hindsight.git
cd hindsight

# 启动服务
docker-compose up -d
```

### Step 2: 安装依赖

```bash
# 无需额外依赖，使用原生 fetch API
```

### Step 3: 配置环境变量

```bash
# .env
HINDSIGHT_URL=http://localhost:8888
HINDSIGHT_ENABLED=true
```

### Step 4: 添加路由

```javascript
// server/index.js
import hindsightRouter from './routes/hindsight.js';
app.use('/api/hindsight', hindsightRouter);
```

## 验收标准

- [ ] Hindsight 服务成功部署并运行
- [ ] Retain 操作能存储对话记忆
- [ ] Recall 操作能检索相关记忆
- [ ] Reflect 操作能生成推理洞察
- [ ] Agent 执行时自动获取记忆上下文
- [ ] 对话结束后自动存储关键记忆
- [ ] Hindsight 不可用时能降级到本地记忆
- [ ] API 端点正常工作

## 性能指标

| 指标 | 目标值 |
|------|--------|
| Recall 响应时间 | < 300ms |
| Retain 处理时间 | < 500ms |
| 记忆相关性准确率 | > 80% |
| 上下文压缩率 | > 60% |

## 后续优化

1. **批量存储** - 累积多条消息后批量存储
2. **异步处理** - Retain 操作异步执行，不阻塞主流程
3. **记忆衰减** - 旧记忆自动降低权重
4. **跨会话记忆** - 支持跨对话检索
5. **Agent 个性化** - 每个 Agent 有独立的记忆空间

## 参考资源

- [Hindsight GitHub](https://github.com/vectorize-io/hindsight)
- [Hindsight 论文](https://arxiv.org/html/2512.12818v1)
- [Phase 3.4 原始设计](./phase3.4-memory-system.md)
