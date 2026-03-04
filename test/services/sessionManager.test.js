import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as sessionManager from '../../server/services/sessionManager.js';
import db from '../../server/db.js';
import logger from '../../server/logger.js';

// Mock dependencies
vi.mock('../../server/db.js');
vi.mock('../../server/logger.js');

describe('Session Manager', () => {
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
    
    // Mock Date.now for consistent timestamps
    const mockDate = new Date('2023-01-01T00:00:00.000Z');
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getSession', () => {
    it('should return session ID for valid agent and task', () => {
      const mockSession = { session_id: 'session123' };
      
      const mockQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => mockSession)
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = sessionManager.getSession('agent1', 'task1');

      expect(result).toBe('session123');
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT session_id FROM agent_sessions WHERE agent_id = ? AND task_id = ?'
      );
      expect(mockQuery.get).toHaveBeenCalledWith('agent1', 'task1');
    });

    it('should return null when session not found', () => {
      const mockQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => undefined)
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = sessionManager.getSession('agent1', 'task1');

      expect(result).toBeNull();
    });

    it('should return null when agentId or taskId is missing', () => {
      expect(sessionManager.getSession('', 'task1')).toBeNull();
      expect(sessionManager.getSession('agent1', '')).toBeNull();
      expect(sessionManager.getSession(null, 'task1')).toBeNull();
      expect(sessionManager.getSession('agent1', null)).toBeNull();
    });
  });

  describe('saveSession', () => {
    it('should create new session when none exists', () => {
      const mockExistingQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => undefined)
      });
      
      const mockInsertQuery = vi.fn().mockReturnValue({
        run: vi.fn()
      });

      db.prepare
        .mockReturnValueOnce(mockExistingQuery)
        .mockReturnValueOnce(mockInsertQuery);

      const result = sessionManager.saveSession('agent1', 'task1', 'session123');

      expect(result).toBe(true);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT id FROM agent_sessions WHERE agent_id = ? AND task_id = ?'
      );
      expect(db.prepare).toHaveBeenCalledWith(
        'INSERT INTO agent_sessions (agent_id, task_id, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      );
      expect(mockInsertQuery.run).toHaveBeenCalledWith(
        'agent1',
        'task1',
        'session123',
        '2023-01-01T00:00:00.000Z',
        '2023-01-01T00:00:00.000Z'
      );
      expect(logger.log).toHaveBeenCalledWith(
        '[sessionManager] created session: agent=%d task=%d session=%s',
        'agent1',
        'task1',
        'session123'
      );
    });

    it('should update existing session', () => {
      const mockExisting = { id: 1 };
      const mockExistingQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => mockExisting)
      });
      
      const mockUpdateQuery = vi.fn().mockReturnValue({
        run: vi.fn()
      });

      db.prepare
        .mockReturnValueOnce(mockExistingQuery)
        .mockReturnValueOnce(mockUpdateQuery);

      const result = sessionManager.saveSession('agent1', 'task1', 'session456');

      expect(result).toBe(true);
      expect(db.prepare).toHaveBeenCalledWith(
        'UPDATE agent_sessions SET session_id = ?, updated_at = ? WHERE agent_id = ? AND task_id = ?'
      );
      expect(mockUpdateQuery.run).toHaveBeenCalledWith(
        'session456',
        '2023-01-01T00:00:00.000Z',
        'agent1',
        'task1'
      );
      expect(logger.log).toHaveBeenCalledWith(
        '[sessionManager] updated session: agent=%d task=%d session=%s',
        'agent1',
        'task1',
        'session456'
      );
    });

    it('should return false when required parameters are missing', () => {
      expect(sessionManager.saveSession('', 'task1', 'session123')).toBe(false);
      expect(sessionManager.saveSession('agent1', '', 'session123')).toBe(false);
      expect(sessionManager.saveSession('agent1', 'task1', '')).toBe(false);
      expect(sessionManager.saveSession(null, 'task1', 'session123')).toBe(false);
      expect(sessionManager.saveSession('agent1', null, 'session123')).toBe(false);
      expect(sessionManager.saveSession('agent1', 'task1', null)).toBe(false);
    });

    it('should handle database errors', () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const result = sessionManager.saveSession('agent1', 'task1', 'session123');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[sessionManager] failed to save session:', expect.any(Error));
    });
  });

  describe('getAgentSessions', () => {
    it('should return all sessions for an agent', () => {
      const mockSessions = [
        { 
          session_id: 'session1', 
          task_id: 'task1', 
          task_title: 'Task 1',
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T01:00:00.000Z'
        },
        { 
          session_id: 'session2', 
          task_id: 'task2', 
          task_title: 'Task 2',
          created_at: '2023-01-01T02:00:00.000Z',
          updated_at: '2023-01-01T03:00:00.000Z'
        }
      ];

      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => mockSessions)
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = sessionManager.getAgentSessions('agent1');

      expect(result).toEqual(mockSessions);
      expect(db.prepare).toHaveBeenCalledWith(
        `SELECT s.*, t.title as task_title 
         FROM agent_sessions s 
         LEFT JOIN tasks t ON s.task_id = t.id 
         WHERE s.agent_id = ? 
         ORDER BY s.updated_at DESC`
      );
      expect(mockQuery.all).toHaveBeenCalledWith('agent1');
    });

    it('should return empty array when no sessions found', () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => [])
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = sessionManager.getAgentSessions('agent1');

      expect(result).toEqual([]);
      expect(mockQuery.all).toHaveBeenCalledWith('agent1');
    });
  });

  describe('getTaskSessions', () => {
    it('should return all sessions for a task', () => {
      const mockSessions = [
        { 
          session_id: 'session1', 
          agent_id: 'agent1', 
          agent_name: 'Agent 1',
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T01:00:00.000Z'
        },
        { 
          session_id: 'session2', 
          agent_id: 'agent2', 
          agent_name: 'Agent 2',
          created_at: '2023-01-01T02:00:00.000Z',
          updated_at: '2023-01-01T03:00:00.000Z'
        }
      ];

      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => mockSessions)
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = sessionManager.getTaskSessions('task1');

      expect(result).toEqual(mockSessions);
      expect(db.prepare).toHaveBeenCalledWith(
        `SELECT s.*, a.name as agent_name 
         FROM agent_sessions s 
         LEFT JOIN agents a ON s.agent_id = a.id 
         WHERE s.task_id = ? 
         ORDER BY s.updated_at DESC`
      );
      expect(mockQuery.all).toHaveBeenCalledWith('task1');
    });

    it('should return empty array when no sessions found', () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn(() => [])
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = sessionManager.getTaskSessions('task1');

      expect(result).toEqual([]);
      expect(mockQuery.all).toHaveBeenCalledWith('task1');
    });
  });

  describe('deleteSession', () => {
    it('should delete session and return true when session exists', () => {
      const mockQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ changes: 1 }))
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = sessionManager.deleteSession('agent1', 'task1');

      expect(result).toBe(true);
      expect(db.prepare).toHaveBeenCalledWith(
        'DELETE FROM agent_sessions WHERE agent_id = ? AND task_id = ?'
      );
      expect(mockQuery.run).toHaveBeenCalledWith('agent1', 'task1');
    });

    it('should return false when session does not exist', () => {
      const mockQuery = vi.fn().mockReturnValue({
        run: vi.fn(() => ({ changes: 0 }))
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = sessionManager.deleteSession('agent1', 'task1');

      expect(result).toBe(false);
      expect(mockQuery.run).toHaveBeenCalledWith('agent1', 'task1');
    });

    it('should handle database errors', () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const result = sessionManager.deleteSession('agent1', 'task1');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[sessionManager] failed to delete session:', expect.any(Error));
    });
  });

  describe('deleteTaskSessions', () => {
    it('should delete all sessions for a task', () => {
      const mockQuery = vi.fn().mockReturnValue({
        run: vi.fn()
      });
      db.prepare.mockReturnValue(mockQuery);

      const result = sessionManager.deleteTaskSessions('task1');

      expect(result).toBe(true);
      expect(db.prepare).toHaveBeenCalledWith(
        'DELETE FROM agent_sessions WHERE task_id = ?'
      );
      expect(mockQuery.run).toHaveBeenCalledWith('task1');
    });

    it('should handle database errors', () => {
      db.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const result = sessionManager.deleteTaskSessions('task1');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[sessionManager] failed to delete task sessions:', expect.any(Error));
    });
  });
});