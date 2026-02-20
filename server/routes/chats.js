import { Router } from 'express';
import db from '../db.js';
import * as memoryManager from '../services/memoryManager.js';

const router = Router();

// Legacy: per-agent messages
router.get('/agents/:id/messages', (req, res) => {
  try {
    const agentId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const list = db
      .prepare(
        'SELECT * FROM chat_messages WHERE agent_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
      )
      .all(agentId, limit, offset);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/agents/:id/messages', (req, res) => {
  try {
    const agentId = req.params.id;
    const { role, content, task_id } = req.body;
    if (!role || content === undefined) {
      return res.status(400).json({ error: 'role 和 content 必填' });
    }
    const run = db.prepare(
      'INSERT INTO chat_messages (agent_id, role, content, task_id) VALUES (?, ?, ?, ?)'
    );
    const info = run.run(agentId, role, content || '', task_id || null);
    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Global messages (unified chat)
router.get('/messages', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const conversationId = req.query.conversation_id || req.query.task_id;
    
    let query = 'SELECT * FROM global_messages';
    let params = [];
    
    if (conversationId) {
      query += ' WHERE task_id = ?';
      params.push(conversationId);
    }
    
    query += ' ORDER BY created_at ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const list = db.prepare(query).all(...params);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/messages', (req, res) => {
  try {
    const { role, content, agent_id, agent_name, task_id } = req.body;
    if (!role || content === undefined) {
      return res.status(400).json({ error: 'role 和 content 必填' });
    }
    const run = db.prepare(
      'INSERT INTO global_messages (role, content, agent_id, agent_name, task_id) VALUES (?, ?, ?, ?, ?)'
    );
    const info = run.run(role, content || '', agent_id || null, agent_name || null, task_id || null);

    if (task_id) {
      db.prepare('UPDATE tasks SET last_activity_at = datetime(\'now\') WHERE id = ?').run(task_id);
    }

    const row = db.prepare('SELECT * FROM global_messages WHERE id = ?').get(info.lastInsertRowid);

    if (content && content.trim() && role === 'user') {
      let title = content;
      if (content.startsWith('@')) {
        const atEnd = content.indexOf(' ');
        if (atEnd > 0) {
          title = content.substring(atEnd + 1);
        }
      }
      title = title.substring(0, 50) + (title.length > 50 ? '...' : '');
      
      memoryManager.recordEvent({
        eventType: 'conversation',
        conversationId: task_id,
        title: title || content.substring(0, 50),
        content: content,
        importance: 6,
      });
    }

    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
