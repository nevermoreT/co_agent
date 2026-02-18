/**
 * 数据库 Mock 工具
 * 用于创建内存数据库进行测试
 */
import initSqlJs from 'sql.js';
import { vi } from 'vitest';

/**
 * 创建内存数据库
 * @returns {Promise<Object>} 数据库包装对象
 */
export async function createTestDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  
  // 创建表结构
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cli_command TEXT NOT NULL,
      cli_cwd TEXT,
      builtin_key TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      task_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS global_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      agent_id INTEGER,
      agent_name TEXT,
      task_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_agent ON chat_messages(agent_id);
    CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_global_created ON global_messages(created_at);
  `);
  
  // 创建数据库包装对象
  const wrap = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        get(...args) {
          stmt.bind(args);
          const has = stmt.step();
          const row = has ? stmt.getAsObject() : null;
          stmt.reset();
          return row;
        },
        all(...args) {
          stmt.bind(args);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          stmt.reset();
          return rows;
        },
        run(...args) {
          stmt.bind(args);
          stmt.step();
          const rowid = db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0];
          const changes = db.getRowsModified();
          stmt.reset();
          return {
            lastInsertRowid: rowid,
            changes: changes,
          };
        },
      };
    },
    exec(sql) {
      db.exec(sql);
    },
    /**
     * 关闭数据库
     */
    close() {
      db.close();
    },
    /**
     * 重置数据库（清空所有表）
     */
    reset() {
      db.exec('DELETE FROM global_messages');
      db.exec('DELETE FROM chat_messages');
      db.exec('DELETE FROM tasks');
      db.exec('DELETE FROM agents');
    },
    /**
     * 插入测试 Agent
     */
    seedAgent(agent) {
      const { name, cli_command, cli_cwd, builtin_key } = agent;
      return wrap.prepare(
        'INSERT INTO agents (name, cli_command, cli_cwd, builtin_key) VALUES (?, ?, ?, ?)'
      ).run(name, cli_command || 'test', cli_cwd || null, builtin_key || null);
    },
    /**
     * 插入测试任务
     */
    seedTask(task) {
      const { title, description, status } = task;
      return wrap.prepare(
        'INSERT INTO tasks (title, description, status) VALUES (?, ?, ?)'
      ).run(title, description || '', status || 'pending');
    },
    /**
     * 插入测试全局消息
     */
    seedGlobalMessage(message) {
      const { role, content, agent_id, agent_name, task_id } = message;
      return wrap.prepare(
        'INSERT INTO global_messages (role, content, agent_id, agent_name, task_id) VALUES (?, ?, ?, ?, ?)'
      ).run(role, content || '', agent_id || null, agent_name || null, task_id || null);
    },
  };
  
  return wrap;
}

/**
 * 创建带有种子数据的测试数据库
 * @returns {Promise<Object>} 数据库包装对象
 */
export async function createTestDbWithSeeds() {
  const db = await createTestDb();
  
  // 插入内置 Agent
  db.seedAgent({ name: 'Claude CLI', cli_command: 'builtin:claude-cli', builtin_key: 'claude-cli' });
  db.seedAgent({ name: 'Opencode CLI', cli_command: 'builtin:opencode-cli', builtin_key: 'opencode-cli' });
  
  // 插入测试任务
  db.seedTask({ title: '测试任务1', description: '这是一个测试任务', status: 'pending' });
  db.seedTask({ title: '测试任务2', description: '另一个测试任务', status: 'doing' });
  
  return db;
}

/**
 * Mock db.js 模块
 * @param {Object} testDb - 测试数据库实例
 */
export function mockDb(testDb) {
  vi.mock('../server/db.js', () => ({
    default: testDb
  }));
}
