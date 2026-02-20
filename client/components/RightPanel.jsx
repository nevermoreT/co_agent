import { useState, useEffect } from 'react';
import './RightPanel.css';

const API = '/api';
const MAX_AGENTS = 5;

export default function RightPanel({
  agents,
  runningAgentIds,
  wsReady,
  refetchAgents,
  selectedTaskId,
}) {
  const [messages, setMessages] = useState([]);
  const [stats, setStats] = useState(null);
  const [agentForm, setAgentForm] = useState(null);
  const [form, setForm] = useState({ name: '', cli_command: '', cli_cwd: '' });

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/messages?limit=50`)
      .then((res) => res.ok ? res.json() : [])
      .then((data) => {
        if (!cancelled) setMessages(Array.isArray(data) ? data : []);
      })
      .catch(() => { if (!cancelled) setMessages([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedTaskId) {
      setStats(null);
      return;
    }
    let cancelled = false;
    fetch(`${API}/stats/messages?task_id=${selectedTaskId}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => { if (!cancelled) setStats(null); });
    return () => { cancelled = true; };
  }, [selectedTaskId, messages]);

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
          {stats.byAgent && Object.keys(stats.byAgent).length > 0 && (
            <div className="stats-agents">
              {Object.entries(stats.byAgent).map(([name, count]) => (
                <div key={name} className="stat-agent">
                  <span className="stat-agent-name">{name}</span>
                  <span className="stat-agent-count">{count}</span>
                </div>
              ))}
            </div>
          )}
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

      <section className="right-section right-section-history">
        <h3>最近消息</h3>
        <div className="right-history">
          {messages.length === 0 && (
            <p className="right-history-empty">暂无记录</p>
          )}
          {(messages || []).filter(Boolean).slice(-10).reverse().map((m) => (
            <div key={m.id} className={`right-history-msg ${m.role || 'assistant'}`}>
              <span className="right-history-role">
                {m.role === 'user' ? '用户' : `@${m.agent_name || 'Agent'}`}
              </span>
              <pre className="right-history-content">{(m.content ?? '').slice(0, 100)}{(m.content ?? '').length > 100 ? '...' : ''}</pre>
            </div>
          ))}
        </div>
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
