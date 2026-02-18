# AGENTS.md

Guidelines for agentic coding agents working in this repository.

## Project Overview

Multi-agent collaboration platform built with Node.js (Express + WebSocket) backend and React (Vite) frontend. The system manages CLI-based agent processes and streams their output via WebSocket.

## Build & Development Commands

```bash
# Install dependencies
npm install

# Development (runs both server and client with hot reload)
npm run dev

# Run server only (port 3000)
npm run server

# Run client only (port 5173, proxies to server)
npm run client

# Production build
npm run build
npm run server  # then access at http://localhost:3000

# Run Claude CLI wrapper standalone (for testing)
node minimal-claude.js "your question"

# Run Opencode CLI wrapper standalone (for testing)
node minimal-opencode.js "your question"
```

**Note:** No formal test framework is configured. Manual testing via `npm run dev` is the primary method.

## Code Style Guidelines

### Module System

- Use ES Modules (`import`/`export`) exclusively - package.json has `"type": "module"`
- Use `.js` extension for all JavaScript files (no TypeScript)
- Use `.jsx` extension for React components with JSX

### Imports Organization

Order imports as follows, separated by blank lines:

1. Node.js built-ins (e.g., `import path from 'path'`)
2. Third-party packages (e.g., `import express from 'express'`)
3. Local imports (e.g., `import db from '../db.js'`)

```javascript
import { spawn } from 'child_process';
import path from 'path';
import db from '../db.js';
import { runClaudeCli } from '../../minimal-claude.js';
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Variables | camelCase | `agentId`, `cliCommand`, `runningAgentIds` |
| Functions | camelCase | `parseCommand()`, `sendInput()` |
| React Components | PascalCase | `ChatPanel`, `TaskPanel` |
| Custom Hooks | use-prefix | `useAgents()`, `useWs()` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_AGENTS`, `API` |
| CSS Classes | kebab-case | `chat-panel`, `chat-msg-content` |
| Database Tables | snake_case | `chat_messages`, `cli_cwd` |

### Export Style

- **React Components:** Default export
  ```javascript
  export default function ChatPanel({ ... }) { }
  ```
- **Utilities/Hooks:** Named exports
  ```javascript
  export function useAgents() { }
  export function run(agentId, onOutput, onExit) { }
  ```

### React Conventions

- Use functional components with hooks (no class components)
- Destructure props in function signature
- Custom hooks in `client/hooks/` directory
- Components in `client/components/` directory
- Each component has a corresponding CSS file: `ChatPanel.jsx` → `ChatPanel.css`

```javascript
export default function ChatPanel({
  agents,
  currentAgent,
  selectedAgentId,
  onSelectAgent,
}) {
  const [input, setInput] = useState('');
  // ...
}
```

### Backend Conventions

- Express routers in `server/routes/` with default export
- Services in `server/services/` with named exports
- Database operations use `db.prepare(sql).get/all/run()` pattern
- All routes wrapped in try-catch, return JSON errors

```javascript
router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Agent not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

### Error Handling

- Always use try-catch for async operations
- Return `{ error: string }` for API errors
- Use appropriate HTTP status codes (400, 404, 500)
- Log errors to console with context prefix

```javascript
console.log('[agentRunner] run() failed: agentId=%s not found', agentId);
```

### Logging

- Prefix console logs with `[componentName]` for traceability
- Use `console.log()` for info, `console.error()` for errors
- Format: `console.log('[module] action: key=%s value=%o', key, value)`

### Async/Await

- Prefer async/await over `.then()` chains
- Use try-catch-finally pattern

```javascript
const refetch = useCallback(async () => {
  setLoading(true);
  try {
    const res = await fetch(`${API}/agents`);
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    setAgents(Array.isArray(data) ? data : []);
  } catch (e) {
    setAgents([]);
  } finally {
    setLoading(false);
  }
}, []);
```

### Comments

- Code should be self-documenting; avoid unnecessary comments
- Use JSDoc for complex exported functions only
- Chinese comments are acceptable for internal documentation

### File Structure

```
co_agent/
├── client/           # React frontend
│   ├── components/   # UI components (.jsx + .css)
│   └── hooks/        # Custom React hooks (.js)
├── server/           # Node.js backend
│   ├── routes/       # Express routers
│   └── services/     # Business logic
├── data/             # SQLite database (auto-created)
├── minimal-claude.js # Claude CLI wrapper
└── minimal-opencode.js # Opencode CLI wrapper
```

### WebSocket Message Protocol

Messages are JSON with format: `{ action, agentId, text }`

Actions: `start`, `send`, `stop`, `status`

Responses: `{ type: 'output'|'exit'|'error'|'started'|'stopped'|'status', ... }`

### Database

- Uses sql.js (SQLite in-memory with file persistence)
- Database file: `data/app.db`
- Schema migrations use ALTER TABLE with try-catch (ignore if column exists)

### Process Management

- Agent processes tracked in `Map` with string keys
- Always convert agentId to string when used as Map key: `String(agentId)`
- Use `child_process.spawn()` with `stdio: ['pipe', 'pipe', 'pipe']`

## Important Constraints

- Maximum 5 agents enforced in backend
- WebSocket path is `/ws`
- Server port: 3000 (configurable via PORT env var)
- Client dev server: 5173 (proxies `/api` and `/ws` to server)
