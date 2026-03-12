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
  let textParts = [];
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
  const { messages, refetch, addMessage } = useGlobalMessages(selectedTaskId);

  const sortedAgents = useMemo(() => [...agents].sort((a, b) => b.name.length - a.name.length), [agents]);

  const filteredAgents = useMemo(() => {
    if (!mentionState.active) return [];
    const q = mentionState.query.toLowerCase();
    return agents.filter(a => a.name.toLowerCase().includes(q));
  }, [agents, mentionState]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

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
    if (!text || !selectedTaskId) return;
    setInput('');
    setMentionState(s => ({ ...s, active: false }));

    // 检查是否是 @ 某人的指令
    const match = text.match(/^@(\S+)\s*(.*)/);
    if (match) {
      const agent = agents.find(a => a.name === match[1]);
      if (agent) {
        try {
          const res = await fetch(`${API}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'user', content: text, agent_id: agent.id, agent_name: agent.name, task_id: selectedTaskId }),
          });
          if (res.ok) addMessage(await res.json());
        } catch (err) { logger.error('Error saving @ message', err); }
        onStart(agent.id);
        onSendText(agent.id, match[2].trim(), selectedTaskId);
        return;
      }
    }

    // 普通消息
    try {
      const res = await fetch(`${API}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: text, task_id: selectedTaskId }),
      });
      if (res.ok) addMessage(await res.json());
    } catch (err) { logger.error('Error saving message', err); }
  };

  const streamingAgent = useMemo(() => streamingAgentId ? agents.find(a => a.id === streamingAgentId) : null, [streamingAgentId, agents]);

  return (
    <div className="chat-panel">
      <header className="chat-header">
        <div className="chat-header-title">
          <span className="chat-title">{currentConversation?.title || '未选择对话'}</span>
          {currentConversation && <span className="chat-subtitle">协作空间</span>}
        </div>
        <div className="chat-header-actions">
          <span className="chat-action-icon">📥</span>
          <span className="chat-action-icon">🔳</span>
        </div>
      </header>
      <div className="chat-messages">
        {messages.filter(Boolean).map(m => <ChatMessage key={m.id} m={m} />)}
        {streamingContent && streamingAgent && <StreamingMessage content={streamingContent} agentName={streamingAgent.name} toolCalls={streamingToolCalls} />}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
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
