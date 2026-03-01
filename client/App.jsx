import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import TaskPanel from './components/TaskPanel';
import ChatPanel from './components/ChatPanel';
import RightPanel from './components/RightPanel';
import { useAgents } from './hooks/useAgents';
import { useTasks } from './hooks/useTasks';
import { useWs } from './hooks/useWs';
import logger from './utils/logger';
import './App.css';

const API = '/api';
const DEFAULT_CONVERSATION_TITLE = '创世碎碎念';

export default function App() {
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [streaming, setStreaming] = useState({});
  const [streamingAgentId, setStreamingAgentId] = useState(null);
  const [streamingToolCalls, setStreamingToolCalls] = useState({});
  const streamingRef = useRef({});

  const { agents, refetch: refetchAgents } = useAgents();
  const { tasks, loading: tasksLoading, refetch: refetchTasks } = useTasks();

  // 默认选中"创世碎碎念"对话
  useEffect(() => {
    logger.log('[App] useEffect: tasksLoading=%s tasks.length=%d selectedConversationId=%s',
      tasksLoading, tasks.length, selectedConversationId);
    if (!tasksLoading && tasks.length > 0 && !selectedConversationId) {
      const defaultConv = tasks.find(t => t.title === DEFAULT_CONVERSATION_TITLE);
      if (defaultConv) {
        logger.log('[App] setting default conversation: %d', defaultConv.id);
        setSelectedConversationId(defaultConv.id);
      } else if (tasks.length > 0) {
        logger.log('[App] setting first conversation: %d', tasks[0].id);
        setSelectedConversationId(tasks[0].id);
      }
    }
  }, [tasks, tasksLoading, selectedConversationId]);

  // Get current conversation object
  const currentConversation = useMemo(
    () => tasks.find(t => t.id === selectedConversationId),
    [tasks, selectedConversationId]
  );

  const { ready, runningAgentIds, lastError, clearError, sendStart, sendStop, sendText } = useWs({
    onOutput(agentId, stream, data, msgConversationId) {
      // 过滤非当前对话的消息
      if (msgConversationId != null && msgConversationId !== selectedConversationId) {
        logger.log('[App] onOutput: ignoring message for different conversation: %s vs current %s', 
          msgConversationId, selectedConversationId);
        return;
      }
      
      const str = typeof data === 'string' ? data : String(data ?? '');
      const prev = streamingRef.current[agentId] || '';
      const nextContent = prev + str;
      streamingRef.current[agentId] = nextContent;
      // 直接更新状态，服务端已有 80ms 节流
      setStreaming((s) => ({ ...s, [agentId]: nextContent }));
      setStreamingAgentId(agentId);
    },
    onToolUse(agentId, toolData, msgConversationId) {
      // 过滤非当前对话的消息
      if (msgConversationId != null && msgConversationId !== selectedConversationId) {
        logger.log('[App] onToolUse: ignoring message for different conversation: %s vs current %s', 
          msgConversationId, selectedConversationId);
        return;
      }
      
      logger.log('[App] onToolUse: agentId=%s tool=%s status=%s', agentId, toolData.tool, toolData.status);
      setStreamingToolCalls((prev) => ({
        ...prev,
        [agentId]: [...(prev[agentId] || []), toolData],
      }));
      setStreamingAgentId(agentId);
    },
    onExit(agentId, code, signal, msgConversationId) {
      logger.log('[App] onExit: agentId=%s selectedConversationId=%s msgConversationId=%s', 
        agentId, selectedConversationId, msgConversationId);
      
      // 如果消息指定了 conversationId 但不匹配当前对话，不处理
      if (msgConversationId != null && msgConversationId !== selectedConversationId) {
        logger.log('[App] onExit: ignoring exit for different conversation: %s vs current %s', 
          msgConversationId, selectedConversationId);
        // 仍然清理本地状态，但不保存消息
        delete streamingRef.current[agentId];
        setStreaming((s) => {
          const o = { ...s };
          delete o[agentId];
          return o;
        });
        setStreamingToolCalls((prev) => {
          const o = { ...prev };
          delete o[agentId];
          return o;
        });
        if (streamingAgentId === agentId) {
          setStreamingAgentId(null);
        }
        return;
      }

      const content = streamingRef.current[agentId] || '';
      const toolCalls = streamingToolCalls[agentId] || [];
      logger.log('[App] onExit: saving assistant message, content.length=%d toolCalls=%d', content.length, toolCalls.length);

      const agent = agents.find((a) => a.id === agentId);
      const agentName = agent?.name || 'Agent';

      if (content.trim() || toolCalls.length > 0) {
        fetch(`${API}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'assistant',
            content,
            agent_id: agentId,
            agent_name: agentName,
            task_id: selectedConversationId,
            metadata: toolCalls.length > 0 ? JSON.stringify({ tool_calls: toolCalls }) : null,
          }),
        }).catch((err) => {
          logger.error('[App] failed to save assistant message:', err);
        });
      }
      delete streamingRef.current[agentId];
      setStreaming((s) => {
        const o = { ...s };
        delete o[agentId];
        return o;
      });
      setStreamingToolCalls((prev) => {
        const o = { ...prev };
        delete o[agentId];
        return o;
      });
      if (streamingAgentId === agentId) {
        setStreamingAgentId(null);
      }
    },
  });

  const handleSendText = useCallback((agentId, text, conversationId) => {
    logger.log('[App] handleSendText: agentId=%s text.length=%d conversationId=%s', agentId, text.length, conversationId);
    sendText(agentId, text, conversationId);
  }, [sendText]);

  const streamingContent = useMemo(
    () => (streamingAgentId && streaming[streamingAgentId]) ? streaming[streamingAgentId] : '',
    [streamingAgentId, streaming]
  );

  const currentStreamingToolCalls = useMemo(
    () => (streamingAgentId && streamingToolCalls[streamingAgentId]) ? streamingToolCalls[streamingAgentId] : [],
    [streamingAgentId, streamingToolCalls]
  );

  return (
    <div className="app">
      <aside className="panel panel-left">
        <TaskPanel
          tasks={tasks}
          loading={tasksLoading}
          refetch={refetchTasks}
          selectedTaskId={selectedConversationId}
          onSelectTask={setSelectedConversationId}
        />
      </aside>
      <main className="panel panel-center">
        {lastError && (
          <div className="app-error" role="alert">
            {lastError}
            <button type="button" onClick={clearError}>关闭</button>
          </div>
        )}
        <ChatPanel
          agents={agents}
          selectedTaskId={selectedConversationId}
          wsReady={ready}
          runningAgentIds={runningAgentIds}
          streamingContent={streamingContent}
          streamingToolCalls={currentStreamingToolCalls}
          streamingAgentId={streamingAgentId}
          onStart={sendStart}
          onStop={sendStop}
          onSendText={handleSendText}
          currentConversation={currentConversation}
        />
      </main>
      <aside className="panel panel-right">
        <RightPanel
          agents={agents}
          runningAgentIds={runningAgentIds}
          wsReady={ready}
          refetchAgents={refetchAgents}
          selectedTaskId={selectedConversationId}
        />
      </aside>
    </div>
  );
}
