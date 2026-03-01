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
  // 流式输出状态按 conversationId 隔离存储
  const [streamingByConversation, setStreamingByConversation] = useState({});
  const [streamingAgentIdByConversation, setStreamingAgentIdByConversation] = useState({});
  const [streamingToolCallsByConversation, setStreamingToolCallsByConversation] = useState({});
  const streamingRefByConversation = useRef({});

  // 获取当前会话的流式输出状态
  const streaming = useMemo(() => {
    return streamingByConversation[selectedConversationId] || {};
  }, [streamingByConversation, selectedConversationId]);

  const streamingAgentId = useMemo(() => {
    return streamingAgentIdByConversation[selectedConversationId] || null;
  }, [streamingAgentIdByConversation, selectedConversationId]);

  const streamingToolCalls = useMemo(() => {
    return streamingToolCallsByConversation[selectedConversationId] || {};
  }, [streamingToolCallsByConversation, selectedConversationId]);

  const streamingRef = useMemo(() => {
    if (!streamingRefByConversation.current[selectedConversationId]) {
      streamingRefByConversation.current[selectedConversationId] = {};
    }
    return {
      current: streamingRefByConversation.current[selectedConversationId],
    };
  }, [selectedConversationId]);

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
      // 使用消息中的 conversationId，否则使用当前选中的 conversationId
      const targetConversationId = msgConversationId != null ? msgConversationId : selectedConversationId;
      
      // 过滤非当前对话的消息（如果消息指定了 conversationId）
      if (msgConversationId != null && msgConversationId !== selectedConversationId) {
        logger.log('[App] onOutput: ignoring message for different conversation: %s vs current %s', 
          msgConversationId, selectedConversationId);
        return;
      }
      
      const str = typeof data === 'string' ? data : String(data ?? '');
      
      // 更新对应会话的流式输出状态
      setStreamingByConversation((prev) => {
        const prevConv = prev[targetConversationId] || {};
        const prevContent = prevConv[agentId] || '';
        return {
          ...prev,
          [targetConversationId]: {
            ...prevConv,
            [agentId]: prevContent + str,
          },
        };
      });
      
      // 更新 ref
      if (!streamingRefByConversation.current[targetConversationId]) {
        streamingRefByConversation.current[targetConversationId] = {};
      }
      streamingRefByConversation.current[targetConversationId][agentId] = 
        (streamingRefByConversation.current[targetConversationId][agentId] || '') + str;
      
      // 更新当前会话的活跃 Agent
      setStreamingAgentIdByConversation((prev) => ({
        ...prev,
        [selectedConversationId]: agentId, // 注意：这里是当前选中的会话
      }));
    },
    onToolUse(agentId, toolData, msgConversationId) {
      const targetConversationId = msgConversationId != null ? msgConversationId : selectedConversationId;
      
      // 过滤非当前对话的消息
      if (msgConversationId != null && msgConversationId !== selectedConversationId) {
        logger.log('[App] onToolUse: ignoring message for different conversation: %s vs current %s', 
          msgConversationId, selectedConversationId);
        return;
      }
      
      logger.log('[App] onToolUse: agentId=%s tool=%s status=%s', agentId, toolData.tool, toolData.status);
      
      setStreamingToolCallsByConversation((prev) => {
        const prevConv = prev[targetConversationId] || {};
        return {
          ...prev,
          [targetConversationId]: {
            ...prevConv,
            [agentId]: [...(prevConv[agentId] || []), toolData],
          },
        };
      });
      
      setStreamingAgentIdByConversation((prev) => ({
        ...prev,
        [selectedConversationId]: agentId, // 注意：这里是当前选中的会话
      }));
    },
    onExit(agentId, code, signal, msgConversationId) {
      // 获取消息所属的会话 ID（如果存在）
      const targetConversationId = msgConversationId != null ? msgConversationId : selectedConversationId;
      
      logger.log('[App] onExit: agentId=%s selectedConversationId=%s msgConversationId=%s targetConversationId=%s', 
        agentId, selectedConversationId, msgConversationId, targetConversationId);
      
      // 获取该会话的流式内容
      const convRef = streamingRefByConversation.current[targetConversationId] || {};
      const content = convRef[agentId] || '';
      
      const convToolCalls = streamingToolCallsByConversation[targetConversationId] || {};
      const toolCalls = convToolCalls[agentId] || [];
      
      logger.log('[App] onExit: saving assistant message, content.length=%d toolCalls=%d conversationId=%d', 
        content.length, toolCalls.length, targetConversationId);

      const agent = agents.find((a) => a.id === agentId);
      const agentName = agent?.name || 'Agent';

      // 保存消息到对应会话
      if (content.trim() || toolCalls.length > 0) {
        fetch(`${API}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'assistant',
            content,
            agent_id: agentId,
            agent_name: agentName,
            task_id: targetConversationId,
            metadata: toolCalls.length > 0 ? JSON.stringify({ tool_calls: toolCalls }) : null,
          }),
        }).catch((err) => {
          logger.error('[App] failed to save assistant message:', err);
        });
      }
      
      // 清理该会话的流式状态
      delete streamingRefByConversation.current[targetConversationId]?.[agentId];
      
      // 更新对应会话的流式内容状态
      setStreamingByConversation((prev) => {
        const prevConv = prev[targetConversationId] || {};
        const { [agentId]: _, ...rest } = prevConv;
        return {
          ...prev,
          [targetConversationId]: rest,
        };
      });
      
      setStreamingToolCallsByConversation((prev) => {
        const prevConv = prev[targetConversationId] || {};
        const { [agentId]: _, ...rest } = prevConv;
        return {
          ...prev,
          [targetConversationId]: rest,
        };
      });
      
      // 清理对应会话的活跃 Agent 状态
      setStreamingAgentIdByConversation((prev) => {
        const prevAgent = prev[targetConversationId];
        if (prevAgent === agentId) {
          const { [targetConversationId]: _, ...rest } = prev;
          return rest;
        }
        return prev;
      });
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
