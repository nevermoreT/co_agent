import { WebSocketServer } from 'ws';
import * as agentRunner from './services/agentRunner.js';
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

export function setupWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
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
        const agent = db.prepare('SELECT builtin_key FROM agents WHERE id = ?').get(id);
        if (agent && agent.builtin_key === 'claude-cli') {
          logger.log('[websocket] send: agentId=%s is claude-cli, calling runClaudeCli', id);
          (async () => {
            try {
              const throttled = createThrottledOutput(send, id);
              const onOutput = (stream, data) => {
                if (stream === 'stdout' && typeof data === 'string' && data.length > 0) {
                  logger.log('[claude-cli] stdout chunk: %d chars', data.length);
                }
                throttled.push(stream, data);
              };
              const onExit = (code, signal) => {
                throttled.flush();
                logger.log('[claude-cli] exit agentId=%s code=%s signal=%s', id, code, signal);
                send({ type: 'exit', agentId: id, code, signal });
              };
              const ok = await agentRunner.runClaudeCli(id, text, onOutput, onExit, convId);
              if (!ok) {
                logger.log('[websocket] send: runClaudeCli failed for agentId=%s', id);
                send({ type: 'error', agentId: id, message: 'Claude CLI start failed (already running?)' });
              }
            } catch (err) {
              logger.error('[websocket] runClaudeCli error:', err);
              send({ type: 'error', agentId: id, message: String(err?.message || err) });
            }
          })();
          return;
        }
        if (agent && agent.builtin_key === 'opencode-cli') {
          logger.log('[websocket] send: agentId=%s is opencode-cli, calling runOpencodeCli', id);
          try {
            const throttled = createThrottledOutput(send, id);
            const onOutput = (stream, data) => {
              if (stream === 'stdout' && typeof data === 'string' && data.length > 0) {
                logger.log('[opencode-cli] stdout chunk:', data.length, 'chars');
              }
              throttled.push(stream, data);
            };
            const onToolUse = (toolData) => {
              logger.log('[opencode-cli] tool_use:', toolData.tool, toolData.status);
              send({ type: 'tool_use', agentId: id, tool: toolData.tool, title: toolData.title, status: toolData.status, output: toolData.output });
            };
            const onExit = (code, signal) => {
              throttled.flush();
              logger.log('[opencode-cli] exit agentId=%s code=%s signal=%s', id, code, signal);
              send({ type: 'exit', agentId: id, code, signal });
            };
            const ok = agentRunner.runOpencodeCli(id, text, onOutput, onExit, convId, onToolUse);
            if (!ok) {
              logger.log('[websocket] send: runOpencodeCli failed for agentId=%s', id);
              send({ type: 'error', agentId: id, message: 'Opencode CLI start failed (already running?)' });
            }
          } catch (err) {
            logger.error('[websocket] runOpencodeCli error:', err);
            send({ type: 'error', agentId: id, message: String(err?.message || err) });
          }
          return;
        }
        logger.log('[websocket] send: agentId=%s is regular agent, calling sendInput', id);
        const ok = agentRunner.sendInput(id, text);
        if (!ok) {
          logger.log('[websocket] send: sendInput failed for agentId=%s', id);
          send({ type: 'error', agentId: id, message: 'Agent not running or stdin closed' });
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
