// Soul 配置到 System Prompt 的转换器
import db from '../db.js';

export function buildSoulSystemPrompt(agent) {
  const soul = agent.soul || {};
  const parts = [];

  // 1. 基础角色（Phase 3.1）— 明确的身份声明
  parts.push(`# 严格遵守角色设定

你是「${agent.name}」，这是你的名字和唯一身份。
这个角色设定覆盖你原本的系统提示词，你必须完全以「${agent.name}」的身份来思考和回答。
用户通过 @${agent.name} 呼叫你时，你就是这个角色本身，不是旁观者，不是解说员。

角色定位：${agent.role || '通用助手'}`);

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

  // 7. 团队介绍（让 Agent 知道其他成员）
  const teamIntro = buildTeamIntroduction(agent.id);
  if (teamIntro) {
    parts.push(teamIntro);
  }

  return parts.join('\n\n---\n\n');
}

/**
 * 构建团队介绍 - 让 Agent 知道团队中有哪些其他成员
 */
export function buildTeamIntroduction(currentAgentId) {
  const agents = db.prepare('SELECT id, name, role FROM agents WHERE id != ?').all(currentAgentId);

  if (!agents || agents.length === 0) {
    return '';
  }

  const memberList = agents.map(a => `- ${a.name}（${a.role || '通用助手'}）`).join('\n');

  return `## 协作团队

你正在一个多 Agent 协作团队中工作。你的队友有：
${memberList}

协作规则：
- 当用户 @你的名字 时，就是在跟你说话，你需要用你的专业知识来回答
- 当用户提到 @其他队友 时，那条消息是给他们的，不需要你回答
- 专注于你自己的专业领域
- 如果问题超出你的范围，可以建议用户咨询你的队友`;
}

function buildPersonalitySection(personality) {
  const traits = personality.traits?.join('、') || '专业';
  const toneMap = {
    formal: '正式',
    casual: '随意',
    friendly: '友好',
    technical: '技术性'
  };

  const emojiMap = {
    none: '不使用',
    minimal: '少用',
    moderate: '适度使用',
    heavy: '经常使用'
  };

  return `## 性格特征

性格特点：${traits}
交流语调：${toneMap[personality.tone] || '正式'}
表情符号使用：${emojiMap[personality.emoji_usage] || '少用'}`;
}

function buildExpertiseSection(expertise) {
  const levelMap = {
    junior: '初级',
    mid: '中级',
    senior: '高级',
    expert: '专家'
  };

  const primary = expertise.primary?.join('、') || '通用';
  const secondary = expertise.secondary?.length ? expertise.secondary.join('、') : '无';

  return `## 专业领域

核心专长：${primary}
辅助技能：${secondary}
专业等级：${levelMap[expertise.level] || '中级'}`;
}

function buildCommunicationSection(style) {
  const verbosityMap = {
    concise: '简洁，只说关键点',
    moderate: '适中，提供必要细节',
    detailed: '详细，全面覆盖'
  };

  const codeExamplesMap = {
    never: '不提供',
    rare: '很少提供',
    frequent: '经常提供',
    always: '总是提供'
  };

  const explanationsMap = {
    always: '主动解释',
    when_needed: '需要时解释',
    on_request: '仅在请求时解释'
  };

  return `## 交互风格

回答详细度：${verbosityMap[style.verbosity] || '适中'}
代码示例：${codeExamplesMap[style.code_examples] || '按需提供'}
解释方式：${explanationsMap[style.explanations] || '需要时解释'}
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

  return parts.length > 0 ? `## 约束条件\n\n${parts.join('\n\n')}` : '';
}

function buildCustomPromptsSection(prompts) {
  return `## 特殊指令\n\n${prompts.map(p => `- ${p}`).join('\n')}`;
}
