# Phase 3.2: Agent Soul 能力配置

## 目标

在 Phase 3.1 的基础上，实现更丰富的 Agent 个性化配置，让每个 Agent 拥有独特的"灵魂"（Soul），包括性格、专业领域、交互风格、约束条件等。类似 OpenClaw 的 Agent 个性化能力。

## 灵感来源：OpenClaw

OpenClaw 是一个 Agent 个性化框架，其核心理念是：
- 每个 Agent 有独特的**性格特征**
- Agent 拥有**专业领域知识**
- **交互风格**可定制（简洁、详细、幽默等）
- **约束与边界**明确（不做什么）

## 设计要点

### 1. Soul 数据结构

```javascript
// agents 表扩展 - soul 字段（JSON）
{
  id: 1,
  name: "Claude CLI",
  
  // Phase 3.1 字段
  role: "架构师",
  responsibilities: ["代码审查", "架构设计"],
  
  // Phase 3.2: Soul 配置
  soul: {
    // 性格特征
    personality: {
      traits: ["专业", "严谨", "注重细节"],
      tone: "formal",  // formal | casual | friendly | technical
      emoji_usage: "minimal",  // none | minimal | moderate | heavy
    },
    
    // 专业领域
    expertise: {
      primary: ["Node.js", "React", "系统架构", "性能优化"],
      secondary: ["DevOps", "数据库", "安全"],
      level: "senior"  // junior | mid | senior | expert
    },
    
    // 交互风格
    communication_style: {
      verbosity: "moderate",  // concise | moderate | detailed
      code_examples: "frequent",  // never | rare | frequent | always
      explanations: "when_needed",  // always | when_needed | on_request
      format_preference: "markdown"  // plain | markdown | code_first
    },
    
    // 约束条件
    constraints: {
      hard_rules: [
        "不写恶意代码",
        "不泄露敏感信息",
        "不做违法建议"
      ],
      soft_preferences: [
        "优先考虑可维护性而非性能",
        "避免过度工程化",
        "推荐测试驱动开发"
      ]
    },
    
    // 自定义提示（高级）
    custom_prompts: [
      "当涉及性能优化时，先问清楚性能瓶颈在哪里",
      "如果用户的问题模糊，先澄清再回答",
      "对于复杂的架构决策，列出多个选项并比较优缺点"
    ],
    
    // 记忆偏好
    memory_preferences: {
      remember_user_preferences: true,
      remember_conversation_context: true,
      max_context_turns: 5
    }
  }
}
```

### 2. Soul 模板库

```javascript
// server/services/soulTemplates.js

export const SOUL_TEMPLATES = {
  // 架构师
  architect: {
    personality: {
      traits: ["专业", "严谨", "系统思维"],
      tone: "formal",
      emoji_usage: "minimal"
    },
    expertise: {
      primary: ["系统架构", "设计模式", "性能优化"],
      secondary: ["DevOps", "安全", "数据库"],
      level: "senior"
    },
    communication_style: {
      verbosity: "moderate",
      code_examples: "frequent",
      explanations: "when_needed"
    },
    constraints: {
      hard_rules: ["不做临时方案", "考虑长期维护"],
      soft_preferences: ["推荐微服务", "强调测试"]
    }
  },
  
  // 前端专家
  frontend_expert: {
    personality: {
      traits: ["创意", "注重用户体验", "细节控"],
      tone: "friendly",
      emoji_usage: "moderate"
    },
    expertise: {
      primary: ["React", "CSS", "性能优化"],
      secondary: ["动画", "可访问性", "SEO"],
      level: "senior"
    },
    communication_style: {
      verbosity: "detailed",
      code_examples: "always",
      explanations: "always"
    }
  },
  
  // DevOps 工程师
  devops: {
    personality: {
      traits: ["务实", "自动化思维", "安全意识"],
      tone: "technical",
      emoji_usage: "minimal"
    },
    expertise: {
      primary: ["CI/CD", "Docker", "Kubernetes"],
      secondary: ["监控", "日志", "安全"],
      level: "senior"
    },
    constraints: {
      soft_preferences: ["基础设施即代码", "GitOps"]
    }
  },
  
  // 测试工程师
  tester: {
    personality: {
      traits: ["细心", "质疑精神", "边缘案例猎手"],
      tone: "formal"
    },
    expertise: {
      primary: ["单元测试", "E2E 测试", "性能测试"],
      level: "mid"
    },
    constraints: {
      hard_rules: ["不跳过测试", "保持测试独立"]
    }
  }
};
```

### 3. Soul 到 System Prompt 转换

```javascript
// server/services/soulPromptBuilder.js

export function buildSoulSystemPrompt(agent) {
  const soul = agent.soul || {};
  const parts = [];
  
  // 1. 基础角色（Phase 3.1）
  parts.push(`# Agent 角色\n\n名称：${agent.name}\n角色：${agent.role || '通用助手'}`);
  
  // 2. 性格特征
  if (soul.personality) {
    parts.push(buildPersonalitySection(soul.personality));
  }
  
  // 3. 专业领域
  if (soul.expertise) {
    parts.push(buildExpertiseSection(soul.expertise));
  }
  
  // 4. 交互风格
  if (soul.communication_style) {
    parts.push(buildCommunicationSection(soul.communication_style));
  }
  
  // 5. 约束条件
  if (soul.constraints) {
    parts.push(buildConstraintsSection(soul.constraints));
  }
  
  // 6. 自定义提示
  if (soul.custom_prompts?.length) {
    parts.push(buildCustomPromptsSection(soul.custom_prompts));
  }
  
  return parts.join('\n\n---\n\n');
}

function buildPersonalitySection(personality) {
  const traits = personality.traits?.join('、') || '专业';
  const toneMap = {
    formal: '正式',
    casual: '随意',
    friendly: '友好',
    technical: '技术性'
  };
  
  return `## 性格特征

性格特点：${traits}
交流语调：${toneMap[personality.tone] || '正式'}
表情符号使用：${personality.emoji_usage || '少用'}`;
}

function buildExpertiseSection(expertise) {
  const levelMap = {
    junior: '初级',
    mid: '中级', 
    senior: '高级',
    expert: '专家'
  };
  
  return `## 专业领域

核心专长：${expertise.primary?.join('、') || '通用'}
辅助技能：${expertise.secondary?.join('、') || '无'}
专业等级：${levelMap[expertise.level] || '中级'}`;
}

function buildCommunicationSection(style) {
  const verbosityMap = {
    concise: '简洁，只说关键点',
    moderate: '适中，提供必要细节',
    detailed: '详细，全面覆盖'
  };
  
  return `## 交互风格

回答详细度：${verbosityMap[style.verbosity] || '适中'}
代码示例：${style.code_examples === 'always' ? '总是提供' : '按需提供'}
解释方式：${style.explanations === 'always' ? '主动解释' : '需要时解释'}
格式偏好：${style.format_preference || 'Markdown'}`;
}

function buildConstraintsSection(constraints) {
  const parts = [];
  
  if (constraints.hard_rules?.length) {
    parts.push(`### 不可违反的规则\n${constraints.hard_rules.map(r => `- ${r}`).join('\n')}`);
  }
  
  if (constraints.soft_preferences?.length) {
    parts.push(`### 偏好做法\n${constraints.soft_preferences.map(r => `- ${r}`).join('\n')}`);
  }
  
  return parts.join('\n\n');
}

function buildCustomPromptsSection(prompts) {
  return `## 特殊指令\n\n${prompts.map(p => `- ${p}`).join('\n')}`;
}
```

### 4. 前端 Soul 配置界面

```jsx
// client/components/SoulConfigPanel.jsx

function SoulConfigPanel({ agent, onSave }) {
  const [soul, setSoul] = useState(agent.soul || {});
  const [selectedTemplate, setSelectedTemplate] = useState('');
  
  // 应用模板
  const applyTemplate = (templateName) => {
    const template = SOUL_TEMPLATES[templateName];
    if (template) {
      setSoul({ ...template });
      setSelectedTemplate(templateName);
    }
  };
  
  // 更新 soul 字段
  const updateSoul = (path, value) => {
    setSoul(prev => {
      const newSoul = { ...prev };
      const keys = path.split('.');
      let current = newSoul;
      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = current[keys[i]] || {};
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      return newSoul;
    });
  };
  
  return (
    <div className="soul-config">
      <h3>Agent Soul 配置</h3>
      
      {/* 模板选择 */}
      <div className="template-selector">
        <label>从模板开始</label>
        <select value={selectedTemplate} onChange={e => applyTemplate(e.target.value)}>
          <option value="">选择模板...</option>
          <option value="architect">🏗️ 架构师</option>
          <option value="frontend_expert">🎨 前端专家</option>
          <option value="devops">🔧 DevOps 工程师</option>
          <option value="tester">🧪 测试工程师</option>
        </select>
      </div>
      
      {/* 性格配置 */}
      <section>
        <h4>性格特征</h4>
        <TraitsInput 
          value={soul.personality?.traits || []}
          onChange={v => updateSoul('personality.traits', v)}
        />
        <SelectField
          label="交流语调"
          value={soul.personality?.tone || 'formal'}
          onChange={v => updateSoul('personality.tone', v)}
          options={[
            { value: 'formal', label: '正式' },
            { value: 'friendly', label: '友好' },
            { value: 'casual', label: '随意' },
            { value: 'technical', label: '技术性' }
          ]}
        />
      </section>
      
      {/* 专业领域 */}
      <section>
        <h4>专业领域</h4>
        <TagInput
          label="核心专长"
          value={soul.expertise?.primary || []}
          onChange={v => updateSoul('expertise.primary', v)}
          placeholder="输入技术栈，按回车添加"
        />
        <TagInput
          label="辅助技能"
          value={soul.expertise?.secondary || []}
          onChange={v => updateSoul('expertise.secondary', v)}
        />
      </section>
      
      {/* 约束条件 */}
      <section>
        <h4>约束条件</h4>
        <TextareaList
          label="不可违反的规则"
          value={soul.constraints?.hard_rules || []}
          onChange={v => updateSoul('constraints.hard_rules', v)}
        />
        <TextareaList
          label="偏好做法"
          value={soul.constraints?.soft_preferences || []}
          onChange={v => updateSoul('constraints.soft_preferences', v)}
        />
      </section>
      
      {/* 自定义提示 */}
      <section>
        <h4>自定义指令</h4>
        <TextareaList
          value={soul.custom_prompts || []}
          onChange={v => updateSoul('custom_prompts', v)}
          placeholder="输入特殊指令，每条一行"
        />
      </section>
      
      <button onClick={() => onSave(soul)}>保存 Soul 配置</button>
    </div>
  );
}
```

## 实现步骤

### Step 1: 数据库扩展

```javascript
// server/db.js

try {
  db.run('ALTER TABLE agents ADD COLUMN soul TEXT DEFAULT "{}"');
  save();
} catch { /* column exists */ }
```

### Step 2: Soul 管理服务

```javascript
// server/services/soulManager.js

import db from '../db.js';
import { SOUL_TEMPLATES } from './soulTemplates.js';

export function getAgentSoul(agentId) {
  const agent = db.prepare('SELECT soul FROM agents WHERE id = ?').get(agentId);
  if (!agent) return null;
  
  try {
    return JSON.parse(agent.soul || '{}');
  } catch {
    return {};
  }
}

export function updateAgentSoul(agentId, soul) {
  db.prepare('UPDATE agents SET soul = ? WHERE id = ?').run(
    JSON.stringify(soul),
    agentId
  );
}

export function applySoulTemplate(agentId, templateName) {
  const template = SOUL_TEMPLATES[templateName];
  if (!template) throw new Error(`Template ${templateName} not found`);
  
  updateAgentSoul(agentId, template);
  return template;
}

export function getAvailableTemplates() {
  return Object.keys(SOUL_TEMPLATES);
}
```

### Step 3: API 端点

```javascript
// server/routes/agents.js

import * as soulManager from '../services/soulManager.js';

// 获取 Agent Soul
router.get('/:id/soul', (req, res) => {
  const soul = soulManager.getAgentSoul(req.params.id);
  res.json(soul);
});

// 更新 Agent Soul
router.patch('/:id/soul', (req, res) => {
  try {
    soulManager.updateAgentSoul(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 应用 Soul 模板
router.post('/:id/soul/apply-template', (req, res) => {
  try {
    const { templateName } = req.body;
    const soul = soulManager.applySoulTemplate(req.params.id, templateName);
    res.json(soul);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 获取可用模板列表
router.get('/soul-templates', (req, res) => {
  res.json(soulManager.getAvailableTemplates());
});
```

### Step 4: 整合到 System Prompt

```javascript
// server/services/systemPromptBuilder.js

import { buildSoulSystemPrompt } from './soulPromptBuilder.js';
import { getAgentSoul } from './soulManager.js';

export function buildSystemPrompt(agentId, conversationId = null) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return '';
  
  // 获取 Soul 配置
  const soul = getAgentSoul(agentId);
  const agentWithSoul = { ...agent, soul };
  
  // 如果有 Soul 配置，使用 Soul 构建器
  if (Object.keys(soul).length > 0) {
    return buildSoulSystemPrompt(agentWithSoul);
  }
  
  // 否则使用 Phase 3.1 的基础构建器
  return buildBasicSystemPrompt(agent);
}
```

## 测试计划

```javascript
// test/unit/soulPromptBuilder.test.js

describe('SoulPromptBuilder', () => {
  test('should build personality section', () => {
    const personality = { traits: ['专业'], tone: 'formal' };
    const section = buildPersonalitySection(personality);
    expect(section).toContain('专业');
    expect(section).toContain('正式');
  });
  
  test('should build expertise section with level', () => {
    const expertise = {
      primary: ['React'],
      level: 'senior'
    };
    const section = buildExpertiseSection(expertise);
    expect(section).toContain('React');
    expect(section).toContain('高级');
  });
  
  test('should handle empty soul gracefully', () => {
    const prompt = buildSoulSystemPrompt({ name: 'Test', soul: {} });
    expect(prompt).toContain('Test');
  });
});

// test/unit/soulManager.test.js

describe('SoulManager', () => {
  test('should apply template', () => {
    const soul = soulManager.applySoulTemplate(1, 'architect');
    expect(soul.personality.traits).toContain('专业');
  });
  
  test('should throw for invalid template', () => {
    expect(() => soulManager.applySoulTemplate(1, 'invalid'))
      .toThrow('Template invalid not found');
  });
});
```

## 验收标准

- [ ] `agents` 表新增 `soul` 字段（JSON）
- [ ] Soul 配置包含性格、专业领域、交互风格、约束
- [ ] 提供 4+ 预设模板（架构师、前端、DevOps、测试）
- [ ] Soul 自动转换为 system prompt
- [ ] 前端提供 Soul 配置界面
- [ ] 支持从模板创建并自定义
- [ ] API 支持 Soul CRUD 操作

## 后续优化

1. **Soul 效果评估** - 根据 Agent 回答质量评分
2. **Soul 推荐系统** - 根据对话内容推荐合适的 Soul
3. **Soul 市场** - 用户可分享/下载 Soul 配置
4. **动态 Soul** - 根据对话进展自动调整性格

## 相关文档

- [Phase 3 总体设计](./phase3.md)
- [Phase 3.1 系统提示词配置](./phase3.1-system-prompt.md)
