# Phase 3.3: 项目共识建设

## 目标

实现 **Layer 2: 共识摘要**，让多 Agent 在同一对话中共享项目知识、团队规则、已达成决策。通过 `consensus_knowledge` 表存储共识信息，并在 system prompt 中注入相关共识。

## 背景

在多 Agent 协作场景中，不同 Agent 需要对项目有共同的理解：
- **项目规则**：代码规范、技术栈约定、命名约定
- **已达成决策**：架构决策、技术选型、方案选择
- **共享知识**：业务背景、系统状态、依赖关系

## 设计要点

### 1. 共识分类体系

```javascript
// consensus_knowledge 表结构（已存在）
{
  id: 1,
  category: "project_rules",  // 分类
  key: "code_style",          // 键
  value: "使用 ES Modules",   // 值
  context: "项目代码规范",     // 上下文说明
  source_events: "[]",        // 来源事件 ID
  verified_by: "Claude CLI,Opencode CLI",  // 验证者
  confidence: 95,             // 置信度 0-100
  valid_from: "2026-02-01",   // 生效日期
  valid_until: null,          // 失效日期（null 表示永久）
  created_at: "...",
  updated_at: "..."
}
```

### 2. 共识分类定义

```javascript
// server/services/consensusCategories.js

export const CONSENSUS_CATEGORIES = {
  // 项目规则
  project_rules: {
    name: '项目规则',
    description: '代码规范、技术栈、命名约定等',
    priority: 1,
    examples: ['code_style', 'tech_stack', 'naming_convention']
  },
  
  // 架构决策
  architecture_decisions: {
    name: '架构决策',
    description: '已确定的技术选型和架构方案',
    priority: 2,
    examples: ['auth_solution', 'database_choice', 'api_design']
  },
  
  // 业务背景
  business_context: {
    name: '业务背景',
    description: '项目目标、用户画像、业务规则',
    priority: 3,
    examples: ['project_goal', 'target_users', 'business_rules']
  },
  
  // 系统状态
  system_state: {
    name: '系统状态',
    description: '当前开发进度、已知问题、待办事项',
    priority: 4,
    examples: ['current_phase', 'known_issues', 'todos']
  },
  
  // 团队约定
  team_conventions: {
    name: '团队约定',
    description: '工作流程、沟通方式、协作规则',
    priority: 5,
    examples: ['workflow', 'review_process', 'communication']
  }
};
```

### 3. 共识来源追踪

共识可以来自多个来源：

```javascript
// 共识来源类型
const CONSENSUS_SOURCES = {
  EXPLICIT: 'explicit',      // 用户明确指定
  DERIVED: 'derived',        // 从对话中推导
  VOTED: 'voted',           // Agent 投票决定
  SYSTEM: 'system'          // 系统默认
};

// 记录共识来源
function recordConsensusSource(consensusId, source, evidence) {
  db.prepare(`
    INSERT INTO consensus_sources (consensus_id, source_type, evidence, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(consensusId, source, JSON.stringify(evidence));
}
```

### 4. 共识冲突检测

当不同 Agent 提出冲突信息时，需要检测和解决：

```javascript
// server/services/consensusConflict.js

export function detectConflict(newConsensus, existingConsensus) {
  // 相同 category + key
  if (newConsensus.category === existingConsensus.category &&
      newConsensus.key === existingConsensus.key &&
      newConsensus.value !== existingConsensus.value) {
    return {
      type: 'value_mismatch',
      existing: existingConsensus,
      proposed: newConsensus,
      resolution: 'needs_vote'  // needs_vote | keep_existing | override
    };
  }
  
  // 语义冲突（需要 LLM 判断）
  // TODO: 调用 LLM 判断两个共识是否冲突
  
  return null;
}

export function resolveConflict(conflict, strategy = 'needs_vote') {
  switch (strategy) {
    case 'keep_existing':
      return { action: 'reject', reason: '保留现有共识' };
      
    case 'override':
      return { action: 'update', reason: '使用新共识覆盖' };
      
    case 'needs_vote':
      // 创建投票任务，让用户或 Agent 投票决定
      return { 
        action: 'vote',
        voteId: createVoteTask(conflict)
      };
      
    default:
      return { action: 'pending', reason: '等待处理' };
  }
}
```

### 5. 共识摘要生成

将多个共识压缩为简洁的摘要注入 system prompt：

```javascript
// server/services/consensusSummaryBuilder.js

export function buildConsensusSummary(conversationId, options = {}) {
  const { maxLength = 1200, categories = null } = options;
  
  // 获取相关共识
  let query = `
    SELECT * FROM consensus_knowledge 
    WHERE confidence >= 50
    AND (valid_until IS NULL OR valid_until > datetime('now'))
  `;
  const params = [];
  
  if (categories) {
    query += ` AND category IN (${categories.map(() => '?').join(',')})`;
    params.push(...categories);
  }
  
  query += ` ORDER BY priority, updated_at DESC`;
  
  const consensusList = db.prepare(query).all(...params);
  
  // 按分类组织
  const grouped = groupByCategory(consensusList);
  
  // 生成摘要文本
  let summary = '## 项目共识\n\n';
  let currentLength = summary.length;
  
  for (const [category, items] of Object.entries(grouped)) {
    const categoryConfig = CONSENSUS_CATEGORIES[category];
    const sectionTitle = `### ${categoryConfig?.name || category}\n`;
    
    if (currentLength + sectionTitle.length > maxLength) break;
    
    summary += sectionTitle;
    currentLength += sectionTitle.length;
    
    for (const item of items) {
      const line = `- **${item.key}**: ${item.value}\n`;
      
      if (currentLength + line.length > maxLength) {
        summary += `- ...（还有 ${items.length - items.indexOf(item)} 条）\n`;
        break;
      }
      
      summary += line;
      currentLength += line.length;
    }
    
    summary += '\n';
  }
  
  return summary.trim();
}

function groupByCategory(consensusList) {
  return consensusList.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});
}
```

### 6. 共识管理 API

```javascript
// server/routes/consensus.js

import express from 'express';
import * as consensusManager from '../services/consensusManager.js';

const router = express.Router();

// 获取所有共识
router.get('/', (req, res) => {
  const { category, conversation_id } = req.query;
  const consensus = consensusManager.getConsensus({ category, conversation_id });
  res.json(consensus);
});

// 获取单个共识
router.get('/:id', (req, res) => {
  const consensus = consensusManager.getConsensusById(req.params.id);
  if (!consensus) return res.status(404).json({ error: 'Not found' });
  res.json(consensus);
});

// 创建共识
router.post('/', (req, res) => {
  try {
    const { category, key, value, context, confidence } = req.body;
    
    // 检测冲突
    const existing = consensusManager.findConsensus(category, key);
    if (existing) {
      const conflict = detectConflict(req.body, existing);
      if (conflict) {
        return res.status(409).json({ 
          error: 'Conflict detected',
          conflict,
          existing
        });
      }
    }
    
    const id = consensusManager.createConsensus(req.body);
    res.status(201).json({ id, ...req.body });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新共识
router.patch('/:id', (req, res) => {
  try {
    consensusManager.updateConsensus(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除共识
router.delete('/:id', (req, res) => {
  consensusManager.deleteConsensus(req.params.id);
  res.status(204).send();
});

// 验证共识（增加置信度）
router.post('/:id/verify', (req, res) => {
  const { agent_id } = req.body;
  consensusManager.verifyConsensus(req.params.id, agent_id);
  res.json({ success: true });
});

// 获取共识摘要
router.get('/summary/:conversationId', (req, res) => {
  const summary = buildConsensusSummary(req.params.conversationId);
  res.json({ summary });
});

export default router;
```

### 7. 前端共识管理界面

```jsx
// client/components/ConsensusPanel.jsx

function ConsensusPanel({ conversationId }) {
  const [consensus, setConsensus] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    category: 'project_rules',
    key: '',
    value: '',
    context: '',
    confidence: 80
  });
  
  useEffect(() => {
    fetchConsensus();
  }, [conversationId]);
  
  const fetchConsensus = async () => {
    const res = await fetch(`/api/consensus?conversation_id=${conversationId}`);
    const data = await res.json();
    setConsensus(data);
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (editingId) {
      await fetch(`/api/consensus/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
    } else {
      await fetch('/api/consensus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, conversation_id: conversationId })
      });
    }
    
    setForm({ category: 'project_rules', key: '', value: '', context: '', confidence: 80 });
    setEditingId(null);
    fetchConsensus();
  };
  
  const handleEdit = (item) => {
    setEditingId(item.id);
    setForm(item);
  };
  
  const handleDelete = async (id) => {
    if (!confirm('确定删除此共识？')) return;
    await fetch(`/api/consensus/${id}`, { method: 'DELETE' });
    fetchConsensus();
  };
  
  // 按分类分组
  const grouped = consensus.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});
  
  return (
    <div className="consensus-panel">
      <h3>项目共识</h3>
      
      {/* 共识列表 */}
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="consensus-category">
          <h4>{CONSENSUS_CATEGORIES[category]?.name || category}</h4>
          {items.map(item => (
            <div key={item.id} className="consensus-item">
              <div className="consensus-header">
                <strong>{item.key}</strong>
                <span className="confidence">{item.confidence}%</span>
              </div>
              <div className="consensus-value">{item.value}</div>
              {item.context && <div className="consensus-context">{item.context}</div>}
              <div className="consensus-actions">
                <button onClick={() => handleEdit(item)}>编辑</button>
                <button onClick={() => handleDelete(item.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      ))}
      
      {/* 添加/编辑表单 */}
      <form onSubmit={handleSubmit} className="consensus-form">
        <h4>{editingId ? '编辑共识' : '添加共识'}</h4>
        
        <select value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
          {Object.entries(CONSENSUS_CATEGORIES).map(([key, config]) => (
            <option key={key} value={key}>{config.name}</option>
          ))}
        </select>
        
        <input
          placeholder="键（如：code_style）"
          value={form.key}
          onChange={e => setForm({...form, key: e.target.value})}
          required
        />
        
        <textarea
          placeholder="值（如：使用 ES Modules）"
          value={form.value}
          onChange={e => setForm({...form, value: e.target.value})}
          required
        />
        
        <input
          placeholder="上下文说明（可选）"
          value={form.context}
          onChange={e => setForm({...form, context: e.target.value})}
        />
        
        <label>
          置信度: {form.confidence}%
          <input type="range" min="0" max="100" value={form.confidence}
                 onChange={e => setForm({...form, confidence: parseInt(e.target.value)})} />
        </label>
        
        <button type="submit">{editingId ? '更新' : '添加'}</button>
        {editingId && <button type="button" onClick={() => {setEditingId(null); setForm({...form, key: '', value: ''});}}>取消</button>}
      </form>
    </div>
  );
}
```

## 实现步骤

### Step 1: 扩展现有表

```javascript
// server/db.js

// 添加 conversation_id 关联
try {
  db.run('ALTER TABLE consensus_knowledge ADD COLUMN conversation_id INTEGER');
  save();
} catch { /* column exists */ }

// 添加来源追踪表
db.exec(`
  CREATE TABLE IF NOT EXISTS consensus_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    consensus_id INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    evidence TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (consensus_id) REFERENCES consensus_knowledge(id)
  )
`);
```

### Step 2: 共识服务

```javascript
// server/services/consensusManager.js

import db from '../db.js';

export function getConsensus({ category, conversation_id }) {
  let query = 'SELECT * FROM consensus_knowledge WHERE 1=1';
  const params = [];
  
  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }
  
  if (conversation_id) {
    query += ' AND (conversation_id = ? OR conversation_id IS NULL)';
    params.push(conversation_id);
  }
  
  query += ' ORDER BY updated_at DESC';
  
  return db.prepare(query).all(...params);
}

export function createConsensus(data) {
  const result = db.prepare(`
    INSERT INTO consensus_knowledge 
    (category, key, value, context, confidence, conversation_id, source_events)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.category,
    data.key,
    data.value,
    data.context || '',
    data.confidence || 80,
    data.conversation_id || null,
    JSON.stringify(data.source_events || [])
  );
  
  return result.lastInsertRowid;
}

export function findConsensus(category, key) {
  return db.prepare(
    'SELECT * FROM consensus_knowledge WHERE category = ? AND key = ?'
  ).get(category, key);
}

export function updateConsensus(id, data) {
  const fields = [];
  const params = [];
  
  for (const [key, value] of Object.entries(data)) {
    if (['category', 'key', 'value', 'context', 'confidence', 'valid_until'].includes(key)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }
  }
  
  fields.push('updated_at = datetime("now")');
  params.push(id);
  
  db.prepare(`UPDATE consensus_knowledge SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function verifyConsensus(id, agentId) {
  const consensus = db.prepare('SELECT * FROM consensus_knowledge WHERE id = ?').get(id);
  if (!consensus) return;
  
  // 增加置信度（每次验证 +5%，最高 100%）
  const newConfidence = Math.min(100, (consensus.confidence || 0) + 5);
  
  // 更新验证者列表
  let verifiedBy = [];
  try {
    verifiedBy = consensus.verified_by ? consensus.verified_by.split(',') : [];
  } catch {}
  
  const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(agentId);
  if (agent && !verifiedBy.includes(agent.name)) {
    verifiedBy.push(agent.name);
  }
  
  db.prepare(`
    UPDATE consensus_knowledge 
    SET confidence = ?, verified_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newConfidence, verifiedBy.join(','), id);
}
```

### Step 3: 整合到 System Prompt

```javascript
// server/services/systemPromptBuilder.js

import { buildConsensusSummary } from './consensusSummaryBuilder.js';

export function buildSystemPrompt(agentId, conversationId = null) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  
  let prompt = buildBasicSystemPrompt(agent);
  
  // Layer 2: 添加共识摘要
  if (conversationId) {
    const consensusSummary = buildConsensusSummary(conversationId, { maxLength: 1000 });
    if (consensusSummary) {
      prompt += '\n\n' + consensusSummary;
    }
  }
  
  return prompt;
}
```

## 测试计划

```javascript
// test/unit/consensusManager.test.js

describe('ConsensusManager', () => {
  test('should create consensus', () => {
    const id = consensusManager.createConsensus({
      category: 'project_rules',
      key: 'code_style',
      value: 'ES Modules',
      confidence: 90
    });
    expect(id).toBeGreaterThan(0);
  });
  
  test('should detect conflict', () => {
    consensusManager.createConsensus({
      category: 'project_rules',
      key: 'code_style',
      value: 'ES Modules'
    });
    
    const conflict = detectConflict({
      category: 'project_rules',
      key: 'code_style',
      value: 'CommonJS'
    }, existingConsensus);
    
    expect(conflict.type).toBe('value_mismatch');
  });
  
  test('should build summary with length limit', () => {
    // 创建多条共识
    for (let i = 0; i < 20; i++) {
      consensusManager.createConsensus({
        category: 'project_rules',
        key: `rule_${i}`,
        value: `Value ${i} `.repeat(50)
      });
    }
    
    const summary = buildConsensusSummary(null, { maxLength: 500 });
    expect(summary.length).toBeLessThanOrEqual(500);
  });
});
```

## 验收标准

- [ ] 共识按分类组织（项目规则、架构决策、业务背景等）
- [ ] 支持共识的 CRUD 操作
- [ ] 共识自动注入到 system prompt（Layer 2）
- [ ] 摘要长度可控，避免 token 膨胀
- [ ] 冲突检测机制（相同 key 不同 value）
- [ ] 置信度管理（验证增加置信度）
- [ ] 前端提供共识管理界面

## 后续优化

1. **自动共识推导** - 从对话中自动识别可形成的共识
2. **共识投票** - 多 Agent 对冲突共识进行投票
3. **共识过期** - 设置有效期，自动清理过期共识
4. **共识搜索** - 按关键词搜索相关共识
5. **共识模板** - 预设常见项目的共识模板

## 相关文档

- [Phase 3 总体设计](./phase3.md)
- [Phase 3.1 系统提示词配置](./phase3.1-system-prompt.md)
- [共识分层 Prompt 设计](./design-共识分层-prompt.md)
