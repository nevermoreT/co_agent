# Phase 3: Agent Soul 与智能上下文系统

## 概述

Phase 3 的核心目标是让每个 Agent 拥有独特的"灵魂"（Soul），同时构建智能的分层上下文系统，让多 Agent 协作更加智能和高效。

基于 `doc/design-共识分层-prompt.md` 的设计，Phase 3 将实现以下核心能力：

1. **Agent Soul** - 每个 Agent 可配置独特的角色、性格、专业领域
2. **系统提示词配置** - 支持自定义 system prompt，与 user prompt 分离
3. **项目共识建设** - 共享知识、基本规则、团队约定
4. **智能记忆系统** - 对话摘要、压缩、长期记忆管理

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    Layered Context Builder                       │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Agent Soul        │  Agent 角色、性格、专业领域        │
│  ─────────────────────────   │  ─────────────────────────────   │
│  Layer 2: Project Consensus  │  共识知识、基本规则、团队约定      │
│  ─────────────────────────   │  ─────────────────────────────   │
│  Layer 3: Memory System      │  近期对话摘要、长期记忆           │
│  ─────────────────────────   │  ─────────────────────────────   │
│  Layer 4: User Input         │  当前用户问题（纯净）             │
└─────────────────────────────────────────────────────────────────┘
           │                              │
           ▼                              ▼
   ┌───────────────┐              ┌───────────────┐
   │  Claude CLI   │              │ Opencode CLI  │
   │ --append-     │              │ (prefix mode) │
   │ system-prompt │              │               │
   └───────────────┘              └───────────────┘
```

## 子阶段划分

| 阶段 | 名称 | 核心目标 | 文档 |
|------|------|----------|------|
| 3.1 | 系统提示词配置 | 实现 Layer 1: Agent 角色配置与 system prompt 注入 | [phase3.1-system-prompt.md](./phase3.1-system-prompt.md) |
| 3.2 | Agent Soul | Agent 个性化配置（性格、专业领域、交互风格） | [phase3.2-agent-soul.md](./phase3.2-agent-soul.md) |
| 3.3 | 项目共识建设 | 实现 Layer 2: 共享知识、团队规则、决策记录 | [phase3.3-consensus.md](./phase3.3-consensus.md) |
| 3.4 | 记忆系统 | 实现 Layer 3: 对话摘要、长期记忆、压缩策略 | [phase3.4-memory-system.md](./phase3.4-memory-system.md) |
| 3.5 | 分层上下文构建 | 整合所有层，实现 `LayeredContextBuilder` | [phase3.5-layered-context.md](./phase3.5-layered-context.md) |

## 核心数据结构

### Agent Soul 配置

```javascript
// agents 表扩展
{
  id: 1,
  name: "Claude CLI",
  builtin_key: "claude-cli",
  
  // Phase 3.1: 基础角色配置
  role: "架构师",
  responsibilities: ["代码审查", "架构设计", "技术决策"],
  
  // Phase 3.2: Agent Soul
  soul: {
    personality: "专业、严谨、注重代码质量",
    expertise: ["Node.js", "React", "系统架构"],
    communication_style: "简洁明了，善用代码示例",
    constraints: ["不写恶意代码", "不泄露敏感信息"],
    custom_prompts: ["当涉及性能优化时，优先考虑可维护性"]
  }
}
```

### 共识知识

```javascript
// consensus_knowledge 表（已存在，扩展用途）
{
  category: "project_rules",
  key: "code_style",
  value: "使用 ES Modules，遵循 Airbnb 规范",
  context: "项目代码规范约定",
  confidence: 100,
  source_events: [...]
}
```

### 记忆摘要

```javascript
// 新增：conversation_summaries 表
{
  conversation_id: 1,
  summary: "讨论了用户认证系统的设计，决定使用 JWT",
  key_decisions: ["使用 JWT", "refresh token 7天有效期"],
  participants: ["Claude CLI", "Opencode CLI"],
  created_at: "2026-02-23T..."
}
```

## 实现优先级

```
Phase 3.1 (基础) ──┬──> Phase 3.2 (Soul) ──┬──> Phase 3.5 (整合)
                   │                        │
                   └──> Phase 3.3 (共识) ───┘
                   │
                   └──> Phase 3.4 (记忆) ───┘
```

**建议实施顺序**：
1. **Phase 3.1** - 系统提示词配置（基础设施）
2. **Phase 3.2** - Agent Soul（差异化能力）
3. **Phase 3.3** - 项目共识（协作基础）
4. **Phase 3.4** - 记忆系统（长期智能）
5. **Phase 3.5** - 分层上下文构建（整合）

## 与现有系统的关系

### 已有功能

- ✅ `consensus_knowledge` 表 - 可直接用于 Layer 2
- ✅ `shared_events` 表 - 事件流，可用于共识建设
- ✅ `agent_sessions` 表 - Session 管理
- ✅ `memoryManager.buildAgentContext()` - 近期对话（需重构）

### 需要新增

- 🆕 `agents` 表扩展 - role, responsibilities, soul 字段
- 🆕 `conversation_summaries` 表 - 对话摘要
- 🆕 `layeredContextBuilder.js` - 分层上下文构建器
- 🆕 `--append-system-prompt-file` 支持 - Claude CLI system 注入
- 🆕 `agentSoulManager.js` - Soul 配置管理

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Windows shell 特殊字符 | System prompt 可能被截断 | 使用临时文件 `--append-system-prompt-file` |
| Token 膨胀 | 成本增加，响应变慢 | 各层设置字符上限，压缩策略 |
| Agent 差异化不足 | 所有 Agent 回答相似 | Phase 3.2 重点投入 Soul 配置 |
| 共识冲突 | 不同 Agent 理解不一致 | Phase 3.3 实现冲突检测机制 |

## 验收标准

Phase 3 完成后，系统应能：

1. ✅ 每个 Agent 拥有独特的角色和专业领域
2. ✅ Claude CLI 的 system prompt 与 user prompt 分离
3. ✅ 多 Agent 在同一对话中共享项目共识
4. ✅ 长对话自动生成摘要，避免 token 膨胀
5. ✅ 用户可配置 Agent 的性格、风格、约束

## 时间估算

| 阶段 | 预计工时 | 说明 |
|------|----------|------|
| Phase 3.1 | 8h | 数据库扩展 + CLI 参数支持 |
| Phase 3.2 | 12h | Soul 配置系统 + 前端界面 |
| Phase 3.3 | 10h | 共识管理 + API |
| Phase 3.4 | 16h | 摘要算法 + 压缩策略 + 存储 |
| Phase 3.5 | 6h | 整合 + 测试 |
| **总计** | **52h** | 约 6-7 个工作日 |

## 参考文档

- [共识分层 Prompt 设计](./design-共识分层-prompt.md)
- [Phase 1 完成报告](./phase1-completion-report-updated.md)
- [Claude CLI 官方文档](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
