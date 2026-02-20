import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/messages', (req, res) => {
  try {
    const { task_id } = req.query;
    
    if (task_id) {
      const total = db.prepare('SELECT COUNT(*) as count FROM global_messages WHERE task_id = ?').get(task_id);
      const byRole = db.prepare(`
        SELECT role, COUNT(*) as count 
        FROM global_messages 
        WHERE task_id = ? 
        GROUP BY role
      `).all(task_id);
      const byAgent = db.prepare(`
        SELECT agent_name, COUNT(*) as count 
        FROM global_messages 
        WHERE task_id = ? AND agent_name IS NOT NULL 
        GROUP BY agent_name
      `).all(task_id);
      
      const roleMap = {};
      byRole.forEach(r => { roleMap[r.role] = r.count; });
      
      const agentMap = {};
      byAgent.forEach(a => { agentMap[a.agent_name] = a.count; });
      
      res.json({
        total: total.count,
        byRole: roleMap,
        byAgent: agentMap
      });
    } else {
      const total = db.prepare('SELECT COUNT(*) as count FROM global_messages').get();
      const byRole = db.prepare(`
        SELECT role, COUNT(*) as count 
        FROM global_messages 
        GROUP BY role
      `).all();
      
      const roleMap = {};
      byRole.forEach(r => { roleMap[r.role] = r.count; });
      
      res.json({
        total: total.count,
        byRole: roleMap
      });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/global', (req, res) => {
  try {
    const conversations = db.prepare('SELECT COUNT(*) as count FROM tasks').get();
    const messages = db.prepare('SELECT COUNT(*) as count FROM global_messages').get();
    const agentCalls = db.prepare(`
      SELECT COUNT(*) as count FROM global_messages WHERE role = 'assistant'
    `).get();
    
    res.json({
      totalConversations: conversations.count,
      totalMessages: messages.count,
      agentCalls: agentCalls.count
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
