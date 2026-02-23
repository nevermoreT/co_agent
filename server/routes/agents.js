import { Router } from 'express';
import db from '../db.js';
import * as agentRunner from '../services/agentRunner.js';

const router = Router();
const MAX_AGENTS = 5;

router.get('/status/running', (req, res) => {
  try {
    const running = agentRunner.getRunningAgentIds();
    res.json({ running });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function getCount() {
  const row = db.prepare('SELECT COUNT(*) as c FROM agents').get();
  return row.c;
}

router.get('/', (req, res) => {
  try {
    const list = db.prepare('SELECT * FROM agents ORDER BY id').all();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Agent not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', (req, res) => {
  try {
    if (getCount() >= MAX_AGENTS) {
      return res.status(400).json({ error: `最多只能添加 ${MAX_AGENTS} 个 Agent` });
    }
    const { name, cli_command, cli_cwd, role, responsibilities, system_prompt } = req.body;
    if (!name || !cli_command) {
      return res.status(400).json({ error: 'name 和 cli_command 必填' });
    }
    const run = db.prepare(
      'INSERT INTO agents (name, cli_command, cli_cwd, role, responsibilities, system_prompt) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const info = run.run(
      name, 
      cli_command || '', 
      cli_cwd || null,
      role || '',
      JSON.stringify(responsibilities || []),
      system_prompt || ''
    );
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const { name, cli_command, cli_cwd, session_id, role, responsibilities, system_prompt } = req.body;
    const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Agent not found' });
    
    const n = name !== undefined ? name : existing.name;
    const c = cli_command !== undefined ? cli_command : existing.cli_command;
    const w = cli_cwd !== undefined ? cli_cwd : existing.cli_cwd;
    const s = session_id !== undefined ? session_id : existing.session_id;
    const r = role !== undefined ? role : existing.role;
    const resp = responsibilities !== undefined ? JSON.stringify(responsibilities) : existing.responsibilities;
    const sp = system_prompt !== undefined ? system_prompt : existing.system_prompt;
    
    db.prepare(
      'UPDATE agents SET name = ?, cli_command = ?, cli_cwd = ?, session_id = ?, role = ?, responsibilities = ?, system_prompt = ? WHERE id = ?'
    ).run(n, c, w, s, r, resp, sp, req.params.id);
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 设置 agent 的 session ID
router.put('/:id/session', (req, res) => {
  try {
    const { session_id } = req.body;
    const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Agent not found' });
    db.prepare('UPDATE agents SET session_id = ? WHERE id = ?').run(session_id || null, req.params.id);
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 清除 agent 的 session ID（开始新会话）
router.delete('/:id/session', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Agent not found' });
    db.prepare('UPDATE agents SET session_id = NULL WHERE id = ?').run(req.params.id);
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const info = db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Agent not found' });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
