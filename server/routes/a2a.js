import express from 'express';
import db from '../db.js';
import logger from '../logger.js';

const router = express.Router();

// GET /.well-known/agent.json - Agent Card 端点
router.get('/.well-known/agent.json', (req, res) => {
  try {
    logger.log('[A2A] Agent card requested from: %s', req.ip);

    // 构建 Agent Card
    const agentCard = {
      name: 'Co-Agent Platform',
      description: 'Multi-agent collaboration platform with A2A capabilities',
      url: `${req.protocol}://${req.get('host')}`,
      version: '1.0.0',
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: true,
      },
      authentication: {
        schemes: ['none'], // 后续可扩展支持 Bearer token 等
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [], // 动态加载所有可用 Agent 的能力
    };

    // 加载所有可用的 Agent 作为技能
    const agents = db.prepare('SELECT * FROM agents WHERE status = ?').all('active');
    agentCard.skills = agents.map(agent => ({
      id: `agent-${agent.id}`,
      name: agent.name,
      description: agent.role || 'General purpose agent',
      tags: agent.responsibilities ? JSON.parse(agent.responsibilities) : [],
      examples: [],
      inputModes: ['text'],
      outputModes: ['text'],
    }));

    logger.log('[A2A] Agent card served with %d skills', agentCard.skills.length);
    
    res.json(agentCard);
  } catch (error) {
    logger.error('[A2A] Error serving agent card:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /a2a/agents - 获取所有可用 Agent
router.get('/agents', (req, res) => {
  try {
    const agents = db.prepare(`
      SELECT id, name, role, responsibilities, created_at 
      FROM agents 
      WHERE status = ?
      ORDER BY name
    `).all('active');

    res.json({
      agents: agents.map(agent => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        responsibilities: agent.responsibilities ? JSON.parse(agent.responsibilities) : [],
        createdAt: agent.created_at,
      }))
    });
  } catch (error) {
    logger.error('[A2A] Error getting agents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /a2a/agents/:id - 获取特定 Agent 详情
router.get('/agents/:id', (req, res) => {
  try {
    const agentId = parseInt(req.params.id);
    if (isNaN(agentId)) {
      return res.status(400).json({ error: 'Invalid agent ID' });
    }

    const agent = db.prepare(`
      SELECT id, name, role, responsibilities, system_prompt, created_at 
      FROM agents 
      WHERE id = ? AND status = ?
    `).get(agentId, 'active');

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      responsibilities: agent.responsibilities ? JSON.parse(agent.responsibilities) : [],
      systemPrompt: agent.system_prompt,
      createdAt: agent.created_at,
    });
  } catch (error) {
    logger.error('[A2A] Error getting agent %d:', req.params.id, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;