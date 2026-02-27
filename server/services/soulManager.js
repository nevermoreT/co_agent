// Soul 管理服务 - 处理 Agent Soul 配置的 CRUD 操作

import db from '../db.js';
import { SOUL_TEMPLATES } from './soulTemplates.js';

/**
 * 获取 Agent 的 Soul 配置
 */
export function getAgentSoul(agentId) {
  const agent = db.prepare('SELECT soul FROM agents WHERE id = ?').get(agentId);
  if (!agent) return null;

  try {
    return JSON.parse(agent.soul || '{}');
  } catch {
    return {};
  }
}

/**
 * 更新 Agent 的 Soul 配置
 */
export function updateAgentSoul(agentId, soul) {
  db.prepare('UPDATE agents SET soul = ? WHERE id = ?').run(
    JSON.stringify(soul),
    agentId
  );
}

/**
 * 应用 Soul 模板到 Agent
 */
export function applySoulTemplate(agentId, templateName) {
  const template = SOUL_TEMPLATES[templateName];
  if (!template) {
    throw new Error(`Template ${templateName} not found`);
  }

  updateAgentSoul(agentId, template);
  return template;
}

/**
 * 获取所有可用的 Soul 模板
 */
export function getAvailableTemplates() {
  return Object.keys(SOUL_TEMPLATES).map(key => ({
    key,
    name: getTemplateDisplayName(key),
    template: SOUL_TEMPLATES[key]
  }));
}

/**
 * 获取模板的显示名称
 */
function getTemplateDisplayName(key) {
  const nameMap = {
    architect: '🏗️ 架构师',
    frontend_expert: '🎨 前端专家',
    devops: '🔧 DevOps 工程师',
    tester: '🧪 测试工程师',
    backend_engineer: '⚙️ 后端工程师',
    product_manager: '📊 产品经理'
  };
  return nameMap[key] || key;
}

/**
 * 合并 Soul 配置（用于部分更新）
 */
export function mergeSoulConfig(agentId, partialSoul) {
  const currentSoul = getAgentSoul(agentId);
  const mergedSoul = deepMerge(currentSoul, partialSoul);
  updateAgentSoul(agentId, mergedSoul);
  return mergedSoul;
}

/**
 * 深度合并对象
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}
