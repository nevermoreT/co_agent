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

/**
 * 构建 Agent 上下文，包含最近的对话历史
 * 当前 Agent 的对话使用第一人称（"你之前回答了..."），其他 Agent 使用第三人称
 *
 * 注意：避免使用括号()和引号""，这些字符在 Windows shell 中会导致问题
 * 详见 doc/bugfix-windows-shell-special-chars.md
 */
export function buildAgentContext(agentId, conversationId) {
  if (!conversationId) {
    return '';
  }

  // 获取当前 Agent 的名称
  const currentAgent = db.prepare('SELECT name FROM agents WHERE id = ?').get(agentId);
  const currentAgentName = currentAgent?.name || '';

  // 从 global_messages 获取最近的对话（包含问答对）
  const recentMessages = db.prepare(`
    SELECT role, content, agent_name, agent_id
    FROM global_messages
    WHERE task_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(conversationId);

  if (recentMessages.length === 0) {
    return '';
  }

  // 反转顺序，让最早的消息在前
  recentMessages.reverse();

  // 构建对话摘要，将问答配对
  // 当前 Agent 使用第一人称，其他 Agent 使用第三人称
  const dialogues = [];
  for (let i = 0; i < recentMessages.length; i++) {
    const msg = recentMessages[i];
    if (msg.role === 'user') {
      // 提取用户问题（去掉 @AgentName 前缀）
      let question = msg.content.replace(/^@[\w\s]+\s+/, '').trim();
      if (question.length > 50) {
        question = question.substring(0, 50) + '...';
      }

      const targetAgent = msg.agent_name || '未知';
      const isTargetingSelf = targetAgent === currentAgentName || Number(msg.agent_id) === agentId;

      // 查找下一条是否是对应的回答
      const nextMsg = recentMessages[i + 1];
      if (nextMsg && nextMsg.role === 'assistant') {
        let answer = nextMsg.content.trim();
        if (answer.length > 100) {
          answer = answer.substring(0, 100) + '...';
        }
        const responder = nextMsg.agent_name || '未知';
        const isResponderSelf = responder === currentAgentName || Number(nextMsg.agent_id) === agentId;

        if (isTargetingSelf || isResponderSelf) {
          // 当前 Agent 参与的对话用第一人称
          dialogues.push(`用户问你: ${question}, 你回答: ${answer}`);
        } else {
          // 其他 Agent 的对话用第三人称
          dialogues.push(`用户问${targetAgent}: ${question}, ${responder}回答: ${answer}`);
        }
        i++; // 跳过已处理的回答
      } else {
        if (isTargetingSelf) {
          dialogues.push(`用户问你: ${question}`);
        } else {
          dialogues.push(`用户问${targetAgent}: ${question}`);
        }
      }
    }
  }

  if (dialogues.length === 0) {
    return '';
  }

  // 只取最近 3 轮对话，避免上下文过长
  const recentDialogues = dialogues.slice(-3);
  return '最近对话 - ' + recentDialogues.join('; ');
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
