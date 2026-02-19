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
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );
  CREATE INDEX IF NOT EXISTS idx_global_created ON global_messages(created_at);
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
  db.run('ALTER TABLE tasks ADD COLUMN last_activity_at TEXT');
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
        'INSERT INTO agents (name, cli_command, cli_cwd, builtin_key) VALUES (?, ?, ?, ?)'
      ).run('Claude CLI', 'builtin:claude-cli', null, 'claude-cli');
    }
  }
  // Seed Opencode CLI
  const opencodeRow = wrap.prepare('SELECT id FROM agents WHERE builtin_key = ?').get('opencode-cli');
  if (!opencodeRow) {
    const count = wrap.prepare('SELECT COUNT(*) as c FROM agents').get();
    if (count.c < 5) {
      wrap.prepare(
        'INSERT INTO agents (name, cli_command, cli_cwd, builtin_key) VALUES (?, ?, ?, ?)'
      ).run('Opencode CLI', 'builtin:opencode-cli', null, 'opencode-cli');
    }
  }
})();

export default wrap;
