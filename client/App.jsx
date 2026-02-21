import { useState, useRef, useEffect } from 'react';
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
  const streamingRef = useRef({});

  const { agents, refetch: refetchAgents } = useAgents();
  const { tasks, loading: tasksLoading, refetch: refetchTasks } = useTasks();

  // 默认选中"创世碎碎念"对话
  useEffect(() => {
    if (!tasksLoading && tasks.length > 0 && !selectedConversationId) {
      const defaultConv = tasks.find(t => t.title === DEFAULT_CONVERSATION_TITLE);
      if (defaultConv) {
        setSelectedConversationId(defaultConv.id);
      } else if (tasks.length > 0) {
        setSelectedConversationId(tasks[0].id);
      }
    }
  }, [tasks, tasksLoading, selectedConversationId]);

  // Get current conversation object
  const currentConversation = tasks.find(t => t.id === selectedConversationId);
  const { ready, runningAgentIds, lastError, clearError, sendStart, sendStop, sendText } = useWs({
    onOutput(agentId, stream, data) {
      logger.log('[App] onOutput: agentId=%s stream=%s data.length=%d', agentId, stream, data?.length || 0);
      const str = typeof data === 'string' ? data : String(data ?? '');
      const prev = streamingRef.current[agentId] || '';
      const nextContent = prev + str;
      streamingRef.current = { ...streamingRef.current, [agentId]: nextContent };
      setStreaming((s) => ({ ...s, [agentId]: nextContent }));
      setStreamingAgentId(agentId);
    },
    onExit(agentId) {
      logger.log('[App] onExit: agentId=%s', agentId);
      const content = streamingRef.current[agentId] || '';
      logger.log('[App] onExit: saving assistant message, content.length=%d', content.length);

      const agent = agents.find((a) => a.id === agentId);
      const agentName = agent?.name || 'Agent';

      if (content.trim()) {
        fetch(`${API}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'assistant',
            content,
            agent_id: agentId,
            agent_name: agentName,
            task_id: selectedConversationId,
          }),
        }).catch((err) => {
          logger.error('[App] failed to save assistant message:', err);
        });
      }
      const next = { ...streamingRef.current };
      delete next[agentId];
      streamingRef.current = next;
      setStreaming((s) => {
        const o = { ...s };
        delete o[agentId];
        return o;
      });
      if (streamingAgentId === agentId) {
        setStreamingAgentId(null);
      }
    },
  });

  const getStreamingContent = () => {
    if (streamingAgentId && streaming[streamingAgentId]) {
      return streaming[streamingAgentId];
    }
    return '';
  };

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
          streamingContent={getStreamingContent()}
          streamingAgentId={streamingAgentId}
          onStart={sendStart}
          onStop={sendStop}
          onSendText={sendText}
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
