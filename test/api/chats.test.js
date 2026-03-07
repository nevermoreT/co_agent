import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import chatsRouter from '../../server/routes/chats.js';
import db from '../../server/db.js';
import * as memoryManager from '../../server/services/memoryManager.js';

// Mock dependencies
vi.mock('../../server/db.js');
vi.mock('../../server/services/memoryManager.js');

const mockApp = express();
mockApp.use(express.json());
mockApp.use('/chats', chatsRouter);

describe('Chats Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementations
    db.prepare = vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn(),
    }));
    
    memoryManager.recordEvent = vi.fn();
  });

  describe('GET /chats/agents/:id/messages', () => {
    it('should return messages for specific agent', async () => {
      const mockMessages = [
        { id: 1, agent_id: 'agent1', role: 'user', content: 'Hello' },
        { id: 2, agent_id: 'agent1', role: 'assistant', content: 'Hi there!' }
      ];

      const mockAll = vi.fn(() => mockMessages);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      const response = await request(mockApp)
        .get('/chats/agents/agent1/messages')
        .expect(200);

      expect(response.body).toEqual(mockMessages);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM chat_messages WHERE agent_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
      );
      expect(mockAll).toHaveBeenCalledWith('agent1', 50, 0);
    });

    it('should apply limit and offset parameters', async () => {
      const mockMessages = [{ id: 1, agent_id: 'agent1', role: 'user', content: 'Test' }];
      const mockAll = vi.fn(() => mockMessages);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      await request(mockApp)
        .get('/chats/agents/agent1/messages?limit=10&offset=5')
        .expect(200);

      expect(mockAll).toHaveBeenCalledWith('agent1', 10, 5);
    });

    it('should limit maximum limit to 200', async () => {
      const mockAll = vi.fn(() => []);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      await request(mockApp)
        .get('/chats/agents/agent1/messages?limit=300')
        .expect(200);

      expect(mockAll).toHaveBeenCalledWith('agent1', 200, 0);
    });

    it('should handle database errors', async () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const response = await request(mockApp)
        .get('/chats/agents/agent1/messages')
        .expect(500);

      expect(response.body.error).toBe('Database error');
    });
  });

  describe('POST /chats/agents/:id/messages', () => {
    it('should create message for agent', async () => {
      const messageData = {
        role: 'user',
        content: 'Hello agent',
        task_id: 'task123'
      };

      const createdMessage = { 
        id: 1, 
        agent_id: 'agent1', 
        ...messageData,
        created_at: new Date().toISOString()
      };

      const mockInsertRun = vi.fn(() => ({ lastInsertRowid: 1 }));
      db.prepare
        .mockReturnValueOnce({ get: vi.fn(), run: mockInsertRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(() => createdMessage), run: vi.fn(), all: vi.fn() });

      const response = await request(mockApp)
        .post('/chats/agents/agent1/messages')
        .send(messageData)
        .expect(201);

      expect(response.body).toEqual(createdMessage);
      expect(mockInsertRun).toHaveBeenCalledWith('agent1', messageData.role, messageData.content, 'task123');
    });

    it('should require role and content', async () => {
      const response = await request(mockApp)
        .post('/chats/agents/agent1/messages')
        .send({ role: 'user' }) // missing content
        .expect(400);

      expect(response.body.error).toBe('role 和 content 必填');
    });

    it('should handle empty content as empty string', async () => {
      const messageData = {
        role: 'user',
        content: null
      };

      const mockInsertRun = vi.fn(() => ({ lastInsertRowid: 1 }));
      db.prepare
        .mockReturnValueOnce({ get: vi.fn(), run: mockInsertRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(() => ({ id: 1, content: '' })), run: vi.fn(), all: vi.fn() });

      await request(mockApp)
        .post('/chats/agents/agent1/messages')
        .send(messageData)
        .expect(201);

      expect(mockInsertRun).toHaveBeenCalledWith('agent1', 'user', '', null);
    });

    it('should handle database errors', async () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const response = await request(mockApp)
        .post('/chats/agents/agent1/messages')
        .send({ role: 'user', content: 'test' })
        .expect(500);

      expect(response.body.error).toBe('Database error');
    });
  });

  describe('GET /chats/messages', () => {
    it('should return global messages', async () => {
      const mockMessages = [
        { id: 1, role: 'user', content: 'Hello everyone' },
        { id: 2, role: 'assistant', content: 'Hi!' }
      ];

      const mockAll = vi.fn(() => mockMessages);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      const response = await request(mockApp)
        .get('/chats/messages')
        .expect(200);

      expect(response.body).toEqual(mockMessages);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM global_messages ORDER BY created_at ASC LIMIT ? OFFSET ?'
      );
      expect(mockAll).toHaveBeenCalledWith(100, 0);
    });

    it('should filter by conversation_id', async () => {
      const mockMessages = [{ id: 1, task_id: 'conv1', role: 'user', content: 'Hello' }];
      const mockAll = vi.fn(() => mockMessages);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      await request(mockApp)
        .get('/chats/messages?conversation_id=conv1')
        .expect(200);

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM global_messages WHERE task_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
      );
      expect(mockAll).toHaveBeenCalledWith('conv1', 100, 0);
    });

    it('should filter by task_id (alternative parameter)', async () => {
      const mockMessages = [{ id: 1, task_id: 'task1', role: 'user', content: 'Hello' }];
      const mockAll = vi.fn(() => mockMessages);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      await request(mockApp)
        .get('/chats/messages?task_id=task1')
        .expect(200);

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM global_messages WHERE task_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
      );
      expect(mockAll).toHaveBeenCalledWith('task1', 100, 0);
    });

    it('should apply pagination parameters', async () => {
      const mockAll = vi.fn(() => []);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      await request(mockApp)
        .get('/chats/messages?limit=50&offset=10')
        .expect(200);

      expect(mockAll).toHaveBeenCalledWith(50, 10);
    });

    it('should limit maximum limit to 500', async () => {
      const mockAll = vi.fn(() => []);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      await request(mockApp)
        .get('/chats/messages?limit=600')
        .expect(200);

      expect(mockAll).toHaveBeenCalledWith(500, 0);
    });

    it('should handle database errors', async () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const response = await request(mockApp)
        .get('/chats/messages')
        .expect(500);

      expect(response.body.error).toBe('Database error');
    });
  });

  describe('POST /chats/messages', () => {
    it('should create global message', async () => {
      const messageData = {
        role: 'user',
        content: 'Hello world',
        agent_id: 'agent1',
        agent_name: 'Agent 1',
        task_id: 'task123',
        message_type: 'text',
        metadata: { source: 'web' }
      };

      const createdMessage = { 
        id: 1, 
        ...messageData,
        metadata: JSON.stringify(messageData.metadata),
        created_at: new Date().toISOString()
      };

      const mockInsertRun = vi.fn(() => ({ lastInsertRowid: 1 }));
      const mockUpdateRun = vi.fn();
      db.prepare
        .mockReturnValueOnce({ get: vi.fn(), run: mockInsertRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(), run: mockUpdateRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(() => createdMessage), run: vi.fn(), all: vi.fn() });

      const response = await request(mockApp)
        .post('/chats/messages')
        .send(messageData)
        .expect(201);

      expect(response.body).toEqual(createdMessage);
      expect(mockInsertRun).toHaveBeenCalledWith(
        messageData.role,
        messageData.content,
        messageData.agent_id,
        messageData.agent_name,
        messageData.task_id,
        messageData.message_type,
        JSON.stringify(messageData.metadata)
      );
    });

    it('should default message_type to text', async () => {
      const messageData = {
        role: 'user',
        content: 'Hello world'
      };

      const mockInsertRun = vi.fn(() => ({ lastInsertRowid: 1 }));
      db.prepare
        .mockReturnValueOnce({ get: vi.fn(), run: mockInsertRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(() => ({ id: 1, message_type: 'text' })), run: vi.fn(), all: vi.fn() });

      await request(mockApp)
        .post('/chats/messages')
        .send(messageData)
        .expect(201);

      expect(mockInsertRun).toHaveBeenCalledWith(
        messageData.role,
        messageData.content,
        null,
        null,
        null,
        'text',
        null
      );
    });

    it('should require role and content', async () => {
      const response = await request(mockApp)
        .post('/chats/messages')
        .send({ role: 'user' }) // missing content
        .expect(400);

      expect(response.body.error).toBe('role 和 content 必填');
    });

    it('should update task last activity when task_id provided', async () => {
      const messageData = {
        role: 'user',
        content: 'Hello',
        task_id: 'task123'
      };

      const mockInsertRun = vi.fn(() => ({ lastInsertRowid: 1 }));
      const mockUpdateRun = vi.fn();
      db.prepare
        .mockReturnValueOnce({ get: vi.fn(), run: mockInsertRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(), run: mockUpdateRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(() => ({ id: 1 })), run: vi.fn(), all: vi.fn() });

      await request(mockApp)
        .post('/chats/messages')
        .send(messageData)
        .expect(201);

      expect(mockUpdateRun).toHaveBeenCalledWith('task123');
    });

    it('should record memory event for user messages', async () => {
      const messageData = {
        role: 'user',
        content: '@Agent1 Hello agent, how are you?',
        task_id: 'task123'
      };

      const mockInsertRun = vi.fn(() => ({ lastInsertRowid: 1 }));
      db.prepare
        .mockReturnValueOnce({ get: vi.fn(), run: mockInsertRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(() => ({ id: 1 })), run: vi.fn(), all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(), run: vi.fn(), all: vi.fn() });

      await request(mockApp)
        .post('/chats/messages')
        .send(messageData)
        .expect(201);

      expect(memoryManager.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'conversation',
          conversationId: 'task123',
          content: '@Agent1 Hello agent, how are you?',
          importance: 6
        })
      );
      expect(memoryManager.recordEvent.mock.calls[0][0].title).toBeTruthy();
    });

    it('should not record memory event for thinking messages', async () => {
      const messageData = {
        role: 'user',
        content: 'Hello agent',
        task_id: 'task123',
        message_type: 'thinking'
      };

      const mockInsertRun = vi.fn(() => ({ lastInsertRowid: 1 }));
      db.prepare
        .mockReturnValueOnce({ get: vi.fn(), run: mockInsertRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(() => ({ id: 1 })), run: vi.fn(), all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(), run: vi.fn(), all: vi.fn() });

      await request(mockApp)
        .post('/chats/messages')
        .send(messageData)
        .expect(201);

      expect(memoryManager.recordEvent).not.toHaveBeenCalled();
    });

    it('should handle string metadata', async () => {
      const messageData = {
        role: 'user',
        content: 'Hello',
        metadata: '{"source":"web"}' // string instead of object
      };

      const mockInsertRun = vi.fn(() => ({ lastInsertRowid: 1 }));
      db.prepare
        .mockReturnValueOnce({ get: vi.fn(), run: mockInsertRun, all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(() => ({ id: 1 })), run: vi.fn(), all: vi.fn() });

      await request(mockApp)
        .post('/chats/messages')
        .send(messageData)
        .expect(201);

      expect(mockInsertRun).toHaveBeenCalledWith(
        messageData.role,
        messageData.content,
        null,
        null,
        null,
        'text',
        '{"source":"web"}'
      );
    });

    it('should handle database errors', async () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const response = await request(mockApp)
        .post('/chats/messages')
        .send({ role: 'user', content: 'test' })
        .expect(500);

      expect(response.body.error).toBe('Database error');
    });
  });
});