import { randomUUID } from 'crypto';
import db from '../../db.js';
import logger from '../../logger.js';

class A2ATaskManager {
  constructor() {
    // 活跃任务存储 (taskId -> task info)
    this.activeTasks = new Map();
    
    // 订阅者存储 (taskId -> [response objects])
    this.subscribers = new Map();
    
    // 初始化数据库表
    this.initializeDbSchema();
  }

  // 初始化数据库表
  initializeDbSchema() {
    try {
      // 创建 A2A 任务表
      db.exec(`
        CREATE TABLE IF NOT EXISTS a2a_tasks (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          source_agent_id INTEGER,
          target_agent_id INTEGER,
          status TEXT DEFAULT 'submitted',
          input TEXT,
          output TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        
        CREATE INDEX IF NOT EXISTS idx_a2a_tasks_session ON a2a_tasks(session_id);
        CREATE INDEX IF NOT EXISTS idx_a2a_tasks_status ON a2a_tasks(status);
        CREATE INDEX IF NOT EXISTS idx_a2a_tasks_source ON a2a_tasks(source_agent_id);
        CREATE INDEX IF NOT EXISTS idx_a2a_tasks_target ON a2a_tasks(target_agent_id);
      `);
      
      logger.log('[A2ATaskManager] Database schema initialized');
    } catch (error) {
      logger.error('[A2ATaskManager] Error initializing database schema:', error);
    }
  }

  // 创建新任务
  createTask({ sessionId, sourceAgentId, targetAgentId, input, conversationId }) {
    const taskId = randomUUID();
    
    const task = {
      id: taskId,
      sessionId,
      sourceAgentId,
      targetAgentId,
      conversationId, // 保存到任务中以便后续关联
      status: 'submitted',
      input,
      output: null,
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 持久化到数据库
    try {
      db.prepare(`
        INSERT INTO a2a_tasks (id, session_id, source_agent_id, target_agent_id, status, input)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        taskId,
        sessionId,
        sourceAgentId,
        targetAgentId,
        'submitted',
        JSON.stringify(input)
      );
    } catch (error) {
      logger.error('[A2ATaskManager] Error creating task in DB:', error);
      throw error;
    }

    // 存储在内存中
    this.activeTasks.set(taskId, task);
    
    logger.log('[A2ATaskManager] Task created: %s (source: %d, target: %d)', 
      taskId, sourceAgentId, targetAgentId);

    return task;
  }

  // 更新任务状态
  updateTaskStatus(taskId, status, output = null) {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      logger.warn('[A2ATaskManager] Task not found for update: %s', taskId);
      return null;
    }

    task.status = status;
    task.updatedAt = new Date().toISOString();
    if (output) {
      task.output = output;
    }

    // 更新数据库
    try {
      db.prepare(`
        UPDATE a2a_tasks 
        SET status = ?, output = ?, updated_at = ? 
        WHERE id = ?
      `).run(
        status,
        output ? JSON.stringify(output) : null,
        task.updatedAt,
        taskId
      );
    } catch (error) {
      logger.error('[A2ATaskManager] Error updating task in DB:', error);
      throw error;
    }

    // 通知订阅者
    this.notifySubscribers(taskId, { 
      type: 'status', 
      status, 
      output,
      timestamp: task.updatedAt
    });

    logger.log('[A2ATaskManager] Task %s status updated to: %s', taskId, status);
    return task;
  }

  // 添加任务历史
  addTaskHistory(taskId, message) {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      logger.warn('[A2ATaskManager] Task not found for history update: %s', taskId);
      return;
    }

    const historyEntry = {
      ...message,
      timestamp: new Date().toISOString(),
    };
    
    task.history.push(historyEntry);

    // 通知订阅者
    this.notifySubscribers(taskId, { 
      type: 'message', 
      message: historyEntry 
    });
    
    logger.log('[A2ATaskManager] Added history to task %s: %s...', taskId, 
      message.content?.substring(0, 50) || 'message');
  }

  // 订阅任务更新 (SSE)
  subscribe(taskId, res) {
    if (!this.subscribers.has(taskId)) {
      this.subscribers.set(taskId, []);
    }
    this.subscribers.get(taskId).push(res);

    // 清理断开连接
    res.on('close', () => {
      this.unsubscribe(taskId, res);
    });
    
    logger.log('[A2ATaskManager] New subscriber for task %s', taskId);
  }

  unsubscribe(taskId, res) {
    const subs = this.subscribers.get(taskId);
    if (subs) {
      const idx = subs.indexOf(res);
      if (idx > -1) {
        subs.splice(idx, 1);
        logger.log('[A2ATaskManager] Unsubscribed from task %s', taskId);
      }
    }
  }

  // 通知所有订阅者
  notifySubscribers(taskId, data) {
    const subs = this.subscribers.get(taskId);
    if (!subs || subs.length === 0) return;

    const sseData = `data: ${JSON.stringify(data)}\n\n`;
    subs.forEach(res => {
      try {
        res.write(sseData);
      } catch (error) {
        logger.error('[A2ATaskManager] Error sending SSE:', error);
        // 移除无效连接
        this.unsubscribe(taskId, res);
      }
    });
    
    logger.log('[A2ATaskManager] Notified %d subscribers for task %s', 
      subs.length, taskId);
  }

  // 获取任务
  getTask(taskId) {
    // 优先从内存获取，否则从数据库获取
    const task = this.activeTasks.get(taskId);
    if (task) return task;
    
    // 从数据库获取（处理已完成的任务）
    try {
      const dbTask = db.prepare('SELECT * FROM a2a_tasks WHERE id = ?').get(taskId);
      if (dbTask) {
        // 转换数据库格式为对象格式
        return {
          id: dbTask.id,
          sessionId: dbTask.session_id,
          sourceAgentId: dbTask.source_agent_id,
          targetAgentId: dbTask.target_agent_id,
          status: dbTask.status,
          input: dbTask.input ? JSON.parse(dbTask.input) : null,
          output: dbTask.output ? JSON.parse(dbTask.output) : null,
          createdAt: dbTask.created_at,
          updatedAt: dbTask.updated_at,
          history: [], // 历史记录需要单独查询
        };
      }
    } catch (error) {
      logger.error('[A2ATaskManager] Error getting task from DB:', error);
    }
    
    return null;
  }

  // 取消任务
  cancelTask(taskId) {
    const task = this.getTask(taskId);
    if (!task) {
      logger.warn('[A2ATaskManager] Attempted to cancel non-existent task: %s', taskId);
      return null;
    }

    logger.log('[A2ATaskManager] Canceling task %s', taskId);
    
    // 从内存中删除
    this.activeTasks.delete(taskId);
    
    // 通知订阅者
    this.notifySubscribers(taskId, { 
      type: 'cancel',
      message: 'Task was cancelled'
    });
    
    // 更新数据库状态
    try {
      db.prepare('UPDATE a2a_tasks SET status = ? WHERE id = ?').run('cancelled', taskId);
    } catch (error) {
      logger.error('[A2ATaskManager] Error cancelling task in DB:', error);
    }
    
    // 清理订阅者
    this.subscribers.delete(taskId);
    
    return { ...task, status: 'cancelled' };
  }

  // 获取任务历史
  getTaskHistory(taskId) {
    const task = this.getTask(taskId);
    if (!task) return [];
    
    // 从内存获取历史（如果是活跃任务）
    if (this.activeTasks.has(taskId)) {
      return [...task.history];
    }
    
    // 对于已完成的任务，可以从数据库获取更多信息
    // 暂时返回空数组，后续可以扩展
    return [];
  }

  // 获取活跃任务数量
  getActiveTaskCount() {
    return this.activeTasks.size;
  }

  // 获取所有活跃任务ID
  getActiveTaskIds() {
    return Array.from(this.activeTasks.keys());
  }
  
  /**
   * 清除会话的 A2A 任务记录
   * 当用户发起新消息时调用，重置 A2A 深度计数
   */
  clearSessionTasks(sessionId) {
    try {
      // 从内存中清除
      for (const [taskId, task] of this.activeTasks) {
        if (task.sessionId === sessionId) {
          this.activeTasks.delete(taskId);
        }
      }
      
      // 从数据库中删除
      db.prepare(`DELETE FROM a2a_tasks WHERE session_id = ?`).run(sessionId);
      
      logger.log('[A2ATaskManager] Cleared tasks for session: %s', sessionId);
    } catch (error) {
      logger.error('[A2ATaskManager] Error clearing session tasks:', error);
    }
  }
}

// 创建单例
const a2aTaskManager = new A2ATaskManager();

export default a2aTaskManager;