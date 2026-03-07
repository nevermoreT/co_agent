import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import agentsRouter from '../../server/routes/agents.js';
import db from '../../server/db.js';
import * as agentRunner from '../../server/services/agentRunner.js';
import * as soulManager from '../../server/services/soulManager.js';

// Mock dependencies
vi.mock('../../server/db.js');
vi.mock('../../server/services/agentRunner.js');
vi.mock('../../server/services/soulManager.js');

const mockApp = express();
mockApp.use(express.json());
mockApp.use('/agents', agentsRouter);

describe('Agents Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementations
    db.prepare = vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn(),
    }));
    
    agentRunner.getRunningAgentIds = vi.fn(() => []);
    soulManager.getAvailableTemplates = vi.fn(() => []);
    soulManager.getAgentSoul = vi.fn(() => null);
    soulManager.updateAgentSoul = vi.fn(() => ({}));
    soulManager.mergeSoulConfig = vi.fn(() => ({}));
    soulManager.applySoulTemplate = vi.fn(() => ({}));
  });

  describe('GET /agents/status/running', () => {
    it('should return list of running agent IDs', async () => {
      agentRunner.getRunningAgentIds = vi.fn(() => ['agent1', 'agent2']);
      
      const response = await request(mockApp)
        .get('/agents/status/running')
        .expect(200);

      expect(response.body).toEqual({ running: ['agent1', 'agent2'] });
      expect(agentRunner.getRunningAgentIds).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      agentRunner.getRunningAgentIds = vi.fn(() => {
        throw new Error('Service error');
      });

      const response = await request(mockApp)
        .get('/agents/status/running')
        .expect(500);

      expect(response.body.error).toBe('Service error');
    });
  });

  describe('GET /agents', () => {
    it('should return list of all agents', async () => {
      const mockAgents = [
        { id: 1, name: 'Agent 1', cli_command: 'node test.js' },
        { id: 2, name: 'Agent 2', cli_command: 'python test.py' }
      ];

      const mockAll = vi.fn(() => mockAgents);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      const response = await request(mockApp)
        .get('/agents')
        .expect(200);

      expect(response.body).toEqual(mockAgents);
      expect(db.prepare).toHaveBeenCalledWith('SELECT * FROM agents ORDER BY id');
    });

    it('should handle database errors', async () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const response = await request(mockApp)
        .get('/agents')
        .expect(500);

      expect(response.body.error).toBe('Database error');
    });
  });

  describe('GET /agents/soul-templates', () => {
    it('should return available soul templates', async () => {
      const mockTemplates = [
        { name: 'developer', description: 'Developer agent' },
        { name: 'analyst', description: 'Analyst agent' }
      ];

      soulManager.getAvailableTemplates = vi.fn(() => mockTemplates);

      const response = await request(mockApp)
        .get('/agents/soul-templates')
        .expect(200);

      expect(response.body).toEqual(mockTemplates);
    });

    it('should handle service errors', async () => {
      soulManager.getAvailableTemplates = vi.fn(() => {
        throw new Error('Service error');
      });

      const response = await request(mockApp)
        .get('/agents/soul-templates')
        .expect(500);

      expect(response.body.error).toBe('Service error');
    });
  });

  describe('GET /agents/:id', () => {
    it('should return agent by ID', async () => {
      const mockAgent = { id: 1, name: 'Test Agent', cli_command: 'node test.js' };
      
      const mockGet = vi.fn(() => mockAgent);
      db.prepare.mockReturnValue({ get: mockGet, run: vi.fn(), all: vi.fn() });

      const response = await request(mockApp)
        .get('/agents/1')
        .expect(200);

      expect(response.body).toEqual(mockAgent);
      expect(db.prepare).toHaveBeenCalledWith('SELECT * FROM agents WHERE id = ?');
      expect(mockGet).toHaveBeenCalledWith('1');
    });

    it('should return 404 for non-existent agent', async () => {
      db.prepare.mockReturnValue({
        get: vi.fn(() => undefined),
        run: vi.fn(),
        all: vi.fn(),
      });

      const response = await request(mockApp)
        .get('/agents/999')
        .expect(404);

      expect(response.body.error).toBe('Agent not found');
    });
  });

  describe('POST /agents', () => {
    it('should create a new agent', async () => {
      const newAgent = {
        name: 'Test Agent',
        cli_command: 'node test.js',
        role: 'developer',
        responsibilities: ['coding', 'testing'],
        system_prompt: 'You are a helpful assistant'
      };

      const createdAgent = { id: 1, ...newAgent, responsibilities: JSON.stringify(newAgent.responsibilities) };

      const mockInsertRun = vi.fn(() => ({ lastInsertRowid: 1 }));
      db.prepare
        .mockReturnValueOnce({ get: vi.fn(() => ({ c: 0 })), run: vi.fn(), all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(), run: mockInsertRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(() => createdAgent), run: vi.fn(), all: vi.fn() });

      const response = await request(mockApp)
        .post('/agents')
        .send(newAgent)
        .expect(201);

      expect(response.body).toEqual(createdAgent);
      expect(mockInsertRun).toHaveBeenCalledWith(
        newAgent.name,
        newAgent.cli_command,
        null, // cli_cwd
        newAgent.role,
        JSON.stringify(newAgent.responsibilities),
        newAgent.system_prompt
      );
    });

    it('should reject when max agents limit reached', async () => {
      db.prepare.mockReturnValue({
        get: vi.fn(() => ({ c: 5 })),
        run: vi.fn(),
        all: vi.fn(),
      });

      const response = await request(mockApp)
        .post('/agents')
        .send({ name: 'Test Agent', cli_command: 'node test.js' })
        .expect(400);

      expect(response.body.error).toBe('最多只能添加 5 个 Agent');
    });

    it('should require name and cli_command', async () => {
      // Route checks count first, then validates body
      db.prepare.mockReturnValue({
        get: vi.fn(() => ({ c: 0 })),
        run: vi.fn(),
        all: vi.fn(),
      });

      const response = await request(mockApp)
        .post('/agents')
        .send({ name: 'Test Agent' }) // missing cli_command
        .expect(400);

      expect(response.body.error).toBe('name 和 cli_command 必填');
    });
  });

  describe('PATCH /agents/:id', () => {
    it('should update agent partially', async () => {
      const existingAgent = { 
        id: 1, 
        name: 'Old Name', 
        cli_command: 'old command',
        cli_cwd: '/old/path',
        session_id: 'session123',
        role: 'old_role',
        responsibilities: '[]',
        system_prompt: 'old prompt'
      };

      const updateData = { name: 'New Name', role: 'developer' };

      const mockUpdateRun = vi.fn();
      db.prepare
        .mockReturnValueOnce({ get: vi.fn(() => existingAgent), run: vi.fn(), all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(), run: mockUpdateRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(() => ({ ...existingAgent, ...updateData })), run: vi.fn(), all: vi.fn() });

      const response = await request(mockApp)
        .patch('/agents/1')
        .send(updateData)
        .expect(200);

      expect(mockUpdateRun).toHaveBeenCalledWith(
        'New Name', // updated name
        'old command', // unchanged cli_command
        '/old/path', // unchanged cli_cwd
        'session123', // unchanged session_id
        'developer', // updated role
        '[]', // unchanged responsibilities
        'old prompt', // unchanged system_prompt
        '1' // agent id
      );
    });

    it('should return 404 for non-existent agent', async () => {
      db.prepare.mockReturnValue({
        get: vi.fn(() => undefined),
        run: vi.fn(),
        all: vi.fn(),
      });

      const response = await request(mockApp)
        .patch('/agents/999')
        .send({ name: 'New Name' })
        .expect(404);

      expect(response.body.error).toBe('Agent not found');
    });
  });

  describe('PUT /agents/:id/session', () => {
    it('should set agent session ID', async () => {
      const existingAgent = { id: 1, name: 'Test Agent' };

      const mockUpdateRun = vi.fn();
      db.prepare
        .mockReturnValueOnce({ get: vi.fn(() => existingAgent), run: vi.fn(), all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(), run: mockUpdateRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(() => ({ ...existingAgent, session_id: 'new-session' })), run: vi.fn(), all: vi.fn() });

      const response = await request(mockApp)
        .put('/agents/1/session')
        .send({ session_id: 'new-session' })
        .expect(200);

      expect(mockUpdateRun).toHaveBeenCalledWith('new-session', '1');
    });

    it('should handle null session_id', async () => {
      const existingAgent = { id: 1, name: 'Test Agent' };

      const mockUpdateRun = vi.fn();
      db.prepare
        .mockReturnValueOnce({ get: vi.fn(() => existingAgent), run: vi.fn(), all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(), run: mockUpdateRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(() => ({ ...existingAgent, session_id: null })), run: vi.fn(), all: vi.fn() });

      const response = await request(mockApp)
        .put('/agents/1/session')
        .send({ session_id: null })
        .expect(200);

      expect(mockUpdateRun).toHaveBeenCalledWith(null, '1');
    });
  });

  describe('DELETE /agents/:id/session', () => {
    it('should clear agent session ID', async () => {
      const existingAgent = { id: 1, name: 'Test Agent', session_id: 'session123' };

      const mockUpdateRun = vi.fn();
      db.prepare
        .mockReturnValueOnce({ get: vi.fn(() => existingAgent), run: vi.fn(), all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(), run: mockUpdateRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(() => ({ ...existingAgent, session_id: null })), run: vi.fn(), all: vi.fn() });

      const response = await request(mockApp)
        .delete('/agents/1/session')
        .expect(200);

      expect(mockUpdateRun).toHaveBeenCalledWith('1');
      expect(response.body.session_id).toBeNull();
    });
  });

  describe('DELETE /agents/:id', () => {
    it('should delete agent', async () => {
      const mockRun = vi.fn(() => ({ changes: 1 }));
      db.prepare.mockReturnValue({ get: vi.fn(), run: mockRun, all: vi.fn() });

      const response = await request(mockApp)
        .delete('/agents/1')
        .expect(204);

      expect(response.body).toEqual({});
      expect(mockRun).toHaveBeenCalledWith('1');
    });

    it('should return 404 for non-existent agent', async () => {
      const mockRun = vi.fn(() => ({ changes: 0 }));
      db.prepare.mockReturnValue({ get: vi.fn(), run: mockRun, all: vi.fn() });

      const response = await request(mockApp)
        .delete('/agents/999')
        .expect(404);

      expect(response.body.error).toBe('Agent not found');
    });
  });

  describe('Soul Configuration Routes', () => {
    describe('GET /agents/:id/soul', () => {
      it('should get agent soul configuration', async () => {
        const mockSoul = { personality: 'friendly', expertise: ['coding'] };
        soulManager.getAgentSoul = vi.fn(() => mockSoul);

        const response = await request(mockApp)
          .get('/agents/1/soul')
          .expect(200);

        expect(response.body).toEqual(mockSoul);
        expect(soulManager.getAgentSoul).toHaveBeenCalledWith('1');
      });

      it('should return 404 for non-existent agent', async () => {
        soulManager.getAgentSoul = vi.fn(() => null);

        const response = await request(mockApp)
          .get('/agents/999/soul')
          .expect(404);

        expect(response.body.error).toBe('Agent not found');
      });
    });

    describe('PUT /agents/:id/soul', () => {
      it('should update agent soul configuration', async () => {
        const soulData = { personality: 'professional' };
        const updatedSoul = { ...soulData, expertise: ['coding'] };
        
        soulManager.updateAgentSoul = vi.fn(() => {});
        soulManager.getAgentSoul = vi.fn(() => updatedSoul);

        const response = await request(mockApp)
          .put('/agents/1/soul')
          .send(soulData)
          .expect(200);

        expect(soulManager.updateAgentSoul).toHaveBeenCalledWith('1', soulData);
        expect(response.body).toEqual(updatedSoul);
      });
    });

    describe('PATCH /agents/:id/soul', () => {
      it('should merge agent soul configuration', async () => {
        const partialSoul = { personality: 'friendly' };
        const mergedSoul = { personality: 'friendly', expertise: ['coding'] };
        
        soulManager.mergeSoulConfig = vi.fn(() => mergedSoul);

        const response = await request(mockApp)
          .patch('/agents/1/soul')
          .send(partialSoul)
          .expect(200);

        expect(soulManager.mergeSoulConfig).toHaveBeenCalledWith('1', partialSoul);
        expect(response.body).toEqual(mergedSoul);
      });
    });

    describe('POST /agents/:id/soul/apply-template', () => {
      it('should apply soul template', async () => {
        const templateData = { personality: 'developer', expertise: ['coding', 'testing'] };
        const templateName = 'developer';
        
        soulManager.applySoulTemplate = vi.fn(() => templateData);

        const response = await request(mockApp)
          .post('/agents/1/soul/apply-template')
          .send({ templateName })
          .expect(200);

        expect(soulManager.applySoulTemplate).toHaveBeenCalledWith('1', templateName);
        expect(response.body).toEqual(templateData);
      });

      it('should require templateName', async () => {
        const response = await request(mockApp)
          .post('/agents/1/soul/apply-template')
          .send({})
          .expect(400);

        expect(response.body.error).toBe('templateName is required');
      });

      it('should handle template application errors', async () => {
        soulManager.applySoulTemplate = vi.fn(() => {
          throw new Error('Template not found');
        });

        const response = await request(mockApp)
          .post('/agents/1/soul/apply-template')
          .send({ templateName: 'nonexistent' })
          .expect(400);

        expect(response.body.error).toBe('Template not found');
      });
    });
  });
});