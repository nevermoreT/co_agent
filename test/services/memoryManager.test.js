import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as memoryManager from '../../server/services/memoryManager.js';
import db from '../../server/db.js';
import logger from '../../server/logger.js';

// Mock dependencies
vi.mock('../../server/db.js');
vi.mock('../../server/logger.js');

describe('Memory Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementations
    db.prepare = vi.fn(() => ({
      get: vi.fn(),
      run: vi.fn(),
      all: vi.fn(),
    }));
    
    logger.log = vi.fn();
    logger.error = vi.fn();
  });

  describe('recordEvent', () => {
    it('should record event with all parameters', () => {
      const eventData = {
        eventType: 'conversation',
        sourceAgentId: 'agent1',
        sourceAgentName: 'Agent 1',
        conversationId: 'conv1',
        title: 'Test Event',
        content: 'Test content',
        summary: 'Test summary',
        metadata: { source: 'web' },
        importance: 8
      };

      const mockQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ lastInsertRowid: 123 }))
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = memoryManager.recordEvent(eventData);

      expect(result).toBe(123);
      expect(db.prepare).toHaveBeenCalledWith(`
        INSERT INTO shared_events 
        (event_type, source_agent_id, source_agent_name, conversation_id, title, content, summary, metadata, importance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      expect(mockQuery.run).toHaveBeenCalledWith(
        'conversation',
        'agent1',
        'Agent 1',
        'conv1',
        'Test Event',
        'Test content',
        'Test summary',
        '{"source":"web"}',
        8
      );
      expect(logger.log).toHaveBeenCalledWith(
        '[memory] recorded event: type=%s title=%s id=%d',
        'conversation',
        'Test Event',
        123
      );
    });

    it('should record event with minimal parameters', () => {
      const eventData = {
        eventType: 'test',
        title: 'Minimal Event',
        content: 'Minimal content'
      };

      const mockQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ lastInsertRowid: 456 }))
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = memoryManager.recordEvent(eventData);

      expect(result).toBe(456);
      expect(mockQuery.run).toHaveBeenCalledWith(
        'test',
        null,
        null,
        null,
        'Minimal Event',
        'Minimal content',
        null,
        null,
        5 // default importance
      );
    });

    it('should handle null metadata', () => {
      const eventData = {
        eventType: 'test',
        title: 'Test Event',
        content: 'Test content',
        metadata: null
      };

      const mockQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ lastInsertRowid: 789 }))
      });
      db.prepare.mockReturnValue(mockQuery);

      memoryManager.recordEvent(eventData);

      expect(mockQuery.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        null, // metadata should be null
        expect.anything()
      );
    });

    it('should handle database errors', () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const result = memoryManager.recordEvent({
        eventType: 'test',
        title: 'Test Event',
        content: 'Test content'
      });

      expect(result).toBe(null);
      expect(logger.error).toHaveBeenCalledWith('[memory] failed to record event:', expect.any(Error));
    });
  });

  describe('getEvents', () => {
    it('should return events with default parameters', () => {
      const mockEvents = [
        { id: 1, event_type: 'conversation', title: 'Event 1' },
        { id: 2, event_type: 'task', title: 'Event 2' }
      ];

      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => mockEvents)
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = memoryManager.getEvents();

      expect(result).toEqual(mockEvents);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE 1=1 ORDER BY created_at DESC LIMIT ? OFFSET ?'
      );
      expect(mockQuery.all).toHaveBeenCalledWith(50, 0);
    });

    it('should filter by event type', () => {
      const mockEvents = [{ id: 1, event_type: 'conversation', title: 'Event 1' }];
      
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => mockEvents)
      });
      db.prepare.mockReturnValue(mockQuery);

      memoryManager.getEvents({ eventType: 'conversation' });

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE 1=1 AND event_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      );
      expect(mockQuery.all).toHaveBeenCalledWith('conversation', 50, 0);
    });

    it('should filter by source agent ID', () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => [])
      });
      db.prepare.mockReturnValue(mockQuery);

      memoryManager.getEvents({ sourceAgentId: 'agent1' });

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE 1=1 AND source_agent_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      );
      expect(mockQuery.all).toHaveBeenCalledWith('agent1', 50, 0);
    });

    it('should filter by conversation ID', () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => [])
      });
      db.prepare.mockReturnValue(mockQuery);

      memoryManager.getEvents({ conversationId: 'conv1' });

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE 1=1 AND conversation_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      );
      expect(mockQuery.all).toHaveBeenCalledWith('conv1', 50, 0);
    });

    it('should filter by minimum importance', () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => [])
      });
      db.prepare.mockReturnValue(mockQuery);

      memoryManager.getEvents({ minImportance: 7 });

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE 1=1 AND importance >= ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      );
      expect(mockQuery.all).toHaveBeenCalledWith(7, 50, 0);
    });

    it('should exclude specific agent', () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => [])
      });
      db.prepare.mockReturnValue(mockQuery);

      memoryManager.getEvents({ excludeAgentId: 'agent2' });

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE 1=1 AND source_agent_id != ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      );
      expect(mockQuery.all).toHaveBeenCalledWith('agent2', 50, 0);
    });

    it('should apply multiple filters', () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => [])
      });
      db.prepare.mockReturnValue(mockQuery);

      memoryManager.getEvents({
        eventType: 'conversation',
        sourceAgentId: 'agent1',
        conversationId: 'conv1',
        minImportance: 6,
        excludeAgentId: 'agent2',
        limit: 20,
        offset: 10
      });

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE 1=1 AND event_type = ? AND source_agent_id = ? AND conversation_id = ? AND importance >= ? AND source_agent_id != ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      );
      expect(mockQuery.all).toHaveBeenCalledWith('conversation', 'agent1', 'conv1', 6, 'agent2', 20, 10);
    });

    it('should handle database errors', () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const result = memoryManager.getEvents();

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('[memory] failed to get events:', expect.any(Error));
    });
  });

  describe('getContextForConversation', () => {
    it('should return context for conversation', () => {
      const mockEvents = [
        { id: 1, title: 'Event 1', content: 'Content 1', importance: 8 },
        { id: 2, title: 'Event 2', content: 'Content 2', importance: 6 }
      ];

      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => mockEvents)
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = memoryManager.getContextForConversation('conv1');

      expect(result).toEqual(mockEvents);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE conversation_id = ? AND importance >= 6 ORDER BY importance DESC, created_at DESC LIMIT 20'
      );
      expect(mockQuery.all).toHaveBeenCalledWith('conv1');
    });

    it('should handle empty conversation ID', () => {
      const result = memoryManager.getContextForConversation('');

      expect(result).toEqual([]);
    });

    it('should handle database errors', () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const result = memoryManager.getContextForConversation('conv1');

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('[memory] failed to get context:', expect.any(Error));
    });
  });

  describe('upsertKnowledge', () => {
    it('should insert new knowledge', () => {
      const knowledgeData = {
        key: 'test-key',
        content: 'Test content',
        sourceAgentId: 'agent1',
        sourceAgentName: 'Agent 1'
      };

      const mockExistingQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => undefined)
      });
      
      const mockInsertQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ lastInsertRowid: 123 }))
      });

      db.prepare
        .mockReturnValueOnce(mockExistingQuery)
        .mockReturnValueOnce(mockInsertQuery);

      const result = memoryManager.upsertKnowledge(knowledgeData);

      expect(result).toBe(123);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT id FROM shared_knowledge WHERE key = ?'
      );
      expect(db.prepare).toHaveBeenCalledWith(
        'INSERT INTO shared_knowledge (key, content, source_agent_id, source_agent_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      expect(mockInsertQuery.run).toHaveBeenCalledWith(
        'test-key',
        'Test content',
        'agent1',
        'Agent 1',
        expect.any(String), // created_at
        expect.any(String)  // updated_at
      );
    });

    it('should update existing knowledge', () => {
      const existingKnowledge = { id: 1, key: 'test-key' };
      const knowledgeData = {
        key: 'test-key',
        content: 'Updated content',
        sourceAgentId: 'agent2',
        sourceAgentName: 'Agent 2'
      };

      const mockExistingQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => existingKnowledge)
      });
      
      const mockUpdateQuery = vi.fn().mockReturnValue({
        run: vi.fn()
      });

      db.prepare
        .mockReturnValueOnce(mockExistingQuery)
        .mockReturnValueOnce(mockUpdateQuery);

      const result = memoryManager.upsertKnowledge(knowledgeData);

      expect(result).toBe(1); // existing ID
      expect(db.prepare).toHaveBeenCalledWith(
        'UPDATE shared_knowledge SET content = ?, source_agent_id = ?, source_agent_name = ?, updated_at = ? WHERE id = ?'
      );
      expect(mockUpdateQuery.run).toHaveBeenCalledWith(
        'Updated content',
        'agent2',
        'Agent 2',
        expect.any(String), // updated_at
        1
      );
    });

    it('should handle database errors', () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const result = memoryManager.upsertKnowledge({
        key: 'test-key',
        content: 'Test content'
      });

      expect(result).toBe(null);
      expect(logger.error).toHaveBeenCalledWith('[memory] failed to upsert knowledge:', expect.any(Error));
    });
  });

  describe('getKnowledge', () => {
    it('should return knowledge by key', () => {
      const mockKnowledge = {
        id: 1,
        key: 'test-key',
        content: 'Test content',
        source_agent_id: 'agent1',
        source_agent_name: 'Agent 1'
      };

      const mockQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => mockKnowledge)
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = memoryManager.getKnowledge('test-key');

      expect(result).toEqual(mockKnowledge);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_knowledge WHERE key = ?'
      );
      expect(mockQuery.get).toHaveBeenCalledWith('test-key');
    });

    it('should return null when knowledge not found', () => {
      const mockQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => undefined)
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = memoryManager.getKnowledge('nonexistent');

      expect(result).toBe(null);
    });

    it('should handle empty key', () => {
      const result = memoryManager.getKnowledge('');

      expect(result).toBe(null);
    });

    it('should handle database errors', () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const result = memoryManager.getKnowledge('test-key');

      expect(result).toBe(null);
      expect(logger.error).toHaveBeenCalledWith('[memory] failed to get knowledge:', expect.any(Error));
    });
  });

  describe('searchKnowledge', () => {
    it('should search knowledge with pattern', () => {
      const mockResults = [
        { id: 1, key: 'test-key-1', content: 'Content about testing' },
        { id: 2, key: 'test-key-2', content: 'More test content' }
      ];

      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => mockResults)
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = memoryManager.searchKnowledge('test');

      expect(result).toEqual(mockResults);
      expect(db.prepare).toHaveBeenCalledWith(
        "SELECT * FROM shared_knowledge WHERE key LIKE ? OR content LIKE ? ORDER BY updated_at DESC"
      );
      expect(mockQuery.all).toHaveBeenCalledWith('%test%', '%test%');
    });

    it('should handle empty search term', () => {
      const result = memoryManager.searchKnowledge('');

      expect(result).toEqual([]);
    });

    it('should handle database errors', () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const result = memoryManager.searchKnowledge('test');

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('[memory] failed to search knowledge:', expect.any(Error));
    });
  });

  describe('deleteKnowledge', () => {
    it('should delete knowledge by key', () => {
      const mockQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ changes: 1 }))
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = memoryManager.deleteKnowledge('test-key');

      expect(result).toBe(true);
      expect(db.prepare).toHaveBeenCalledWith(
        'DELETE FROM shared_knowledge WHERE key = ?'
      );
      expect(mockQuery.run).toHaveBeenCalledWith('test-key');
    });

    it('should return false when knowledge not found', () => {
      const mockQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ changes: 0 }))
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = memoryManager.deleteKnowledge('nonexistent');

      expect(result).toBe(false);
    });

    it('should handle empty key', () => {
      const result = memoryManager.deleteKnowledge('');

      expect(result).toBe(false);
    });

    it('should handle database errors', () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const result = memoryManager.deleteKnowledge('test-key');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[memory] failed to delete knowledge:', expect.any(Error));
    });
  });
});