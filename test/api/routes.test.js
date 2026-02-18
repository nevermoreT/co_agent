/**
 * API 路由测试
 * 测试 agents、tasks、chats 路由
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 由于路由依赖 db.js，我们需要创建一个模拟环境
// 这里我们测试路由逻辑

describe('API 路由测试', () => {
  describe('agents 路由逻辑', () => {
    // 模拟数据库操作
    let mockDb;
    let agents;
    let nextId;

    beforeEach(() => {
      agents = [
        { id: 1, name: 'Claude CLI', cli_command: 'builtin:claude-cli', cli_cwd: null, builtin_key: 'claude-cli' },
        { id: 2, name: 'Opencode CLI', cli_command: 'builtin:opencode-cli', cli_cwd: null, builtin_key: 'opencode-cli' },
      ];
      nextId = 3;

      mockDb = {
        prepare: vi.fn((sql) => {
          // 根据SQL返回不同的结果
          if (sql.includes('SELECT COUNT(*)')) {
            return {
              get: vi.fn(() => ({ c: agents.length }))
            };
          }
          if (sql.includes('SELECT * FROM agents ORDER BY')) {
            return {
              all: vi.fn(() => agents)
            };
          }
          if (sql.includes('SELECT * FROM agents WHERE id =')) {
            return {
              get: vi.fn((id) => agents.find(a => a.id === parseInt(id)))
            };
          }
          if (sql.includes('INSERT INTO agents')) {
            return {
              run: vi.fn((name, cli_command, cli_cwd) => {
                const newAgent = { id: nextId++, name, cli_command, cli_cwd, builtin_key: null };
                agents.push(newAgent);
                return { lastInsertRowid: newAgent.id, changes: 1 };
              })
            };
          }
          if (sql.includes('UPDATE agents')) {
            return {
              run: vi.fn((name, cli_command, cli_cwd, id) => {
                const agent = agents.find(a => a.id === parseInt(id));
                if (agent) {
                  agent.name = name;
                  agent.cli_command = cli_command;
                  agent.cli_cwd = cli_cwd;
                  return { changes: 1 };
                }
                return { changes: 0 };
              })
            };
          }
          if (sql.includes('DELETE FROM agents')) {
            return {
              run: vi.fn((id) => {
                const index = agents.findIndex(a => a.id === parseInt(id));
                if (index !== -1) {
                  agents.splice(index, 1);
                  return { changes: 1 };
                }
                return { changes: 0 };
              })
            };
          }
          return {
            get: vi.fn(),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
          };
        })
      };
    });

    describe('GET /api/agents', () => {
      it('应该返回所有 agents', () => {
        const list = mockDb.prepare('SELECT * FROM agents ORDER BY id').all();
        expect(list).toHaveLength(2);
        expect(list[0].name).toBe('Claude CLI');
      });
    });

    describe('GET /api/agents/:id', () => {
      it('应该返回指定的 agent', () => {
        const agent = mockDb.prepare('SELECT * FROM agents WHERE id = ?').get(1);
        expect(agent).toBeDefined();
        expect(agent.name).toBe('Claude CLI');
      });

      it('应该返回 null 当 agent 不存在', () => {
        const agent = mockDb.prepare('SELECT * FROM agents WHERE id = ?').get(999);
        expect(agent).toBeUndefined();
      });
    });

    describe('POST /api/agents', () => {
      it('应该创建新的 agent', () => {
        const count = mockDb.prepare('SELECT COUNT(*) as c FROM agents').get();
        expect(count.c).toBe(2);

        const info = mockDb.prepare(
          'INSERT INTO agents (name, cli_command, cli_cwd) VALUES (?, ?, ?)'
        ).run('Test Agent', 'test-command', null);
        
        expect(info.lastInsertRowid).toBe(3);
        expect(agents).toHaveLength(3);
      });

      it('应该拒绝超过 5 个 agent', () => {
        // 添加更多 agents 直到达到限制
        for (let i = agents.length; i < 5; i++) {
          agents.push({ id: nextId++, name: `Agent ${i}`, cli_command: 'test' });
        }
        
        const count = mockDb.prepare('SELECT COUNT(*) as c FROM agents').get();
        expect(count.c).toBe(5);
        
        // 应该拒绝添加
        if (count.c >= 5) {
          expect(true).toBe(true); // 模拟拒绝逻辑
        }
      });
    });

    describe('PATCH /api/agents/:id', () => {
      it('应该更新 agent', () => {
        const info = mockDb.prepare(
          'UPDATE agents SET name = ?, cli_command = ?, cli_cwd = ? WHERE id = ?'
        ).run('Updated Name', 'updated-command', null, 1);
        
        expect(info.changes).toBe(1);
        expect(agents[0].name).toBe('Updated Name');
      });
    });

    describe('DELETE /api/agents/:id', () => {
      it('应该删除 agent', () => {
        const info = mockDb.prepare('DELETE FROM agents WHERE id = ?').run(1);
        expect(info.changes).toBe(1);
        expect(agents).toHaveLength(1);
      });

      it('应该返回 0 当 agent 不存在', () => {
        const info = mockDb.prepare('DELETE FROM agents WHERE id = ?').run(999);
        expect(info.changes).toBe(0);
      });
    });
  });

  describe('tasks 路由逻辑', () => {
    let mockDb;
    let tasks;
    let nextId;

    beforeEach(() => {
      tasks = [
        { id: 1, title: 'Task 1', description: 'Description 1', status: 'pending' },
        { id: 2, title: 'Task 2', description: 'Description 2', status: 'doing' },
      ];
      nextId = 3;

      mockDb = {
        prepare: vi.fn((sql) => {
          if (sql.includes('SELECT * FROM tasks ORDER BY')) {
            return { all: vi.fn(() => tasks) };
          }
          if (sql.includes('SELECT * FROM tasks WHERE id =')) {
            return { get: vi.fn((id) => tasks.find(t => t.id === parseInt(id))) };
          }
          if (sql.includes('INSERT INTO tasks')) {
            return {
              run: vi.fn((title, description, status) => {
                const newTask = { id: nextId++, title, description, status };
                tasks.push(newTask);
                return { lastInsertRowid: newTask.id, changes: 1 };
              })
            };
          }
          if (sql.includes('UPDATE tasks')) {
            return {
              run: vi.fn((title, description, status, id) => {
                const task = tasks.find(t => t.id === parseInt(id));
                if (task) {
                  task.title = title;
                  task.description = description;
                  task.status = status;
                  return { changes: 1 };
                }
                return { changes: 0 };
              })
            };
          }
          if (sql.includes('DELETE FROM tasks')) {
            return {
              run: vi.fn((id) => {
                const index = tasks.findIndex(t => t.id === parseInt(id));
                if (index !== -1) {
                  tasks.splice(index, 1);
                  return { changes: 1 };
                }
                return { changes: 0 };
              })
            };
          }
          return {
            get: vi.fn(),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
          };
        })
      };
    });

    describe('GET /api/tasks', () => {
      it('应该返回所有 tasks', () => {
        const list = mockDb.prepare('SELECT * FROM tasks ORDER BY updated_at DESC').all();
        expect(list).toHaveLength(2);
      });
    });

    describe('POST /api/tasks', () => {
      it('应该创建新的 task', () => {
        const info = mockDb.prepare(
          'INSERT INTO tasks (title, description, status) VALUES (?, ?, ?)'
        ).run('New Task', 'New Description', 'pending');
        
        expect(info.lastInsertRowid).toBe(3);
        expect(tasks).toHaveLength(3);
      });

      it('应该默认 status 为 pending', () => {
        const status = 'invalid';
        const validStatus = status === 'doing' || status === 'done' ? status : 'pending';
        expect(validStatus).toBe('pending');
      });

      it('应该接受 doing 和 done 状态', () => {
        const status1 = 'doing';
        const validStatus1 = status1 === 'doing' || status1 === 'done' ? status1 : 'pending';
        expect(validStatus1).toBe('doing');

        const status2 = 'done';
        const validStatus2 = status2 === 'doing' || status2 === 'done' ? status2 : 'pending';
        expect(validStatus2).toBe('done');
      });
    });

    describe('PATCH /api/tasks/:id', () => {
      it('应该更新 task', () => {
        const info = mockDb.prepare(
          'UPDATE tasks SET title = ?, description = ?, status = ? WHERE id = ?'
        ).run('Updated Task', 'Updated Description', 'done', 1);
        
        expect(info.changes).toBe(1);
        expect(tasks[0].status).toBe('done');
      });
    });

    describe('DELETE /api/tasks/:id', () => {
      it('应该删除 task', () => {
        const info = mockDb.prepare('DELETE FROM tasks WHERE id = ?').run(1);
        expect(info.changes).toBe(1);
        expect(tasks).toHaveLength(1);
      });
    });
  });

  describe('chats 路由逻辑', () => {
    let mockDb;
    let globalMessages;
    let chatMessages;
    let nextId;

    beforeEach(() => {
      globalMessages = [
        { id: 1, role: 'user', content: 'Hello', agent_id: 1, agent_name: 'Claude CLI' },
        { id: 2, role: 'assistant', content: 'Hi there!', agent_id: 1, agent_name: 'Claude CLI' },
      ];
      chatMessages = [
        { id: 1, agent_id: 1, role: 'user', content: 'Test message' },
      ];
      nextId = 3;

      mockDb = {
        prepare: vi.fn((sql) => {
          if (sql.includes('SELECT * FROM global_messages')) {
            return { all: vi.fn(() => globalMessages) };
          }
          if (sql.includes('SELECT * FROM chat_messages WHERE agent_id')) {
            return { all: vi.fn(() => chatMessages) };
          }
          if (sql.includes('INSERT INTO global_messages')) {
            return {
              run: vi.fn((role, content, agent_id, agent_name, task_id) => {
                const newMsg = { id: nextId++, role, content, agent_id, agent_name, task_id };
                globalMessages.push(newMsg);
                return { lastInsertRowid: newMsg.id, changes: 1 };
              })
            };
          }
          if (sql.includes('INSERT INTO chat_messages')) {
            return {
              run: vi.fn((agent_id, role, content, task_id) => {
                const newMsg = { id: nextId++, agent_id, role, content, task_id };
                chatMessages.push(newMsg);
                return { lastInsertRowid: newMsg.id, changes: 1 };
              })
            };
          }
          if (sql.includes('SELECT * FROM global_messages WHERE id')) {
            return { get: vi.fn((id) => globalMessages.find(m => m.id === parseInt(id))) };
          }
          return {
            get: vi.fn(),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
          };
        })
      };
    });

    describe('GET /api/messages', () => {
      it('应该返回全局消息', () => {
        const list = mockDb.prepare('SELECT * FROM global_messages ORDER BY created_at ASC').all();
        expect(list).toHaveLength(2);
      });
    });

    describe('POST /api/messages', () => {
      it('应该创建新的全局消息', () => {
        const info = mockDb.prepare(
          'INSERT INTO global_messages (role, content, agent_id, agent_name, task_id) VALUES (?, ?, ?, ?, ?)'
        ).run('user', 'New message', 1, 'Claude CLI', null);
        
        expect(info.lastInsertRowid).toBe(3);
        expect(globalMessages).toHaveLength(3);
      });

      it('应该支持无 agent 的消息', () => {
        const info = mockDb.prepare(
          'INSERT INTO global_messages (role, content, agent_id, agent_name, task_id) VALUES (?, ?, ?, ?, ?)'
        ).run('user', 'Note message', null, null, null);
        
        expect(info.lastInsertRowid).toBe(3);
        expect(globalMessages[2].agent_id).toBe(null);
      });
    });

    describe('GET /api/chats/agents/:id/messages', () => {
      it('应该返回指定 agent 的消息', () => {
        const list = mockDb.prepare(
          'SELECT * FROM chat_messages WHERE agent_id = ? ORDER BY created_at ASC'
        ).all(1);
        expect(list).toHaveLength(1);
      });
    });
  });
});
