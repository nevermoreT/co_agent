# AGENTS.md

Guidelines for agentic coding agents working in this repository.

## Project Overview

Multi-agent collaboration platform with Node.js (Express + WebSocket) backend and React (Vite) frontend. Manages CLI-based agent processes with WebSocket streaming. Features unified chat with @mention support.

## Commands

```bash
npm install                 # Install dependencies
npm run dev                 # Development (server + client with hot reload)
npm run server              # Server only (port 3000)
npm run client              # Client only (port 5173)
npm run test:run            # Run all tests once
npm test                    # Run tests in watch mode
npm run test:coverage       # Run with coverage
npx vitest run test/unit/minimal-claude.test.js  # Single test file
npx vitest run -t "parseCommand"                 # Pattern matching
npx vitest run test/hooks/                       # Specific directory
npm run lint                # Run ESLint
npm run lint:fix            # Auto-fix issues
npm run build && npm run server  # Production build
```

## Code Style

### Module System & Imports

- ES Modules (`import`/`export`) - package.json has `"type": "module"`
- `.js` for JavaScript, `.jsx` for React components
- No React import needed (React 17+ automatic JSX)
- Import order: built-ins → third-party → local (blank line separated)

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Variables/Functions | camelCase | `agentId`, `parseCommand()` |
| Components | PascalCase | `ChatPanel` |
| Hooks | use-prefix | `useAgents()` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_AGENTS` |
| CSS | kebab-case | `chat-panel` |
| DB Tables | snake_case | `global_messages` |

### Exports

- Components: default export
- Utilities/Hooks/Services: named exports

### React

- Functional components with hooks (no classes)
- Destructure props in signature
- Use `memo()` for performance-critical components
- Files: `Component.jsx` + `Component.css`

### Backend

- Routers: `server/routes/` (default export)
- Services: `server/services/` (named exports)
- Database: `db.prepare(sql).get/all/run()`
- Always wrap in try-catch, return `{ error: string }`
- Use logger: `logger.log('[module] action: key=%s', key)`

### Error Handling

```javascript
try {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
} catch (e) {
  res.status(500).json({ error: e.message });
}

// Empty catch with comment
} catch {
  // ignore fetch errors
}
```

### Other Guidelines

- **Async/Await**: Prefer over `.then()` chains, use try-catch-finally
- **Comments**: Self-documenting code preferred; JSDoc for complex exports; Chinese OK
- **ESLint**: `no-unused-vars`: warn (ignore `_`), `no-console`: off, `no-empty`: warn

## Architecture

### File Structure

```
co_agent/
├── client/         # React (components/, hooks/, utils/)
├── server/         # Node.js (routes/, services/)
├── test/           # Tests (api/, components/, hooks/, mocks/, e2e/, unit/)
├── data/           # SQLite DB (auto-created)
├── docs/           # Documentation
├── minimal-claude.js    # Claude CLI wrapper
└── minimal-opencode.js  # Opencode CLI wrapper
```

### Chat System

- All messages in `global_messages` table
- `@AgentName message` to target (supports spaces)
- No @ prefix = regular message

### WebSocket Protocol

**Client → Server:** `{ action, agentId, text, conversationId }`  
Actions: `start`, `send`, `stop`, `status`

**Server → Client:**
- `{ type: 'output', agentId, stream, data }`
- `{ type: 'tool_use', agentId, tool, title, status, input, output, callID }`
- `{ type: 'exit', agentId, code, signal }`
- `{ type: 'error', agentId, message }`

### Database

- sql.js (SQLite in-memory + file persistence)
- File: `data/app.db`
- Migrations: ALTER TABLE with try-catch

### Process Management

- Map with string keys: `String(agentId)`
- `spawn()` with `stdio: ['pipe', 'pipe', 'pipe']`
- 30-minute timeout

### CLI Wrappers

- Parse NDJSON output
- `stripAnsi()` before JSON parse
- Callbacks: `onOutput(stream, data)`, `onToolUse(toolData)`, `onExit(code, signal)`
- Tool format: `{ tool, title, status, input, output, callID }`

### Windows Compatibility

- `shell: true` with `spawn()`
- Replace `\n` with spaces in prompts
- Avoid `<>` (use `[SYSTEM_CONTEXT]`)

## Constraints

- Max 5 agents
- WebSocket path: `/ws`
- Server: 3000 (PORT env)
- Client: 5173
- Tests: single-threaded, jsdom

## Before Commit

1. `npm run lint`
2. `npm run test:run`
3. `npm run build`

## Documentation

See `docs/README.md`
