# GEMINI.md - Project Context

## Project Overview
**Multi-Agent Collaboration Platform** (co_agent) is a Node.js and React-based system designed to manage and orchestrate multiple AI agents. It provides a three-panel interface: task management on the left, agent conversation in the center, and agent status/history on the right. Agents are integrated via CLI commands (using `spawn` or `node-pty`), allowing for a highly extensible environment where different AI models (like Claude or custom scripts) can collaborate.

### Core Architecture
- **Frontend:** React (Vite) with a responsive three-column layout.
- **Backend:** Node.js (Express) for REST APIs and WebSocket (`ws`) for real-time bidirectional communication.
- **Persistence:** SQLite (`better-sqlite3` / `sql.js`) storing agents, tasks, and message history in `data/app.db`.
- **Agent Execution:** Orchestrated via `server/services/agentRunner.js`, supporting both standard CLI tools and specialized integrations for `claude-cli` and `opencode-cli`.

## Building and Running
The project uses a unified `package.json` for both frontend and backend management.

### Key Commands
- `npm install`: Install dependencies.
- `npm run dev`: Concurrent startup of backend (Port 3000) and frontend (Port 5173).
- `npm run server`: Start only the backend server.
- `npm run client`: Start only the Vite frontend.
- `npm run build`: Production build of the React frontend into `dist/`.
- `npm test`: Run tests using Vitest.

## Development Conventions & Key Systems

### 1. Agent "Souls" & Personas
Agents are not just CLI commands; they have "Souls" managed by `server/services/soulManager.js`. A Soul defines an agent's:
- **Role & Responsibilities:** Stored as JSON.
- **System Prompts:** Layered prompting strategy (Layer 1-4).
- **Templates:** Predefined personas (e.g., Architect, Coder, Reviewer).

### 2. Layered Prompting Strategy
The system uses a four-layer context injection model in `agentRunner.js`:
- **Layer 1:** Agent Role/Persona (System Prompt).
- **Layer 2:** (Consensus/Global Context - implied in docs).
- **Layer 3:** Memory Context (managed by `memoryManager.js`).
- **Layer 4:** User Input + Enriched Context.

### 3. A2A (Agent-to-Agent) Protocol
Agents can invoke each other. The backend (`server/websocket.js` and `agentInvocationDetector.js`) monitors agent output for specific patterns (like `@AgentName`) and triggers nested agent executions.

### 4. Real-time Communication
- **WebSocket:** All agent output is streamed via `/ws`. 
- **Throttling:** High-frequency output chunks are throttled in `websocket.js` to prevent frontend UI lag.
- **ANSI Handling:** The system handles ANSI escape codes for clean terminal-like output in the browser.

### 5. Specialized Agents
- **Claude CLI:** Integrated via `minimal-claude.js`, supporting session persistence and tool-use parsing.
- **Opencode CLI:** Integrated via `minimal-opencode.js`, used for code execution or specific developer tasks.

## Key Directory Structure
- `client/`: React source code (App, components, hooks, utils).
- `server/`: Express app, WebSocket setup, and routes.
- `server/services/`: Core logic (AgentRunner, MemoryManager, SoulManager, SessionManager).
- `docs/`: Comprehensive technical documentation (Architecture, Phases, Bugfixes).
- `test/`: Extensive test suite (Unit, Integration, E2E).
- `data/`: SQLite database storage.

## Development Mandates
- **ES Modules:** The project uses `"type": "module"`.
- **Database Safety:** Use parameterized queries via `better-sqlite3`.
- **Process Management:** Ensure agent processes are correctly terminated (`SIGTERM`/`kill`) to avoid zombie processes.
- **Documentation:** Follow the standards in `RULES.md` and `AGENTS.md` when adding new features.
