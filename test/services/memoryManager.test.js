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

      const mockRun = vi.fn(() => ({ lastInsertRowid: 123 }));
      db.prepare.mockReturnValue({ get: vi.fn(), run: mockRun, all: vi.fn() });

      const result = memoryManager.recordEvent(eventData);

      expect(result).toBe(123);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO shared_events'));
      expect(mockRun).toHaveBeenCalledWith(
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

      const mockRun = vi.fn(() => ({ lastInsertRowid: 456 }));
      db.prepare.mockReturnValue({ get: vi.fn(), run: mockRun, all: vi.fn() });

      const result = memoryManager.recordEvent(eventData);

      expect(result).toBe(456);
      expect(mockRun).toHaveBeenCalledWith(
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

      const mockRun = vi.fn(() => ({ lastInsertRowid: 789 }));
      db.prepare.mockReturnValue({ get: vi.fn(), run: mockRun, all: vi.fn() });

      memoryManager.recordEvent(eventData);

      expect(mockRun).toHaveBeenCalledWith(
        'test',
        null,
        null,
        null,
        'Test Event',
        'Test content',
        null,
        null, // metadata should be null
        5
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

      const mockAll = vi.fn(() => mockEvents);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      const result = memoryManager.getEvents();

      expect(result).toEqual(mockEvents);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE 1=1 ORDER BY created_at DESC LIMIT ? OFFSET ?'
      );
      expect(mockAll).toHaveBeenCalledWith(50, 0);
    });

    it('should filter by event type', () => {
      const mockEvents = [{ id: 1, event_type: 'conversation', title: 'Event 1' }];
      
      const mockAll = vi.fn(() => mockEvents);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      memoryManager.getEvents({ eventType: 'conversation' });

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE 1=1 AND event_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      );
      expect(mockAll).toHaveBeenCalledWith('conversation', 50, 0);
    });

    it('should filter by source agent ID', () => {
      const mockAll = vi.fn(() => []);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      memoryManager.getEvents({ sourceAgentId: 'agent1' });

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE 1=1 AND source_agent_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      );
      expect(mockAll).toHaveBeenCalledWith('agent1', 50, 0);
    });

    it('should filter by conversation ID', () => {
      const mockAll = vi.fn(() => []);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      memoryManager.getEvents({ conversationId: 'conv1' });

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE 1=1 AND conversation_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      );
      expect(mockAll).toHaveBeenCalledWith('conv1', 50, 0);
    });

    it('should filter by minimum importance', () => {
      const mockAll = vi.fn(() => []);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      memoryManager.getEvents({ minImportance: 7 });

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE 1=1 AND importance >= ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      );
      expect(mockAll).toHaveBeenCalledWith(7, 50, 0);
    });

    it('should exclude specific agent', () => {
      const mockAll = vi.fn(() => []);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      memoryManager.getEvents({ excludeAgentId: 'agent2' });

      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT * FROM shared_events WHERE 1=1 AND source_agent_id != ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      );
      expect(mockAll).toHaveBeenCalledWith('agent2', 50, 0);
    });

    it('should apply multiple filters', () => {
      const mockAll = vi.fn(() => []);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

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
      expect(mockAll).toHaveBeenCalledWith('conversation', 'agent1', 'conv1', 6, 'agent2', 20, 10);
    });

    it('should throw when database errors', () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      expect(() => memoryManager.getEvents()).toThrow('Database error');
    });
  });

  describe('buildAgentContext', () => {
    it('should return context string for conversation', () => {
      const mockMessages = [
        { role: 'assistant', content: 'Hi', agent_name: 'A' },
        { role: 'user', content: 'Hello', agent_name: null }
      ];
      const mockAll = vi.fn(() => mockMessages);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      const result = memoryManager.buildAgentContext(1, 'conv1');

      expect(typeof result).toBe('string');
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('global_messages')
      );
      expect(mockAll).toHaveBeenCalledWith('conv1');
    });

    it('should return empty string when conversation ID empty', () => {
      const result = memoryManager.buildAgentContext(1, '');

      expect(result).toBe('');
    });

    it('should return empty string when conversation ID null', () => {
      const result = memoryManager.buildAgentContext(1, null);

      expect(result).toBe('');
    });
  });

  describe('upsertKnowledge', () => {
    it('should insert new knowledge', () => {
      const knowledgeData = {
        category: 'test-cat',
        key: 'test-key',
        value: 'Test content'
      };

      const mockGet = vi.fn(() => undefined);
      const mockRun = vi.fn(() => ({ lastInsertRowid: 123 }));
      db.prepare
        .mockReturnValueOnce({ get: mockGet, run: vi.fn(), all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(), run: mockRun, all: vi.fn() });

      const result = memoryManager.upsertKnowledge(knowledgeData);

      expect(result).toBe(123);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT id FROM consensus_knowledge WHERE key = ? AND category = ?'
      );
      expect(mockGet).toHaveBeenCalledWith('test-key', 'test-cat');
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO consensus_knowledge')
      );
    });

    it('should update existing knowledge', () => {
      const existingKnowledge = { id: 1 };
      const knowledgeData = {
        category: 'test-cat',
        key: 'test-key',
        value: 'Updated content'
      };

      const mockGet = vi.fn(() => existingKnowledge);
      const mockRun = vi.fn();
      db.prepare
        .mockReturnValueOnce({ get: mockGet, run: vi.fn(), all: vi.fn() })
        .mockReturnValueOnce({ get: vi.fn(), run: mockRun, all: vi.fn() });

      const result = memoryManager.upsertKnowledge(knowledgeData);

      expect(result).toBe(1);
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE consensus_knowledge')
      );
      expect(mockRun).toHaveBeenCalled();
    });

    it('should handle database errors', () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const result = memoryManager.upsertKnowledge({
        category: 'cat',
        key: 'test-key',
        value: 'Test content'
      });

      expect(result).toBe(null);
      expect(logger.error).toHaveBeenCalledWith('[memory] failed to upsert knowledge:', expect.any(Error));
    });
  });

  describe('getKnowledge', () => {
    it('should return knowledge array by key', () => {
      const mockKnowledge = [
        {
          id: 1,
          key: 'test-key',
          value: 'Test content',
          category: 'cat'
        }
      ];
      const mockAll = vi.fn(() => mockKnowledge);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      const result = memoryManager.getKnowledge({ key: 'test-key' });

      expect(result).toEqual(mockKnowledge);
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('consensus_knowledge')
      );
      expect(mockAll).toHaveBeenCalledWith('test-key');
    });

    it('should return empty array when knowledge not found', () => {
      db.prepare.mockReturnValue({
        get: vi.fn(),
        run: vi.fn(),
        all: vi.fn(() => []),
      });

      const result = memoryManager.getKnowledge({ key: 'nonexistent' });

      expect(result).toEqual([]);
    });

    it('should return all when no filters', () => {
      const mockAll = vi.fn(() => []);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      memoryManager.getKnowledge({});

      expect(mockAll).toHaveBeenCalledWith();
    });
  });

  describe('getKnowledge with category', () => {
    it('should filter by category and key', () => {
      const mockAll = vi.fn(() => []);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      memoryManager.getKnowledge({ category: 'cat', key: 'k' });

      expect(mockAll).toHaveBeenCalledWith('cat', 'k');
    });
  });

  describe('deleteKnowledge', () => {
    it('should delete knowledge by category and key', () => {
      const mockRun = vi.fn(() => ({ changes: 1 }));
      db.prepare.mockReturnValue({ get: vi.fn(), run: mockRun, all: vi.fn() });

      const result = memoryManager.deleteKnowledge('cat', 'test-key');

      expect(result).toBe(true);
      expect(db.prepare).toHaveBeenCalledWith(
        'DELETE FROM consensus_knowledge WHERE category = ? AND key = ?'
      );
      expect(mockRun).toHaveBeenCalledWith('cat', 'test-key');
    });

    it('should return false when knowledge not found', () => {
      const mockRun = vi.fn(() => ({ changes: 0 }));
      db.prepare.mockReturnValue({ get: vi.fn(), run: mockRun, all: vi.fn() });

      const result = memoryManager.deleteKnowledge('cat', 'nonexistent');

      expect(result).toBe(false);
    });

    it('should handle database errors', () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const result = memoryManager.deleteKnowledge('cat', 'test-key');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[memory] failed to delete knowledge:', expect.any(Error));
    });
  });
});