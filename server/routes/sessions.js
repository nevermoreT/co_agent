import { Router } from 'express';
import * as sessionManager from '../services/sessionManager.js';

const router = Router();

router.get('/task/:taskId', (req, res) => {
  try {
    const sessions = sessionManager.getTaskSessions(req.params.taskId);
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/agent/:agentId', (req, res) => {
  try {
    const sessions = sessionManager.getAgentSessions(req.params.agentId);
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:agentId/:taskId', (req, res) => {
  try {
    const deleted = sessionManager.deleteSession(req.params.agentId, req.params.taskId);
    if (deleted) {
      res.status(204).send();
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
