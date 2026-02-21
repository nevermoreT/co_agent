import { useState, useRef, useEffect } from 'react';
import './TaskPanel.css';

const API = '/api';

function formatTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
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

export default function TaskPanel({ tasks, loading, refetch, selectedTaskId, onSelectTask }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', group_name: '' });
  const [contextMenu, setContextMenu] = useState(null);
  const [previews, setPreviews] = useState({});
  const contextRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (contextRef.current && !contextRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    tasks.forEach(async (t) => {
      if (!previews[t.id]) {
        try {
          const res = await fetch(`${API}/tasks/${t.id}/preview`);
          if (res.ok) {
            const data = await res.json();
            if (data) {
              setPreviews((p) => ({ ...p, [t.id]: data }));
            }
          }
        } catch {
          // ignore
        }
      }
    });
  }, [tasks]);

  const openNew = () => {
    setEditing('new');
    setForm({ title: '', group_name: '' });
  };

  const closeEdit = () => {
    setEditing(null);
    setForm({ title: '', group_name: '' });
  };

  const save = async () => {
    if (!form.title.trim()) return;
    
    if (editing === 'new') {
      const res = await fetch(`${API}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: form.title, group_name: form.group_name || null }),
      });
      if (res.ok) {
        const data = await res.json();
        refetch();
        closeEdit();
        onSelectTask(data.id);
      }
    } else if (editing != null && editing !== 'new') {
      const res = await fetch(`${API}/tasks/${editing}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: form.title, group_name: form.group_name || null }),
      });
      if (res.ok) {
        refetch();
        closeEdit();
      }
    }
  };

  const remove = async (id) => {
    if (!confirm('确定删除该对话？所有消息将被删除。')) return;
    const res = await fetch(`${API}/tasks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      refetch();
      if (selectedTaskId === id) onSelectTask(null);
      setContextMenu(null);
    }
  };

  const handleContextMenu = (e, task) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      taskId: task.id,
      task,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const startEdit = (task) => {
    setEditing(task.id);
    setForm({ title: task.title, group_name: task.group_name || '' });
    setContextMenu(null);
  };

  const archiveTask = async (id) => {
    const res = await fetch(`${API}/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_archived: true }),
    });
    if (res.ok) {
      refetch();
      if (selectedTaskId === id) onSelectTask(null);
      setContextMenu(null);
    }
  };

  const groupedTasks = tasks.reduce((acc, t) => {
    const group = t.group_name || '默认';
    if (!acc[group]) acc[group] = [];
    acc[group].push(t);
    return acc;
  }, {});

  return (
    <div className="task-panel">
      <header className="task-panel-header">
        <h2>对话</h2>
        <button type="button" className="btn-new-task" onClick={openNew} title="新建对话">
          +
        </button>
      </header>
      
      {loading ? (
        <div className="task-panel-loading">加载中...</div>
      ) : (
        <div className="task-list">
          {Object.entries(groupedTasks).map(([group, groupTasks]) => (
            <div key={group} className="task-group">
              <div className="task-group-header">{group}</div>
              {groupTasks.map((t) => {
                const preview = previews[t.id];
                const previewText = preview?.content 
                  ? preview.content.substring(0, 30) + (preview.content.length > 30 ? '...' : '')
                  : '';
                  
                return (
                  <div
                    key={t.id}
                    className={`task-item ${selectedTaskId === t.id ? 'selected' : ''}`}
                    onClick={() => onSelectTask(t.id)}
                    onContextMenu={(e) => handleContextMenu(e, t)}
                  >
                    <div className="task-item-content">
                      <div className="task-item-title">{t.title}</div>
                      {previewText && (
                        <div className="task-item-preview">{previewText}</div>
                      )}
                      <div className="task-item-meta">
                        <span className="task-item-time">{formatTime(t.last_activity_at || t.created_at)}</span>
                        {t.message_count > 0 && (
                          <span className="task-item-count">{t.message_count}条</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          
          {tasks.length === 0 && (
            <div className="task-panel-empty">
              暂无对话
            </div>
          )}
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button type="button" onClick={() => startEdit(contextMenu.task)}>
            重命名
          </button>
          <button type="button" onClick={() => archiveTask(contextMenu.taskId)}>
            归档
          </button>
          <button type="button" className="danger" onClick={() => remove(contextMenu.taskId)}>
            删除
          </button>
        </div>
      )}

      {editing && (
        <div className="task-modal" onClick={closeEdit}>
          <div className="task-modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>{editing === 'new' ? '新建对话' : '重命名对话'}</h3>
            <label>标题</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="对话标题"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <label>分组（可选）</label>
            <input
              value={form.group_name}
              onChange={(e) => setForm((f) => ({ ...f, group_name: e.target.value }))}
              placeholder="分组名称"
            />
            <div className="task-modal-actions">
              <button type="button" className="btn" onClick={closeEdit}>
                取消
              </button>
              <button 
                type="button" 
                className="btn btn-primary" 
                onClick={save}
                disabled={!form.title.trim()}
              >
                {editing === 'new' ? '创建' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
