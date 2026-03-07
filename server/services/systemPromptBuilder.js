import fs from 'fs';
import path from 'path';
import os from 'os';
import db from '../db.js';
import logger from '../logger.js';
import { buildSoulSystemPrompt, buildTeamIntroduction } from './soulPromptBuilder.js';
import { getAgentSoul } from './soulManager.js';

const _DEFAULT_SYSTEM_PROMPT_TEMPLATE = `
# Agent 角色定义

## 名称
{agent_name}

## 角色
{role}

## 职责
{responsibilities}

## 自定义指令
{custom_system_prompt}

## 协作上下文
你正在参与一个多 Agent 协作对话。请基于你的专业领域提供回答。
`;

export function buildSystemPrompt(agentId, _conversationId = null) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return '';

  // 获取 Soul 配置
  const soul = getAgentSoul(agentId);

  // 如果有 Soul 配置，使用 Soul 构建器
  if (soul && Object.keys(soul).length > 0) {
    const agentWithSoul = { ...agent, soul };
    return buildSoulSystemPrompt(agentWithSoul);
  }

  // 否则使用基础构建器（Phase 3.1）
  return buildBasicSystemPrompt(agent);
}

export function sanitizeForShell(str) {
  if (!str) return '""';
  return '"' + str.replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
}

export function containsSpecialChars(str) {
  if (!str) return false;
  return /[()&|<>^]/.test(str);
}

let tmpFileCounter = 0;

export async function writeSystemPromptFile(content) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `claude-system-${Date.now()}-${++tmpFileCounter}.txt`);
  
  await fs.promises.writeFile(tmpFile, content, 'utf8');
  logger.log('[systemPromptBuilder] wrote system prompt file: %s (%d chars)', tmpFile, content.length);
  
  return tmpFile;
}

export function deleteSystemPromptFile(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
    logger.log('[systemPromptBuilder] deleted system prompt file: %s', filePath);
  } catch {
    // ignore
  }
}

export function buildOpencodePrefix(agentId) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return '';

  // 获取 Soul 配置
  const soul = getAgentSoul(agentId);
  logger.log('[systemPromptBuilder] buildOpencodePrefix: agentId=%d soul=%s', agentId, JSON.stringify(soul));

  // 如果有 Soul 配置，使用完整的 Soul 系统提示词
  if (soul && Object.keys(soul).length > 0) {
    const agentWithSoul = { ...agent, soul };
    const soulPrompt = buildSoulSystemPrompt(agentWithSoul);
    // 将换行符替换为空格，避免 Windows cmd.exe 解析问题
    // 使用 [SYSTEM_CONTEXT] 而不是 <system_context>（避免 < > 被解释为重定向）
    const oneLinePrompt = soulPrompt.replace(/\n/g, ' ').replace(/\r/g, '');
    logger.log('[systemPromptBuilder] buildOpencodePrefix: using soul prompt (%d chars)', soulPrompt.length);
    return `[SYSTEM_CONTEXT] ${oneLinePrompt} [/SYSTEM_CONTEXT] 用户消息：`;
  }

  // 否则使用基础系统提示词
  const basicPrompt = buildBasicSystemPrompt(agent);
  logger.log('[systemPromptBuilder] buildOpencodePrefix: using basic prompt (%d chars)', basicPrompt.length);
  if (basicPrompt) {
    const oneLinePrompt = basicPrompt.replace(/\n/g, ' ').replace(/\r/g, '');
    return `[SYSTEM_CONTEXT] ${oneLinePrompt} [/SYSTEM_CONTEXT] 用户消息：`;
  }

  // 最简单的前缀
  let prefix = `[${agent.name}`;
  if (agent.role) prefix += ` - ${agent.role}`;
  prefix += '] ';

  return prefix;
}

export function buildBasicSystemPrompt(agent) {
  let responsibilities;
  try {
    responsibilities = JSON.parse(agent.responsibilities || '[]');
  } catch {
    responsibilities = [];
  }
  
  const parts = [`# Agent 角色`, ``, `名称：${agent.name}`, `角色：${agent.role || '通用助手'}`];
  
  if (responsibilities.length > 0) {
    parts.push(``, `职责：`);
    responsibilities.forEach(r => parts.push(`- ${r}`));
  }
  
  if (agent.system_prompt) {
    parts.push(``, `自定义指令：${agent.system_prompt}`);
  }
  
  // 添加团队介绍
  const teamIntro = buildTeamIntroduction(agent.id);
  if (teamIntro) {
    parts.push(teamIntro);
  } else {
    parts.push(``, `协作上下文：你正在参与一个多 Agent 协作对话。请基于你的专业领域提供回答。`);
  }
  
  return parts.join('\n');
}

/**
 * 将多行文本转换为单行（Windows shell 免容)
 * @param {string} str - 多行文本
 * @returns {string} 单行文本
 */
export function toOneLine(str) {
  return (str || '').replace(/\r?\n/g, ' ').replace(/\r/g, '');
}

/**
 * 构建 A2A 调用的 prompt (供 CLI 使用)
 * @param {Object} invocation - 调用信息
 * @returns {string} 格式化的 prompt
 */
export function buildA2APromptForCLI(invocation) {
  const { sourceAgentId, invocationText, fullOutput } = invocation;
  const sourceAgent = db.prepare('SELECT name FROM agents WHERE id = ?').get(sourceAgentId);
  const sourceName = sourceAgent?.name || 'Agent';
  
  const oneLineOutput = toOneLine(fullOutput || '');
  const oneLineInvocation = toOneLine(invocationText || '');
  
  // 构建上下文 - Windows shell 兼容：单行格式
  return `${sourceName} 的完整输出: ${oneLineOutput} --- 请处理: ${oneLineInvocation}`;
}
