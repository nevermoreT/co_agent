# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-agent collaboration platform (多 Agent 协作平台) that allows managing tasks, chatting with multiple CLI-based agents, and viewing agent status. The platform spawns external CLI processes as "agents" and communicates with them via stdin/stdout.

**Key Features**:
- Task management with status tracking (pending/in_progress/completed)
- Unified chat interface with @mention to specify target agent
- Real-time chat with CLI-based agents via WebSocket
- Built-in Claude CLI and Opencode CLI agent support with streaming NDJSON parsing
- Agent process lifecycle management (start/stop/send input)
- Persistent storage with SQLite database

## Development Commands

```bash
# Install dependencies
npm install

# Development mode (runs both server and client concurrently)
npm run dev
# Server runs on http://localhost:3000
# Client runs on http://localhost:5173 with proxy to server

# Run server only
npm run server

# Run client only (requires server to be running)
npm run client

# Production build
npm run build
npm run server
# Access at http://localhost:3000
```

## Architecture

### Data Flow

**Unified Chat Message Flow**:
1. User types `@AgentName message` in ChatPanel
2. Frontend parses @mention to identify target agent
3. Message saved to `global_messages` table with agent_id and agent_name
4. Frontend sends WebSocket `start` action with agentId
5. Frontend sends WebSocket `send` action with text (without @mention prefix)
6. Backend spawns process or triggers CLI agent
7. Process stdout/stderr streams back via WebSocket `output` events
8. Frontend accumulates output in `streamingRef` and displays in real-time
9. Process exits → WebSocket `exit` event → frontend saves accumulated output as "assistant" message to `global_messages`

**Regular Agent Message Flow**:
1. User types message in ChatPanel → saved to DB as "user" message
2. Frontend sends WebSocket `start` action with agentId
3. Backend spawns process via `agentRunner.run()`
4. Frontend sends WebSocket `send` action with text
5. Backend writes text to process stdin
6. Process stdout/stderr streams back via WebSocket `output` events
7. Frontend accumulates output in `streamingRef` and displays in real-time
8. Process exits → WebSocket `exit` event → frontend saves accumulated output as "assistant" message

**Claude CLI Agent Message Flow**:
1. User types message in ChatPanel → saved to DB as "user" message
2. Frontend sends WebSocket `start` action → backend returns immediately (no spawn)
3. Frontend sends WebSocket `send` action with prompt text
4. Backend calls `agentRunner.runClaudeCli()` → spawns one-shot Claude CLI process
5. `minimal-claude.js` parses streaming NDJSON output, extracts text blocks
6. Text blocks stream back via WebSocket `output` events
7. Frontend accumulates output in `streamingRef` and displays in real-time
8. Process exits → WebSocket `exit` event → frontend saves accumulated output as "assistant" message

**Opencode CLI Agent Message Flow**:
1. User types message in ChatPanel → saved to DB as "user" message
2. Frontend sends WebSocket `start` action → backend returns immediately (no spawn)
3. Frontend sends WebSocket `send` action with prompt text
4. Backend calls `agentRunner.runOpencodeCli()` → spawns one-shot Opencode CLI process
5. `minimal-opencode.js` parses streaming NDJSON output, extracts text blocks
6. Text blocks stream back via WebSocket `output` events
7. Frontend accumulates output in `streamingRef` and displays in real-time
8. Process exits → WebSocket `exit` event → frontend saves accumulated output as "assistant" message

### Backend (Node.js + Express + WebSocket)

**Server Entry**: `server/index.js`
- Express server on port 3000 (configurable via PORT env var)
- Serves static files from `dist/` in production mode
- WebSocket server at `/ws` path for real-time agent communication
- CORS enabled for development

**Database**: `server/db.js`
- Uses sql.js (SQLite in-memory with file persistence)
- Database file: `data/app.db` (auto-created on first run)
- Four tables with schema:
  - `agents`: id, name, cli_command, cli_cwd, builtin_key, created_at
  - `tasks`: id, title, description, status, created_at, updated_at
  - `chat_messages`: id, agent_id, role, content, task_id, created_at (legacy, per-agent messages)
  - `global_messages`: id, role, content, agent_id, agent_name, task_id, created_at (unified chat)
- Custom wrapper provides `prepare()` API similar to better-sqlite3 with get/all/run methods
- Auto-seeds built-in "Claude CLI" and "Opencode CLI" agents on first run if agent count < 5

**REST API Routes**:
- `/api/agents` - CRUD operations for agents (max 5 agents) - `server/routes/agents.js`
- `/api/tasks` - CRUD operations for tasks (pending/in_progress/completed) - `server/routes/tasks.js`
- `/api/messages` - Global chat messages (unified chat) - `server/routes/chats.js`
- `/api/agents/:id/messages` - Legacy per-agent chat messages - `server/routes/chats.js`

**Agent Runner**: `server/services/agentRunner.js`
- Spawns child processes based on agent's `cli_command` and `cli_cwd`
- Manages running processes in a Map (keyed by agentId as string)
- Streams stdout/stderr to WebSocket clients via callbacks
- Handles stdin for sending user input to regular agents
- Command parsing: splits on spaces/tabs, respects single/double quotes
- Working directory: supports absolute paths or relative to server cwd
- Exports: `run()`, `runClaudeCli()`, `runOpencodeCli()`, `stop()`, `sendInput()`, `isRunning()`, `getRunningAgentIds()`
- Special handling for built-in CLI agents (Claude CLI and Opencode CLI):
  - Uses `runClaudeCli()` or `runOpencodeCli()` wrappers that call respective minimal-*.js modules
  - One-shot execution per message (not persistent process)
  - Parses streaming NDJSON output from CLI
  - Supports node-pty for unbuffered output (falls back to spawn)

**WebSocket**: `server/websocket.js`
- Path: `/ws` - WebSocket server attached to HTTP server
- Actions: `start`, `send`, `stop`, `status`
- Message format: JSON with `{ action, agentId, text }`
- Broadcasts agent output streams via `{ type: 'output', agentId, stream, data }`
- Sends exit events via `{ type: 'exit', agentId, code, signal }`
- Sends initial status on connection with running agent IDs
- Built-in CLI agent handling (Claude CLI and Opencode CLI):
  - `start` action: returns immediately without spawning (waits for `send`)
  - `send` action: triggers `runClaudeCli()` or `runOpencodeCli()` with prompt text
  - Each `send` spawns a new CLI process (one-shot execution)

**Claude CLI Wrapper**: `minimal-claude.js`
- Standalone module that wraps Claude CLI invocation with streaming NDJSON parsing
- Can be imported by server or run directly: `node minimal-claude.js "your question"`
- Exports `runClaudeCli(prompt, { onOutput, onExit })` function
- Implementation details:
  - Tries to load node-pty for PTY support (unbuffered output)
  - Falls back to regular spawn if node-pty unavailable
  - PTY mode: spawns via `cmd.exe /c` on Windows, direct `claude` on Unix
  - PTY cols set to 8192 to prevent line wrapping that breaks NDJSON parsing
  - Strips ANSI escape sequences and `\r` characters from PTY output
  - Parses each line as JSON, extracts `message.content[].text` blocks
  - Calls `onOutput('stdout', text)` for each text block found
  - Handles errors gracefully (ENOENT → "Claude CLI not found" message)
  - Returns `{ child }` object with `pid` and `kill()` method

### Frontend (React + Vite)

**Entry**: `client/main.jsx` → `client/App.jsx`

**Three-panel layout**:
- Left: TaskPanel - Task management (CRUD, status filtering)
- Center: ChatPanel - Unified chat interface with @mention to specify agent
- Right: RightPanel - Agent management (CRUD), connection status, chat history

**Components**:
- `client/components/TaskPanel.jsx` - Task list and CRUD operations
- `client/components/ChatPanel.jsx` - Agent chat interface with streaming display
- `client/components/RightPanel.jsx` - Agent list, status, and message history
- `client/components/ErrorBoundary.jsx` - Error boundary wrapper

**Custom Hooks**:
- `useAgents()` - Fetches and manages agents list (`client/hooks/useAgents.js`)
- `useTasks()` - Fetches and manages tasks list (`client/hooks/useTasks.js`)
- `useWs()` - WebSocket connection, handles messages, maintains running agent IDs (`client/hooks/useWs.js`)
- `useGlobalMessages()` - Fetches global chat history (`client/hooks/useGlobalMessages.js`)
- `useMessages()` - Legacy: fetches chat history for selected agent (`client/hooks/useMessages.js`)

**Key Behaviors**:
- User sends message with `@AgentName` prefix to specify target agent
- Message is saved to `global_messages` table with agent info
- Agent is started via WebSocket `start` action, then input sent via `send`
- For Claude CLI agent: `start` returns immediately, `send` triggers one-shot execution
- Agent output streams in real-time and displays in ChatPanel
- On agent exit, accumulated output is saved as an "assistant" message to `global_messages`
- Agents can be started/stopped via WebSocket, only one instance per agent at a time
- Frontend maintains `streamingRef` to accumulate output before saving

## Important Notes

### Agent Configuration
- **Agent CLI Commands**: Parsed by splitting on spaces/tabs, respecting single and double quotes. Quotes are stripped from final arguments. Example: `node agent.js` or `python -u "path/to/agent.py"`
- **Agent Working Directory**: Optional `cli_cwd` can be absolute or relative to server process cwd
- **Agent Limit**: Maximum 5 agents enforced in backend (checked during creation and seeding)

### Built-in Claude CLI Agent
- **Auto-creation**: Created on first run with `builtin_key='claude-cli'` and `cli_command='builtin:claude-cli'`
- **Requirements**: Claude CLI must be installed and in PATH (`claude` command available)
- **Execution Model**: One-shot execution per message (each user message spawns a new process)
- **Command**: `claude -p "prompt" --output-format stream-json --verbose --permission-mode acceptEdits`
- **PTY Support**: Prefers node-pty for unbuffered output, falls back to spawn if unavailable
- **PTY Configuration**: 8192 cols (wide terminal to prevent line wrapping breaking NDJSON)
- **Output Parsing**: Strips ANSI escape sequences, parses NDJSON, extracts text from `message.content[].text`

### Built-in Opencode CLI Agent
- **Auto-creation**: Created on first run with `builtin_key='opencode-cli'` and `cli_command='builtin:opencode-cli'`
- **Requirements**: Opencode CLI must be installed and in PATH (`opencode` command available)
- **Execution Model**: One-shot execution per message (each user message spawns a new process)
- **Command**: `opencode run --format json "prompt"`
- **PTY Support**: Prefers node-pty for unbuffered output, falls back to spawn if unavailable
- **PTY Configuration**: 8192 cols (wide terminal to prevent line wrapping breaking NDJSON)
- **Output Parsing**: Strips ANSI escape sequences, parses NDJSON, extracts text from `part.text` and tool output from `part.state.output`

### Technical Details
- **Database**: sql.js requires manual save after each write operation (handled automatically in db wrapper)
- **WebSocket Path**: `/ws` - Vite dev server proxies this to backend in development
- **Streaming**: Agent output accumulates in frontend `streamingRef` and is saved to DB only after process exits
- **NDJSON Parsing**: `minimal-claude.js` and `minimal-opencode.js` strip ANSI escape sequences and parse JSON lines to extract text blocks
- **Process Management**: Running processes tracked in Map with string keys (agentId converted to string)
- **Error Handling**: ENOENT errors for missing CLI commands show user-friendly messages

### Development Tips
- Use `npm run dev` for concurrent server and client development with hot reload
- Server logs show detailed agent lifecycle events (start, output, exit)
- WebSocket messages are logged with action and agentId for debugging
- Database is auto-created in `data/` directory on first run
- Built-in Claude CLI and Opencode CLI agents are auto-seeded if agent count < 5

## File Structure

```
co_agent/
├── client/                    # React frontend
│   ├── components/
│   │   ├── TaskPanel.jsx     # Task management UI (CRUD, status filtering)
│   │   ├── ChatPanel.jsx     # Agent chat interface with streaming display
│   │   ├── RightPanel.jsx    # Agent list, status, and message history
│   │   └── ErrorBoundary.jsx # Error boundary wrapper
│   ├── hooks/
│   │   ├── useAgents.js      # Agent data fetching and management
│   │   ├── useTasks.js       # Task data fetching and management
│   │   ├── useWs.js          # WebSocket connection and message handling
│   │   ├── useGlobalMessages.js # Global chat history fetching
│   │   └── useMessages.js    # Legacy: chat history fetching per agent
│   ├── App.jsx               # Main app component (three-panel layout)
│   └── main.jsx              # React entry point
├── server/                    # Node.js backend
│   ├── routes/
│   │   ├── agents.js         # Agent CRUD API (max 5 agents)
│   │   ├── tasks.js          # Task CRUD API (status: pending/in_progress/completed)
│   │   └── chats.js          # Chat message API (GET/POST /api/messages, legacy /api/agents/:id/messages)
│   ├── services/
│   │   └── agentRunner.js    # Process spawning, lifecycle management, Claude CLI wrapper
│   ├── db.js                 # SQLite wrapper with prepare/exec API
│   ├── index.js              # Express server entry with CORS and static serving
│   └── websocket.js          # WebSocket handler (start/send/stop/status actions)
├── data/
│   └── app.db                # SQLite database (auto-created on first run)
├── minimal-claude.js          # Claude CLI wrapper with NDJSON parsing
│                              # - Exports runClaudeCli(prompt, {onOutput, onExit})
│                              # - Can be run standalone: node minimal-claude.js "question"
│                              # - Prefers node-pty, falls back to spawn
│                              # - Strips ANSI, parses NDJSON, extracts text blocks
├── minimal-opencode.js        # Opencode CLI wrapper with NDJSON parsing
│                              # - Exports runOpencodeCli(prompt, {onOutput, onExit})
│                              # - Can be run standalone: node minimal-opencode.js "question"
│                              # - Prefers node-pty, falls back to spawn
│                              # - Strips ANSI, parses NDJSON, extracts text and tool output
├── vite.config.js            # Vite configuration with proxy (/api, /ws)
├── package.json              # Dependencies & scripts (dev/build/server/client)
└── CLAUDE.md                 # This file (project documentation)
```


