# Phase 3.4: 记忆系统

## 目标

实现 **Layer 3: 近期对话摘要**，通过智能压缩和摘要技术，让 Agent 能够"记住"关键对话内容，同时避免 token 膨胀。包括：

1. **对话摘要生成** - 长对话自动压缩
2. **长期记忆管理** - 重要信息持久化
3. **记忆检索优化** - 快速找到相关记忆
4. **压缩策略** - 平衡信息量与 token 消耗

## 设计要点

### 1. 记忆层次结构

```
┌─────────────────────────────────────────────────────────┐
│                    记忆层次结构                          │
├─────────────────────────────────────────────────────────┤
│  Working Memory (工作记忆)                               │
│  - 最近 2-3 轮对话，完整内容                              │
│  - 不压缩，直接可用                                       │
├─────────────────────────────────────────────────────────┤
│  Short-term Memory (短期记忆)                            │
│  - 最近 10-20 轮对话，摘要形式                            │
│  - 提取关键信息，压缩长度                                  │
├─────────────────────────────────────────────────────────┤
│  Long-term Memory (长期记忆)                             │
│  - conversation_summaries 表                             │
│  - 对话级别的摘要，包含关键决策和结果                      │
├─────────────────────────────────────────────────────────┤
│  Knowledge Base (知识库)                                 │
│  - consensus_knowledge 表                                │
│  - 共享知识，跨对话可用                                   │
└─────────────────────────────────────────────────────────┘
```

### 2. 对话摘要数据结构

```javascript
// 新增表：conversation_summaries
CREATE TABLE conversation_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  
  -- 摘要内容
  summary TEXT NOT NULL,           -- 整体摘要
  key_topics TEXT DEFAULT '[]',    -- 关键话题 JSON 数组
  key_decisions TEXT DEFAULT '[]', -- 关键决策 JSON 数组
  action_items TEXT DEFAULT '[]',  -- 待办事项 JSON 数组
  
  -- 参与信息
  participants TEXT DEFAULT '[]',  -- 参与的 Agent JSON 数组
  message_count INTEGER DEFAULT 0, -- 涵盖的消息数
  message_range_start INTEGER,     -- 起始消息 ID
  message_range_end INTEGER,       -- 结束消息 ID
  
  -- 元数据
  compression_ratio REAL,          -- 压缩率
  generated_by TEXT,               -- 生成摘要的 Agent
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  
  FOREIGN KEY (conversation_id) REFERENCES tasks(id)
);
```

### 3. 摘要生成策略

```javascript
// server/services/summaryGenerator.js

/**
 * 对话摘要生成器
 * 策略：
 * 1. 短对话（<5 条）：不生成摘要，直接使用原文
 * 2. 中等对话（5-20 条）：提取关键句子生成摘要
 * 3. 长对话（>20 条）：分层摘要，先生成段落摘要，再汇总
 */

export async function generateConversationSummary(conversationId, options = {}) {
  const { maxSummaryLength = 500, forceRegenerate = false } = options;
  
  // 获取对话消息
  const messages = db.prepare(`
    SELECT * FROM global_messages 
    WHERE task_id = ? 
    ORDER BY created_at ASC
  `).all(conversationId);
  
  if (messages.length < 5) {
    return { summary: null, reason: 'messages_too_few' };
  }
  
  // 检查是否已有摘要
  const existing = db.prepare(`
    SELECT * FROM conversation_summaries 
    WHERE conversation_id = ? AND message_range_end >= ?
  `).get(conversationId, messages[messages.length - 1].id);
  
  if (existing && !forceRegenerate) {
    return { summary: existing, reason: 'existing_valid' };
  }
  
  // 生成摘要
  const summary = await generateSummary(messages, maxSummaryLength);
  
  // 保存摘要
  const result = db.prepare(`
    INSERT INTO conversation_summaries
    (conversation_id, summary, key_topics, key_decisions, participants, 
     message_count, message_range_start, message_range_end, compression_ratio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    conversationId,
    summary.text,
    JSON.stringify(summary.keyTopics),
    JSON.stringify(summary.keyDecisions),
    JSON.stringify(summary.participants),
    messages.length,
    messages[0].id,
    messages[messages.length - 1].id,
    summary.compressionRatio
  );
  
  return { 
    summary: { id: result.lastInsertRowid, ...summary },
    reason: 'generated'
  };
}

async function generateSummary(messages, maxLength) {
  // 提取关键信息
  const keyTopics = extractKeyTopics(messages);
  const keyDecisions = extractKeyDecisions(messages);
  const participants = [...new Set(messages.map(m => m.agent_name).filter(Boolean))];
  
  // 生成摘要文本
  const text = buildSummaryText(messages, keyTopics, keyDecisions, maxLength);
  
  // 计算压缩率
  const originalLength = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  const compressionRatio = text.length / originalLength;
  
  return {
    text,
    keyTopics,
    keyDecisions,
    participants,
    compressionRatio
  };
}

function buildSummaryText(messages, topics, decisions, maxLength) {
  let text = '';
  
  // 话题部分
  if (topics.length > 0) {
    text += '讨论话题：' + topics.slice(0, 5).join('、') + '\n';
  }
  
  // 决策部分
  if (decisions.length > 0) {
    text += '关键决策：\n';
    decisions.slice(0, 3).forEach((d, i) => {
      text += `${i + 1}. ${d}\n`;
    });
  }
  
  // 对话流程摘要
  const messageSummary = summarizeMessageFlow(messages);
  text += '对话摘要：' + messageSummary;
  
  // 截断到最大长度
  if (text.length > maxLength) {
    text = text.substring(0, maxLength - 3) + '...';
  }
  
  return text;
}

function summarizeMessageFlow(messages) {
  // 简单实现：取每个 Agent 的最后一条消息的关键句
  const agentLastMessages = {};
  messages.forEach(m => {
    if (m.agent_name) {
      agentLastMessages[m.agent_name] = m;
    }
  });
  
  const summaries = Object.entries(agentLastMessages).map(([agent, msg]) => {
    const keySentence = extractKeySentence(msg.content);
    return `${agent}: ${keySentence}`;
  });
  
  return summaries.join('；');
}

function extractKeySentence(content) {
  if (!content) return '';
  
  // 取第一句或前 50 字符
  const sentences = content.split(/[。！？\n]/);
  const firstSentence = sentences[0] || '';
  
  if (firstSentence.length <= 50) return firstSentence;
  return firstSentence.substring(0, 47) + '...';
}

function extractKeyTopics(messages) {
  // 简单实现：从用户消息中提取关键词
  const userMessages = messages.filter(m => m.role === 'user');
  const topics = new Set();
  
  const patterns = [
    /关于(.{2,10})的问题/,
    /如何(.{2,10})/,
    /(.{2,10})是什么/,
    /请(.{2,10})/
  ];
  
  userMessages.forEach(m => {
    patterns.forEach(p => {
      const match = m.content?.match(p);
      if (match) topics.add(match[1]);
    });
  });
  
  return [...topics].slice(0, 10);
}

function extractKeyDecisions(messages) {
  // 简单实现：查找包含决策性词汇的句子
  const decisions = [];
  const decisionPatterns = [
    /决定(.{5,30})/,
    /使用(.{2,15})方案/,
    /选择(.{2,15})/,
    /确定(.{2,15})/
  ];
  
  messages.forEach(m => {
    decisionPatterns.forEach(p => {
      const match = m.content?.match(p);
      if (match) decisions.push(match[0]);
    });
  });
  
  return [...new Set(decisions)].slice(0, 10);
}
```

### 4. 记忆检索系统

```javascript
// server/services/memoryRetriever.js

/**
 * 检索相关记忆
 * 用于为当前问题找到历史相关内容
 */

export function retrieveRelevantMemories(conversationId, query, options = {}) {
  const { maxResults = 5, includeSummaries = true, includeConsensus = true } = options;
  
  const memories = [];
  
  // 1. 从当前对话的近期消息中检索
  const recentMessages = retrieveRecentMessages(conversationId, query);
  memories.push(...recentMessages);
  
  // 2. 从对话摘要中检索
  if (includeSummaries) {
    const summaryMemories = retrieveFromSummaries(conversationId, query);
    memories.push(...summaryMemories);
  }
  
  // 3. 从共识知识中检索
  if (includeConsensus) {
    const consensusMemories = retrieveFromConsensus(query);
    memories.push(...consensusMemories);
  }
  
  // 按相关性排序并返回 top N
  return rankMemories(memories, query).slice(0, maxResults);
}

function retrieveRecentMessages(conversationId, query) {
  // 获取最近 20 条消息
  const messages = db.prepare(`
    SELECT * FROM global_messages 
    WHERE task_id = ? 
    ORDER BY created_at DESC 
    LIMIT 20
  `).all(conversationId);
  
  // 简单的关键词匹配
  const keywords = extractKeywords(query);
  
  return messages
    .filter(m => {
      const content = m.content?.toLowerCase() || '';
      return keywords.some(k => content.includes(k.toLowerCase()));
    })
    .map(m => ({
      type: 'recent_message',
      content: m.content,
      agent_name: m.agent_name,
      timestamp: m.created_at,
      relevance: calculateRelevance(m.content, keywords)
    }));
}

function retrieveFromSummaries(conversationId, query) {
  const summaries = db.prepare(`
    SELECT * FROM conversation_summaries 
    WHERE conversation_id = ? 
    ORDER BY created_at DESC
  `).all(conversationId);
  
  const keywords = extractKeywords(query);
  
  return summaries
    .filter(s => {
      const text = (s.summary + ' ' + (s.key_topics || '')).toLowerCase();
      return keywords.some(k => text.includes(k.toLowerCase()));
    })
    .map(s => ({
      type: 'summary',
      content: s.summary,
      key_topics: JSON.parse(s.key_topics || '[]'),
      timestamp: s.created_at,
      relevance: calculateRelevance(s.summary, keywords)
    }));
}

function retrieveFromConsensus(query) {
  const keywords = extractKeywords(query);
  
  const consensus = db.prepare(`
    SELECT * FROM consensus_knowledge 
    WHERE confidence >= 50
  `).all();
  
  return consensus
    .filter(c => {
      const text = (c.key + ' ' + c.value + ' ' + (c.context || '')).toLowerCase();
      return keywords.some(k => text.includes(k.toLowerCase()));
    })
    .map(c => ({
      type: 'consensus',
      category: c.category,
      key: c.key,
      value: c.value,
      relevance: calculateRelevance(c.value, keywords)
    }));
}

function extractKeywords(text) {
  if (!text) return [];
  
  // 简单实现：分词后过滤停用词
  const stopWords = new Set(['的', '了', '是', '在', '我', '你', '他', '这', '那', '什么', '怎么', '如何']);
  
  return text
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w));
}

function calculateRelevance(content, keywords) {
  if (!content || keywords.length === 0) return 0;
  
  const lowerContent = content.toLowerCase();
  let matches = 0;
  
  keywords.forEach(k => {
    const regex = new RegExp(k.toLowerCase(), 'gi');
    const count = (lowerContent.match(regex) || []).length;
    matches += count;
  });
  
  return matches / Math.max(content.length / 100, 1);
}

function rankMemories(memories, query) {
  return memories.sort((a, b) => b.relevance - a.relevance);
}
```

### 5. 压缩策略

```javascript
// server/services/memoryCompressor.js

/**
 * 记忆压缩策略
 * 目标：保持关键信息的同时最小化 token 消耗
 */

export const COMPRESSION_STRATEGIES = {
  // 渐进式压缩
  progressive: {
    name: '渐进式',
    description: '旧消息压缩程度更高',
    apply: (messages) => progressiveCompress(messages)
  },
  
  // 重要性压缩
  importance: {
    name: '重要性',
    description: '保留重要消息，压缩普通消息',
    apply: (messages) => importanceCompress(messages)
  },
  
  // 摘要式压缩
  summary: {
    name: '摘要式',
    description: '将连续消息合并为摘要',
    apply: (messages) => summaryCompress(messages)
  }
};

function progressiveCompress(messages) {
  const now = Date.now();
  
  return messages.map(m => {
    const age = now - new Date(m.created_at).getTime();
    const hours = age / (1000 * 60 * 60);
    
    // 最近的完整保留
    if (hours < 1) return m;
    
    // 1-6 小时：保留 70%
    if (hours < 6) {
      return { ...m, content: truncate(m.content, 0.7) };
    }
    
    // 6-24 小时：保留 50%
    if (hours < 24) {
      return { ...m, content: truncate(m.content, 0.5) };
    }
    
    // 24+ 小时：仅保留关键句
    return { ...m, content: extractKeySentence(m.content) };
  });
}

function importanceCompress(messages) {
  return messages.map(m => {
    // 检测重要消息（包含决策、结论、代码等）
    const isImportant = detectImportance(m);
    
    if (isImportant) return m;
    
    // 普通消息压缩
    return { ...m, content: truncate(m.content, 0.5) };
  });
}

function detectImportance(message) {
  const importantPatterns = [
    /决定|确定|选择|方案|结论/,
    /```[\s\S]*?```/,  // 代码块
    /\b(fix|solve|implement|完成|解决)\b/i,
    /重要|关键|注意/
  ];
  
  return importantPatterns.some(p => p.test(message.content || ''));
}

function summaryCompress(messages) {
  // 将连续的同 Agent 消息合并
  const groups = [];
  let currentGroup = null;
  
  messages.forEach(m => {
    if (!currentGroup || currentGroup.agent_name !== m.agent_name) {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = {
        agent_name: m.agent_name,
        messages: [m],
        startTime: m.created_at
      };
    } else {
      currentGroup.messages.push(m);
    }
  });
  if (currentGroup) groups.push(currentGroup);
  
  // 每组生成摘要
  return groups.map(g => ({
    agent_name: g.agent_name,
    created_at: g.startTime,
    content: summarizeGroup(g.messages),
    isSummary: true
  }));
}

function summarizeGroup(messages) {
  if (messages.length === 1) return messages[0].content;
  
  // 合并内容并生成摘要
  const combined = messages.map(m => m.content).join(' ');
  return `[${messages.length}条消息摘要] ${extractKeySentence(combined)}`;
}

function truncate(text, ratio) {
  if (!text) return '';
  const targetLength = Math.floor(text.length * ratio);
  if (text.length <= targetLength) return text;
  return text.substring(0, targetLength - 3) + '...';
}
```

### 6. Layer 3 上下文构建

```javascript
// server/services/layer3Builder.js

import { retrieveRelevantMemories } from './memoryRetriever.js';

/**
 * 构建 Layer 3: 近期对话与记忆上下文
 */
export function buildLayer3Context(conversationId, currentQuery, options = {}) {
  const { 
    maxLength = 800,
    includeRelevant = true,
    compressionStrategy = 'progressive'
  } = options;
  
  let context = '';
  
  // 1. 工作记忆：最近 2-3 轮完整对话
  const workingMemory = getWorkingMemory(conversationId);
  context += formatWorkingMemory(workingMemory);
  
  // 2. 相关记忆检索
  if (includeRelevant && currentQuery) {
    const relevantMemories = retrieveRelevantMemories(conversationId, currentQuery, {
      maxResults: 3,
      excludeRecent: workingMemory.map(m => m.id)
    });
    
    if (relevantMemories.length > 0) {
      context += '\n\n## 相关历史\n';
      context += formatRelevantMemories(relevantMemories);
    }
  }
  
  // 3. 对话摘要（如果有）
  const summary = getConversationSummary(conversationId);
  if (summary) {
    context += '\n\n## 对话摘要\n';
    context += summary.summary;
  }
  
  // 应用长度限制
  if (context.length > maxLength) {
    context = context.substring(0, maxLength - 3) + '...';
  }
  
  return context.trim();
}

function getWorkingMemory(conversationId) {
  // 获取最近 5 条消息（约 2-3 轮）
  return db.prepare(`
    SELECT * FROM global_messages 
    WHERE task_id = ? 
    ORDER BY created_at DESC 
    LIMIT 5
  `).all(conversationId).reverse();
}

function formatWorkingMemory(messages) {
  if (messages.length === 0) return '';
  
  let text = '## 近期对话\n';
  
  messages.forEach(m => {
    const agent = m.agent_name || (m.role === 'user' ? '用户' : '系统');
    const content = m.content?.substring(0, 100) || '';
    text += `- ${agent}: ${content}${m.content?.length > 100 ? '...' : ''}\n`;
  });
  
  return text;
}

function formatRelevantMemories(memories) {
  return memories.map(m => {
    switch (m.type) {
      case 'recent_message':
        return `- [历史] ${m.agent_name}: ${m.content?.substring(0, 80)}...`;
      case 'summary':
        return `- [摘要] ${m.content?.substring(0, 80)}...`;
      case 'consensus':
        return `- [共识] ${m.key}: ${m.value}`;
      default:
        return '';
    }
  }).join('\n');
}

function getConversationSummary(conversationId) {
  return db.prepare(`
    SELECT * FROM conversation_summaries 
    WHERE conversation_id = ? 
    ORDER BY created_at DESC 
    LIMIT 1
  `).get(conversationId);
}
```

## 实现步骤

### Step 1: 创建数据库表

```javascript
// server/db.js

db.exec(`
  CREATE TABLE IF NOT EXISTS conversation_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    summary TEXT NOT NULL,
    key_topics TEXT DEFAULT '[]',
    key_decisions TEXT DEFAULT '[]',
    action_items TEXT DEFAULT '[]',
    participants TEXT DEFAULT '[]',
    message_count INTEGER DEFAULT 0,
    message_range_start INTEGER,
    message_range_end INTEGER,
    compression_ratio REAL,
    generated_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES tasks(id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_summaries_conv ON conversation_summaries(conversation_id);
`);
```

### Step 2: 定时摘要任务

```javascript
// server/services/summaryScheduler.js

/**
 * 定时检查并生成对话摘要
 */

export function startSummaryScheduler() {
  // 每 5 分钟检查一次
  setInterval(async () => {
    try {
      await checkAndGenerateSummaries();
    } catch (e) {
      console.error('[SummaryScheduler] Error:', e);
    }
  }, 5 * 60 * 1000);
}

async function checkAndGenerateSummaries() {
  // 找出需要生成摘要的对话
  const conversationsNeedingSummary = db.prepare(`
    SELECT DISTINCT t.id, COUNT(m.id) as msg_count, 
           MAX(s.id) as latest_summary_id
    FROM tasks t
    JOIN global_messages m ON m.task_id = t.id
    LEFT JOIN conversation_summaries s ON s.conversation_id = t.id
    GROUP BY t.id
    HAVING msg_count >= 10 
    AND (latest_summary_id IS NULL 
         OR (SELECT message_range_end FROM conversation_summaries WHERE id = latest_summary_id) < MAX(m.id) - 10)
  `).all();
  
  for (const conv of conversationsNeedingSummary) {
    console.log('[SummaryScheduler] Generating summary for conversation', conv.id);
    await generateConversationSummary(conv.id);
  }
}
```

### Step 3: API 端点

```javascript
// server/routes/memory.js

import express from 'express';
import { generateConversationSummary } from '../services/summaryGenerator.js';
import { retrieveRelevantMemories } from '../services/memoryRetriever.js';
import { buildLayer3Context } from '../services/layer3Builder.js';

const router = express.Router();

// 手动生成摘要
router.post('/summaries/:conversationId/generate', async (req, res) => {
  try {
    const result = await generateConversationSummary(
      parseInt(req.params.conversationId),
      { forceRegenerate: true }
    );
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取摘要
router.get('/summaries/:conversationId', (req, res) => {
  const summary = db.prepare(`
    SELECT * FROM conversation_summaries 
    WHERE conversation_id = ? 
    ORDER BY created_at DESC 
    LIMIT 1
  `).get(parseInt(req.params.conversationId));
  
  res.json(summary || null);
});

// 检索相关记忆
router.get('/retrieve/:conversationId', (req, res) => {
  const { query } = req.query;
  const memories = retrieveRelevantMemories(
    parseInt(req.params.conversationId),
    query
  );
  res.json(memories);
});

// 获取 Layer 3 上下文
router.get('/layer3/:conversationId', (req, res) => {
  const { query, maxLength } = req.query;
  const context = buildLayer3Context(
    parseInt(req.params.conversationId),
    query,
    { maxLength: maxLength ? parseInt(maxLength) : undefined }
  );
  res.json({ context });
});

export default router;
```

## 测试计划

```javascript
// test/unit/summaryGenerator.test.js

describe('SummaryGenerator', () => {
  test('should generate summary for long conversation', async () => {
    // 创建 15 条消息
    const messages = createTestMessages(15);
    const result = await generateConversationSummary(conversationId);
    
    expect(result.summary).toBeDefined();
    expect(result.summary.summary.length).toBeLessThan(500);
  });
  
  test('should not generate summary for short conversation', async () => {
    const messages = createTestMessages(3);
    const result = await generateConversationSummary(conversationId);
    
    expect(result.summary).toBeNull();
    expect(result.reason).toBe('messages_too_few');
  });
  
  test('should extract key decisions', () => {
    const messages = [
      { content: '我们决定使用 JWT 做认证' },
      { content: '好的，方案确定了' }
    ];
    
    const decisions = extractKeyDecisions(messages);
    expect(decisions).toContain('决定使用 JWT 做认证');
  });
});

// test/unit/memoryRetriever.test.js

describe('MemoryRetriever', () => {
  test('should retrieve relevant memories', () => {
    const memories = retrieveRelevantMemories(conversationId, 'JWT 认证');
    
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0]).toHaveProperty('relevance');
  });
  
  test('should rank by relevance', () => {
    const memories = retrieveRelevantMemories(conversationId, 'React 性能优化');
    
    for (let i = 1; i < memories.length; i++) {
      expect(memories[i - 1].relevance).toBeGreaterThanOrEqual(memories[i].relevance);
    }
  });
});
```

## 验收标准

- [ ] `conversation_summaries` 表创建并正常工作
- [ ] 对话超过 10 条消息时自动生成摘要
- [ ] 摘要包含关键话题、决策、参与者
- [ ] 记忆检索能找到相关历史内容
- [ ] Layer 3 上下文长度可控（默认 800 字符）
- [ ] 支持渐进式、重要性、摘要式三种压缩策略
- [ ] 定时任务自动检查并生成摘要

## 后续优化

1. **LLM 摘要** - 使用 LLM 生成更高质量的摘要
2. **向量检索** - 使用向量数据库提高检索精度
3. **记忆衰减** - 旧记忆自动降低权重
4. **跨对话记忆** - 在不同对话间共享记忆
5. **记忆导出** - 支持导出和导入记忆

## 相关文档

- [Phase 3 总体设计](./phase3.md)
- [Phase 3.3 项目共识建设](./phase3.3-consensus.md)
- [共识分层 Prompt 设计](./design-共识分层-prompt.md)
