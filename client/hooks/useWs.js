import { useState, useEffect, useRef, useCallback } from 'react';
import logger from '../utils/logger';

const getWsUrl = () => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  if (window.location.port === '5173') {
    return `${proto}//${host.replace(/5173$/, '3000')}/ws`;
  }
  return `${proto}//${host}/ws`;
};

export function useWs(options = {}) {
  const { onOutput, onExit, onError, onToolUse, onA2AOutput, onA2AComplete, onA2AStart } = options;
  const [ready, setReady] = useState(false);
  const [runningAgentIds, setRunningAgentIds] = useState([]);
  const [lastError, setLastError] = useState(null);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const callbacksRef = useRef({ onOutput, onExit, onError, onToolUse, onA2AOutput, onA2AComplete, onA2AStart });
  callbacksRef.current = { onOutput, onExit, onError, onToolUse, onA2AOutput, onA2AComplete, onA2AStart };

  const connect = useCallback(() => {
    const url = getWsUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setReady(true);
    ws.onclose = () => {
      setReady(false);
      setRunningAgentIds([]);
      reconnectRef.current = setTimeout(connect, 2000);
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        logger.log('[useWs] received message:', msg.type, msg);
        
        // 提取 conversationId（如果存在）
        const msgConversationId = msg.conversationId != null ? Number(msg.conversationId) : null;
        
        if (msg.type === 'status' && Array.isArray(msg.running)) {
          setRunningAgentIds(msg.running);
        }
        if (msg.type === 'exit' && msg.agentId != null) {
          logger.log('[useWs] exit event for agentId:', msg.agentId, 'code:', msg.code, 'signal:', msg.signal, 'conversationId:', msgConversationId);
          setRunningAgentIds((prev) => prev.filter((id) => id !== msg.agentId));
          callbacksRef.current.onExit?.(msg.agentId, msg.code, msg.signal, msgConversationId);
        }
        if (msg.type === 'started' && msg.agentId != null) {
          logger.log('[useWs] started event for agentId:', msg.agentId);
          setRunningAgentIds((prev) =>
            prev.includes(msg.agentId) ? prev : [...prev, msg.agentId]
          );
        }
        if (msg.type === 'stopped' && msg.agentId != null && msg.ok) {
          logger.log('[useWs] stopped event for agentId:', msg.agentId);
          setRunningAgentIds((prev) => prev.filter((id) => id !== msg.agentId));
        }
        if (msg.type === 'output' && msg.agentId != null) {
          logger.log('[useWs] output event for agentId:', msg.agentId, 'stream:', msg.stream, 'data length:', msg.data?.length || 0, 'conversationId:', msgConversationId);
          callbacksRef.current.onOutput?.(msg.agentId, msg.stream, msg.data, msgConversationId);
        }
        if (msg.type === 'tool_use' && msg.agentId != null) {
          logger.log('[useWs] tool_use event for agentId:', msg.agentId, 'tool:', msg.tool, 'title:', msg.title, 'conversationId:', msgConversationId);
          callbacksRef.current.onToolUse?.(msg.agentId, {
            tool: msg.tool,
            title: msg.title,
            status: msg.status,
            input: msg.input,
            output: msg.output,
            callID: msg.callID
          }, msgConversationId);
        }
        if (msg.type === 'error') {
          logger.log('[useWs] error event:', msg.message, 'conversationId:', msgConversationId);
          setLastError(msg.message || 'Unknown error');
          callbacksRef.current.onError?.(msg, msgConversationId);
        }
        if (msg.type === 'a2a_invocation_start') {
          logger.log('[useWs] a2a_invocation_start: taskId=%s targetAgentId=%s', msg.taskId, msg.targetAgentId);
          setRunningAgentIds((prev) =>
            prev.includes(msg.targetAgentId) ? prev : [...prev, msg.targetAgentId]
          );
          callbacksRef.current.onA2AStart?.(msg);
        }
        if (msg.type === 'a2a_output') {
          logger.log('[useWs] a2a_output: taskId=%s agentId=%s conversationId=%s', msg.taskId, msg.agentId, msg.conversationId);
          callbacksRef.current.onA2AOutput?.(msg);
        }
        if (msg.type === 'a2a_invocation_complete') {
          logger.log('[useWs] a2a_invocation_complete: taskId=%s status=%s agentId=%s conversationId=%s', msg.taskId, msg.status, msg.agentId, msg.conversationId);
          if (msg.agentId != null) {
            setRunningAgentIds((prev) => prev.filter((id) => id !== msg.agentId));
          }
          callbacksRef.current.onA2AComplete?.(msg);
        }
      } catch (e) {
        logger.error('[useWs] failed to parse message:', e);
        setLastError(String(e));
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  const send = useCallback((payload) => {
    logger.log('[useWs] sending:', payload);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    } else {
      logger.warn('[useWs] WebSocket not ready, cannot send:', payload);
    }
  }, []);

  const sendStart = useCallback((agentId) => send({ action: 'start', agentId }), [send]);
  const sendStop = useCallback((agentId) => send({ action: 'stop', agentId }), [send]);
  const sendText = useCallback(
    (agentId, text, conversationId) => {
      logger.log('[useWs] sendText: agentId=%s conversationId=%s', agentId, conversationId);
      send({ action: 'send', agentId, text, conversationId });
    },
    [send]
  );

  return {
    ws: wsRef.current,
    ready,
    runningAgentIds,
    lastError,
    clearError: useCallback(() => setLastError(null), []),
    sendStart,
    sendStop,
    sendText,
  };
}
