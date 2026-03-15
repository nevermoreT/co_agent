import { WebSocketServer } from 'ws';
import * as agentRunner from './services/agentRunner.js';
import { detectAgentInvocation } from './services/agentInvocationDetector.js';
import { executeAgentInvocation } from './services/agentInvocationExecutor.js';
import a2aTaskManager from './services/a2a/a2aTaskManager.js';
import db from './db.js';
import logger from './logger.js';

/**
 * 创建节流输出函数，批量发送 WebSocket 消息
 * 避免高频 chunk 触发前端大量重渲染
 */
function createThrottledOutput(send, agentId, delay = 80) {
  let buffer = '';
  let timer = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffer) {
      send({ type: 'output', agentId, stream: 'stdout', data: buffer });
      buffer = '';
    }
  };

  const push = (stream, data) => {
    // stderr 不节流，直接发送
    if (stream === 'stderr') {
      send({ type: 'output', agentId, stream, data });
      return;
    }
    buffer += data;
    if (!timer) {
      timer = setTimeout(flush, delay);
    }
  };

  return { push, flush };
}

/**
 * 创建 Agent 调用检测器
 * 累积输出，在 Agent 退出后检测并触发 A2A 调用
 */
function createInvocationDetector(agentId, conversationId, send) {
  let outputBuffer = '';
  let pendingInvocation = null; // 检测到的调用意图
  
  return {
    process: (stream, data) => {
      // 只检测 stdout 输出
      if (stream !== 'stdout' || typeof data !== 'string') {
        return;
      }
      
      // 累积输出
      outputBuffer += data;
      
      // 如果还没检测到调用意图，继续检测
      if (!pendingInvocation) {
        const invocation = detectAgentInvocation(agentId, outputBuffer, conversationId);
        if (invocation) {
          logger.log('[websocket] Detected agent invocation intent: Agent %d -> Agent %d', 
            agentId, invocation.targetAgentId);
          pendingInvocation = invocation;
        }
      }
    },
    
    // Agent 退出时调用，返回完整输出
    onExit: () => {
      // 如果有调用意图，用完整输出重新构建 invocation
      if (pendingInvocation) {
        // 用完整输出更新 invocation
        const fullInvocation = {
          ...pendingInvocation,
          fullOutput: outputBuffer,
        };
        logger.log('[websocket] Executing A2A invocation with full output (%d chars)', outputBuffer.length);
        setImmediate(() => {
          executeAgentInvocation(fullInvocation, send);
        });
      }
      return outputBuffer;
    },
    
    reset: () => {
      outputBuffer = '';
      pendingInvocation = null;
    },
  };
}

export function setupWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    // 存储当前 WebSocket 连接正在处理的 conversationId
    const wsContext = {
      currentConversationId: null,
    };

    const send = (payload) => {
      if (ws.readyState !== 1) return; // 1 = OPEN
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        // 客户端已断开时 write 可能报 ECONNABORTED，忽略
      }
    };

    ws.on('error', (err) => {
      logger.error('[websocket] WebSocket error:', err);
    });
    ws.on('close', () => {
      logger.log('[websocket] Client disconnected');
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send({ type: 'error', message: 'Invalid JSON' });
        return;
      }
      const { action, agentId, text, conversationId } = msg;
      const id = agentId != null ? Number(agentId) : null;
      const convId = conversationId != null ? Number(conversationId) : null;
      logger.log('[websocket] message: action=%s agentId=%s conversationId=%s (raw: %s) convId=%s', 
        action, id, conversationId, JSON.stringify(conversationId), convId);

      if (action === 'start') {
        if (id == null || Number.isNaN(id)) {
          send({ type: 'error', message: 'agentId required' });
          return;
        }
        logger.log('[websocket] start: agentId=%s', id);
        const agent = db.prepare('SELECT builtin_key FROM agents WHERE id = ?').get(id);
        if (agent && (agent.builtin_key === 'claude-cli' || agent.builtin_key === 'opencode-cli')) {
          logger.log('[websocket] start: agentId=%s is %s, sending started without spawn', id, agent.builtin_key);
          send({ type: 'started', agentId: id });
          return;
        }
        const ok = agentRunner.run(
          id,
          (() => {
            const throttled = createThrottledOutput(send, id);
            return (stream, data) => throttled.push(stream, data);
          })(),
          (code, signal) => send({ type: 'exit', agentId: id, code, signal })
        );
        if (!ok) {
          logger.log('[websocket] start failed: agentId=%s', id);
          send({ type: 'error', agentId: id, message: 'Start failed (already running or invalid)' });
        } else {
          logger.log('[websocket] start success: agentId=%s', id);
          send({ type: 'started', agentId: id });
        }
        return;
      }

      if (action === 'send') {
        if (id == null || Number.isNaN(id) || typeof text !== 'string') {
          send({ type: 'error', message: 'agentId and text required' });
          return;
        }
        logger.log('[websocket] send: agentId=%s convId=%s', id, convId);
        
        // 存储当前对话 ID 到 WebSocket 上下文
        wsContext.currentConversationId = convId;
        
        // 用户发新消息时重置 A2A 深度计数
        if (convId) {
          a2aTaskManager.clearSessionTasks(`conv-${convId}`);
        }
        
        // 包装 send 函数，自动添加 conversationId
        const sendWithContext = (payload) => {
          send({ ...payload, conversationId: wsContext.currentConversationId });
        };
        
        const agent = db.prepare('SELECT builtin_key FROM agents WHERE id = ?').get(id);
        if (agent && agent.builtin_key === 'claude-cli') {
          logger.log('[websocket] send: agentId=%s is claude-cli, calling runClaudeCli', id);
          (async () => {
            try {
              const throttled = createThrottledOutput(sendWithContext, id);
              
              // 创建调用检测器
              const invocationDetector = createInvocationDetector(id, convId, sendWithContext);
              
              const onOutput = (stream, data) => {
                if (stream === 'stdout' && typeof data === 'string' && data.length > 0) {
                  logger.log('[claude-cli] stdout chunk: %d chars', data.length);
                  
                  // 检测 Agent 调用意图
                  invocationDetector.process(stream, data);
                }
                throttled.push(stream, data);
              };
              const onToolUse = (toolData) => {
                logger.log('[claude-cli] tool_use:', toolData.tool, toolData.title);
                sendWithContext({
                  type: 'tool_use',
                  agentId: id,
                  tool: toolData.tool,
                  title: toolData.title,
                  status: toolData.status,
                  input: toolData.input,
                  output: toolData.output,
                  callID: toolData.callID
                });
              };
              const onExit = (code, signal) => {
                throttled.flush();
                logger.log('[claude-cli] exit agentId=%s code=%s signal=%s', id, code, signal);
                sendWithContext({ type: 'exit', agentId: id, code, signal });
                // Agent 退出后检查并执行 A2A 调用
                invocationDetector.onExit();
              };
              const ok = await agentRunner.runClaudeCli(id, text, onOutput, onExit, convId, onToolUse);
              if (!ok) {
                logger.log('[websocket] send: runClaudeCli failed for agentId=%s', id);
                sendWithContext({ type: 'error', agentId: id, message: 'Claude CLI start failed (already running?)' });
              }
            } catch (err) {
              logger.error('[websocket] runClaudeCli error:', err);
              sendWithContext({ type: 'error', agentId: id, message: String(err?.message || err) });
            }
          })();
          return;
        }
        if (agent && agent.builtin_key === 'opencode-cli') {
          logger.log('[websocket] send: agentId=%s is opencode-cli, calling runOpencodeCli', id);
          try {
            const throttled = createThrottledOutput(sendWithContext, id);
            
            // 创建调用检测器
            const invocationDetector = createInvocationDetector(id, convId, sendWithContext);
            
            const onOutput = (stream, data) => {
              if (stream === 'stdout' && typeof data === 'string' && data.length > 0) {
                logger.log('[opencode-cli] stdout chunk:', data.length, 'chars');
                
                // 检测 Agent 调用意图
                invocationDetector.process(stream, data);
              }
              throttled.push(stream, data);
            };
            const onToolUse = (toolData) => {
              logger.log('[opencode-cli] tool_use:', toolData.tool, toolData.title);
              sendWithContext({
                type: 'tool_use',
                agentId: id,
                tool: toolData.tool,
                title: toolData.title,
                status: toolData.status,
                input: toolData.input,
                output: toolData.output,
                callID: toolData.callID
              });
            };
            const onExit = (code, signal) => {
              throttled.flush();
              logger.log('[opencode-cli] exit agentId=%s code=%s signal=%s', id, code, signal);
              sendWithContext({ type: 'exit', agentId: id, code, signal });
              // Agent 退出后检查并执行 A2A 调用
              invocationDetector.onExit();
            };
            const ok = agentRunner.runOpencodeCli(id, text, onOutput, onExit, convId, onToolUse);
            if (!ok) {
              logger.log('[websocket] send: runOpencodeCli failed for agentId=%s', id);
              sendWithContext({ type: 'error', agentId: id, message: 'Opencode CLI start failed (already running?)' });
            }
          } catch (err) {
            logger.error('[websocket] runOpencodeCli error:', err);
            sendWithContext({ type: 'error', agentId: id, message: String(err?.message || err) });
          }
          return;
        }
        logger.log('[websocket] send: agentId=%s is regular agent, calling sendInput', id);
        
        // 对于常规 Agent，也需要包装输出回调
        const agentProc = agentRunner.getProcess(id);
        if (agentProc) {
          // 如果进程已存在，直接发送输入
          const ok = agentRunner.sendInput(id, text);
          if (!ok) {
            logger.log('[websocket] send: sendInput failed for agentId=%s', id);
            send({ type: 'error', agentId: id, message: 'Agent not running or stdin closed' });
          }
        } else {
          // 启动新进程，包装回调
          const throttled = createThrottledOutput(
            (payload) => send({ ...payload, conversationId: convId }), 
            id
          );
          
          const ok = agentRunner.run(
            id,
            (stream, data) => throttled.push(stream, data),
            (code, signal) => {
              throttled.flush();
              send({ type: 'exit', agentId: id, code, signal, conversationId: convId });
            }
          );
          
          if (!ok) {
            logger.log('[websocket] send: run failed for agentId=%s', id);
            send({ type: 'error', agentId: id, message: 'Failed to start agent' });
          } else {
            // 发送输入
            setTimeout(() => {
              agentRunner.sendInput(id, text);
            }, 100);
          }
        }
        return;
      }

      if (action === 'stop') {
        if (id == null || Number.isNaN(id)) {
          send({ type: 'error', message: 'agentId required' });
          return;
        }
        logger.log('[websocket] stop: agentId=%s', id);
        const ok = agentRunner.stop(id);
        logger.log('[websocket] stop result: agentId=%s ok=%s', id, ok);
        send({ type: 'stopped', agentId: id, ok });
        return;
      }

      if (action === 'status') {
        const running = agentRunner.getRunningAgentIds();
        send({ type: 'status', running });
        return;
      }

      send({ type: 'error', message: 'Unknown action' });
    });

    const running = agentRunner.getRunningAgentIds();
    send({ type: 'status', running });
  });
}
