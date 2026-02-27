/**
 * Mock Database 类
 * 用于集成测试的数据库模拟
 */
export class MockDatabase {
  constructor() {
    this.statements = new Map();
    this.data = {
      agents: [],
      tasks: [],
      global_messages: [],
      agent_sessions: [],
      agent_memory: [],
    };
    this.nextIds = {
      agents: 1,
      tasks: 1,
      global_messages: 1,
      agent_sessions: 1,
      agent_memory: 1,
    };
  }

  prepare(sql) {
    const mockStmt = {
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn(),
    };

    // 解析 SQL 并设置相应的 mock 行为
    if (sql.includes('SELECT')) {
      this.setupSelectMocks(sql, mockStmt);
    } else if (sql.includes('INSERT')) {
      this.setupInsertMocks(sql, mockStmt);
    } else if (sql.includes('UPDATE')) {
      this.setupUpdateMocks(sql, mockStmt);
    } else if (sql.includes('DELETE')) {
      this.setupDeleteMocks(sql, mockStmt);
    }

    return mockStmt;
  }

  setupSelectMocks(sql, mockStmt) {
    mockStmt.get.mockImplementation((...params) => {
      if (sql.includes('agents WHERE id = ?')) {
        return this.data.agents.find(agent => agent.id === params[0]) || null;
      }
      if (sql.includes('tasks WHERE id = ?')) {
        return this.data.tasks.find(task => task.id === params[0]) || null;
      }
      if (sql.includes('agent_sessions WHERE agent_id = ? AND task_id = ?')) {
        return this.data.agent_sessions.find(
          session => session.agent_id === params[0] && session.task_id === params[1]
        ) || null;
      }
      if (sql.includes('agent_memory WHERE agent_id = ? AND task_id = ?')) {
        return this.data.agent_memory.find(
          memory => memory.agent_id === params[0] && memory.task_id === params[1]
        ) || null;
      }
      if (sql.includes('COUNT(*) as count')) {
        let count = 0;
        if (sql.includes('agents')) {
          count = this.data.agents.length;
        } else if (sql.includes('tasks')) {
          count = this.data.tasks.length;
        } else if (sql.includes('global_messages')) {
          count = this.data.global_messages.length;
        } else if (sql.includes('agent_sessions')) {
          count = this.data.agent_sessions.length;
        }
        return { count };
      }
      return null;
    });

    mockStmt.all.mockImplementation((...params) => {
      if (sql.includes('SELECT * FROM agents')) {
        return this.data.agents;
      }
      if (sql.includes('SELECT * FROM tasks')) {
        return this.data.tasks;
      }
      if (sql.includes('SELECT * FROM global_messages')) {
        let messages = this.data.global_messages;
        if (sql.includes('WHERE task_id = ?')) {
          messages = messages.filter(msg => msg.task_id === params[0]);
        }
        return messages;
      }
      if (sql.includes('FROM agent_sessions')) {
        const sessions = this.data.agent_sessions.filter(session => session.agent_id === params[0]);
        return sessions.map(session => ({
          ...session,
          task_title: this.data.tasks.find(task => task.id === session.task_id)?.title || null,
        }));
      }
      return [];
    });
  }

  setupInsertMocks(sql, mockStmt) {
    mockStmt.run.mockImplementation((...params) => {
      let insertData;
      
      if (sql.includes('agents')) {
        insertData = {
          id: this.nextIds.agents++,
          name: params[0],
          cli_command: params[1],
          cli_cwd: params[2],
          builtin_key: params[3],
          created_at: new Date().toISOString(),
        };
        this.data.agents.push(insertData);
      } else if (sql.includes('tasks')) {
        insertData = {
          id: this.nextIds.tasks++,
          title: params[0],
          description: params[1] || '',
          status: params[2] || 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.data.tasks.push(insertData);
      } else if (sql.includes('global_messages')) {
        insertData = {
          id: this.nextIds.global_messages++,
          role: params[0],
          content: params[1],
          task_id: params[2],
          agent_id: params[3],
          agent_name: params[4],
          created_at: params[5] || new Date().toISOString(),
        };
        this.data.global_messages.push(insertData);
      } else if (sql.includes('agent_sessions')) {
        insertData = {
          id: this.nextIds.agent_sessions++,
          agent_id: params[0],
          task_id: params[1],
          session_id: params[2],
          created_at: params[3],
          updated_at: params[4],
        };
        this.data.agent_sessions.push(insertData);
      } else if (sql.includes('agent_memory')) {
        insertData = {
          id: this.nextIds.agent_memory++,
          agent_id: params[0],
          task_id: params[1],
          memories: params[2],
          created_at: params[3],
          updated_at: params[4],
        };
        this.data.agent_memory.push(insertData);
      }

      return {
        lastInsertRowid: insertData?.id || null,
        changes: 1,
      };
    });
  }

  setupUpdateMocks(sql, mockStmt) {
    mockStmt.run.mockImplementation((...params) => {
      let changes = 0;
      
      if (sql.includes('agents') && sql.includes('WHERE id = ?')) {
        const agentIndex = this.data.agents.findIndex(agent => agent.id === params[params.length - 1]);
        if (agentIndex !== -1) {
          this.data.agents[agentIndex] = { ...this.data.agents[agentIndex], ...this.parseUpdateData(sql, params) };
          changes = 1;
        }
      } else if (sql.includes('agent_sessions') && sql.includes('WHERE agent_id = ? AND task_id = ?')) {
        const sessionIndex = this.data.agent_sessions.findIndex(
          session => session.agent_id === params[params.length - 2] && session.task_id === params[params.length - 1]
        );
        if (sessionIndex !== -1) {
          this.data.agent_sessions[sessionIndex] = { 
            ...this.data.agent_sessions[sessionIndex], 
            ...this.parseUpdateData(sql, params) 
          };
          changes = 1;
        }
      } else if (sql.includes('agent_memory') && sql.includes('WHERE agent_id = ? AND task_id = ?')) {
        const memoryIndex = this.data.agent_memory.findIndex(
          memory => memory.agent_id === params[params.length - 2] && memory.task_id === params[params.length - 1]
        );
        if (memoryIndex !== -1) {
          this.data.agent_memory[memoryIndex] = { 
            ...this.data.agent_memory[memoryIndex], 
            ...this.parseUpdateData(sql, params) 
          };
          changes = 1;
        }
      }

      return { changes };
    });
  }

  setupDeleteMocks(sql, mockStmt) {
    mockStmt.run.mockImplementation((...params) => {
      let changes = 0;
      
      if (sql.includes('agents') && sql.includes('WHERE id = ?')) {
        const initialLength = this.data.agents.length;
        this.data.agents = this.data.agents.filter(agent => agent.id !== params[0]);
        changes = initialLength - this.data.agents.length;
      } else if (sql.includes('tasks') && sql.includes('WHERE id = ?')) {
        const initialLength = this.data.tasks.length;
        this.data.tasks = this.data.tasks.filter(task => task.id !== params[0]);
        changes = initialLength - this.data.tasks.length;
      } else if (sql.includes('agent_sessions') && sql.includes('WHERE id = ?')) {
        const initialLength = this.data.agent_sessions.length;
        this.data.agent_sessions = this.data.agent_sessions.filter(session => session.id !== params[0]);
        changes = initialLength - this.data.agent_sessions.length;
      } else if (sql.includes('agent_memory') && sql.includes('WHERE agent_id = ? AND task_id = ?')) {
        const initialLength = this.data.agent_memory.length;
        this.data.agent_memory = this.data.agent_memory.filter(
          memory => !(memory.agent_id === params[0] && memory.task_id === params[1])
        );
        changes = initialLength - this.data.agent_memory.length;
      }

      return { changes };
    });
  }

  parseUpdateData(sql, params) {
    // 简单的 UPDATE 数据解析，实际实现可能需要更复杂的 SQL 解析
    if (sql.includes('agents')) {
      return {
        name: params[0],
        cli_command: params[1],
        cli_cwd: params[2],
        updated_at: new Date().toISOString(),
      };
    } else if (sql.includes('agent_sessions')) {
      return {
        session_id: params[0],
        updated_at: params[1],
      };
    } else if (sql.includes('agent_memory')) {
      return {
        memories: params[0],
        updated_at: params[1],
      };
    }
    return {};
  }

  // 便捷方法用于测试数据设置
  addAgent(agent) {
    const newAgent = {
      id: this.nextIds.agents++,
      ...agent,
      created_at: agent.created_at || new Date().toISOString(),
    };
    this.data.agents.push(newAgent);
    return newAgent;
  }

  addTask(task) {
    const newTask = {
      id: this.nextIds.tasks++,
      ...task,
      created_at: task.created_at || new Date().toISOString(),
      updated_at: task.updated_at || new Date().toISOString(),
    };
    this.data.tasks.push(newTask);
    return newTask;
  }

  addMessage(message) {
    const newMessage = {
      id: this.nextIds.global_messages++,
      ...message,
      created_at: message.created_at || new Date().toISOString(),
    };
    this.data.global_messages.push(newMessage);
    return newMessage;
  }

  addSession(session) {
    const newSession = {
      id: this.nextIds.agent_sessions++,
      ...session,
      created_at: session.created_at || new Date().toISOString(),
      updated_at: session.updated_at || new Date().toISOString(),
    };
    this.data.agent_sessions.push(newSession);
    return newSession;
  }

  addMemory(memory) {
    const newMemory = {
      id: this.nextIds.agent_memory++,
      ...memory,
      created_at: memory.created_at || new Date().toISOString(),
      updated_at: memory.updated_at || new Date().toISOString(),
    };
    this.data.agent_memory.push(newMemory);
    return newMemory;
  }

  reset() {
    this.data = {
      agents: [],
      tasks: [],
      global_messages: [],
      agent_sessions: [],
      agent_memory: [],
    };
    this.nextIds = {
      agents: 1,
      tasks: 1,
      global_messages: 1,
      agent_sessions: 1,
      agent_memory: 1,
    };
  }
}