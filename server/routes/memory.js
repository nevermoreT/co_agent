import { Router } from 'express';
import * as memoryManager from '../services/memoryManager.js';

const router = Router();

router.post('/events', (req, res) => {
  try {
    const { eventType, sourceAgentId, sourceAgentName, conversationId, title, content, summary, metadata, importance } = req.body;
    if (!eventType || !title || !content) {
      return res.status(400).json({ error: 'eventType, title, content 必填' });
    }
    const id = memoryManager.recordEvent({
      eventType,
      sourceAgentId,
      sourceAgentName,
      conversationId,
      title,
      content,
      summary,
      metadata,
      importance,
    });
    if (id) {
      res.status(201).json({ id });
    } else {
      res.status(500).json({ error: 'Failed to record event' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/events', (req, res) => {
  try {
    const { eventType, sourceAgentId, conversationId, minImportance, limit, offset, excludeAgentId } = req.query;
    const events = memoryManager.getEvents({
      eventType,
      sourceAgentId: sourceAgentId ? parseInt(sourceAgentId) : undefined,
      conversationId: conversationId ? parseInt(conversationId) : undefined,
      minImportance: minImportance ? parseInt(minImportance) : 0,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      excludeAgentId: excludeAgentId ? parseInt(excludeAgentId) : undefined,
    });
    res.json(events);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/knowledge', (req, res) => {
  try {
    const { category, key } = req.query;
    const knowledge = memoryManager.getKnowledge({ category, key });
    res.json(knowledge);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/knowledge', (req, res) => {
  try {
    const { category, key, value, context, sourceEvents, verifiedBy, confidence, validFrom, validUntil } = req.body;
    if (!category || !key || !value) {
      return res.status(400).json({ error: 'category, key, value 必填' });
    }
    const id = memoryManager.upsertKnowledge({
      category,
      key,
      value,
      context,
      sourceEvents,
      verifiedBy,
      confidence,
      validFrom,
      validUntil,
    });
    if (id) {
      res.json({ id });
    } else {
      res.status(500).json({ error: 'Failed to upsert knowledge' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/knowledge', (req, res) => {
  try {
    const { category, key } = req.query;
    if (!category || !key) {
      return res.status(400).json({ error: 'category, key 必填' });
    }
    const deleted = memoryManager.deleteKnowledge(category, key);
    if (deleted) {
      res.json({ deleted: true });
    } else {
      res.status(404).json({ error: 'Knowledge not found' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/context/:agentId', (req, res) => {
  try {
    const { conversationId } = req.query;
    const context = memoryManager.buildAgentContext(
      parseInt(req.params.agentId),
      conversationId ? parseInt(conversationId) : undefined
    );
    res.json({ context });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
