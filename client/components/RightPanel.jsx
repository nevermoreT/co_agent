import { useState, useEffect } from 'react';
import './RightPanel.css';

const API = '/api';
const MAX_AGENTS = 5;

function formatSessionTime(isoString) {
  if (!isoString) return '';
  // 兼容 "YYYY-MM-DD HH:MM:SS" 和 ISO 8601 格式
  const normalized = isoString.includes('T') ? isoString : isoString.replace(' ', 'T');
  const date = new Date(normalized);
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN');
}

function generateFakeTokenStats(sessionId) {
  const hash = sessionId ? sessionId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) : 0;
  const inputTokens = 10000 + (hash % 50000);
  const outputTokens = 100 + (hash % 500);
  const cachePercent = 85 + (hash % 15);
  return { inputTokens, outputTokens, cachePercent };
}

function formatTokens(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

export default function RightPanel({
  agents,
  runningAgentIds,
  wsReady,
  refetchAgents,
  selectedTaskId,
}) {
  const [stats, setStats] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [agentForm, setAgentForm] = useState(null);
  const [form, setForm] = useState({ name: '', cli_command: '', cli_cwd: '' });

  useEffect(() => {
    if (!selectedTaskId) {
      setStats(null);
      setSessions([]);
      return;
    }
    let cancelled = false;
    
    fetch(`${API}/stats/messages?task_id=${selectedTaskId}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => { if (!cancelled) setStats(null); });
    
    fetch(`${API}/sessions/task/${selectedTaskId}`)
      .then((res) => res.ok ? res.json() : [])
      .then((data) => {
        if (!cancelled) setSessions(Array.isArray(data) ? data : []);
      })
      .catch(() => { if (!cancelled) setSessions([]); });
    
    return () => { cancelled = true; };
  }, [selectedTaskId]);

  const openNewAgent = () => {
    setAgentForm('new');
    setForm({ name: '', cli_command: '', cli_cwd: '' });
  };

  const openEditAgent = (a) => {
    setAgentForm(a.id);
    setForm({ name: a.name, cli_command: a.cli_command, cli_cwd: a.cli_cwd || '' });
  };

  const saveAgent = async () => {
    if (agentForm === 'new') {
      const res = await fetch(`${API}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        refetchAgents();
        setAgentForm(null);
      } else {
        const err = await res.json();
        alert(err.error || '保存失败');
      }
    } else {
      const res = await fetch(`${API}/agents/${agentForm}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        refetchAgents();
        setAgentForm(null);
      } else {
        const err = await res.json();
        alert(err.error || '保存失败');
      }
    }
  };

  const deleteAgent = async (id) => {
    if (!confirm('确定删除该 Agent？')) return;
    const res = await fetch(`${API}/agents/${id}`, { method: 'DELETE' });
    if (res.ok) refetchAgents();
    setAgentForm(null);
  };

  const runningCount = runningAgentIds.length;
  const mode = runningCount > 0 ? '处理中' : '空闲';

  return (
    <div className="right-panel">
      <section className="right-section">
        <h3>状态</h3>
        <div className="status-bar">
          <div className="status-item">
            <span className="status-label">当前模式</span>
            <span className={`status-value ${runningCount > 0 ? 'active' : ''}`}>{mode}</span>
          </div>
          <div className="status-item">
            <span className="status-label">活跃 Agent</span>
            <span className="status-value">{runningCount}</span>
          </div>
          <div className="status-item">
            <span className="status-label">WebSocket</span>
            <span className={`status-dot ${wsReady ? 'connected' : ''}`} />
            <span className="status-value">{wsReady ? '已连接' : '未连接'}</span>
          </div>
        </div>
      </section>

      {stats && selectedTaskId && (
        <section className="right-section">
          <h3>消息统计</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-value">{stats.total}</span>
              <span className="stat-label">总数</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{stats.byRole?.user || 0}</span>
              <span className="stat-label">用户</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{stats.byRole?.assistant || 0}</span>
              <span className="stat-label">AI</span>
            </div>
          </div>
        </section>
      )}

      {selectedTaskId && (
        <section className="right-section">
          <div className="section-header">
            <h3>Session Chain</h3>
            <span className="session-count">{sessions.length} sessions</span>
          </div>
          <div className="session-list">
            {sessions.length === 0 && (
              <div className="session-empty">暂无活跃会话</div>
            )}
            {sessions.map((s) => {
              const tokenStats = generateFakeTokenStats(s.session_id);
              const isActive = runningAgentIds.includes(s.agent_id);
              
              return (
                <div key={s.agent_id} className={`session-item ${isActive ? 'active' : ''}`}>
                  <div className="session-header">
                    <div className="session-status">
                      <span className={`session-dot ${isActive ? 'running' : ''}`} />
                      <span className="session-status-text">{isActive ? 'ACTIVE' : 'IDLE'}</span>
                    </div>
                    <span className="session-number">#{s.agent_id}</span>
                  </div>
                  <div className="session-name">{s.agent_name}</div>
                  <div className="session-id">{s.session_id?.substring(0, 8)}...{s.session_id?.substring(s.session_id.length - 4)}</div>
                  <div className="session-meta">
                    <span>Started {formatSessionTime(s.created_at)}</span>
                  </div>
                  <div className="session-stats">
                    <div className="session-stat">
                      <span className="session-stat-label">Input</span>
                      <span className="session-stat-value">{formatTokens(tokenStats.inputTokens)}</span>
                    </div>
                    <div className="session-stat">
                      <span className="session-stat-label">Output</span>
                      <span className="session-stat-value">{formatTokens(tokenStats.outputTokens)}</span>
                    </div>
                    <div className="session-stat">
                      <span className="session-stat-label">Cache</span>
                      <span className="session-stat-value cache">{tokenStats.cachePercent}%</span>
                    </div>
                  </div>
                  <div className="session-progress">
                    <div className="session-progress-bar" style={{ width: `${tokenStats.cachePercent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="right-section">
        <h3>Agent 列表</h3>
        <div className="right-agent-list-header">
          <span>{agents.length} / {MAX_AGENTS}</span>
          {agents.length < MAX_AGENTS && (
            <button type="button" className="btn btn-sm btn-primary" onClick={openNewAgent}>
              添加
            </button>
          )}
        </div>
        {agents.length > 0 && (
          <ul className="right-agent-list">
            {agents.map((a) => (
              <li key={a.id}>
                <span>{a.name}{a.builtin_key && <span className="right-badge right-badge-builtin">内置</span>}</span>
                <span className="right-agent-item-actions">
                  {runningAgentIds.includes(a.id) && <span className="right-badge running">运行中</span>}
                  <button type="button" className="btn btn-sm" onClick={() => openEditAgent(a)}>编辑</button>
                  {!a.builtin_key && (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteAgent(a.id)}>删除</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {agentForm && (
        <div className="right-modal">
          <div className="right-modal-content">
            <h3>{agentForm === 'new' ? '添加 Agent' : '编辑 Agent'}</h3>
            <label>名称</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Agent 名称"
            />
            <label>CLI 命令</label>
            <input
              value={form.cli_command}
              onChange={(e) => setForm((f) => ({ ...f, cli_command: e.target.value }))}
              placeholder="例如: node agent.js 或 python -u agent.py"
              readOnly={!!(typeof agentForm === 'number' && agents.find((ag) => ag.id === agentForm)?.builtin_key)}
            />
            <label>工作目录（可选）</label>
            <input
              value={form.cli_cwd}
              onChange={(e) => setForm((f) => ({ ...f, cli_cwd: e.target.value }))}
              placeholder="留空则使用当前目录"
              readOnly={!!(typeof agentForm === 'number' && agents.find((ag) => ag.id === agentForm)?.builtin_key)}
            />
            <div className="right-modal-actions">
              <button type="button" className="btn" onClick={() => setAgentForm(null)}>取消</button>
              <button type="button" className="btn btn-primary" onClick={saveAgent}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
