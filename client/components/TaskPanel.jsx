import { useState } from 'react';
import { formatRelativeTime } from '../utils/timeUtils.js';
import './TaskPanel.css';

const API = '/api';

export default function TaskPanel({ tasks, loading, refetch, selectedTaskId, onSelectTask }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', status: 'pending', group_name: '' });

  const openNew = () => {
    setEditing('new');
    setForm({ title: '', description: '', status: 'pending', group_name: '' });
  };

  const openEdit = (t) => {
    setEditing(t.id);
    setForm({ title: t.title, description: t.description || '', status: t.status, group_name: t.group_name || '' });
  };

  const closeEdit = () => {
    setEditing(null);
  };

  const save = async () => {
    if (editing === 'new') {
      const res = await fetch(`${API}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        refetch();
        closeEdit();
      }
    } else if (editing != null) {
      const res = await fetch(`${API}/tasks/${editing}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        refetch();
        closeEdit();
      }
    }
  };

  const remove = async (id) => {
    if (!confirm('确定删除该任务？')) return;
    const res = await fetch(`${API}/tasks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      refetch();
      if (selectedTaskId === id) onSelectTask(null);
      closeEdit();
    }
  };

  const setStatus = async (id, status) => {
    const res = await fetch(`${API}/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) refetch();
  };

  return (
    <div className="task-panel">
      <header className="task-panel-header">
        <h2>对话</h2>
        <button type="button" className="btn btn-primary" onClick={openNew}>
          新建对话
        </button>
      </header>
      {loading ? (
        <div className="task-panel-loading">加载中...</div>
      ) : (
        <ul className="task-list">
          {tasks.map((t) => (
            <li
              key={t.id}
              className={`task-item ${selectedTaskId === t.id ? 'selected' : ''}`}
              onClick={() => onSelectTask(t.id)}
            >
              <div className="task-item-main">
                <span className="task-title">{t.title}</span>
                {t.group_name && <span className="task-group">{t.group_name}</span>}
                <span className="task-time">{formatRelativeTime(t.last_activity_at)}</span>
              </div>
              <div className="task-item-actions">
                <button type="button" className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(t); }}>
                  编辑
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); remove(t.id); }}>
                  删除
                </button>
                {t.status !== 'done' && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setStatus(t.id, t.status === 'doing' ? 'done' : 'doing');
                    }}
                  >
                    {t.status === 'doing' ? '完成' : '进行中'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <div className="task-modal">
          <div className="task-modal-content">
            <h3>{editing === 'new' ? '新建对话' : '编辑对话'}</h3>
            <label>标题</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="对话标题"
            />
            <label>分组（可选）</label>
            <input
              value={form.group_name}
              onChange={(e) => setForm((f) => ({ ...f, group_name: e.target.value }))}
              placeholder="如：工作、学习、项目"
            />
            <label>描述（可选）</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="对话描述或备注"
              rows={3}
            />
            <div className="task-modal-actions">
              <button type="button" className="btn" onClick={closeEdit}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={save}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
