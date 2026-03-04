/**
 * Agent 调用检测器
 * 
 * 监控 Agent 输出，检测 @mention 调用意图
 */

import db from '../db.js';
import logger from '../logger.js';

/**
 * 调用意图关键词
 * 当 @mention 后包含这些词时，认为是调用意图
 */
const INVOCATION_KEYWORDS = [
  // 中文请求词
  '请', '帮我', '帮忙', '可以', '能否', '能否请',
  '检查', '检视', '审查', '测试',
  '实现', '修复', '优化', '改进',
  '设计', '分析', '评估', '建议',
  '写', '创建', '生成', '编写',
  '看看', '查看', '阅读', '理解',
  '醒醒', '起来', '过来', '出来',
  '别睡', '别休息', '起来干活',
  '有用户', '在找你', '需要你',
  '帮个忙', '帮帮忙', '来帮',
  
  // 英文请求词
  'please', 'help', 'can you', 'could you', 'would you',
  'review', 'check', 'test', 'verify',
  'implement', 'fix', 'optimize', 'improve',
  'design', 'analyze', 'evaluate', 'suggest',
  'write', 'create', 'generate', 'build',
  'look at', 'examine', 'read', 'understand',
  'wake up', 'come here', 'come out',
  'user', 'looking for', 'need you',
];

/**
 * 检测 Agent 输出中的 @mention 调用意图
 * 
 * @param {number} sourceAgentId - 发起调用的 Agent ID
 * @param {string} output - Agent 的输出内容
 * @param {number} conversationId - 对话 ID
 * @returns {Object|null} - 如果检测到调用意图，返回调用信息
 */
export function detectAgentInvocation(sourceAgentId, output, conversationId) {
  if (!output || typeof output !== 'string') {
    return null;
  }

  logger.log('[AgentInvocationDetector] Checking output from Agent %d, length=%d', sourceAgentId, output.length);

  // 1. 查找所有 @mention
  // 支持中文、英文、数字和下划线
  const mentionPattern = /@([\w\u4e00-\u9fa5]+(?:\s+[\w\u4e00-\u9fa5]+)*?)(?=\s|$|,|!|\?|\.|~)/g;
  const matches = [...output.matchAll(mentionPattern)];
  
  if (matches.length === 0) {
    logger.log('[AgentInvocationDetector] No @mentions found');
    return null;
  }
  
  logger.log('[AgentInvocationDetector] Found %d @mentions: %s', matches.length, matches.map(m => m[1]).join(', '));
  
  // 2. 获取所有 Agent（排除自己）
  const agents = db.prepare(`
    SELECT id, name, role 
    FROM agents 
    WHERE id != ?
  `).all(sourceAgentId);
  
  logger.log('[AgentInvocationDetector] Found %d agents (excluding self)', agents.length);
  agents.forEach(a => logger.log('[AgentInvocationDetector]   - Agent %d: %s', a.id, a.name));
  
  if (agents.length === 0) {
    return null;
  }
  
  // 3. 对每个 @mention 进行分析
  for (const match of matches) {
    const mentionedName = match[1].trim();
    logger.log('[AgentInvocationDetector] Checking mention: "%s"', mentionedName);
    
    const targetAgent = findAgentByName(agents, mentionedName);
    
    if (!targetAgent) {
      logger.log('[AgentInvocationDetector] No matching agent found for "%s"', mentionedName);
      continue;
    }
    
    logger.log('[AgentInvocationDetector] Matched agent: Agent %d (%s)', targetAgent.id, targetAgent.name);
    
    // 4. 提取 @mention 后的内容
    const afterMentionStart = match.index + match[0].length;
    const afterMention = output.slice(afterMentionStart).trim();
    
    logger.log('[AgentInvocationDetector] Text after mention: "%s"', afterMention.substring(0, 100));
    
    // 5. 判断是否是调用意图
    const isInvocation = isInvocationIntent(afterMention);
    
    logger.log('[AgentInvocationDetector] Is invocation intent: %s', isInvocation);
    
    if (isInvocation) {
      logger.log('[AgentInvocationDetector] ✓ Detected invocation: Agent %d -> Agent %d (%s)', 
        sourceAgentId, targetAgent.id, mentionedName);
      
      return {
        sourceAgentId,
        targetAgentId: targetAgent.id,
        targetAgentName: targetAgent.name,
        mentionedName,
        invocationText: afterMention.slice(0, 200), // 限制长度
        fullOutput: output,
        conversationId,
        matchIndex: match.index,
      };
    }
  }
  
  logger.log('[AgentInvocationDetector] No invocation intent detected');
  return null;
}

/**
 * 判断 @mention 后的内容是否表示调用意图
 * 
 * @param {string} textAfterMention - @mention 后的文本
 * @returns {boolean} - 是否是调用意图
 */
function isInvocationIntent(textAfterMention) {
  if (!textAfterMention || textAfterMention.length === 0) {
    return false;
  }
  
  const lowerText = textAfterMention.toLowerCase();
  
  // 检查是否包含任何调用关键词
  return INVOCATION_KEYWORDS.some(keyword => {
    const lowerKeyword = keyword.toLowerCase();
    return lowerText.includes(lowerKeyword);
  });
}

/**
 * 根据名称查找 Agent（支持模糊匹配）
 * 
 * @param {Array} agents - Agent 列表
 * @param {string} name - 要查找的名称
 * @returns {Object|null} - 找到的 Agent 或 null
 */
function findAgentByName(agents, name) {
  const nameLower = name.toLowerCase().trim();
  
  // 1. 精确匹配（不区分大小写）
  let found = agents.find(a => a.name.toLowerCase() === nameLower);
  if (found) {
    return found;
  }
  
  // 2. 部分匹配（Agent 名称包含提及的名称）
  // 例如："Code" 匹配 "Code Reviewer"
  found = agents.find(a => {
    const agentNameLower = a.name.toLowerCase();
    // 提及的名称应该是 Agent 名称的子串
    return agentNameLower.includes(nameLower) && nameLower.length >= 3;
  });
  if (found) {
    return found;
  }
  
  // 3. 反向部分匹配（提及的名称包含 Agent 名称）
  // 例如："Code Reviewer please help" 中的 "Code Reviewer"
  found = agents.find(a => {
    const agentNameLower = a.name.toLowerCase();
    return nameLower.includes(agentNameLower);
  });
  if (found) {
    return found;
  }
  
  return null;
}

/**
 * 批量检测多个输出片段
 * 用于处理流式输出，避免重复检测
 * 
 * @param {number} sourceAgentId - 源 Agent ID
 * @param {string[]} outputChunks - 输出片段数组
 * @param {number} conversationId - 对话 ID
 * @returns {Object|null} - 检测到的调用信息
 */
export function detectAgentInvocationFromChunks(sourceAgentId, outputChunks, conversationId) {
  // 合并所有片段
  const fullOutput = outputChunks.join('');
  
  // 使用单个检测函数
  return detectAgentInvocation(sourceAgentId, fullOutput, conversationId);
}

/**
 * 提取调用上下文
 * 从完整输出中提取与调用相关的上下文
 * 
 * @param {string} fullOutput - 完整输出
 * @param {number} matchIndex - @mention 的位置
 * @param {number} contextLength - 上下文长度（前后各取多少字符）
 * @returns {string} - 提取的上下文
 */
export function extractInvocationContext(fullOutput, matchIndex, contextLength = 500) {
  const start = Math.max(0, matchIndex - contextLength);
  const end = Math.min(fullOutput.length, matchIndex + contextLength);
  
  return fullOutput.slice(start, end);
}
