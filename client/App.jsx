import { useState, useRef } from 'react';
import TaskPanel from './components/TaskPanel';
import ChatPanel from './components/ChatPanel';
import RightPanel from './components/RightPanel';
import { useAgents } from './hooks/useAgents';
import { useTasks } from './hooks/useTasks';
import { useWs } from './hooks/useWs';
import logger from './utils/logger';
import './App.css';

const API = '/api';

export default function App() {
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [streaming, setStreaming] = useState({});
  const [streamingAgentId, setStreamingAgentId] = useState(null);
  const streamingRef = useRef({});

  const { agents, refetch: refetchAgents } = useAgents();
  const { tasks, loading: tasksLoading, refetch: refetchTasks } = useTasks();
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
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
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
          selectedTaskId={selectedTaskId}
          wsReady={ready}
          runningAgentIds={runningAgentIds}
          streamingContent={getStreamingContent()}
          streamingAgentId={streamingAgentId}
          onStart={sendStart}
          onStop={sendStop}
          onSendText={sendText}
        />
      </main>
      <aside className="panel panel-right">
        <RightPanel
          agents={agents}
          runningAgentIds={runningAgentIds}
          wsReady={ready}
          refetchAgents={refetchAgents}
          selectedTaskId={selectedTaskId}
        />
      </aside>
    </div>
  );
}
