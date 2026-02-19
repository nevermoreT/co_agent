import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const list = db.prepare('SELECT * FROM tasks ORDER BY last_activity_at DESC').all();
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
    const run = db.prepare(
      'INSERT INTO tasks (title, description, status, group_name) VALUES (?, ?, ?, ?)'
    );
    const info = run.run(
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
    const { title, description, status, group_name } = req.body;
    const t = title !== undefined ? title : existing.title;
    const d = description !== undefined ? description : existing.description;
    const s = status !== undefined ? status : existing.status;
    const g = group_name !== undefined ? group_name : existing.group_name;
    db.prepare(
      'UPDATE tasks SET title = ?, description = ?, status = ?, group_name = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(t, d, s, g, req.params.id);
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Task not found' });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
