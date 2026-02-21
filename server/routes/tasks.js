import { Router } from 'express';
import db from '../db.js';
import * as sessionManager from '../services/sessionManager.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const { include_archived } = req.query;
    let sql = `SELECT t.*, 
      (SELECT COUNT(*) FROM global_messages WHERE task_id = t.id) as message_count
      FROM tasks t`;
    if (include_archived !== 'true') {
      sql += ' WHERE is_archived = 0 OR is_archived IS NULL';
    }
    sql += ' ORDER BY last_activity_at DESC NULLS LAST, created_at DESC';
    const list = db.prepare(sql).all();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { title, description, status, group_name } = req.body;
    if (!title) return res.status(400).json({ error: 'title 必填' });
    const info = db.prepare(
      `INSERT INTO tasks (title, description, status, group_name, last_activity_at) 
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(
      title,
      description || '',
      status === 'doing' || status === 'done' ? status : 'pending',
      group_name || null
    );
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    
    const { title, description, status, group_name, is_archived } = req.body;
    const t = title !== undefined ? title : existing.title;
    const d = description !== undefined ? description : existing.description;
    const s = status !== undefined ? status : existing.status;
    const g = group_name !== undefined ? group_name : existing.group_name;
    const a = is_archived !== undefined ? (is_archived ? 1 : 0) : existing.is_archived;
    
    db.prepare(
      `UPDATE tasks SET title = ?, description = ?, status = ?, group_name = ?, is_archived = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(t, d, s, g, a, req.params.id);
    
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM global_messages WHERE task_id = ?').run(req.params.id);
    db.prepare('DELETE FROM shared_events WHERE conversation_id = ?').run(req.params.id);
    sessionManager.deleteTaskSessions(req.params.id);
    const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Task not found' });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/preview', (req, res) => {
  try {
    const row = db.prepare(`
      SELECT content, role, agent_name, created_at 
      FROM global_messages 
      WHERE task_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `).get(req.params.id);
    res.json(row || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
