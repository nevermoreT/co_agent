import db from '../db.js';
import logger from '../logger.js';

export function recordEvent({
  eventType,
  sourceAgentId,
  sourceAgentName,
  conversationId,
  title,
  content,
  summary,
  metadata,
  importance = 5,
}) {
  try {
    const result = db.prepare(`
      INSERT INTO shared_events 
      (event_type, source_agent_id, source_agent_name, conversation_id, title, content, summary, metadata, importance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventType,
      sourceAgentId || null,
      sourceAgentName || null,
      conversationId || null,
      title,
      content,
      summary || null,
      metadata ? JSON.stringify(metadata) : null,
      importance
    );
    logger.log('[memory] recorded event: type=%s title=%s id=%d', eventType, title, result.lastInsertRowid);
    return result.lastInsertRowid;
  } catch (e) {
    logger.error('[memory] failed to record event:', e);
    return null;
  }
}

export function getEvents({
  eventType,
  sourceAgentId,
  conversationId,
  minImportance = 0,
  limit = 50,
  offset = 0,
  excludeAgentId,
} = {}) {
  let sql = 'SELECT * FROM shared_events WHERE 1=1';
  const params = [];

  if (eventType) {
    sql += ' AND event_type = ?';
    params.push(eventType);
  }
  if (sourceAgentId) {
    sql += ' AND source_agent_id = ?';
    params.push(sourceAgentId);
  }
  if (conversationId) {
    sql += ' AND conversation_id = ?';
    params.push(conversationId);
  }
  if (minImportance > 0) {
    sql += ' AND importance >= ?';
    params.push(minImportance);
  }
  if (excludeAgentId) {
    sql += ' AND source_agent_id != ?';
    params.push(excludeAgentId);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(sql).all(...params);
}

export function getRecentEvents({ limit = 20, minImportance = 5, excludeAgentId } = {}) {
  return getEvents({ minImportance, limit, excludeAgentId });
}

export function getKnowledge({ category, key } = {}) {
  let sql = 'SELECT * FROM consensus_knowledge WHERE 1=1';
  const params = [];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (key) {
    sql += ' AND key = ?';
    params.push(key);
  }

  sql += ' ORDER BY updated_at DESC';

  return db.prepare(sql).all(...params);
}

export function upsertKnowledge({
  category,
  key,
  value,
  context,
  sourceEvents,
  verifiedBy,
  confidence = 80,
  validFrom,
  validUntil,
}) {
  try {
    const existing = db.prepare(
      'SELECT id FROM consensus_knowledge WHERE key = ? AND category = ?'
    ).get(key, category);

    if (existing) {
      db.prepare(`
        UPDATE consensus_knowledge 
        SET value = ?, context = ?, source_events = ?, verified_by = ?, 
            confidence = ?, valid_from = ?, valid_until = ?, updated_at = datetime('now')
        WHERE key = ? AND category = ?
      `).run(
        value,
        context || null,
        sourceEvents ? JSON.stringify(sourceEvents) : null,
        verifiedBy ? JSON.stringify(verifiedBy) : null,
        confidence,
        validFrom || null,
        validUntil || null,
        key,
        category
      );
      logger.log('[memory] updated knowledge: %s/%s', category, key);
      return existing.id;
    } else {
      const result = db.prepare(`
        INSERT INTO consensus_knowledge 
        (category, key, value, context, source_events, verified_by, confidence, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        category,
        key,
        value,
        context || null,
        sourceEvents ? JSON.stringify(sourceEvents) : null,
        verifiedBy ? JSON.stringify(verifiedBy) : null,
        confidence,
        validFrom || null,
        validUntil || null
      );
      logger.log('[memory] created knowledge: %s/%s id=%d', category, key, result.lastInsertRowid);
      return result.lastInsertRowid;
    }
  } catch (e) {
    logger.error('[memory] failed to upsert knowledge:', e);
    return null;
  }
}

export function buildAgentContext(agentId, conversationId) {
  const knowledge = getKnowledge();
  const recentEvents = getEvents({
    conversationId,
    limit: 10,
    minImportance: 3,
    excludeAgentId: agentId,
  });

  if (recentEvents.length === 0 && knowledge.length === 0) {
    return '';
  }

  let context = '';
  
  if (knowledge.length > 0) {
    context += `### 项目共识\n${knowledge.map(k => `- ${k.key}: ${k.value}`).join('\n')}\n\n`;
  }
  
  if (recentEvents.length > 0) {
    context += `### 最近对话\n${recentEvents.map(e => {
      const name = e.source_agent_name || 'User';
      const title = e.title.length > 50 ? e.title.substring(0, 50) + '...' : e.title;
      return `- ${name}: ${title}`;
    }).join('\n')}\n`;
  }

  return context;
}

export function deleteKnowledge(category, key) {
  try {
    const result = db.prepare(
      'DELETE FROM consensus_knowledge WHERE category = ? AND key = ?'
    ).run(category, key);
    logger.log('[memory] deleted knowledge: %s/%s', category, key);
    return result.changes > 0;
  } catch (e) {
    logger.error('[memory] failed to delete knowledge:', e);
    return false;
  }
}
