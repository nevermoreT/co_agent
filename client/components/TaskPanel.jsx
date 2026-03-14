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

export default function TaskPanel({ selectedTaskId, onSelectTask, tasks, refetchTasks }) {
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [previews, setPreviews] = useState({});
  const [contextMenu, setContextMenu] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
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
            if (data) setPreviews((p) => ({ ...p, [t.id]: data }));
          }
        } catch { /* ignore fetch errors */ }
      }
    });
  }, [tasks]);

  const createTask = async () => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch(`${API}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewTitle('');
        setShowNewModal(false);
        refetchTasks();
        onSelectTask(data.id);
      }
    } catch (err) {
      console.error('Failed to create task:', err);
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
    setEditingTask(task.id);
    setNewTitle(task.title);
    setContextMenu(null);
    setShowNewModal(true);
  };

  const updateTask = async () => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch(`${API}/tasks/${editingTask}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      if (res.ok) {
        setNewTitle('');
        setEditingTask(null);
        setShowNewModal(false);
        refetchTasks();
      }
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  const removeTask = async (id) => {
    if (!window.confirm('确定删除该对话？所有消息将被删除。')) return;
    const res = await fetch(`${API}/tasks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      refetchTasks();
      if (selectedTaskId === id) onSelectTask(null);
      setContextMenu(null);
    }
  };

  const archiveTask = async (id) => {
    const res = await fetch(`${API}/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_archived: true }),
    });
    if (res.ok) {
      refetchTasks();
      if (selectedTaskId === id) onSelectTask(null);
      setContextMenu(null);
    }
  };

  return (
    <div className="task-panel">
      <header className="task-panel-header">
        <h2>对话列表</h2>
        <button className="btn-new-task" onClick={() => { setEditingTask(null); setNewTitle(''); setShowNewModal(true); }}>+</button>
      </header>
      <div className="task-search">
        <input type="text" placeholder="搜索对话..." />
      </div>
      <div className="task-list">
        {tasks.map((t) => {
          const preview = previews[t.id];
          const previewText = preview?.content 
            ? preview.content.substring(0, 40) + (preview.content.length > 40 ? '...' : '')
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
                {previewText && <div className="task-item-preview">{previewText}</div>}
                <div className="task-item-footer">
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
          <button type="button" className="danger" onClick={() => removeTask(contextMenu.taskId)}>
            删除
          </button>
        </div>
      )}

      {showNewModal && (
        <div className="task-modal" onClick={() => { setShowNewModal(false); setEditingTask(null); }}>
          <div className="task-modal-content" onClick={e => e.stopPropagation()}>
            <h3>{editingTask ? '重命名对话' : '新建对话'}</h3>
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="输入对话标题..."
              onKeyDown={(e) => e.key === 'Enter' && (editingTask ? updateTask() : createTask())}
            />
            <div className="task-modal-actions">
              <button className="btn" onClick={() => { setShowNewModal(false); setEditingTask(null); }}>取消</button>
              <button className="btn btn-primary" onClick={editingTask ? updateTask : createTask}>
                {editingTask ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
