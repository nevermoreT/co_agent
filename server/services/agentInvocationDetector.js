/**
 * Agent 调用检测器
 * 
 * 监控 Agent 输出，检测 @mention 调用意图
 */

import db from '../db.js';
import logger from '../logger.js';

/**
 * 非 A2A 场景关键词
 * 当 @mention 后紧跟这些词时，认为不是 A2A 调用（如单纯的提及）
 */
const NON_INVOCATION_PATTERNS = [
  /^说的/i,        // "@XXX说的对"
  /^也是/i,        // "@XXX也是这么想的"
  /^已经/i,        // "@XXX已经完成了"
  /^刚刚/i,        // "@XXX刚刚说了"
  /^之前/i,        // "@XXX之前提到"
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
  // 负向前瞻：名称后不能紧跟中文字符（防止"哈基狸花来"把"来"也匹配进去）
  const mentionPattern = /@([\w\u4e00-\u9fa5]+(?:\s+[\w\u4e00-\u9fa5]+)*?)(?!\w|\u4e00-\u9fa5)(?=\s|$|,|!|\?|\.|~|，|。|！|？|、)/g;
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
 * 默认只要有 @mention 就是调用意图，除非匹配非调用模式
 * 
 * @param {string} textAfterMention - @mention 后的文本
 * @returns {boolean} - 是否是调用意图
 */
function isInvocationIntent(textAfterMention) {
  if (!textAfterMention || textAfterMention.length === 0) {
    // 纯 @mention 也触发（相当于"叫一下"）
    return true;
  }
  
  // 检查是否匹配非调用模式
  const isNonInvocation = NON_INVOCATION_PATTERNS.some(pattern => pattern.test(textAfterMention));
  
  return !isNonInvocation;
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
