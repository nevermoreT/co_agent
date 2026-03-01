/**
 * 测试工具库
 * 提供通用的测试辅助函数、数据工厂、模拟工具等
 */

import { vi, beforeEach, afterEach } from 'vitest';

// 数据工厂
export const factories = {
  /**
   * Agent 数据工厂
   */
  agent: (overrides = {}) => ({
    id: overrides.id || Math.floor(Math.random() * 1000),
    name: overrides.name || `Test Agent ${Date.now()}`,
    cli_command: overrides.cli_command || 'node test-agent.js',
    cli_cwd: overrides.cli_cwd || null,
    builtin_key: overrides.builtin_key || null,
    session_id: overrides.session_id || null,
    role: overrides.role || 'general',
    responsibilities: overrides.responsibilities || JSON.stringify([]),
    system_prompt: overrides.system_prompt || '',
    created_at: overrides.created_at || new Date().toISOString(),
    ...overrides,
  }),

  /**
   * 任务/对话 数据工厂
   */
  task: (overrides = {}) => ({
    id: overrides.id || Math.floor(Math.random() * 1000),
    title: overrides.title || `Test Task ${Date.now()}`,
    description: overrides.description || 'Test task description',
    status: overrides.status || 'pending',
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
    last_activity_at: overrides.last_activity_at || new Date().toISOString(),
    group_name: overrides.group_name || null,
    is_archived: overrides.is_archived || 0,
    ...overrides,
  }),

  /**
   * 消息 数据工厂
   */
  message: (overrides = {}) => ({
    id: overrides.id || Math.floor(Math.random() * 100000),
    role: overrides.role || 'user',
    content: overrides.content || 'Test message content',
    agent_id: overrides.agent_id || null,
    agent_name: overrides.agent_name || null,
    task_id: overrides.task_id || null,
    message_type: overrides.message_type || 'text',
    metadata: overrides.metadata || null,
    created_at: overrides.created_at || new Date().toISOString(),
    ...overrides,
  }),

  /**
   * A2A 任务 数据工厂
   */
  a2aTask: (overrides = {}) => ({
    id: overrides.id || `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    session_id: overrides.session_id || `session-${Date.now()}`,
    source_agent_id: overrides.source_agent_id || 1,
    target_agent_id: overrides.target_agent_id || 2,
    status: overrides.status || 'submitted',
    input: overrides.input || { text: 'Test input' },
    output: overrides.output || null,
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
    ...overrides,
  }),

  /**
   * 主动消息 数据工厂
   */
  proactiveMessage: (overrides = {}) => ({
    id: overrides.id || Math.floor(Math.random() * 100000),
    agent_id: overrides.agent_id || 1,
    conversation_id: overrides.conversation_id || 101,
    message_type: overrides.message_type || 'task_complete',
    content: overrides.content || 'Test proactive message',
    metadata: overrides.metadata || JSON.stringify({}),
    is_read: overrides.is_read || 0,
    created_at: overrides.created_at || new Date().toISOString(),
    ...overrides,
  }),
};

// 模拟工具
export const mocks = {
  /**
   * 创建模拟 WebSocket
   */
  createMockWebSocket: () => {
    const listeners = new Map();
    
    return {
      readyState: 1, // OPEN
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn((event, callback) => {
        if (!listeners.has(event)) {
          listeners.set(event, []);
        }
        listeners.get(event).push(callback);
      }),
      removeEventListener: vi.fn((event, callback) => {
        if (listeners.has(event)) {
          const callbacks = listeners.get(event);
          const index = callbacks.indexOf(callback);
          if (index > -1) {
            callbacks.splice(index, 1);
          }
        }
      }),
      emit: (event, data) => {
        const callbacks = listeners.get(event) || [];
        callbacks.forEach(callback => callback(data));
      },
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
    };
  },

  /**
   * 创建模拟 Agent Runner
   */
  createMockAgentRunner: () => {
    return {
      run: vi.fn((agentId, onOutput, onExit) => {
        // 模拟启动成功
        return true;
      }),
      runClaudeCli: vi.fn(async (agentId, prompt, onOutput, onExit) => {
        // 模拟 Claude CLI 调用
        setTimeout(() => {
          onOutput('stdout', `Claude processed: ${prompt.substring(0, 20)}...`);
          onExit(0, null);
        }, 100);
        return true;
      }),
      runOpencodeCli: vi.fn((agentId, prompt, onOutput, onExit) => {
        // 模拟 Opencode CLI 调用
        setTimeout(() => {
          onOutput('stdout', `Opencode processed: ${prompt.substring(0, 20)}...`);
          onExit(0, null);
        }, 100);
        return true;
      }),
      sendInput: vi.fn((agentId, text) => {
        // 模拟发送输入
        return true;
      }),
      stop: vi.fn((agentId) => {
        // 模拟停止
        return true;
      }),
      isRunning: vi.fn((agentId) => {
        // 模拟运行状态检查
        return false;
      }),
      getRunningAgentIds: vi.fn(() => {
        // 模拟获取运行中的 Agent ID 列表
        return [];
      }),
    };
  },

  /**
   * 创建模拟数据库
   */
  createMockDb: () => {
    const tables = new Map();
    
    return {
      prepare: vi.fn((sql) => {
        return {
          get: vi.fn((...params) => {
            // 简单的查询模拟
            const tableName = sql.match(/FROM\s+(\w+)/i)?.[1];
            if (tableName && tables.has(tableName)) {
              const table = tables.get(tableName);
              // 简单的 WHERE 条件处理
              if (sql.includes('WHERE')) {
                const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
                if (whereMatch) {
                  const field = whereMatch[1];
                  const value = params[0];
                  return table.find(row => row[field] === value) || null;
                }
              }
              return table[0] || null;
            }
            return null;
          }),
          all: vi.fn((...params) => {
            const tableName = sql.match(/FROM\s+(\w+)/i)?.[1];
            if (tableName && tables.has(tableName)) {
              return tables.get(tableName);
            }
            return [];
          }),
          run: vi.fn((...params) => {
            const tableName = sql.match(/(?:INTO|UPDATE|DELETE FROM)\s+(\w+)/i)?.[1];
            if (tableName) {
              if (!tables.has(tableName)) {
                tables.set(tableName, []);
              }
              const table = tables.get(tableName);
              
              if (sql.includes('INSERT')) {
                const valuesMatch = sql.match(/\(([^)]+)\)/g);
                if (valuesMatch && params.length > 0) {
                  const newRow = {};
                  const columns = valuesMatch[0].substring(1, valuesMatch[0].length - 1).split(', ');
                  
                  for (let i = 0; i < columns.length && i < params.length; i++) {
                    newRow[columns[i]] = params[i];
                  }
                  
                  table.push(newRow);
                }
              } else if (sql.includes('UPDATE')) {
                const setMatch = sql.match(/SET\s+([^WHERE]+)/i);
                if (setMatch) {
                  const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
                  if (whereMatch) {
                    const field = whereMatch[1];
                    const value = params[params.length - 1]; // WHERE 参数在最后
                    const updateParams = params.slice(0, params.length - 1); // 除了 WHERE 参数
                    
                    const row = table.find(r => r[field] === value);
                    if (row) {
                      // 简单的 SET 参数应用
                      // 这里可以根据具体 SQL 来实现更精确的更新
                    }
                  }
                }
              }
            }
            
            return { lastInsertRowid: 1, changes: 1 };
          }),
        };
      }),
      exec: vi.fn((sql) => {
        // 执行 SQL
      }),
      // 用于设置测试数据
      setTableData: (tableName, data) => {
        tables.set(tableName, data);
      },
      getTableData: (tableName) => {
        return tables.get(tableName) || [];
      },
    };
  },
};

// 等待工具
export const waitFor = {
  /**
   * 等待条件满足
   */
  condition: async (conditionFn, timeout = 5000, interval = 100) => {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      if (conditionFn()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    throw new Error(`Condition not met within ${timeout}ms`);
  },

  /**
   * 等待异步操作完成
   */
  asyncOperation: async (operationPromise, timeout = 5000) => {
    return Promise.race([
      operationPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout)
      )
    ]);
  },
};

// 测试设置工具
export const testSetup = {
  /**
   * 设置数据库相关测试
   */
  withDatabase: (testFn) => {
    return async (ctx) => {
      const mockDb = mocks.createMockDb();
      ctx.db = mockDb;
      try {
        return await testFn(ctx);
      } finally {
        // 清理
      }
    };
  },

  /**
   * 设置 WebSocket 相关测试
   */
  withWebSocket: (testFn) => {
    return async (ctx) => {
      const mockWs = mocks.createMockWebSocket();
      ctx.ws = mockWs;
      try {
        return await testFn(ctx);
      } finally {
        // 清理
      }
    };
  },

  /**
   * 设置 Agent Runner 相关测试
   */
  withAgentRunner: (testFn) => {
    return async (ctx) => {
      const mockRunner = mocks.createMockAgentRunner();
      ctx.runner = mockRunner;
      try {
        return await testFn(ctx);
      } finally {
        // 清理
      }
    };
  },
};

// 通用测试辅助函数
export const utils = {
  /**
   * 捕获函数调用参数
   */
  captureCallArgs: (mockFn) => {
    return mockFn.mock.calls;
  },

  /**
   * 验证函数被调用
   */
  expectCalled: (mockFn, times = 1) => {
    expect(mockFn).toHaveBeenCalledTimes(times);
  },

  /**
   * 验证函数被调用并带有特定参数
   */
  expectCalledWith: (mockFn, ...args) => {
    expect(mockFn).toHaveBeenCalledWith(...args);
  },

  /**
   * 延迟执行
   */
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
};

export default {
  factories,
  mocks,
  waitFor,
  testSetup,
  utils,
};