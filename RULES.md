# Project Rules

This file contains rules and guidelines for AI coding agents working in this repository.

## Branch Strategy

**IMPORTANT**: Always use feature branch development. NEVER push directly to main.

### Workflow

1. **Create feature branch** before starting work:
   ```bash
   git checkout main
   git pull
   git checkout -b feature/description
   ```

2. **Naming conventions**:
   - `feature/xxx` - New features
   - `fix/xxx` - Bug fixes
   - `refactor/xxx` - Code refactoring
   - `docs/xxx` - Documentation updates
   - `test/xxx` - Test additions/updates

3. **Commit frequently** with clear messages

4. **Before creating PR**:
   ```bash
   npm run lint
   npm run test:run
   npm run build
   ```

5. **Push and create PR**:
   ```bash
   git push -u origin feature/xxx
   gh pr create --title "title" --body "description"
   ```

6. **Merge via GitHub PR** - Do not merge locally

## Build & Test Commands

```bash
# Development
npm run dev           # Start both server and client
npm run server        # Server only (port 3000)
npm run client        # Client only (port 5173)

# Testing
npm run test:run      # Run all tests once
npm test              # Run tests in watch mode
npm run test:coverage # Run with coverage

# Single test file
npx vitest run test/unit/xxx.test.js

# Linting
npm run lint          # Check code style
npm run lint:fix      # Auto-fix issues

# Build
npm run build         # Production build
```

## Code Style

### Module System
- ES Modules only (`import`/`export`)
- `.js` for JavaScript, `.jsx` for React components

### Imports Order
1. Node.js built-ins
2. Third-party packages
3. Local imports

```javascript
import { spawn } from 'child_process';
import path from 'path';

import express from 'express';

import db from '../db.js';
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Variables | camelCase | `agentId`, `runningAgentIds` |
| Functions | camelCase | `parseCommand()` |
| Components | PascalCase | `ChatPanel` |
| Hooks | use-prefix | `useAgents()` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_AGENTS` |
| CSS | kebab-case | `chat-panel` |
| Database | snake_case | `chat_messages` |

### Exports
- React Components: `export default function Xxx() {}`
- Utilities/Hooks: `export function xxx() {}`

### Error Handling
- Use try-catch for async operations
- Empty catch blocks should have comments:
  ```javascript
  } catch {
    // ignore fetch errors
  }
  ```

### Logging
- Use logger module: `import logger from './logger.js'`
- Format: `logger.log('[module] action: key=%s', key)`

## Architecture

### Unified Chat System
- All messages in `global_messages` table
- Use `@AgentName message` to target specific agent
- Messages without `@` are regular messages

### Session Management
- Each agent has `session_id` in database
- CLI wrappers use `--continue` or `--session` for persistence
- See `doc/cli-json-format-analysis.md` for event types

### WebSocket Protocol
- Actions: `start`, `send`, `stop`, `status`
- Responses: `{ type: 'output'|'exit'|'error'|'started'|'stopped'|'status' }`

## File Structure

```
co_agent/
├── client/           # React frontend
│   ├── components/   # UI components (.jsx + .css)
│   ├── hooks/        # Custom hooks (.js)
│   └── utils/        # Utilities
├── server/           # Node.js backend
│   ├── routes/       # Express routers
│   └── services/     # Business logic
├── test/             # Test files
│   ├── api/          # API tests
│   ├── components/   # Component tests
│   ├── hooks/        # Hook tests
│   ├── mocks/        # Mock modules
│   └── unit/         # Unit tests
├── doc/              # Documentation
├── data/             # SQLite database
├── minimal-claude.js # Claude CLI wrapper
└── minimal-opencode.js # Opencode CLI wrapper
```

## Constraints

- Maximum 5 agents
- WebSocket path: `/ws`
- Server port: 3000
- Client dev port: 5173
- Tests run single-threaded (SQLite limitation)

## Before Committing

1. `npm run lint` - Fix all issues
2. `npm run test:run` - All tests pass
3. `npm run build` - Build succeeds
4. **Create PR** instead of pushing to main
