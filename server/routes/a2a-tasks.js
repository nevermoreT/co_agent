import express from 'express';
import a2aTaskManager from '../services/a2a/a2aTaskManager.js';
import agentRunner from '../services/agentRunner.js';
import db from '../db.js';
import logger from '../logger.js';

const router = express.Router();

// POST /a2a/tasks/send - 创建并发送任务
router.post('/tasks/send', async (req, res) => {
  try {
    const { sessionId, sourceAgentId, targetAgentId, input, conversationId } = req.body;

    // 验證必需參數
    if (!sessionId || !sourceAgentId || !targetAgentId || !input) {
      return res.status(400).json({ 
        error: 'Missing required fields: sessionId, sourceAgentId, targetAgentId, input' 
      });
    }

    logger.log('[A2A-Tasks] Creating task: source=%d, target=%d, conversation=%d', 
      sourceAgentId, targetAgentId, conversationId);

    // 创建任务
    const task = a2aTaskManager.createTask({
      sessionId,
      sourceAgentId,
      targetAgentId,
      input,
      conversationId,
    });

    // 启动目标 Agent 处理任务
    a2aTaskManager.updateTaskStatus(task.id, 'working');

    // 根据目标 Agent 类型选择不同的执行方式
    const targetAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(targetAgentId);
    
    if (!targetAgent) {
      a2aTaskManager.updateTaskStatus(task.id, 'failed', { error: 'Target agent not found' });
      return res.status(404).json({ error: 'Target agent not found' });
    }

    let accumulatedOutput = '';

    if (targetAgent.builtin_key === 'claude-cli') {
      // Claude CLI 专用处理
      logger.log('[A2A-Tasks] Using Claude CLI for task %s', task.id);
      
      await agentRunner.runClaudeCli(
        targetAgentId,
        input.text || JSON.stringify(input),
        (stream, data) => {
          accumulatedOutput += data;
          a2aTaskManager.addTaskHistory(task.id, {
            role: 'agent',
            content: data,
            agentId: targetAgentId,
            stream,
          });
        },
        (code, signal) => {
          const status = code === 0 ? 'completed' : 'failed';
          a2aTaskManager.updateTaskStatus(task.id, status, {
            text: accumulatedOutput,
            exitCode: code,
            signal,
          });
        },
        conversationId
      );
    } else if (targetAgent.builtin_key === 'opencode-cli') {
      // Opencode CLI 专用处理
      logger.log('[A2A-Tasks] Using Opencode CLI for task %s', task.id);
      
      agentRunner.runOpencodeCli(
        targetAgentId,
        input.text || JSON.stringify(input),
        (stream, data) => {
          accumulatedOutput += data;
          a2aTaskManager.addTaskHistory(task.id, {
            role: 'agent',
            content: data,
            agentId: targetAgentId,
            stream,
          });
        },
        (code, signal) => {
          const status = code === 0 ? 'completed' : 'failed';
          a2aTaskManager.updateTaskStatus(task.id, status, {
            text: accumulatedOutput,
            exitCode: code,
            signal,
          });
        },
        conversationId
      );
    } else {
      // 普通 Agent 处理
      logger.log('[A2A-Tasks] Using regular agent for task %s', task.id);
      
      const success = agentRunner.run(
        targetAgentId,
        (stream, data) => {
          accumulatedOutput += data;
          a2aTaskManager.addTaskHistory(task.id, {
            role: 'agent',
            content: data,
            agentId: targetAgentId,
            stream,
          });
        },
        (code, signal) => {
          const status = code === 0 ? 'completed' : 'failed';
          a2aTaskManager.updateTaskStatus(task.id, status, {
            text: accumulatedOutput,
            exitCode: code,
            signal,
          });
        }
      );

      if (success) {
        // 发送输入
        agentRunner.sendInput(targetAgentId, input.text || JSON.stringify(input));
      } else {
        a2aTaskManager.updateTaskStatus(task.id, 'failed', { 
          error: 'Failed to start agent process' 
        });
        return res.status(500).json({ error: 'Failed to start agent process' });
      }
    }

    res.json({
      id: task.id,
      status: task.status,
      sessionId: task.sessionId,
      sourceAgentId: task.sourceAgentId,
      targetAgentId: task.targetAgentId,
    });
  } catch (error) {
    logger.error('[A2A-Tasks] Error creating task:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /a2a/tasks/sendSubscribe - 创建任务并订阅（SSE）
router.post('/tasks/sendSubscribe', async (req, res) => {
  try {
    const { sessionId, sourceAgentId, targetAgentId, input, conversationId } = req.body;

    if (!sessionId || !sourceAgentId || !targetAgentId || !input) {
      return res.status(400).json({ 
        error: 'Missing required fields: sessionId, sourceAgentId, targetAgentId, input' 
      });
    }

    // 设置 SSE 头部
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // 创建任务
    const task = a2aTaskManager.createTask({
      sessionId,
      sourceAgentId,
      targetAgentId,
      input,
      conversationId,
    });

    // 订閱任務更新
    a2aTaskManager.subscribe(task.id, res);

    // 發送初始狀態
    res.write(`data: ${JSON.stringify({ 
      type: 'status', 
      status: 'submitted', 
      taskId: task.id,
      message: 'Task submitted successfully'
    })}\n\n`);

    // 启动处理
    a2aTaskManager.updateTaskStatus(task.id, 'working');

    // 根据目标 Agent 类型执行
    const targetAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(targetAgentId);
    if (!targetAgent) {
      a2aTaskManager.updateTaskStatus(task.id, 'failed', { error: 'Target agent not found' });
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        error: 'Target agent not found',
        taskId: task.id
      })}\n\n`);
      res.end();
      return;
    }

    let accumulatedOutput = '';

    if (targetAgent.builtin_key === 'claude-cli') {
      logger.log('[A2A-Tasks-SSE] Using Claude CLI for task %s', task.id);
      
      await agentRunner.runClaudeCli(
        targetAgentId,
        input.text || JSON.stringify(input),
        (stream, data) => {
          accumulatedOutput += data;
          a2aTaskManager.addTaskHistory(task.id, {
            role: 'agent',
            content: data,
            agentId: targetAgentId,
            stream,
          });
        },
        (code, signal) => {
          const status = code === 0 ? 'completed' : 'failed';
          a2aTaskManager.updateTaskStatus(task.id, status, {
            text: accumulatedOutput,
            exitCode: code,
            signal,
          });
          // 任务完成，结束 SSE
          res.end();
        },
        conversationId
      );
    } else if (targetAgent.builtin_key === 'opencode-cli') {
      logger.log('[A2A-Tasks-SSE] Using Opencode CLI for task %s', task.id);
      
      agentRunner.runOpencodeCli(
        targetAgentId,
        input.text || JSON.stringify(input),
        (stream, data) => {
          accumulatedOutput += data;
          a2aTaskManager.addTaskHistory(task.id, {
            role: 'agent',
            content: data,
            agentId: targetAgentId,
            stream,
          });
        },
        (code, signal) => {
          const status = code === 0 ? 'completed' : 'failed';
          a2aTaskManager.updateTaskStatus(task.id, status, {
            text: accumulatedOutput,
            exitCode: code,
            signal,
          });
          // 任务完成，结束 SSE
          res.end();
        },
        conversationId
      );
    } else {
      logger.log('[A2A-Tasks-SSE] Using regular agent for task %s', task.id);
      
      const success = agentRunner.run(
        targetAgentId,
        (stream, data) => {
          accumulatedOutput += data;
          a2aTaskManager.addTaskHistory(task.id, {
            role: 'agent',
            content: data,
            agentId: targetAgentId,
            stream,
          });
        },
        (code, signal) => {
          const status = code === 0 ? 'completed' : 'failed';
          a2aTaskManager.updateTaskStatus(task.id, status, {
            text: accumulatedOutput,
            exitCode: code,
            signal,
          });
          // 任务完成，结束 SSE
          res.end();
        }
      );

      if (success) {
        agentRunner.sendInput(targetAgentId, input.text || JSON.stringify(input));
      } else {
        a2aTaskManager.updateTaskStatus(task.id, 'failed', { 
          error: 'Failed to start agent process' 
        });
        res.write(`data: ${JSON.stringify({ 
          type: 'error', 
          error: 'Failed to start agent process',
          taskId: task.id
        })}\n\n`);
        res.end();
      }
    }
  } catch (error) {
    logger.error('[A2A-Tasks-SSE] Error in sendSubscribe:', error);
    res.write(`data: ${JSON.stringify({ 
      type: 'error', 
      error: error.message,
      taskId: null
    })}\n\n`);
    res.end();
  }
});

// GET /a2a/tasks/:id - 获取任务详情
router.get('/tasks/:id', (req, res) => {
  try {
    const task = a2aTaskManager.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
  } catch (error) {
    logger.error('[A2A-Tasks] Error getting task:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /a2a/tasks/:id/history - 获取任务历史
router.get('/tasks/:id/history', (req, res) => {
  try {
    const history = a2aTaskManager.getTaskHistory(req.params.id);
    if (!history) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ history });
  } catch (error) {
    logger.error('[A2A-Tasks] Error getting task history:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /a2a/tasks/:id/cancel - 取消任务
router.post('/tasks/:id/cancel', (req, res) => {
  try {
    const task = a2aTaskManager.cancelTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
  } catch (error) {
    logger.error('[A2A-Tasks] Error cancelling task:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /a2a/tasks - 获取活跃任务列表
router.get('/tasks', (req, res) => {
  try {
    const activeTaskIds = a2aTaskManager.getActiveTaskIds();
    const tasks = activeTaskIds.map(id => a2aTaskManager.getTask(id)).filter(Boolean);
    
    res.json({ 
      tasks,
      count: tasks.length,
      activeCount: a2aTaskManager.getActiveTaskCount()
    });
  } catch (error) {
    logger.error('[A2A-Tasks] Error getting tasks list:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;