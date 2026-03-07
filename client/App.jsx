import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import TaskPanel from './components/TaskPanel';
import ChatPanel from './components/ChatPanel';
import RightPanel from './components/RightPanel';
import { useAgents } from './hooks/useAgents';
import { useTasks } from './hooks/useTasks';
import { useWs } from './hooks/useWs';
import { messageApi } from './services/api.js';
import logger from './utils/logger';
import './App.css';

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
      // 如果消息带有 conversationId，说明这是特定会话的消息
      if (msgConversationId != null) {
        // 即使用户已切换到其他会话，仍应将此消息存储到正确的会话中
        // 这样当用户切换回该会话时，可以看到完整的输出
        
        const str = typeof data === 'string' ? data : String(data ?? '');
        
        // 更新对应会话的流式输出状态
        setStreamingByConversation((prev) => {
          const prevConv = prev[msgConversationId] || {};
          const prevContent = prevConv[agentId] || '';
          return {
            ...prev,
            [msgConversationId]: {
              ...prevConv,
              [agentId]: prevContent + str,
            },
          };
        });
        
        // 更新 ref
        if (!streamingRefByConversation.current[msgConversationId]) {
          streamingRefByConversation.current[msgConversationId] = {};
        }
        streamingRefByConversation.current[msgConversationId][agentId] = 
          (streamingRefByConversation.current[msgConversationId][agentId] || '') + str;
        
        // 如果这是当前选中的会话，则更新活跃 Agent
        if (msgConversationId === selectedConversationId) {
          setStreamingAgentIdByConversation((prev) => ({
            ...prev,
            [selectedConversationId]: agentId,
          }));
        }
      } else {
        // 没有 conversationId 的旧消息，按以前的方式处理（只更新当前会话）
        const str = typeof data === 'string' ? data : String(data ?? '');
        
        setStreamingByConversation((prev) => {
          const prevConv = prev[selectedConversationId] || {};
          const prevContent = prevConv[agentId] || '';
          return {
            ...prev,
            [selectedConversationId]: {
              ...prevConv,
              [agentId]: prevContent + str,
            },
          };
        });
        
        if (!streamingRefByConversation.current[selectedConversationId]) {
          streamingRefByConversation.current[selectedConversationId] = {};
        }
        streamingRefByConversation.current[selectedConversationId][agentId] = 
          (streamingRefByConversation.current[selectedConversationId][agentId] || '') + str;
        
        setStreamingAgentIdByConversation((prev) => ({
          ...prev,
          [selectedConversationId]: agentId,
        }));
      }
    },
    onToolUse(agentId, toolData, msgConversationId) {
      if (msgConversationId != null) {
        setStreamingToolCallsByConversation((prev) => {
          const prevConv = prev[msgConversationId] || {};
          return {
            ...prev,
            [msgConversationId]: {
              ...prevConv,
              [agentId]: [...(prevConv[agentId] || []), toolData],
            },
          };
        });
        
        // 如果这是当前选中的会话，则更新活跃 Agent
        if (msgConversationId === selectedConversationId) {
          setStreamingAgentIdByConversation((prev) => ({
            ...prev,
            [selectedConversationId]: agentId,
          }));
        }
      } else {
        // 没有 conversationId 的旧消息，按以前的方式处理
        setStreamingToolCallsByConversation((prev) => {
          const prevConv = prev[selectedConversationId] || {};
          return {
            ...prev,
            [selectedConversationId]: {
              ...prevConv,
              [agentId]: [...(prevConv[agentId] || []), toolData],
            },
          };
        });
        
        setStreamingAgentIdByConversation((prev) => ({
          ...prev,
          [selectedConversationId]: agentId,
        }));
      }
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
        messageApi.create({
          role: 'assistant',
          content,
          agent_id: agentId,
          agent_name: agentName,
          task_id: targetConversationId,
          metadata: toolCalls.length > 0 ? { tool_calls: toolCalls } : null,
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
    onA2AOutput(msg) {
      const agentId = msg.agentId;
      const str = typeof msg.data === 'string' ? msg.data : String(msg.data ?? '');
      
      // 使用消息中的 conversationId
      const convId = msg.conversationId != null ? Number(msg.conversationId) : selectedConversationId;
      
      logger.log('[App] onA2AOutput: agentId=%s taskId=%s msgConvId=%s selectedConvId=%s convId=%s', 
        msg.agentId, msg.taskId, msg.conversationId, selectedConversationId, convId);
      
      if (!convId) {
        logger.warn('[App] onA2AOutput: convId is null, skipping');
        return;
      }
      
      // 检查 agent 是否存在
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) {
        logger.warn('[App] onA2AOutput: agent not found, agentId=%s agents=%o', agentId, agents.map(a => a.id));
      }
      
      // 更新流式输出
      setStreamingByConversation((prev) => {
        const prevConv = prev[convId] || {};
        const prevContent = prevConv[agentId] || '';
        logger.log('[App] onA2AOutput: updating streaming, prevContent.length=%d newContent.length=%d', 
          prevContent.length, (prevContent + str).length);
        return {
          ...prev,
          [convId]: {
            ...prevConv,
            [agentId]: prevContent + str,
          },
        };
      });
      
      // 更新 ref
      if (!streamingRefByConversation.current[convId]) {
        streamingRefByConversation.current[convId] = {};
      }
      streamingRefByConversation.current[convId][agentId] = 
        (streamingRefByConversation.current[convId][agentId] || '') + str;
      
      // 设置活跃 Agent
      setStreamingAgentIdByConversation((prev) => {
        logger.log('[App] onA2AOutput: setting streamingAgentId for convId=%s to agentId=%s', convId, agentId);
        return {
          ...prev,
          [convId]: agentId,
        };
      });
    },
    onA2AComplete(msg) {
      const agentId = msg.agentId;
      const convId = msg.conversationId != null ? Number(msg.conversationId) : selectedConversationId;
      
      logger.log('[App] onA2AComplete: taskId=%s status=%s agentId=%s convId=%s', msg.taskId, msg.status, agentId, convId);
      
      if (!convId || !agentId) return;
      
      // 获取该会话的流式内容
      const convRef = streamingRefByConversation.current[convId] || {};
      const content = convRef[agentId] || '';
      
      logger.log('[App] onA2AComplete: saving assistant message, content.length=%d conversationId=%d', 
        content.length, convId);

      const agent = agents.find((a) => a.id === agentId);
      const agentName = agent?.name || 'Agent';

      // 保存消息到对应会话
      if (content.trim()) {
        messageApi.create({
          role: 'assistant',
          content,
          agent_id: agentId,
          agent_name: agentName,
          task_id: convId,
        }).catch((err) => {
          logger.error('[App] onA2AComplete: failed to save assistant message:', err);
        });
      }
      
      // 清理该会话的流式状态
      delete streamingRefByConversation.current[convId]?.[agentId];
      
      setStreamingByConversation((prev) => {
        const prevConv = prev[convId] || {};
        const { [agentId]: _, ...rest } = prevConv;
        return {
          ...prev,
          [convId]: rest,
        };
      });
      
      setStreamingAgentIdByConversation((prev) => {
        const prevAgent = prev[convId];
        if (prevAgent === agentId) {
          const { [convId]: _, ...rest } = prev;
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
