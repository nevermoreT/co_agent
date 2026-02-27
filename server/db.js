import initSqlJs from 'sql.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'app.db');

const SQL = await initSqlJs();
let db;
if (fs.existsSync(dbPath)) {
  const buf = fs.readFileSync(dbPath);
  db = new SQL.Database(buf);
} else {
  db = new SQL.Database();
}

function save() {
  const data = db.export();
  const buf = Buffer.from(data);
  fs.writeFileSync(dbPath, buf);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cli_command TEXT NOT NULL,
    cli_cwd TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    last_activity_at TEXT DEFAULT (datetime('now')),
    group_name TEXT
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

  CREATE INDEX IF NOT EXISTS idx_chat_agent ON chat_messages(agent_id);
  CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at);

  CREATE TABLE IF NOT EXISTS global_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    agent_id INTEGER,
    agent_name TEXT,
    task_id INTEGER,
    message_type TEXT DEFAULT 'text',  -- text, thinking, image
    metadata TEXT,  -- JSON string for image url, etc.
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );
  CREATE INDEX IF NOT EXISTS idx_global_created ON global_messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_global_type ON global_messages(message_type);

  CREATE TABLE IF NOT EXISTS shared_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    source_agent_id INTEGER,
    source_agent_name TEXT,
    conversation_id INTEGER,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    metadata TEXT,
    importance INTEGER DEFAULT 5,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (source_agent_id) REFERENCES agents(id),
    FOREIGN KEY (conversation_id) REFERENCES tasks(id)
  );
  CREATE INDEX IF NOT EXISTS idx_events_type ON shared_events(event_type);
  CREATE INDEX IF NOT EXISTS idx_events_agent ON shared_events(source_agent_id);
  CREATE INDEX IF NOT EXISTS idx_events_conv ON shared_events(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_events_time ON shared_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_importance ON shared_events(importance);

  CREATE TABLE IF NOT EXISTS consensus_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    context TEXT,
    source_events TEXT,
    verified_by TEXT,
    confidence INTEGER DEFAULT 80,
    valid_from TEXT,
    valid_until TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(key, category)
  );

  CREATE TABLE IF NOT EXISTS agent_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    task_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    UNIQUE(agent_id, task_id)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent ON agent_sessions(agent_id);
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_task ON agent_sessions(task_id);
`);

try {
  db.run('ALTER TABLE agents ADD COLUMN builtin_key TEXT');
  save();
} catch {
  // column already exists
}

try {
  db.run('ALTER TABLE agents ADD COLUMN session_id TEXT');
  save();
} catch {
  // column already exists
}

try {
  db.run('ALTER TABLE tasks ADD COLUMN group_name TEXT');
  save();
} catch {
  // column already exists
}

try {
  db.run('ALTER TABLE tasks ADD COLUMN last_activity_at TEXT');
  save();
} catch {
  // column already exists
}

try {
  db.run('ALTER TABLE tasks ADD COLUMN is_archived INTEGER DEFAULT 0');
  save();
} catch {
  // column already exists
}

// 添加消息类型字段（用于 thinking、image 等）
try {
  db.run("ALTER TABLE global_messages ADD COLUMN message_type TEXT DEFAULT 'text'");
  save();
} catch {
  // column already exists
}

try {
  db.run('ALTER TABLE global_messages ADD COLUMN metadata TEXT');
  save();
} catch {
  // column already exists
}

// Phase 3.1: Agent 角色配置字段
try {
  db.run('ALTER TABLE agents ADD COLUMN role TEXT DEFAULT ""');
  save();
} catch {
  // column already exists
}

try {
  db.run('ALTER TABLE agents ADD COLUMN responsibilities TEXT DEFAULT "[]"');
  save();
} catch {
  // column already exists
}

try {
  db.run('ALTER TABLE agents ADD COLUMN system_prompt TEXT DEFAULT ""');
  save();
} catch {
  // column already exists
}

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
        save();
        return {
          lastInsertRowid: rowid,
          changes: changes,
        };
      },
    };
  },
  exec(sql) {
    db.exec(sql);
    save();
  },
};
wrap.prepare.bind(wrap);

(function seedBuiltinAgents() {
  // Seed Claude CLI
  const claudeRow = wrap.prepare('SELECT id FROM agents WHERE builtin_key = ?').get('claude-cli');
  if (!claudeRow) {
    const count = wrap.prepare('SELECT COUNT(*) as c FROM agents').get();
    if (count.c < 5) {
      wrap.prepare(
        'INSERT INTO agents (name, cli_command, cli_cwd, builtin_key, role, responsibilities, system_prompt) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'Claude CLI', 
        'builtin:claude-cli', 
        null, 
        'claude-cli',
        '架构师',
        JSON.stringify(['代码审查', '架构设计', '技术决策', '性能优化建议']),
        '你是一个专业的软件架构师。注重代码质量、可维护性和性能。回答时优先提供代码示例。'
      );
    }
  } else {
    // 更新已有 Claude CLI 的角色配置（如果为空）
    const existing = wrap.prepare('SELECT role FROM agents WHERE id = ?').get(claudeRow.id);
    if (!existing.role) {
      wrap.prepare(
        'UPDATE agents SET role = ?, responsibilities = ?, system_prompt = ? WHERE id = ?'
      ).run(
        '架构师',
        JSON.stringify(['代码审查', '架构设计', '技术决策', '性能优化建议']),
        '你是一个专业的软件架构师。注重代码质量、可维护性和性能。回答时优先提供代码示例。',
        claudeRow.id
      );
    }
  }
  // Seed Opencode CLI
  const opencodeRow = wrap.prepare('SELECT id FROM agents WHERE builtin_key = ?').get('opencode-cli');
  if (!opencodeRow) {
    const count = wrap.prepare('SELECT COUNT(*) as c FROM agents').get();
    if (count.c < 5) {
      wrap.prepare(
        'INSERT INTO agents (name, cli_command, cli_cwd, builtin_key, role, responsibilities, system_prompt) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'Opencode CLI', 
        'builtin:opencode-cli', 
        null, 
        'opencode-cli',
        '开发者助手',
        JSON.stringify(['代码生成', 'Bug 修复', '功能实现', '技术问答']),
        '你是一个高效的开发者助手。快速理解需求并提供可用的代码实现。'
      );
    }
  } else {
    // 更新已有 Opencode CLI 的角色配置（如果为空）
    const existing = wrap.prepare('SELECT role FROM agents WHERE id = ?').get(opencodeRow.id);
    if (!existing.role) {
      wrap.prepare(
        'UPDATE agents SET role = ?, responsibilities = ?, system_prompt = ? WHERE id = ?'
      ).run(
        '开发者助手',
        JSON.stringify(['代码生成', 'Bug 修复', '功能实现', '技术问答']),
        '你是一个高效的开发者助手。快速理解需求并提供可用的代码实现。',
        opencodeRow.id
      );
    }
  }
})();

// 创建默认对话"创世碎碎念"
(function seedDefaultConversation() {
  const defaultConv = wrap.prepare('SELECT id FROM tasks WHERE title = ?').get('创世碎碎念');
  if (!defaultConv) {
    wrap.prepare(
      'INSERT INTO tasks (title, description, status, group_name) VALUES (?, ?, ?, ?)'
    ).run('创世碎碎念', '默认对话，记录所有碎碎念', 'doing', '默认');
  }
})();

export default wrap;
