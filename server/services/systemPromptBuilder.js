import fs from 'fs';
import path from 'path';
import os from 'os';
import db from '../db.js';
import logger from '../logger.js';

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `
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

export function buildSystemPrompt(agentId, conversationId = null) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return '';
  
  let responsibilities;
  try {
    responsibilities = JSON.parse(agent.responsibilities || '[]');
  } catch {
    responsibilities = [];
  }
  
  const prompt = DEFAULT_SYSTEM_PROMPT_TEMPLATE
    .replace('{agent_name}', agent.name || '助手')
    .replace('{role}', agent.role || '通用助手')
    .replace('{responsibilities}', responsibilities.length > 0 
      ? responsibilities.map(r => `- ${r}`).join('\n') 
      : '- 通用任务处理')
    .replace('{custom_system_prompt}', agent.system_prompt || '无特殊指令');
  
  return prompt.trim();
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
  
  let prefix = `[${agent.name}`;
  if (agent.role) prefix += ` - ${agent.role}`;
  prefix += '] ';
  
  if (prefix.length > 200) {
    prefix = prefix.substring(0, 197) + '... ';
  }
  
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
  
  parts.push(``, `协作上下文：你正在参与一个多 Agent 协作对话。请基于你的专业领域提供回答。`);
  
  return parts.join('\n');
}
