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
      const mockGet = vi.fn(() => mockSession);
      db.prepare.mockReturnValue({
        get: mockGet,
        run: vi.fn(),
        all: vi.fn(),
      });

      const result = sessionManager.getSession('agent1', 'task1');

      expect(result).toBe('session123');
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT session_id FROM agent_sessions WHERE agent_id = ? AND task_id = ?'
      );
      expect(mockGet).toHaveBeenCalledWith('agent1', 'task1');
    });

    it('should return null when session not found', () => {
      db.prepare.mockReturnValue({
        get: vi.fn(() => undefined),
        run: vi.fn(),
        all: vi.fn(),
      });

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
      const mockInsertRun = vi.fn();
      db.prepare
        .mockReturnValueOnce({
          get: vi.fn(() => undefined),
          run: vi.fn(),
          all: vi.fn(),
        })
        .mockReturnValueOnce({
          get: vi.fn(),
          run: mockInsertRun,
          all: vi.fn(),
        });

      const result = sessionManager.saveSession('agent1', 'task1', 'session123');

      expect(result).toBe(true);
      expect(db.prepare).toHaveBeenCalledWith(
        'SELECT id FROM agent_sessions WHERE agent_id = ? AND task_id = ?'
      );
      expect(db.prepare).toHaveBeenCalledWith(
        'INSERT INTO agent_sessions (agent_id, task_id, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      );
      expect(mockInsertRun).toHaveBeenCalledWith(
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
      const mockUpdateRun = vi.fn();
      db.prepare
        .mockReturnValueOnce({
          get: vi.fn(() => mockExisting),
          run: vi.fn(),
          all: vi.fn(),
        })
        .mockReturnValueOnce({
          get: vi.fn(),
          run: mockUpdateRun,
          all: vi.fn(),
        });

      const result = sessionManager.saveSession('agent1', 'task1', 'session456');

      expect(result).toBe(true);
      expect(db.prepare).toHaveBeenCalledWith(
        'UPDATE agent_sessions SET session_id = ?, updated_at = ? WHERE agent_id = ? AND task_id = ?'
      );
      expect(mockUpdateRun).toHaveBeenCalledWith(
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
      const mockAll = vi.fn(() => mockSessions);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      const result = sessionManager.getAgentSessions('agent1');

      expect(result).toEqual(mockSessions);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT s.*, t.title as task_title'));
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('FROM agent_sessions s'));
      expect(mockAll).toHaveBeenCalledWith('agent1');
    });

    it('should return empty array when no sessions found', () => {
      db.prepare.mockReturnValue({
        get: vi.fn(),
        run: vi.fn(),
        all: vi.fn(() => []),
      });

      const result = sessionManager.getAgentSessions('agent1');

      expect(result).toEqual([]);
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
      const mockAll = vi.fn(() => mockSessions);
      db.prepare.mockReturnValue({ get: vi.fn(), run: vi.fn(), all: mockAll });

      const result = sessionManager.getTaskSessions('task1');

      expect(result).toEqual(mockSessions);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT s.*, a.name as agent_name'));
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('FROM agent_sessions s'));
      expect(mockAll).toHaveBeenCalledWith('task1');
    });

    it('should return empty array when no sessions found', () => {
      db.prepare.mockReturnValue({
        get: vi.fn(),
        run: vi.fn(),
        all: vi.fn(() => []),
      });

      const result = sessionManager.getTaskSessions('task1');

      expect(result).toEqual([]);
    });
  });

  describe('deleteSession', () => {
    it('should delete session and return true when session exists', () => {
      const mockRun = vi.fn(() => ({ changes: 1 }));
      db.prepare.mockReturnValue({
        get: vi.fn(),
        run: mockRun,
        all: vi.fn(),
      });

      const result = sessionManager.deleteSession('agent1', 'task1');

      expect(result).toBe(true);
      expect(db.prepare).toHaveBeenCalledWith(
        'DELETE FROM agent_sessions WHERE agent_id = ? AND task_id = ?'
      );
      expect(mockRun).toHaveBeenCalledWith('agent1', 'task1');
    });

    it('should return false when session does not exist', () => {
      const mockRun = vi.fn(() => ({ changes: 0 }));
      db.prepare.mockReturnValue({
        get: vi.fn(),
        run: mockRun,
        all: vi.fn(),
      });

      const result = sessionManager.deleteSession('agent1', 'task1');

      expect(result).toBe(false);
      expect(mockRun).toHaveBeenCalledWith('agent1', 'task1');
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
      const mockRun = vi.fn(() => ({ changes: 1 }));
      db.prepare.mockReturnValue({
        get: vi.fn(),
        run: mockRun,
        all: vi.fn(),
      });

      const result = sessionManager.deleteTaskSessions('task1');

      expect(result).toBe(true);
      expect(db.prepare).toHaveBeenCalledWith(
        'DELETE FROM agent_sessions WHERE task_id = ?'
      );
      expect(mockRun).toHaveBeenCalledWith('task1');
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