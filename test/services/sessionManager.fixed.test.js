/**
 * Session Manager 测试 - 修复版本
 * 使用隔离的测试数据库，避免 schema 冲突
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as sessionManager from '../../server/services/sessionManager.js';
import logger from '../../server/logger.js';
import { createTestDatabase, createTestData, cleanupTestDatabase } from '../utils/testDb.js';

// Mock logger
vi.mock('../../server/logger.js', () => ({
  default: {
    log: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Session Manager - 修复版', () => {
  let db;
  
  beforeEach(async () => {
    // 创建独立的测试数据库
    db = await createTestDatabase();
    
    // 创建测试数据
    await createTestData(db, {
      agents: [
        { id: 'agent1', name: 'Agent 1', cli_command: 'echo test' },
        { id: 'agent2', name: 'Agent 2', cli_command: 'node test.js' },
      ],
      tasks: [
        { id: 'task1', title: 'Task 1' },
        { id: 'task2', title: 'Task 2' },
      ],
    });
  });
  
  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('getSession', () => {
    it('should return session ID for existing session', async () => {
      // 先创建一个会话
      await db.run(
        'INSERT INTO agent_sessions (agent_id, task_id, session_id) VALUES (?, ?, ?)',
        ['agent1', 'task1', 'session123']
      );
      
      const result = await sessionManager.getSession(db, 'agent1', 'task1');
      
      expect(result).toBe('session123');
      expect(logger.log).toHaveBeenCalledWith('[SessionManager] Retrieved session', 'agent1', 'task1');
    });

    it('should return null for non-existing session', async () => {
      const result = await sessionManager.getSession(db, 'agent1', 'task2');
      
      expect(result).toBeNull();
    });

    it('should handle database errors gracefully', async () => {
      // Mock database error
      const mockDb = {
        prepare: vi.fn(() => {
          throw new Error('Database error');
        }),
      };
      
      const result = await sessionManager.getSession(mockDb, 'agent1', 'task1');
      
      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('[SessionManager] Error getting session', expect.any(Error));
    });
  });

  describe('createSession', () => {
    it('should create new session', async () => {
      const result = await sessionManager.createSession(db, 'agent1', 'task1');
      
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(logger.log).toHaveBeenCalledWith('[SessionManager] Created session', 'agent1', 'task1');
      
      // 验证会话已创建
      const session = await db.get(
        'SELECT session_id FROM agent_sessions WHERE agent_id = ? AND task_id = ?',
        ['agent1', 'task1']
      );
      expect(session.session_id).toBe(result);
    });

    it('should update existing session', async () => {
      // 先创建一个会话
      await sessionManager.createSession(db, 'agent1', 'task1');
      
      // 创建新会话（应该替换旧的）
      const result = await sessionManager.createSession(db, 'agent1', 'task1');
      
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      
      // 验证只有一个会话记录
      const sessions = await db.all(
        'SELECT session_id FROM agent_sessions WHERE agent_id = ? AND task_id = ?',
        ['agent1', 'task1']
      );
      expect(sessions).toHaveLength(1);
      expect(sessions[0].session_id).toBe(result);
    });

    it('should handle database errors gracefully', async () => {
      const mockDb = {
        prepare: vi.fn(() => {
          throw new Error('Database error');
        }),
      };
      
      const result = await sessionManager.createSession(mockDb, 'agent1', 'task1');
      
      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('[SessionManager] Error creating session', expect.any(Error));
    });
  });

  describe('updateSession', () => {
    it('should update existing session', async () => {
      // 先创建会话
      await sessionManager.createSession(db, 'agent1', 'task1');
      
      const result = await sessionManager.updateSession(db, 'agent1', 'task1', 'newSessionId');
      
      expect(result).toBe(true);
      expect(logger.log).toHaveBeenCalledWith('[SessionManager] Updated session', 'agent1', 'task1');
      
      // 验证会话已更新
      const session = await db.get(
        'SELECT session_id FROM agent_sessions WHERE agent_id = ? AND task_id = ?',
        ['agent1', 'task1']
      );
      expect(session.session_id).toBe('newSessionId');
    });

    it('should return false for non-existing session', async () => {
      const result = await sessionManager.updateSession(db, 'agent1', 'task1', 'newSessionId');
      
      expect(result).toBe(false);
    });

    it('should handle database errors gracefully', async () => {
      const mockDb = {
        prepare: vi.fn(() => {
          throw new Error('Database error');
        }),
      };
      
      const result = await sessionManager.updateSession(mockDb, 'agent1', 'task1', 'newSessionId');
      
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[SessionManager] Error updating session', expect.any(Error));
    });
  });

  describe('deleteSession', () => {
    it('should delete existing session', async () => {
      // 先创建会话
      await sessionManager.createSession(db, 'agent1', 'task1');
      
      const result = await sessionManager.deleteSession(db, 'agent1', 'task1');
      
      expect(result).toBe(true);
      expect(logger.log).toHaveBeenCalledWith('[SessionManager] Deleted session', 'agent1', 'task1');
      
      // 验证会话已删除
      const session = await db.get(
        'SELECT session_id FROM agent_sessions WHERE agent_id = ? AND task_id = ?',
        ['agent1', 'task1']
      );
      expect(session).toBeUndefined();
    });

    it('should return false for non-existing session', async () => {
      const result = await sessionManager.deleteSession(db, 'agent1', 'task1');
      
      expect(result).toBe(false);
    });

    it('should handle database errors gracefully', async () => {
      const mockDb = {
        prepare: vi.fn(() => {
          throw new Error('Database error');
        }),
      };
      
      const result = await sessionManager.deleteSession(mockDb, 'agent1', 'task1');
      
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[SessionManager] Error deleting session', expect.any(Error));
    });
  });

  describe('getAllSessions', () => {
    it('should return all sessions for an agent', async () => {
      // 创建多个会话
      await sessionManager.createSession(db, 'agent1', 'task1');
      await sessionManager.createSession(db, 'agent1', 'task2');
      await sessionManager.createSession(db, 'agent2', 'task1');
      
      const result = await sessionManager.getAllSessions(db, 'agent1');
      
      expect(result).toHaveLength(2);
      expect(result.map(s => s.task_id)).toContain('task1');
      expect(result.map(s => s.task_id)).toContain('task2');
      expect(result.map(s => s.agent_id)).toStrictEqual(['agent1', 'agent1']);
    });

    it('should return empty array for agent with no sessions', async () => {
      const result = await sessionManager.getAllSessions(db, 'agent1');
      
      expect(result).toHaveLength(0);
    });

    it('should handle database errors gracefully', async () => {
      const mockDb = {
        prepare: vi.fn(() => {
          throw new Error('Database error');
        }),
      };
      
      const result = await sessionManager.getAllSessions(mockDb, 'agent1');
      
      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('[SessionManager] Error getting all sessions', expect.any(Error));
    });
  });

  describe('clearAgentSessions', () => {
    it('should clear all sessions for an agent', async () => {
      // 创建多个会话
      await sessionManager.createSession(db, 'agent1', 'task1');
      await sessionManager.createSession(db, 'agent1', 'task2');
      await sessionManager.createSession(db, 'agent2', 'task1');
      
      const result = await sessionManager.clearAgentSessions(db, 'agent1');
      
      expect(result).toBe(true);
      expect(logger.log).toHaveBeenCalledWith('[SessionManager] Cleared all sessions', 'agent1');
      
      // 验证 agent1 的会话已删除
      const agent1Sessions = await db.all(
        'SELECT * FROM agent_sessions WHERE agent_id = ?',
        ['agent1']
      );
      expect(agent1Sessions).toHaveLength(0);
      
      // 验证 agent2 的会话仍然存在
      const agent2Sessions = await db.all(
        'SELECT * FROM agent_sessions WHERE agent_id = ?',
        ['agent2']
      );
      expect(agent2Sessions).toHaveLength(1);
    });

    it('should handle database errors gracefully', async () => {
      const mockDb = {
        prepare: vi.fn(() => {
          throw new Error('Database error');
        }),
      };
      
      const result = await sessionManager.clearAgentSessions(mockDb, 'agent1');
      
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[SessionManager] Error clearing agent sessions', expect.any(Error));
    });
  });
});