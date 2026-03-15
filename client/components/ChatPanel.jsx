import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { useGlobalMessages } from '../hooks/useGlobalMessages';
import { MarkdownRenderer, ThinkingMessage, ToolUseMessage, parseMessageContent } from './MarkdownRenderer';
import logger from '../utils/logger';
import './ChatPanel.css';

const API = '/api';
const VISIBLE_MESSAGE_LIMIT = 100;

// 获取头像首字母和背景色
function getAvatarStyle(name) {
  if (!name) return { initial: '?', color: '#999' };
  const colors = ['#d96c5a', '#4db6a3', '#6d83f5', '#f0a500', '#8b9cf5'];
  const index = name.length % colors.length;
  return {
    initial: name.charAt(0).toUpperCase(),
    backgroundColor: colors[index]
  };
}

function formatMessageTime(isoString) {
  if (!isoString) return '刚刚';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

const ChatMessage = memo(function ChatMessage({ m }) {
  if (m.message_type === 'thinking') {
    return <ThinkingMessage content={m.content} agentName={m.agent_name || 'Agent'} />;
  }

  let toolCalls = [];
  let textParts;
  if (m.metadata) {
    try {
      const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
      if (meta.tool_calls) toolCalls = meta.tool_calls;
    } catch (e) {
      logger.warn('Failed to parse metadata', e);
    }
  }
  
  if (toolCalls.length === 0) {
    const parsed = parseMessageContent(m.content || '');
    toolCalls = parsed.toolCalls;
    textParts = parsed.textParts;
  } else {
    textParts = m.content ? [m.content] : [];
  }

  const isUser = m.role === 'user';
  const senderName = isUser ? '用户' : (m.agent_name || 'Agent');
  const avatar = getAvatarStyle(senderName);

  return (
    <div className={`chat-msg-container ${isUser ? 'user' : 'assistant'}`}>
      <div className="chat-msg-header">
        <span className="msg-sender">{senderName}</span>
        <span className="msg-time">{formatMessageTime(m.created_at)}</span>
      </div>
      <div 
        className={`chat-msg-avatar ${isUser ? 'user' : 'assistant'}`}
        style={!isUser ? { backgroundColor: avatar.backgroundColor } : {}}
      >
        {isUser ? '👤' : avatar.initial}
      </div>
      <div className={`chat-msg chat-msg-${m.role || 'assistant'}`}>
        <div className="chat-msg-content markdown-content">
          {toolCalls.length > 0 && <ToolUseMessage toolCalls={toolCalls} />}
          {textParts.map((text, idx) => (
            <MarkdownRenderer key={idx} content={text} />
          ))}
          {toolCalls.length === 0 && textParts.length === 0 && (
            <MarkdownRenderer content={m.content || ''} />
          )}
        </div>
      </div>
    </div>
  );
});

function StreamingMessage({ content, agentName, toolCalls: externalToolCalls }) {
  const { toolCalls: parsedToolCalls, textParts } = parseMessageContent(content || '');
  const toolCalls = externalToolCalls && externalToolCalls.length > 0 ? externalToolCalls : parsedToolCalls;
  const avatar = getAvatarStyle(agentName);

  return (
    <div className="chat-msg-container assistant">
      <div className="chat-msg-header">
        <span className="msg-sender">{agentName}</span>
        <span className="msg-time">正在输入...</span>
      </div>
      <div className="chat-msg-avatar assistant" style={{ backgroundColor: avatar.backgroundColor }}>
        {avatar.initial}
      </div>
      <div className="chat-msg chat-msg-assistant">
        <div className="chat-msg-content chat-msg-streaming">
          {toolCalls.length > 0 && <ToolUseMessage toolCalls={toolCalls} />}
          {textParts.map((text, idx) => (
            <MarkdownRenderer key={idx} content={text} />
          ))}
          {toolCalls.length === 0 && textParts.length === 0 && (
            <MarkdownRenderer content={content || ''} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChatPanel({
  agents, selectedTaskId, wsReady, runningAgentIds, streamingContent, streamingToolCalls, streamingAgentId, onStart, onStop, onSendText, currentConversation,
}) {
  const [input, setInput] = useState('');
  const [mentionState, setMentionState] = useState({ active: false, query: '', start: 0, selectedIndex: 0 });
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const prevStreamingRef = useRef('');
  const { messages, refetch, addMessage } = useGlobalMessages(selectedTaskId);

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => b.name.length - a.name.length),
    [agents]
  );

  const filteredAgents = useMemo(
    () => mentionState.active
      ? agents.filter((a) => a.name.toLowerCase().includes(mentionState.query.toLowerCase()))
      : [],
    [agents, mentionState.active, mentionState.query]
  );

  useEffect(() => {
    // Periodically refresh messages to ensure UI reflects latest chat content
    const interval = setInterval(() => {
      refetch();
    }, 5000);
    return () => clearInterval(interval);
  }, [refetch]);

  useEffect(() => {
    if (prevStreamingRef.current && !streamingContent) {
      refetch();
    }
    prevStreamingRef.current = streamingContent;
  }, [streamingContent, refetch]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const parseTargetAgent = useCallback((text) => {
    // Find the last '@' to support mentions anywhere in the text
    const atIdx = text.lastIndexOf('@');
    if (atIdx === -1) {
      return null;
    }
    const beforeMention = text.slice(0, atIdx).trim();
    const textWithoutAt = text.slice(atIdx + 1);

    for (const agent of sortedAgents) {
      const nameLower = agent.name.toLowerCase();
      const textLower = textWithoutAt.toLowerCase();

      if (textLower.startsWith(nameLower)) {
        const afterName = textWithoutAt.slice(agent.name.length);
        if (afterName === '' || afterName.startsWith(' ')) {
          // Combine text before @ and text after agent name
          const afterText = afterName.trimStart();
          const combined = [beforeMention, afterText].filter(Boolean).join(' ');
          return {
            agent,
            textWithoutMention: combined,
          };
        }
      }
    }

    return null;
  }, [sortedAgents]);

  const handleInputChange = (e) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setInput(value);

    const textBefore = value.slice(0, cursorPos);
    const atIdx = textBefore.lastIndexOf('@');

    if (atIdx !== -1) {
      const query = textBefore.slice(atIdx + 1);
      // 如果 query 中包含空格，则关闭弹出框
      if (!query.includes(' ')) {
        setMentionState({ active: true, query, start: atIdx, selectedIndex: 0 });
        return;
      }
    }
    setMentionState(s => ({ ...s, active: false }));
  };

  const selectMention = (agent) => {
    const before = input.slice(0, mentionState.start);
    const after = input.slice(inputRef.current.selectionStart);
    setInput(`${before}@${agent.name} ${after}`);
    setMentionState(s => ({ ...s, active: false }));
    inputRef.current?.focus();
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

  const streamingAgent = useMemo(() => streamingAgentId ? agents.find(a => a.id === streamingAgentId) : null, [streamingAgentId, agents]);

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
        {currentConversation && (() => {
          const allMessages = (messages || []).filter(Boolean);
          const truncated = allMessages.length > VISIBLE_MESSAGE_LIMIT;
          const visibleMessages = truncated
            ? allMessages.slice(-VISIBLE_MESSAGE_LIMIT)
            : allMessages;
          return (
            <>
              {truncated && (
                <div className="chat-msg-truncated" onClick={refetch}>
                已隐藏 {allMessages.length - VISIBLE_MESSAGE_LIMIT} 条早期消息，点击加载更多
              </div>
              )}
              {visibleMessages.map((m) => (
                <ChatMessage key={m.id} m={m} />
              ))}
            </>
          );
        })()}
        {currentConversation && streamingContent && streamingAgent && (
          <StreamingMessage 
            content={streamingContent} 
            agentName={streamingAgent.name}
            toolCalls={streamingToolCalls}
          />
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
            onKeyDown={(e) => {
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
            }}
            placeholder={currentConversation ? "输入消息，使用 @ 唤起列表..." : "请先选择对话"}
            rows={2}
            disabled={!wsReady || !currentConversation}
          />
          {mentionState.active && (
            <div className="mention-dropdown">
              {filteredAgents.length > 0 ? filteredAgents.map((a, i) => (
                <div 
                  key={a.id} 
                  className={`mention-item ${i === mentionState.selectedIndex ? 'selected' : ''}`}
                  onClick={() => selectMention(a)}
                >
                  <span className="mention-avatar" style={{ backgroundColor: getAvatarStyle(a.name).backgroundColor }}>
                    {a.name[0]}
                  </span>
                  <span className="mention-name">@{a.name}</span>
                </div>
              )) : <div className="mention-empty">无匹配的 Agent</div>}
            </div>
          )}
        </div>
        <div className="chat-input-actions">
          <button className="btn btn-primary" onClick={send} disabled={!input.trim()}>发送</button>
          {runningAgentIds.length > 0 && (
            <div className="running-agents-actions">
              {runningAgentIds.map(id => {
                const agent = agents.find(a => a.id === id);
                return agent && <button key={id} className="btn btn-danger btn-sm" onClick={() => onStop(id)}>停止 @{agent.name}</button>;
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
