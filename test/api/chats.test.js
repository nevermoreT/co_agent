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

      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => mockMessages)
      });
      db.prepare.mockReturnValue(mockQuery);

      const response = await request(mockApp)
        .get('/chats/agents/agent1/messages')
        .expect(200);

      expect(response.body).toEqual(mockMessages);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM chat_messages WHERE agent_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
      );
      expect(mockQuery.all).toHaveBeenCalledWith('agent1', 50, 0);
    });

    it('should apply limit and offset parameters', async () => {
      const mockMessages = [{ id: 1, agent_id: 'agent1', role: 'user', content: 'Test' }];
      
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => mockMessages)
      });
      db.prepare.mockReturnValue(mockQuery);

      await request(mockApp)
        .get('/chats/agents/agent1/messages?limit=10&offset=5')
        .expect(200);

      expect(mockQuery.all).toHaveBeenCalledWith('agent1', 10, 5);
    });

    it('should limit maximum limit to 200', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => [])
      });
      db.prepare.mockReturnValue(mockQuery);

      await request(mockApp)
        .get('/chats/agents/agent1/messages?limit=300')
        .expect(200);

      expect(mockQuery.all).toHaveBeenCalledWith('agent1', 200, 0);
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

      const mockInsertQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ lastInsertRowid: 1 }))
      });
      
      const mockSelectQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => createdMessage)
      });

      db.prepare
        .mockReturnValueOnce(mockInsertQuery)
        .mockReturnValueOnce(mockSelectQuery);

      const response = await request(mockApp)
        .post('/chats/agents/agent1/messages')
        .send(messageData)
        .expect(201);

      expect(response.body).toEqual(createdMessage);
      expect(mockInsertQuery.run).toHaveBeenCalledWith('agent1', messageData.role, messageData.content, 'task123');
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

      const mockInsertQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ lastInsertRowid: 1 }))
      });
      
      const mockSelectQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => ({ id: 1, content: '' }))
      });

      db.prepare
        .mockReturnValueOnce(mockInsertQuery)
        .mockReturnValueOnce(mockSelectQuery);

      await request(mockApp)
        .post('/chats/agents/agent1/messages')
        .send(messageData)
        .expect(201);

      expect(mockInsertQuery.run).toHaveBeenCalledWith('agent1', 'user', '', null);
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

      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => mockMessages)
      });
      db.prepare.mockReturnValue(mockQuery);

      const response = await request(mockApp)
        .get('/chats/messages')
        .expect(200);

      expect(response.body).toEqual(mockMessages);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM global_messages ORDER BY created_at ASC LIMIT ? OFFSET ?'
      );
      expect(mockQuery.all).toHaveBeenCalledWith(100, 0);
    });

    it('should filter by conversation_id', async () => {
      const mockMessages = [{ id: 1, task_id: 'conv1', role: 'user', content: 'Hello' }];
      
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => mockMessages)
      });
      db.prepare.mockReturnValue(mockQuery);

      await request(mockApp)
        .get('/chats/messages?conversation_id=conv1')
        .expect(200);

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM global_messages WHERE task_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
      );
      expect(mockQuery.all).toHaveBeenCalledWith('conv1', 100, 0);
    });

    it('should filter by task_id (alternative parameter)', async () => {
      const mockMessages = [{ id: 1, task_id: 'task1', role: 'user', content: 'Hello' }];
      
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => mockMessages)
      });
      db.prepare.mockReturnValue(mockQuery);

      await request(mockApp)
        .get('/chats/messages?task_id=task1')
        .expect(200);

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM global_messages WHERE task_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
      );
      expect(mockQuery.all).toHaveBeenCalledWith('task1', 100, 0);
    });

    it('should apply pagination parameters', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => [])
      });
      db.prepare.mockReturnValue(mockQuery);

      await request(mockApp)
        .get('/chats/messages?limit=50&offset=10')
        .expect(200);

      expect(mockQuery.all).toHaveBeenCalledWith(50, 10);
    });

    it('should limit maximum limit to 500', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => [])
      });
      db.prepare.mockReturnValue(mockQuery);

      await request(mockApp)
        .get('/chats/messages?limit=600')
        .expect(200);

      expect(mockQuery.all).toHaveBeenCalledWith(500, 0);
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

      const mockInsertQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ lastInsertRowid: 1 }))
      });
      
      const mockSelectQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => createdMessage)
      });
      
      const mockUpdateQuery = vi.fn().mockReturnValue({
        run: vi.fn()
      });

      db.prepare
        .mockReturnValueOnce(mockInsertQuery)
        .mockReturnValueOnce(mockSelectQuery)
        .mockReturnValueOnce(mockUpdateQuery);

      const response = await request(mockApp)
        .post('/chats/messages')
        .send(messageData)
        .expect(201);

      expect(response.body).toEqual(createdMessage);
      expect(mockInsertQuery.run).toHaveBeenCalledWith(
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

      const mockInsertQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ lastInsertRowid: 1 }))
      });
      
      const mockSelectQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => ({ id: 1, message_type: 'text' }))
      });

      db.prepare
        .mockReturnValueOnce(mockInsertQuery)
        .mockReturnValueOnce(mockSelectQuery);

      await request(mockApp)
        .post('/chats/messages')
        .send(messageData)
        .expect(201);

      expect(mockInsertQuery.run).toHaveBeenCalledWith(
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

      const mockInsertQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ lastInsertRowid: 1 }))
      });
      
      const mockSelectQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => ({ id: 1 }))
      });
      
      const mockUpdateQuery = vi.fn().mockReturnValue({
        run: vi.fn()
      });

      db.prepare
        .mockReturnValueOnce(mockInsertQuery)
        .mockReturnValueOnce(mockSelectQuery)
        .mockReturnValueOnce(mockUpdateQuery);

      await request(mockApp)
        .post('/chats/messages')
        .send(messageData)
        .expect(201);

      expect(mockUpdateQuery.run).toHaveBeenCalledWith('task123');
    });

    it('should record memory event for user messages', async () => {
      const messageData = {
        role: 'user',
        content: '@Agent1 Hello agent, how are you?',
        task_id: 'task123'
      };

      const mockInsertQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ lastInsertRowid: 1 }))
      });
      
      const mockSelectQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => ({ id: 1 }))
      });
      
      const mockUpdateQuery = vi.fn().mockReturnValue({
        run: vi.fn()
      });

      db.prepare
        .mockReturnValueOnce(mockInsertQuery)
        .mockReturnValueOnce(mockSelectQuery)
        .mockReturnValueOnce(mockUpdateQuery);

      await request(mockApp)
        .post('/chats/messages')
        .send(messageData)
        .expect(201);

      expect(memoryManager.recordEvent).toHaveBeenCalledWith({
        eventType: 'conversation',
        conversationId: 'task123',
        title: 'Hello agent, how are you?',
        content: '@Agent1 Hello agent, how are you?',
        importance: 6
      });
    });

    it('should not record memory event for thinking messages', async () => {
      const messageData = {
        role: 'user',
        content: 'Hello agent',
        task_id: 'task123',
        message_type: 'thinking'
      };

      const mockInsertQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ lastInsertRowid: 1 }))
      });
      
      const mockSelectQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => ({ id: 1 }))
      });
      
      const mockUpdateQuery = vi.fn().mockReturnValue({
        run: vi.fn()
      });

      db.prepare
        .mockReturnValueOnce(mockInsertQuery)
        .mockReturnValueOnce(mockSelectQuery)
        .mockReturnValueOnce(mockUpdateQuery);

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

      const mockInsertQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ lastInsertRowid: 1 }))
      });
      
      const mockSelectQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => ({ id: 1 }))
      });

      db.prepare
        .mockReturnValueOnce(mockInsertQuery)
        .mockReturnValueOnce(mockSelectQuery);

      await request(mockApp)
        .post('/chats/messages')
        .send(messageData)
        .expect(201);

      expect(mockInsertQuery.run).toHaveBeenCalledWith(
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