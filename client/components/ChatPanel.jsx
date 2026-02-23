import { useState, useRef, useEffect } from 'react';
import { useGlobalMessages } from '../hooks/useGlobalMessages';
import { MarkdownRenderer, ThinkingMessage } from './MarkdownRenderer';
import logger from '../utils/logger';
import './ChatPanel.css';

const API = '/api';

export default function ChatPanel({
  agents,
  selectedTaskId,
  wsReady,
  runningAgentIds,
  streamingContent,
  streamingAgentId,
  onStart,
  onStop,
  onSendText,
  currentConversation,
}) {
  const [input, setInput] = useState('');
  const [mentionState, setMentionState] = useState({ active: false, query: '', start: 0, selectedIndex: 0 });
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const prevStreamingRef = useRef('');
  const { messages, refetch, addMessage } = useGlobalMessages(selectedTaskId);

  const filteredAgents = mentionState.active
    ? agents.filter((a) => a.name.toLowerCase().includes(mentionState.query.toLowerCase()))
    : [];

  useEffect(() => {
    if (prevStreamingRef.current && !streamingContent) {
      refetch();
    }
    prevStreamingRef.current = streamingContent;
  }, [streamingContent, refetch]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const parseTargetAgent = (text) => {
    if (!text.startsWith('@')) {
      return null;
    }

    const textWithoutAt = text.slice(1);
    const sortedAgents = [...agents].sort((a, b) => b.name.length - a.name.length);

    for (const agent of sortedAgents) {
      const nameLower = agent.name.toLowerCase();
      const textLower = textWithoutAt.toLowerCase();

      if (textLower.startsWith(nameLower)) {
        const afterName = textWithoutAt.slice(agent.name.length);
        if (afterName === '' || afterName.startsWith(' ')) {
          return {
            agent,
            textWithoutMention: afterName.trimStart(),
          };
        }
      }
    }

    return null;
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setInput(value);

    const textBeforeCursor = value.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(atIndex + 1);
      const hasSpace = textAfterAt.includes(' ');

      if (!hasSpace) {
        setMentionState({
          active: true,
          query: textAfterAt,
          start: atIndex,
          selectedIndex: 0,
        });
        return;
      }
    }
    setMentionState((s) => ({ ...s, active: false }));
  };

  const selectMention = (agent) => {
    const before = input.slice(0, mentionState.start);
    const after = input.slice(inputRef.current.selectionStart);
    const newText = `${before}@${agent.name} ${after}`;
    setInput(newText);
    setMentionState((s) => ({ ...s, active: false }));
    setTimeout(() => {
      const newPos = before.length + agent.name.length + 2;
      inputRef.current?.setSelectionRange(newPos, newPos);
      inputRef.current?.focus();
    }, 0);
  };

  const handleKeyDown = (e) => {
    if (mentionState.active && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionState((s) => ({
          ...s,
          selectedIndex: (s.selectedIndex + 1) % filteredAgents.length,
        }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionState((s) => ({
          ...s,
          selectedIndex: s.selectedIndex === 0 ? filteredAgents.length - 1 : s.selectedIndex - 1,
        }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMention(filteredAgents[mentionState.selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setMentionState((s) => ({ ...s, active: false }));
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    logger.log('[ChatPanel] send() called, selectedTaskId=%s', selectedTaskId);
    if (!selectedTaskId) {
      logger.warn('[ChatPanel] No conversation selected, cannot send');
      return;
    }

    const parsed = parseTargetAgent(text);

    setInput('');
    setMentionState((s) => ({ ...s, active: false }));

    if (parsed) {
      const { agent, textWithoutMention } = parsed;
      if (!textWithoutMention.trim()) {
        setInput(`@${agent.name} `);
        return;
      }

      try {
        const res = await fetch(`${API}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'user',
            content: text,
            agent_id: agent.id,
            agent_name: agent.name,
            task_id: selectedTaskId || null,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          addMessage(data);
        } else {
          logger.error('[ChatPanel] Failed to save user message:', res.status, res.statusText);
        }
      } catch (err) {
        logger.error('[ChatPanel] Error saving user message:', err);
      }

      logger.log('[ChatPanel] sending to agent %d, selectedTaskId=%s', agent.id, selectedTaskId);
      onStart(agent.id);
      onSendText(agent.id, textWithoutMention.trim(), selectedTaskId);
    } else {
      try {
        const res = await fetch(`${API}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'user',
            content: text,
            agent_id: null,
            agent_name: null,
            task_id: selectedTaskId || null,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          addMessage(data);
        } else {
          logger.error('[ChatPanel] Failed to save note message:', res.status, res.statusText);
        }
      } catch (err) {
        logger.error('[ChatPanel] Error saving note message:', err);
      }
    }
  };

  const stopAgent = (agentId) => {
    onStop(agentId);
  };

  const getStreamingAgent = () => {
    if (streamingAgentId) {
      return agents.find((a) => a.id === streamingAgentId);
    }
    return null;
  };

  const streamingAgent = getStreamingAgent();

  return (
    <div className="chat-panel">
      <header className={`chat-header ${currentConversation ? 'has-conversation' : ''}`}>
        <div className="chat-header-title">
          <span className="chat-title">
            {currentConversation ? currentConversation.title : '统一聊天'}
          </span>
          {currentConversation?.group_name && (
            <span className="chat-conversation-group">{currentConversation.group_name}</span>
          )}
        </div>
        {!wsReady && <span className="chat-ws-badge">连接中...</span>}
        {wsReady && runningAgentIds.length > 0 && (
          <span className="chat-ws-badge running">
            {runningAgentIds.length} 个 Agent 运行中
          </span>
        )}
      </header>
      <div className="chat-messages">
        {!currentConversation && (
          <div className="chat-empty-state">
            <div className="chat-empty-icon">💬</div>
            <div className="chat-empty-title">选择一个对话开始聊天</div>
            <div className="chat-empty-desc">从左侧对话列表中选择一个对话，或创建新对话</div>
          </div>
        )}
        {currentConversation && (messages || []).filter(Boolean).map((m) => {
          // Thinking 消息单独渲染为折叠面板
          if (m.message_type === 'thinking') {
            return (
              <ThinkingMessage
                key={m.id}
                content={m.content}
                agentName={m.agent_name || 'Agent'}
              />
            );
          }

          // 普通消息使用 Markdown 渲染
          return (
            <div key={m.id} className={`chat-msg chat-msg-${m.role || 'assistant'}`}>
              <span className="chat-msg-role">
                {m.role === 'user' ? '用户' : `@${m.agent_name || 'Agent'}`}
              </span>
              <div className="chat-msg-content markdown-content">
                <MarkdownRenderer content={m.content ?? ''} />
              </div>
            </div>
          );
        })}
        {currentConversation && streamingContent && streamingAgent && (
          <div className="chat-msg chat-msg-assistant">
            <span className="chat-msg-role">@{streamingAgent.name}</span>
            <div className="chat-msg-content chat-msg-streaming">
              <MarkdownRenderer content={streamingContent} />
            </div>
          </div>
        )}
        {currentConversation && <div ref={messagesEndRef} />}
      </div>
      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              currentConversation 
                ? "输入消息，使用 @AgentName 调用 Agent..." 
                : "请先选择或创建一个对话"
            }
            rows={2}
            disabled={!wsReady || !currentConversation}
          />
          {mentionState.active && filteredAgents.length > 0 && (
            <div className="mention-dropdown">
              {filteredAgents.map((agent, index) => (
                <div
                  key={agent.id}
                  className={`mention-item ${index === mentionState.selectedIndex ? 'selected' : ''}`}
                  onClick={() => selectMention(agent)}
                  onMouseEnter={() => setMentionState((s) => ({ ...s, selectedIndex: index }))}
                >
                  <span className="mention-item-avatar">@</span>
                  <span className="mention-item-name">{agent.name}</span>
                  {runningAgentIds.includes(agent.id) && (
                    <span className="mention-item-status">运行中</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {mentionState.active && filteredAgents.length === 0 && mentionState.query && (
            <div className="mention-dropdown mention-empty">
              无匹配的 Agent
            </div>
          )}
        </div>
        <div className="chat-input-actions">
          {runningAgentIds.length > 0 ? (
            <div className="running-agents-actions">
              {runningAgentIds.map((id) => {
                const agent = agents.find((a) => a.id === id);
                return agent ? (
                  <button
                    key={id}
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => stopAgent(id)}
                  >
                    停止 @{agent.name}
                  </button>
                ) : null;
              })}
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={send}
              disabled={!input.trim() || !wsReady}
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
