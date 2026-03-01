# Phase 3.5: 分层上下文构建器（整合）

## 目标

整合 Phase 3.1-3.4 的所有组件，实现统一的 `LayeredContextBuilder`，将 Agent Soul、项目共识、记忆系统组合为分层的上下文，注入到 Claude CLI 和 Opencode CLI。

## 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LayeredContextBuilder                             │
│                                                                      │
│  buildLayeredContext(agentId, conversationId, userPrompt)           │
│          │                                                           │
│          ├──> Layer 1: Agent Soul (Phase 3.1 + 3.2)                 │
│          │    - 角色、职责、性格、专业领域                            │
│          │    - 来自 agents 表 + soul 配置                           │
│          │                                                           │
│          ├──> Layer 2: Project Consensus (Phase 3.3)                │
│          │    - 项目规则、架构决策、共享知识                          │
│          │    - 来自 consensus_knowledge 表                         │
│          │                                                           │
│          ├──> Layer 3: Memory System (Phase 3.4)                    │
│          │    - 近期对话、相关记忆、对话摘要                          │
│          │    - 来自 global_messages + conversation_summaries       │
│          │                                                           │
│          └──> Layer 4: User Input                                   │
│               - 当前用户问题（纯净）                                  │
│               - 来自前端                                             │
│                                                                      │
│  Output:                                                             │
│    {                                                                 │
│      systemAppend: string,   // Layer 1+2+3，用于 --append-system   │
│      userPromptOnly: string  // Layer 4，用于 -p                    │
│    }                                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

## 核心实现

### 1. LayeredContextBuilder 主模块

```javascript
// server/services/layeredContextBuilder.js

import db from '../db.js';
import { buildSoulSystemPrompt } from './soulPromptBuilder.js';
import { buildConsensusSummary } from './consensusSummaryBuilder.js';
import { buildLayer3Context } from './layer3Builder.js';
import { writeSystemPromptFile, sanitizeForShell } from './systemPromptBuilder.js';
import logger from '../logger.js';

/**
 * 分层上下文构建器配置
 */
const DEFAULT_CONFIG = {
  // 各层最大长度（字符）
  layer1MaxLength: 800,
  layer2MaxLength: 1000,
  layer3MaxLength: 600,
  
  // 总 system prompt 最大长度
  systemPromptMaxLength: 3000,
  
  // 是否使用临时文件（超过此长度时）
  useFileThreshold: 2000,
  
  // Opencode 前缀最大长度
  opencodePrefixMaxLength: 500
};

/**
 * 构建分层上下文
 * 
 * @param {number} agentId - Agent ID
 * @param {number} conversationId - 对话 ID
 * @param {string} userPrompt - 用户原始输入
 * @param {object} options - 配置选项
 * @returns {object} { systemAppend, userPromptOnly, systemPromptFile? }
 */
export async function buildLayeredContext(agentId, conversationId, userPrompt, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  
  logger.log('[LayeredContextBuilder] Building context for agent=%d conv=%d', agentId, conversationId);
  
  // 获取 Agent 信息
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }
  
  // 解析 Soul 配置
  let soul = {};
  try {
    soul = JSON.parse(agent.soul || '{}');
  } catch {
    soul = {};
  }
  const agentWithSoul = { ...agent, soul };
  
  // 1. 构建 Layer 1: Agent Soul
  const layer1 = buildLayer1(agentWithSoul, config);
  logger.log('[LayeredContextBuilder] Layer 1: %d chars', layer1.length);
  
  // 2. 构建 Layer 2: 共识摘要
  const layer2 = buildLayer2(conversationId, config);
  logger.log('[LayeredContextBuilder] Layer 2: %d chars', layer2.length);
  
  // 3. 构建 Layer 3: 记忆系统
  const layer3 = buildLayer3(conversationId, userPrompt, config);
  logger.log('[LayeredContextBuilder] Layer 3: %d chars', layer3.length);
  
  // 4. 组合 System Prompt
  const systemAppend = combineLayers([layer1, layer2, layer3], config);
  logger.log('[LayeredContextBuilder] Total system prompt: %d chars', systemAppend.length);
  
  // 5. 决定注入方式
  const result = {
    systemAppend,
    userPromptOnly: userPrompt,  // Layer 4 保持纯净
    stats: {
      layer1Length: layer1.length,
      layer2Length: layer2.length,
      layer3Length: layer3.length,
      totalLength: systemAppend.length
    }
  };
  
  // 如果 system prompt 较长或包含特殊字符，写入临时文件
  if (systemAppend.length > config.useFileThreshold || containsSpecialChars(systemAppend)) {
    result.systemPromptFile = await writeSystemPromptFile(systemAppend);
    result.useFile = true;
    logger.log('[LayeredContextBuilder] Using file: %s', result.systemPromptFile);
  } else {
    result.useFile = false;
  }
  
  return result;
}

/**
 * 构建 Layer 1: Agent Soul
 */
function buildLayer1(agent, config) {
  const prompt = buildSoulSystemPrompt(agent);
  
  if (prompt.length > config.layer1MaxLength) {
    return prompt.substring(0, config.layer1MaxLength - 3) + '...';
  }
  
  return prompt;
}

/**
 * 构建 Layer 2: 共识摘要
 */
function buildLayer2(conversationId, config) {
  if (!conversationId) return '';
  
  const summary = buildConsensusSummary(conversationId, {
    maxLength: config.layer2MaxLength
  });
  
  return summary;
}

/**
 * 构建 Layer 3: 记忆系统
 */
function buildLayer3(conversationId, userPrompt, config) {
  if (!conversationId) return '';
  
  const context = buildLayer3Context(conversationId, userPrompt, {
    maxLength: config.layer3MaxLength
  });
  
  return context;
}

/**
 * 组合各层
 */
function combineLayers(layers, config) {
  const validLayers = layers.filter(l => l && l.trim());
  
  if (validLayers.length === 0) return '';
  
  let combined = validLayers.join('\n\n---\n\n');
  
  // 添加统一头部
  const header = `# Agent 上下文

以下是与当前任务相关的背景信息。请根据这些信息提供专业回答。

---

`;
  
  combined = header + combined;
  
  // 应用总长度限制
  if (combined.length > config.systemPromptMaxLength) {
    combined = combined.substring(0, config.systemPromptMaxLength - 3) + '...';
  }
  
  return combined;
}

/**
 * 检测特殊字符
 */
function containsSpecialChars(str) {
  // Windows cmd 特殊字符
  return /[()&|<>^]/.test(str);
}

/**
 * 为 Opencode CLI 构建简化的上下文前缀
 * Opencode 暂不支持 system prompt 注入，使用前缀模式
 */
export function buildOpencodePrefix(agentId, conversationId, userPrompt, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return { prefix: '', userPrompt };
  
  // 简化的前缀：角色 + 最近 1 轮对话
  let prefix = `[${agent.name}`;
  if (agent.role) prefix += ` - ${agent.role}`;
  prefix += '] ';
  
  // 添加最近对话摘要（如果有）
  if (conversationId) {
    const recentSummary = getRecentConversationSummary(conversationId);
    if (recentSummary) {
      prefix += `(上下文: ${recentSummary}) `;
    }
  }
  
  // 长度限制
  if (prefix.length > cfg.opencodePrefixMaxLength) {
    prefix = prefix.substring(0, cfg.opencodePrefixMaxLength - 3) + '... ';
  }
  
  return {
    prefix,
    userPromptOnly: userPrompt
  };
}

function getRecentConversationSummary(conversationId) {
  const messages = db.prepare(`
    SELECT * FROM global_messages 
    WHERE task_id = ? 
    ORDER BY created_at DESC 
    LIMIT 2
  `).all(conversationId).reverse();
  
  if (messages.length === 0) return null;
  
  return messages.map(m => {
    const agent = m.agent_name || '用户';
    const content = (m.content || '').substring(0, 30);
    return `${agent}: ${content}`;
  }).join('; ');
}
```

### 2. 整合到 agentRunner

```javascript
// server/services/agentRunner.js

import { buildLayeredContext, buildOpencodePrefix } from './layeredContextBuilder.js';

/**
 * 运行 Claude CLI（Phase 3.5 版本）
 */
export async function runClaudeCli(agentId, prompt, onOutput, onExit, conversationId) {
  const key = String(agentId);
  if (runs.has(key)) {
    logger.log('[agentRunner] runClaudeCli() blocked: agentId=%s already running', agentId);
    return false;
  }
  
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent || agent.builtin_key !== 'claude-cli') {
    onExit && onExit(-1, 'agent not found or not claude-cli');
    return false;
  }
  
  try {
    // 构建分层上下文
    const layeredContext = await buildLayeredContext(agentId, conversationId, prompt);
    
    logger.log('[agentRunner] runClaudeCli() context stats: L1=%d L2=%d L3=%d total=%d',
      layeredContext.stats.layer1Length,
      layeredContext.stats.layer2Length,
      layeredContext.stats.layer3Length,
      layeredContext.stats.totalLength
    );
    
    // 获取 Session ID
    const sessionId = sessionManager.getSession(agentId, conversationId);
    const sessionConfig = buildSessionArgs({ sessionId });
    
    // 构建 CLI 参数
    const args = [
      ...sessionConfig.args,
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'acceptEdits'
    ];
    
    // 注入 System Prompt
    if (layeredContext.useFile) {
      args.push('--append-system-prompt-file', layeredContext.systemPromptFile);
    } else {
      args.push('--append-system-prompt', sanitizeForShell(layeredContext.systemAppend));
    }
    
    // User Prompt（纯净）
    args.push('-p', prompt);
    
    logger.log('[agentRunner] runClaudeCli() args count: %d', args.length);
    
    // 调用 CLI
    const child = spawn('claude', args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      cwd: process.cwd(),
      shell: true
    });
    
    runs.set(key, { process: child, conversationId });
    
    // ... 现有的输出处理逻辑 ...
    
    // 退出时清理临时文件
    child.on('exit', (code, signal) => {
      if (layeredContext.systemPromptFile) {
        try {
          fs.unlinkSync(layeredContext.systemPromptFile);
        } catch {
          // 忽略清理错误
        }
      }
      runs.delete(key);
      onExit && onExit(code ?? -1, signal);
    });
    
    return true;
    
  } catch (error) {
    logger.error('[agentRunner] runClaudeCli() error:', error);
    onExit && onExit(-1, error.message);
    return false;
  }
}

/**
 * 运行 Opencode CLI（Phase 3.5 版本）
 */
export function runOpencodeCli(agentId, prompt, onOutput, onExit, conversationId) {
  const key = String(agentId);
  if (runs.has(key)) {
    return false;
  }
  
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent || agent.builtin_key !== 'opencode-cli') {
    onExit && onExit(-1, 'agent not found or not opencode-cli');
    return false;
  }
  
  try {
    // 构建简化的前缀（Opencode 不支持 system prompt）
    const { prefix, userPromptOnly } = buildOpencodePrefix(agentId, conversationId, prompt);
    const fullPrompt = prefix + userPromptOnly;
    
    logger.log('[agentRunner] runOpencodeCli() prefix length: %d', prefix.length);
    
    // 获取 Session ID
    const sessionId = sessionManager.getSession(agentId, conversationId);
    
    // 调用 Opencode CLI（使用 fullPrompt）
    const { child } = runOpencodeCliImpl(fullPrompt, {
      onOutput,
      onExit: (code, signal) => {
        runs.delete(key);
        onExit && onExit(code ?? -1, signal);
      },
      onSession: (newSessionId) => {
        if (newSessionId && conversationId) {
          sessionManager.saveSession(agentId, conversationId, newSessionId);
        }
      },
      sessionId,
      continue: false
    });
    
    runs.set(key, { process: child, conversationId });
    return true;
    
  } catch (error) {
    logger.error('[agentRunner] runOpencodeCli() error:', error);
    onExit && onExit(-1, error.message);
    return false;
  }
}
```

### 3. 配置管理

```javascript
// server/services/contextConfigManager.js

import db from '../db.js';

/**
 * 上下文配置管理
 * 允许用户自定义各层参数
 */

const DEFAULT_GLOBAL_CONFIG = {
  layer1_enabled: true,
  layer2_enabled: true,
  layer3_enabled: true,
  
  layer1_max_length: 800,
  layer2_max_length: 1000,
  layer3_max_length: 600,
  
  system_prompt_max_length: 3000,
  use_file_threshold: 2000,
  
  opencode_prefix_max_length: 500
};

/**
 * 获取全局上下文配置
 */
export function getGlobalContextConfig() {
  const row = db.prepare(
    "SELECT value FROM system_config WHERE key = 'context_config'"
  ).get();
  
  if (!row) return DEFAULT_GLOBAL_CONFIG;
  
  try {
    return { ...DEFAULT_GLOBAL_CONFIG, ...JSON.parse(row.value) };
  } catch {
    return DEFAULT_GLOBAL_CONFIG;
  }
}

/**
 * 更新全局上下文配置
 */
export function updateGlobalContextConfig(config) {
  const merged = { ...DEFAULT_GLOBAL_CONFIG, ...config };
  
  db.prepare(`
    INSERT OR REPLACE INTO system_config (key, value)
    VALUES ('context_config', ?)
  `).run(JSON.stringify(merged));
  
  return merged;
}

/**
 * 获取 Agent 特定的上下文配置
 */
export function getAgentContextConfig(agentId) {
  const agent = db.prepare('SELECT context_config FROM agents WHERE id = ?').get(agentId);
  
  if (!agent?.context_config) {
    return getGlobalContextConfig();
  }
  
  try {
    const agentConfig = JSON.parse(agent.context_config);
    return { ...getGlobalContextConfig(), ...agentConfig };
  } catch {
    return getGlobalContextConfig();
  }
}
```

### 4. 调试与监控

```javascript
// server/services/contextDebugger.js

import logger from '../logger.js';

/**
 * 上下文调试工具
 * 用于开发和问题排查
 */

export function logContextDetails(layeredContext, agentId, conversationId) {
  logger.log('='.repeat(60));
  logger.log('[ContextDebugger] Agent ID: %d, Conversation ID: %d', agentId, conversationId);
  logger.log('[ContextDebugger] Layer 1 (Agent Soul): %d chars', layeredContext.stats.layer1Length);
  logger.log('[ContextDebugger] Layer 2 (Consensus): %d chars', layeredContext.stats.layer2Length);
  logger.log('[ContextDebugger] Layer 3 (Memory): %d chars', layeredContext.stats.layer3Length);
  logger.log('[ContextDebugger] Total System Prompt: %d chars', layeredContext.stats.totalLength);
  logger.log('[ContextDebugger] Use File: %s', layeredContext.useFile);
  logger.log('[ContextDebugger] User Prompt Length: %d', layeredContext.userPromptOnly.length);
  logger.log('='.repeat(60));
  
  // 详细日志（仅在 DEBUG 模式）
  if (process.env.DEBUG_CONTEXT === 'true') {
    logger.log('[ContextDebugger] Full System Prompt:');
    logger.log(layeredContext.systemAppend);
    logger.log('-'.repeat(60));
    logger.log('[ContextDebugger] User Prompt:');
    logger.log(layeredContext.userPromptOnly);
    logger.log('='.repeat(60));
  }
}

/**
 * 生成上下文报告
 */
export function generateContextReport(conversationId) {
  const agents = db.prepare(`
    SELECT DISTINCT a.id, a.name, a.role
    FROM agents a
    JOIN agent_sessions s ON s.agent_id = a.id
    WHERE s.task_id = ?
  `).all(conversationId);
  
  const consensus = db.prepare(`
    SELECT category, key, value FROM consensus_knowledge
    WHERE conversation_id = ? OR conversation_id IS NULL
  `).all(conversationId);
  
  const summaries = db.prepare(`
    SELECT * FROM conversation_summaries WHERE conversation_id = ?
  `).all(conversationId);
  
  return {
    conversationId,
    agents: agents.map(a => ({ id: a.id, name: a.name, role: a.role })),
    consensus: consensus,
    summaries: summaries.map(s => ({
      summary: s.summary,
      topics: JSON.parse(s.key_topics || '[]'),
      decisions: JSON.parse(s.key_decisions || '[]')
    })),
    generatedAt: new Date().toISOString()
  };
}
```

### 5. API 端点

```javascript
// server/routes/context.js

import express from 'express';
import { buildLayeredContext, buildOpencodePrefix } from '../services/layeredContextBuilder.js';
import { getGlobalContextConfig, updateGlobalContextConfig } from '../services/contextConfigManager.js';
import { generateContextReport } from '../services/contextDebugger.js';

const router = express.Router();

// 获取上下文配置
router.get('/config', (req, res) => {
  const config = getGlobalContextConfig();
  res.json(config);
});

// 更新上下文配置
router.patch('/config', (req, res) => {
  try {
    const config = updateGlobalContextConfig(req.body);
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 预览上下文（调试用）
router.post('/preview', async (req, res) => {
  try {
    const { agentId, conversationId, userPrompt } = req.body;
    
    const context = await buildLayeredContext(agentId, conversationId, userPrompt);
    
    res.json({
      systemAppend: context.systemAppend,
      userPromptOnly: context.userPromptOnly,
      stats: context.stats,
      useFile: context.useFile
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 生成上下文报告
router.get('/report/:conversationId', (req, res) => {
  try {
    const report = generateContextReport(parseInt(req.params.conversationId));
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Opencode 前缀预览
router.post('/opencode-prefix', (req, res) => {
  const { agentId, conversationId, userPrompt } = req.body;
  
  const result = buildOpencodePrefix(agentId, conversationId, userPrompt);
  
  res.json(result);
});

export default router;
```

## 实现步骤

### Step 1: 创建整合模块

1. 创建 `server/services/layeredContextBuilder.js`
2. 创建 `server/services/contextConfigManager.js`
3. 创建 `server/services/contextDebugger.js`

### Step 2: 修改 agentRunner

1. 修改 `runClaudeCli` 使用 `buildLayeredContext`
2. 修改 `runOpencodeCli` 使用 `buildOpencodePrefix`
3. 添加临时文件清理逻辑

### Step 3: 添加配置表

```sql
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 为 agents 表添加 context_config 字段
ALTER TABLE agents ADD COLUMN context_config TEXT DEFAULT '{}';
```

### Step 4: 注册路由

```javascript
// server/index.js

import contextRouter from './routes/context.js';

app.use('/api/context', contextRouter);
```

## 测试计划

```javascript
// test/integration/layeredContext.test.js

describe('LayeredContextBuilder', () => {
  test('should build all layers', async () => {
    const context = await buildLayeredContext(1, 1, '测试问题');
    
    expect(context.systemAppend).toBeDefined();
    expect(context.userPromptOnly).toBe('测试问题');
    expect(context.stats.layer1Length).toBeGreaterThan(0);
  });
  
  test('should use file for long content', async () => {
    // 创建大量共识
    for (let i = 0; i < 50; i++) {
      createConsensus({ key: `rule_${i}`, value: 'x'.repeat(100) });
    }
    
    const context = await buildLayeredContext(1, 1, '测试');
    
    expect(context.useFile).toBe(true);
    expect(context.systemPromptFile).toBeDefined();
  });
  
  test('should handle missing conversation gracefully', async () => {
    const context = await buildLayeredContext(1, null, '测试');
    
    expect(context.systemAppend).toBeDefined();
    expect(context.stats.layer2Length).toBe(0);
    expect(context.stats.layer3Length).toBe(0);
  });
  
  test('Opencode prefix should be shorter', () => {
    const { prefix, userPromptOnly } = buildOpencodePrefix(1, 1, '测试问题');
    
    expect(prefix.length).toBeLessThan(600);
    expect(userPromptOnly).toBe('测试问题');
  });
});
```

## 验收标准

- [ ] `LayeredContextBuilder` 整合 Layer 1-3
- [ ] Claude CLI 使用 `--append-system-prompt` 或 `--append-system-prompt-file`
- [ ] Opencode CLI 使用前缀模式
- [ ] User Prompt 保持纯净（Layer 4）
- [ ] 各层长度可配置
- [ ] 超长内容自动写入临时文件
- [ ] 临时文件在进程退出后自动清理
- [ ] 提供调试 API 预览上下文

## 部署检查清单

- [ ] 数据库迁移完成（新表、新字段）
- [ ] 所有服务文件创建
- [ ] 路由注册
- [ ] 配置默认值设置
- [ ] 测试通过
- [ ] 文档更新

## 相关文档

- [Phase 3 总体设计](./phase3.md)
- [Phase 3.1 系统提示词配置](./phase3.1-system-prompt.md)
- [Phase 3.2 Agent Soul](./phase3.2-agent-soul.md)
- [Phase 3.3 项目共识建设](./phase3.3-consensus.md)
- [Phase 3.4 记忆系统](./phase3.4-memory-system.md)
- [共识分层 Prompt 设计](./design-共识分层-prompt.md)
