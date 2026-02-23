import db from '../db.js';
import logger from '../logger.js';

function isoNow() {
  return new Date().toISOString();
}

export function getSession(agentId, taskId) {
  if (!agentId || !taskId) return null;
  
  const row = db.prepare(
    'SELECT session_id FROM agent_sessions WHERE agent_id = ? AND task_id = ?'
  ).get(agentId, taskId);
  
  return row?.session_id || null;
}

export function saveSession(agentId, taskId, sessionId) {
  if (!agentId || !taskId || !sessionId) return false;
  
  try {
    const existing = db.prepare(
      'SELECT id FROM agent_sessions WHERE agent_id = ? AND task_id = ?'
    ).get(agentId, taskId);
    
    if (existing) {
      db.prepare(
        'UPDATE agent_sessions SET session_id = ?, updated_at = ? WHERE agent_id = ? AND task_id = ?'
      ).run(sessionId, isoNow(), agentId, taskId);
      logger.log('[sessionManager] updated session: agent=%d task=%d session=%s', agentId, taskId, sessionId);
    } else {
      const now = isoNow();
      db.prepare(
        'INSERT INTO agent_sessions (agent_id, task_id, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(agentId, taskId, sessionId, now, now);
      logger.log('[sessionManager] created session: agent=%d task=%d session=%s', agentId, taskId, sessionId);
    }
    return true;
  } catch (e) {
    logger.error('[sessionManager] failed to save session:', e);
    return false;
  }
}

export function getAgentSessions(agentId) {
  return db.prepare(
    `SELECT s.*, t.title as task_title 
     FROM agent_sessions s 
     LEFT JOIN tasks t ON s.task_id = t.id 
     WHERE s.agent_id = ? 
     ORDER BY s.updated_at DESC`
  ).all(agentId);
}

export function getTaskSessions(taskId) {
  return db.prepare(
    `SELECT s.*, a.name as agent_name 
     FROM agent_sessions s 
     LEFT JOIN agents a ON s.agent_id = a.id 
     WHERE s.task_id = ? 
     ORDER BY s.updated_at DESC`
  ).all(taskId);
}

export function deleteSession(agentId, taskId) {
  try {
    const result = db.prepare(
      'DELETE FROM agent_sessions WHERE agent_id = ? AND task_id = ?'
    ).run(agentId, taskId);
    return result.changes > 0;
  } catch (e) {
    logger.error('[sessionManager] failed to delete session:', e);
    return false;
  }
}

export function deleteTaskSessions(taskId) {
  try {
    db.prepare('DELETE FROM agent_sessions WHERE task_id = ?').run(taskId);
    return true;
  } catch (e) {
    logger.error('[sessionManager] failed to delete task sessions:', e);
    return false;
  }
}
