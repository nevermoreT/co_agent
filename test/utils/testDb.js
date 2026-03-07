/**
 * 数据库测试隔离设置
 * 解决测试中数据库 schema 冲突问题
 */
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

/**
 * 创建独立的测试数据库实例
 */
export async function createTestDatabase() {
  // 使用内存数据库，避免文件系统冲突
  const db = await open({
    filename: ':memory:',
    driver: sqlite3.Database
  });
  
  // 执行表结构创建
  await initializeSchema(db);
  
  return db;
}

/**
 * 初始化数据库表结构
 */
async function initializeSchema(db) {
  // Agents table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      cli_command TEXT NOT NULL,
      status TEXT DEFAULT 'stopped',
      session_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Global messages table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS global_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      conversation_id TEXT,
      agent_id INTEGER,
      agent_name TEXT,
      role TEXT NOT NULL,
      content TEXT,
      message_type TEXT DEFAULT 'text',
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks (id),
      FOREIGN KEY (agent_id) REFERENCES agents (id)
    )
  `);
  
  // Tasks table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Agent sessions table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      agent_id TEXT NOT NULL,
      task_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (agent_id, task_id),
      FOREIGN KEY (task_id) REFERENCES tasks (id)
    )
  `);
  
  // Memory events table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS memory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      task_id INTEGER,
      event_type TEXT NOT NULL,
      event_data TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents (id),
      FOREIGN KEY (task_id) REFERENCES tasks (id)
    )
  `);
  
  // A2A tasks table (确保不会重复创建列)
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS a2a_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks (id)
      )
    `);
    
    // 尝试添加 conversation_id 列，如果不存在
    try {
      await db.exec(`ALTER TABLE a2a_tasks ADD COLUMN conversation_id TEXT`);
    } catch {
      // 列已存在，忽略错误
    }
  } catch {
    // 表已存在，继续
  }
}

/**
 * 清理测试数据库连接
 */
export async function cleanupTestDatabase(db) {
  if (db) {
    await db.close();
  }
}

/**
 * 创建测试数据
 */
export async function createTestData(db, data = {}) {
  const {
    agents = [],
    messages = [],
    tasks = [],
  } = data;
  
  // 创建测试任务
  for (const task of tasks) {
    await db.run(
      'INSERT INTO tasks (id, title, description, status) VALUES (?, ?, ?, ?)',
      [task.id, task.title, task.description, task.status || 'active']
    );
  }
  
  // 创建测试代理
  for (const agent of agents) {
    await db.run(
      'INSERT INTO agents (id, name, cli_command, status) VALUES (?, ?, ?, ?)',
      [agent.id, agent.name, agent.cli_command, agent.status || 'stopped']
    );
  }
  
  // 创建测试消息
  for (const message of messages) {
    await db.run(
      'INSERT INTO global_messages (task_id, agent_id, agent_name, role, content, message_type) VALUES (?, ?, ?, ?, ?, ?)',
      [
        message.task_id,
        message.agent_id,
        message.agent_name,
        message.role,
        message.content,
        message.message_type || 'text'
      ]
    );
  }
}

/**
 * 测试数据库 Hook
 */
export function useTestDatabase() {
  let db = null;
  
  const setup = async () => {
    db = await createTestDatabase();
    return db;
  };
  
  const teardown = async () => {
    await cleanupTestDatabase(db);
    db = null;
  };
  
  return {
    setup,
    teardown,
    getDb: () => db,
  };
}

/**
 * Vitest 测试设置辅助函数
 */
export function createTestSetup() {
  const testDb = useTestDatabase();
  
  return {
    async beforeEach() {
      return await testDb.setup();
    },
    
    async afterEach() {
      await testDb.teardown();
    },
    
    // 预设测试数据
    createMockData: async (db) => {
      // 创建默认测试数据
      await createTestData(db, {
        tasks: [
          { id: 1, title: 'Test Task 1' },
          { id: 2, title: 'Test Task 2' },
        ],
        agents: [
          { id: 1, name: 'Test Agent 1', cli_command: 'echo test' },
          { id: 2, name: 'Test Agent 2', cli_command: 'node test.js' },
        ],
        messages: [
          {
            task_id: 1,
            agent_id: 1,
            agent_name: 'Test Agent 1',
            role: 'user',
            content: 'Hello'
          },
          {
            task_id: 1,
            agent_id: 1,
            agent_name: 'Test Agent 1',
            role: 'assistant',
            content: 'Hi there!'
          },
        ],
      });
    },
  };
}