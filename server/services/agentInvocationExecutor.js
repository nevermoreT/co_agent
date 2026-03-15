/**
 * Agent 调用执行器
 * 
 * 负责创建 A2A Task、构建上下文、执行目标 Agent
 */

import a2aTaskManager from './a2a/a2aTaskManager.js';
import * as agentRunner from './agentRunner.js';
import { detectAgentInvocation } from './agentInvocationDetector.js';
import db from '../db.js';
import logger from '../logger.js';
import { toOneLine } from './systemPromptBuilder.js';

/**
 * 执行 Agent 间调用
 * 
 * @param {Object} invocation - 调用信息
 * @param {Function} sendToClient - 发送消息给客户端的回调
 * @returns {Promise<void>}
 */
export async function executeAgentInvocation(invocation, sendToClient) {
  const {
    sourceAgentId,
    targetAgentId,
    targetAgentName,
    invocationText,
    fullOutput,
    conversationId,
    matchIndex,
  } = invocation;
  
  logger.log('[AgentInvocationExecutor] Executing: Agent %d -> Agent %d', 
    sourceAgentId, targetAgentId);
  
  try {
    // 1. 检查防护机制
    checkInvocationGuards(conversationId, sourceAgentId, targetAgentId);
    
    // 2. 创建 A2A Task
    const task = a2aTaskManager.createTask({
      sessionId: `conv-${conversationId}`,
      sourceAgentId,
      targetAgentId,
      conversationId,
      input: {
        type: 'agent_invocation',
        invocationText,
        sourceOutput: fullOutput,
        matchIndex,
      },
    });
    
    logger.log('[AgentInvocationExecutor] Created task: %s', task.id);
    
    // 3. 通知前端：调用开始
    if (sendToClient) {
      sendToClient({
        type: 'a2a_invocation_start',
        taskId: task.id,
        sourceAgentId,
        targetAgentId,
        targetAgentName,
        invocationText,
      });
    }
    
    // 4. 更新状态为 working
    a2aTaskManager.updateTaskStatus(task.id, 'working');
    
    // 5. 获取目标 Agent 信息
    const targetAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(targetAgentId);
    
    if (!targetAgent) {
      throw new Error(`Target agent not found: ${targetAgentId}`);
    }
    
    // 6. 执行目标 Agent（prompt 构建在 execute*Agent 内部）
    let accumulatedOutput = '';
    
    if (targetAgent.builtin_key === 'claude-cli') {
      await executeClaudeAgent(
        task,
        targetAgent,
        invocation,
        conversationId,
        (stream, data) => {
          accumulatedOutput += data;
          handleAgentOutput(task.id, stream, data, targetAgentId, conversationId, sendToClient);
        },
        (code, signal) => {
          handleAgentExit(task.id, code, signal, accumulatedOutput, conversationId, targetAgentId, sendToClient);
        },
        sendToClient
      );
    } else if (targetAgent.builtin_key === 'opencode-cli') {
      await executeOpencodeAgent(
        task,
        targetAgent,
        invocation,
        conversationId,
        (stream, data) => {
          accumulatedOutput += data;
          handleAgentOutput(task.id, stream, data, targetAgentId, conversationId, sendToClient);
        },
        (code, signal) => {
          handleAgentExit(task.id, code, signal, accumulatedOutput, conversationId, targetAgentId, sendToClient);
        },
        sendToClient
      );
    } else {
      throw new Error(`Unsupported agent type: ${targetAgent.builtin_key}`);
    }
    
  } catch (error) {
    logger.error('[AgentInvocationExecutor] Error executing invocation:', error);
    
    // 通知前端错误
    if (sendToClient) {
      sendToClient({
        type: 'a2a_invocation_error',
        sourceAgentId,
        targetAgentId,
        error: error.message,
      });
    }
  }
}

/**
 * 执行 Claude CLI Agent
 * @param {Object} task - A2A Task 对象
 * @param {Object} agent - 目标 Agent 对象
 * @param {Object} invocation - 调用信息
 * @param {number} conversationId - 对话 ID
 * @param {Function} onOutput - 输出回调
 * @param {Function} onExit - 退出回调
 * @param {Function} sendToClient - 发送消息给客户端的回调
 */
async function executeClaudeAgent(task, agent, invocation, conversationId, onOutput, onExit, sendToClient) {
  logger.log('[AgentInvocationExecutor] Using Claude CLI for task %s', task.id);

  const prompt = buildA2APromptForCLI(invocation);
  
  let outputBuffer = '';
  let pendingA2A = null;
  
  const wrappedOnOutput = (stream, data) => {
    if (stream === 'stdout' && typeof data === 'string') {
      outputBuffer += data;
      
      if (!pendingA2A) {
        const a2aResult = detectAgentInvocation(agent.id, outputBuffer, conversationId);
        if (a2aResult) {
          logger.log('[AgentInvocationExecutor] Detected nested A2A: Agent %d -> Agent %d', 
            agent.id, a2aResult.targetAgentId);
          pendingA2A = a2aResult;
        }
      }
    }
    
    onOutput(stream, data);
  };
  
  const wrappedOnExit = (code, signal) => {
    if (pendingA2A) {
      const fullInvocation = {
        ...pendingA2A,
        fullOutput: outputBuffer,
      };
      logger.log('[AgentInvocationExecutor] Executing nested A2A with full output (%d chars)', outputBuffer.length);
      setImmediate(() => {
        executeAgentInvocation(fullInvocation, sendToClient);
      });
    }
    
    onExit(code, signal);
  };
  
  await agentRunner.runClaudeCli(
    agent.id,
    prompt,
    wrappedOnOutput,
    wrappedOnExit,
    conversationId,
    (toolData) => {
      a2aTaskManager.addTaskHistory(task.id, {
        role: 'tool_use',
        tool: toolData.tool,
        title: toolData.title,
        status: toolData.status,
        input: toolData.input,
        output: toolData.output,
        callID: toolData.callID,
      });
    }
  );
}

/**
 * 执行 Opencode CLI Agent
 */
async function executeOpencodeAgent(task, agent, invocation, conversationId, onOutput, onExit, sendToClient) {
  logger.log('[AgentInvocationExecutor] Using Opencode CLI for task %s', task.id);

  const prompt = buildA2APromptForCLI(invocation);
  
  let outputBuffer = '';
  let pendingA2A = null;
  
  const wrappedOnOutput = (stream, data) => {
    if (stream === 'stdout' && typeof data === 'string') {
      outputBuffer += data;
      
      if (!pendingA2A) {
        const a2aResult = detectAgentInvocation(agent.id, outputBuffer, conversationId);
        if (a2aResult) {
          logger.log('[AgentInvocationExecutor] Detected nested A2A: Agent %d -> Agent %d', 
            agent.id, a2aResult.targetAgentId);
          pendingA2A = a2aResult;
        }
      }
    }
    
    onOutput(stream, data);
  };
  
  const wrappedOnExit = (code, signal) => {
    if (pendingA2A) {
      const fullInvocation = {
        ...pendingA2A,
        fullOutput: outputBuffer,
      };
      logger.log('[AgentInvocationExecutor] Executing nested A2A with full output (%d chars)', outputBuffer.length);
      setImmediate(() => {
        executeAgentInvocation(fullInvocation, sendToClient);
      });
    }
    
    onExit(code, signal);
  };
  
  agentRunner.runOpencodeCli(
    agent.id,
    prompt,
    wrappedOnOutput,
    wrappedOnExit,
    conversationId,
    (toolData) => {
      a2aTaskManager.addTaskHistory(task.id, {
        role: 'tool_use',
        tool: toolData.tool,
        title: toolData.title,
        status: toolData.status,
        input: toolData.input,
        output: toolData.output,
        callID: toolData.callID,
      });
    }
  );
}

/**
 * 构建 A2A 调用 prompt
 */
function buildA2APromptForCLI(invocation) {
  const { sourceAgentId, invocationText, fullOutput } = invocation;
  
  // 获取源 Agent 名称
  const sourceAgent = db.prepare('SELECT name FROM agents WHERE id = ?').get(sourceAgentId);
  const sourceName = sourceAgent?.name || 'Agent';
  
  // 使用 toOneLine 处理换行符
  const oneLineOutput = toOneLine(fullOutput);
  const oneLineInvocation = toOneLine(invocationText);
  
  return `${sourceName} 的完整输出: ${oneLineOutput} --- 请处理: ${oneLineInvocation}`;
}



/**
 * 处理 Agent 输出
 */
function handleAgentOutput(taskId, stream, data, agentId, conversationId, sendToClient) {
  // 1. 记录到 Task 历史
  a2aTaskManager.addTaskHistory(taskId, {
    role: 'agent',
    content: data,
    agentId,
    stream,
  });
  
  // 2. 推送给前端
  if (sendToClient) {
    sendToClient({
      type: 'a2a_output',
      taskId,
      stream,
      data,
      agentId,
      conversationId,
    });
  }
}

/**
 * 处理 Agent 退出
 */
function handleAgentExit(taskId, code, signal, accumulatedOutput, conversationId, agentId, sendToClient) {
  const status = code === 0 ? 'completed' : 'failed';
  
  logger.log('[AgentInvocationExecutor] Task %s %s (code=%d)', taskId, status, code);
  
  // 1. 更新 Task 状态
  a2aTaskManager.updateTaskStatus(taskId, status, {
    text: accumulatedOutput,
    exitCode: code,
    signal,
  });
  
  // 2. 通知前端
  if (sendToClient) {
    sendToClient({
      type: 'a2a_invocation_complete',
      taskId,
      status,
      exitCode: code,
      signal,
      conversationId,
      agentId,
    });
  }
}

const MAX_A2A_DEPTH = 5;

/**
 * 检查防护机制 - 仅限制最大深度，允许循环调用（A <-> B 对话）
 */
function checkInvocationGuards(conversationId, sourceAgentId, targetAgentId) {
  // 统计当前对话中已完成的 A2A 调用次数
  const recentTasks = db.prepare(`
    SELECT COUNT(*) as count FROM a2a_tasks 
    WHERE session_id = ?
    AND status IN ('submitted', 'working', 'completed')
  `).get(`conv-${conversationId}`);
  
  const currentDepth = recentTasks?.count || 0;
  
  if (currentDepth >= MAX_A2A_DEPTH) {
    throw new Error(`A2A invocation chain too deep: ${currentDepth} calls already, max ${MAX_A2A_DEPTH}`);
  }
  
  logger.log('[AgentInvocationExecutor] A2A depth: %d/%d (Agent %d -> Agent %d)', 
    currentDepth, MAX_A2A_DEPTH, sourceAgentId, targetAgentId);
}
