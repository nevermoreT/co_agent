import { useState, useEffect } from 'react';
import './RightPanel.css';
import SoulConfigPanel from './SoulConfigPanel';

const API = '/api';
const MAX_AGENTS = 5;

function formatTokens(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

function generateFakeTokenStats(sessionId) {
  const hash = sessionId ? String(sessionId).split('').reduce((a, c) => a + c.charCodeAt(0), 0) : 0;
  return { 
    inputTokens: 10000 + (hash % 50000), 
    outputTokens: 100 + (hash % 500), 
    cachePercent: 85 + (hash % 15) 
  };
}

export default function RightPanel({ agents, runningAgentIds, wsReady, refetchAgents, selectedTaskId }) {
  const [stats, setStats] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [agentForm, setAgentForm] = useState(null);
  const [soulConfigAgent, setSoulConfigAgent] = useState(null);
  const [form, setForm] = useState({ name: '', cli_command: '', role: '', responsibilities: '', system_prompt: '' });

  useEffect(() => {
    if (!selectedTaskId) {
      setStats(null);
      setSessions([]);
      return;
    }
    fetch(`${API}/stats/messages?task_id=${selectedTaskId}`).then(r => r.json()).then(setStats).catch(() => setStats(null));
    fetch(`${API}/sessions/task/${selectedTaskId}`).then(r => r.json()).then(setSessions).catch(() => setSessions([]));
  }, [selectedTaskId]);

  const openNewAgent = () => { setAgentForm('new'); setForm({ name: '', cli_command: '', role: '', responsibilities: '', system_prompt: '' }); };
  const openEditAgent = (a) => {
    setAgentForm(a.id);
    let resp = []; try { resp = JSON.parse(a.responsibilities); } catch {}
    setForm({ 
      name: a.name, 
      cli_command: a.cli_command, 
      role: a.role, 
      responsibilities: Array.isArray(resp) ? resp.join('\n') : '', 
      system_prompt: a.system_prompt || '' 
    });
  };

  const saveAgent = async () => {
    const data = { ...form, responsibilities: form.responsibilities.split('\n').filter(r => r) };
    const method = agentForm === 'new' ? 'POST' : 'PATCH';
    const url = agentForm === 'new' ? `${API}/agents` : `${API}/agents/${agentForm}`;
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { refetchAgents(); setAgentForm(null); }
  };

  const deleteAgent = async (id) => {
    if (window.confirm('确定要删除这个 Agent 吗？')) {
      const res = await fetch(`${API}/agents/${id}`, { method: 'DELETE' });
      if (res.ok) refetchAgents();
    }
  };

  return (
    <div className="right-panel">
      <div className="right-panel-content">
        <section className="right-section">
          <h3>系统状态</h3>
          <div className="status-cards-grid">
            <div className="status-card">
              <span className="status-card-label">服务连接</span>
              <div className="status-card-value">
                <span className={`status-dot ${wsReady ? 'connected' : ''}`} />
                {wsReady ? '就绪' : '离线'}
              </div>
            </div>
            <div className="status-card">
              <span className="status-card-label">活跃节点</span>
              <div className="status-card-value">{runningAgentIds.length}</div>
            </div>
          </div>
        </section>

        {stats && (
          <section className="right-section">
            <h3>本次对话统计</h3>
            <div className="stats-cards-grid">
              <div className="stat-card"><span className="stat-card-value">{stats.total}</span><span className="stat-card-label">消息</span></div>
              <div className="stat-card"><span className="stat-card-value">{stats.byRole?.assistant || 0}</span><span className="stat-card-label">AI</span></div>
              <div className="stat-card"><span className="stat-card-value">{stats.byRole?.user || 0}</span><span className="stat-card-label">用户</span></div>
            </div>
          </section>
        )}

        {selectedTaskId && sessions.length > 0 && (
          <section className="right-section">
            <div className="section-header">
              <h3>Session Chain</h3>
              <span className="session-count">{sessions.length} 节点</span>
            </div>
            <div className="session-list">
              {sessions.map((s) => {
                const tokenStats = generateFakeTokenStats(s.session_id);
                const isActive = runningAgentIds.includes(s.agent_id);
                
                return (
                  <div key={s.session_id} className={`session-item ${isActive ? 'active' : ''}`}>
                    <div className="session-header">
                      <div className="session-status">
                        <span className={`session-dot ${isActive ? 'running' : ''}`} />
                        <span className="session-status-text">{isActive ? 'ACTIVE' : 'IDLE'}</span>
                      </div>
                      <span className="session-number">#{s.agent_id}</span>
                    </div>
                    <div className="session-name">{s.agent_name}</div>
                    <div className="session-id">{String(s.session_id || '').substring(0, 8)}...</div>
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

        {selectedTaskId && (
          <section className="right-section info-section">
            <h3>对话详情</h3>
            <div className="info-card">
              <div className="info-row">
                <span className="info-label">Thread ID:</span>
                <span className="info-value">thread_{String(selectedTaskId).substring(0, 8)}</span>
              </div>
              <div className="info-row">
                <span className="info-label">心里话:</span>
                <button className="info-toggle">显示调试</button>
              </div>
              <div className="info-row">
                <span className="info-label">悄悄话:</span>
                <button className="info-btn-outline">揭秘全部</button>
              </div>
            </div>
          </section>
        )}

        <section className="right-section">
          <div className="section-header">
            <h3>Agent 成员</h3>
            <button className="btn btn-sm btn-primary" onClick={openNewAgent}>+ 添加成员</button>
          </div>
          <ul className="right-agent-list">
            {agents.map((a) => {
              const active = runningAgentIds.includes(a.id);
              return (
                <li key={a.id} className={active ? 'agent-active' : ''}>
                  <div className="agent-item-main">
                    <div className="agent-avatar">{a.name[0].toUpperCase()}</div>
                    <div className="agent-info">
                      <div className="agent-name">{a.name}</div>
                      <div className="agent-role">{a.role || 'Assistant'}</div>
                    </div>
                  </div>
                  <div className="agent-item-actions">
                    <button onClick={() => setSoulConfigAgent(a)}>Soul</button>
                    <button onClick={() => openEditAgent(a)}>编辑</button>
                    {!a.builtin_key && <button className="danger" onClick={() => deleteAgent(a.id)}>删除</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {agentForm && (
        <div className="right-modal" onClick={() => setAgentForm(null)}>
          <div className="right-modal-content" onClick={e => e.stopPropagation()}>
            <h3>{agentForm === 'new' ? '新增 Agent' : '编辑 Agent'}</h3>
            <div className="form-section">
              <label>名称</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Agent 名称" />
              <label>CLI 命令</label>
              <input value={form.cli_command} onChange={(e) => setForm({ ...form, cli_command: e.target.value })} placeholder="例如: node agent.js" />
              <label>角色</label>
              <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="例如: 架构师" />
              <label>职责 (每行一个)</label>
              <textarea value={form.responsibilities} onChange={(e) => setForm({ ...form, responsibilities: e.target.value })} rows={3} placeholder="输入职责..." />
            </div>
            <div className="right-modal-actions">
              <button className="btn" onClick={() => setAgentForm(null)}>取消</button>
              <button className="btn btn-primary" onClick={saveAgent}>保存</button>
            </div>
          </div>
        </div>
      )}

      {soulConfigAgent && (
        <>
          <div className="soul-config-overlay" onClick={() => setSoulConfigAgent(null)} />
          <SoulConfigPanel 
            agent={soulConfigAgent} 
            onClose={() => setSoulConfigAgent(null)} 
            onSave={() => { setSoulConfigAgent(null); refetchAgents(); }} 
          />
        </>
      )}
    </div>
  );
}
