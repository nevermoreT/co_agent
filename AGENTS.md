# AGENTS.md

Guidelines for agentic coding agents working in this repository.

## Project Overview

Multi-agent collaboration platform built with Node.js (Express + WebSocket) backend and React (Vite) frontend. The system manages CLI-based agent processes and streams their output via WebSocket. Features a unified chat interface with @mention support for agent selection.

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
```

## Testing Commands

```bash
# Run all tests once
npm run test:run

# Run tests in watch mode
npm test

# Run tests with coverage
npm run test:coverage

# Run a single test file
npx vitest run test/unit/minimal-claude.test.js

# Run tests matching a pattern
npx vitest run -t "parseCommand"

# Run tests in a specific directory
npx vitest run test/hooks/
```

## Linting Commands

```bash
# Run ESLint
npm run lint

# Run ESLint with auto-fix
npm run lint:fix
```

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

import express from 'express';

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
| Database Tables | snake_case | `chat_messages`, `global_messages` |

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
- No need to import React (React 17+ automatic JSX transform)

```javascript
export default function ChatPanel({
  agents,
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
- Use logger module instead of console directly:
  ```javascript
  import logger from './logger.js';
  logger.log('[module] action: key=%s', key);
  logger.error('[module] error:', err);
  ```

### Empty Catch Blocks

- Use descriptive comments or omit parameter entirely:
  ```javascript
  // Good
  } catch {
    // ignore fetch errors
  }
  
  // Good (for intentionally ignored errors)
  } catch {
    // column already exists
  }
  
  // Avoid
  } catch (e) {}
  } catch (_) {}
  ```

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
  } catch {
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
│   ├── hooks/        # Custom React hooks (.js)
│   └── utils/        # Utility modules (logger.js)
├── server/           # Node.js backend
│   ├── routes/       # Express routers
│   └── services/     # Business logic
├── test/             # Test files
│   ├── api/          # API route tests
│   ├── components/   # React component tests
│   ├── hooks/        # Hook tests
│   ├── mocks/        # Mock modules
│   └── unit/         # Unit tests
├── data/             # SQLite database (auto-created)
├── minimal-claude.js # Claude CLI wrapper
└── minimal-opencode.js # Opencode CLI wrapper
```

## Architecture Notes

### Unified Chat System

- All messages stored in `global_messages` table
- Use `@AgentName message` format to target specific agent
- Agent name parsing supports spaces (e.g., `@Claude CLI hello`)
- Messages without @ prefix are saved as regular messages

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
- Tests run single-threaded (`threads: false`) due to SQLite

## Before Committing

1. Run `npm run lint` and fix any issues
2. Run `npm run test:run` and ensure all tests pass
3. Run `npm run build` to verify production build works
