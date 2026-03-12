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

  useEffect(() => {
    tasks.forEach(async (t) => {
      if (!previews[t.id]) {
        try {
          const res = await fetch(`${API}/tasks/${t.id}/preview`);
          if (res.ok) {
            const data = await res.json();
            if (data) setPreviews((p) => ({ ...p, [t.id]: data }));
          }
        } catch {}
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

  return (
    <div className="task-panel">
      <header className="task-panel-header">
        <h2>对话列表</h2>
        <button className="btn-new-task" onClick={() => setShowNewModal(true)}>+</button>
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

      {showNewModal && (
        <div className="task-modal" onClick={() => setShowNewModal(false)}>
          <div className="task-modal-content" onClick={e => e.stopPropagation()}>
            <h3>新建对话</h3>
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="输入对话标题..."
              onKeyDown={(e) => e.key === 'Enter' && createTask()}
            />
            <div className="task-modal-actions">
              <button className="btn" onClick={() => setShowNewModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={createTask}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
