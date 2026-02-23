# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-agent collaboration platform (多 Agent 协作平台) that allows managing conversations, chatting with multiple CLI-based agents, and viewing agent status. The platform spawns external CLI processes as "agents" and communicates with them via stdin/stdout.

**Key Features**:
- Conversation management (tasks table) with status tracking and grouping
- Unified chat interface with @mention to specify target agent (optional - messages without @ are saved as general notes)
- Real-time chat with CLI-based agents via WebSocket
- Built-in Claude CLI and Opencode CLI agent support with streaming NDJSON parsing
- Agent process lifecycle management (start/stop/send input)
- Shared event system for cross-agent context sharing
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
1. User selects a conversation (task) from left panel
2. User types message in ChatPanel - can optionally use `@AgentName` prefix to invoke an agent
3. Message saved to `global_messages` table with conversation_id (task_id), agent_id, and agent_name
4. If @mention used:
   - Frontend sends WebSocket `start` action with agentId
   - Frontend sends WebSocket `send` action with text (without @mention prefix) and conversationId
   - Backend spawns process or triggers CLI agent
   - Process stdout/stderr streams back via WebSocket `output` events
   - Frontend accumulates output in `streamingRef` and displays in real-time
   - Process exits → WebSocket `exit` event → frontend saves accumulated output as "assistant" message
5. If no @mention: message saved as general note (no agent invocation)
6. Important user messages trigger memory events via `memoryManager.recordEvent()`

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
- Five tables with schema:
  - `agents`: id, name, cli_command, cli_cwd, builtin_key, session_id, created_at
  - `tasks`: id, title, description, status, group_name, last_activity_at, is_archived, created_at, updated_at
    - Note: "tasks" table is used for conversations - each task represents a conversation thread
  - `chat_messages`: id, agent_id, role, content, task_id, created_at (legacy, per-agent messages)
  - `global_messages`: id, role, content, agent_id, agent_name, task_id, created_at (unified chat)
  - `shared_events`: id, event_type, source_agent_id, source_agent_name, conversation_id, title, content, summary, metadata, importance, created_at
    - Stores cross-agent shareable events for context building
  - `agent_sessions`: id, agent_id, task_id, session_id, created_at, updated_at
    - Tracks agent session IDs per conversation for context continuity
- Custom wrapper provides `prepare()` API similar to better-sqlite3 with get/all/run methods
- Auto-seeds built-in "Claude CLI" and "Opencode CLI" agents on first run if agent count < 5
- Auto-creates default "创世碎碎念" conversation on first run

**REST API Routes**:
- `/api/agents` - CRUD operations for agents (max 5 agents) - `server/routes/agents.js`
- `/api/tasks` - CRUD operations for conversations (status: pending/in_progress/completed) - `server/routes/tasks.js`
- `/api/messages` - Global chat messages with conversation filtering - `server/routes/chats.js`
  - GET supports `?conversation_id=X` or `?task_id=X` to filter by conversation
  - POST updates `tasks.last_activity_at` and records memory events for user messages
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

**Session Manager**: `server/services/sessionManager.js`
- Manages agent session IDs per conversation for context continuity
- Stores session mappings in `agent_sessions` table
- Ensures agents maintain conversation context across multiple invocations

**Memory Manager**: `server/services/memoryManager.js` (referenced but not yet implemented)
- Intended to record important events to `shared_events` table
- Called from chat routes when user messages are posted
- Will enable cross-agent context sharing

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
- Left: TaskPanel - Conversation management (CRUD, status filtering, grouping)
- Center: ChatPanel - Unified chat interface with optional @mention to invoke agents
- Right: RightPanel - Agent management (CRUD), connection status, recent chat history

**Components**:
- `client/components/TaskPanel.jsx` - Conversation list and CRUD operations
- `client/components/ChatPanel.jsx` - Unified chat interface with @mention parsing and streaming display
- `client/components/RightPanel.jsx` - Agent list, status, and recent message history
- `client/components/ErrorBoundary.jsx` - Error boundary wrapper

**Custom Hooks**:
- `useAgents()` - Fetches and manages agents list (`client/hooks/useAgents.js`)
- `useTasks()` - Fetches and manages conversations list (`client/hooks/useTasks.js`)
- `useWs()` - WebSocket connection, handles messages, maintains running agent IDs (`client/hooks/useWs.js`)
- `useGlobalMessages(conversationId)` - Fetches global chat history filtered by conversation (`client/hooks/useGlobalMessages.js`)
- `useMessages()` - Legacy: fetches chat history for selected agent (`client/hooks/useMessages.js`)

**Utilities**:
- `client/utils/logger.js` - Timestamped console logging (log, error, warn)

**Key Behaviors**:
- User selects a conversation from left panel (defaults to "创世碎碎念" on first load)
- User can send messages with optional `@AgentName` prefix to invoke specific agent
- Messages without @ are saved as general notes (no agent invocation)
- @mention parsing supports agent names with spaces (e.g., "@Claude CLI")
  - Algorithm: sorts agents by name length (longest first) to avoid short-name false matches
  - Case-insensitive matching
  - Name must be followed by space or end of string
- Message is saved to `global_messages` table with conversation_id (task_id)
- If @mention used: agent started via WebSocket `start`, then input sent via `send` with conversationId
- For Claude CLI agent: `start` returns immediately, `send` triggers one-shot execution
- Agent output streams in real-time and displays in ChatPanel
- On agent exit, accumulated output saved as "assistant" message to `global_messages`
- Agents can be started/stopped via WebSocket, only one instance per agent at a time
- Frontend maintains `streamingRef` to accumulate output before saving
- Empty state shown when no conversation selected

## Important Notes

### Conversation System
- **Terminology**: The `tasks` table stores conversations, not traditional tasks
- **Default Conversation**: "创世碎碎念" is auto-created and selected by default
- **Conversation Filtering**: Messages are filtered by `conversation_id` (task_id) parameter
- **Activity Tracking**: `last_activity_at` updated when messages posted to conversation
- **Grouping**: Conversations can have optional `group_name` for organization
- **Archiving**: `is_archived` flag for hiding old conversations (not yet implemented in UI)

### @Mention Parsing
- **Optional**: @mention is not required - messages without @ are saved as notes
- **Space Support**: Handles agent names with spaces (e.g., "Claude CLI", "Opencode CLI")
- **Algorithm**: Sorts agents by name length descending, matches longest first
- **Case Insensitive**: "@claude cli" matches "Claude CLI"
- **Boundary Check**: Name must be followed by space or end of string
- **Example**: "@Claude CLI hello" → agent="Claude CLI", text="hello"

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
- **Logging**: Frontend uses `logger.js` utility for timestamped console logs
- **Session Continuity**: Agent sessions tracked per conversation in `agent_sessions` table
- **Memory Events**: User messages trigger `memoryManager.recordEvent()` for cross-agent context (implementation pending)

### Development Tips
- Use `npm run dev` for concurrent server and client development with hot reload
- Server logs show detailed agent lifecycle events (start, output, exit)
- WebSocket messages are logged with action and agentId for debugging
- Database is auto-created in `data/` directory on first run
- Built-in Claude CLI and Opencode CLI agents are auto-seeded if agent count < 5
- Default "创世碎碎念" conversation is auto-created on first run
- Frontend logger adds timestamps to all console output
- Check `doc/` directory for design documents and bugfix notes

## File Structure

```
co_agent/
├── client/                    # React frontend
│   ├── components/
│   │   ├── TaskPanel.jsx     # Conversation management UI (CRUD, status filtering)
│   │   ├── ChatPanel.jsx     # Unified chat with @mention parsing and streaming
│   │   ├── RightPanel.jsx    # Agent list, status, and recent message history
│   │   └── ErrorBoundary.jsx # Error boundary wrapper
│   ├── hooks/
│   │   ├── useAgents.js      # Agent data fetching and management
│   │   ├── useTasks.js       # Conversation data fetching and management
│   │   ├── useWs.js          # WebSocket connection and message handling
│   │   ├── useGlobalMessages.js # Global chat history fetching (with conversation filter)
│   │   └── useMessages.js    # Legacy: chat history fetching per agent
│   ├── utils/
│   │   └── logger.js         # Timestamped console logging utility
│   ├── App.jsx               # Main app component (three-panel layout)
│   └── main.jsx              # React entry point
├── server/                    # Node.js backend
│   ├── routes/
│   │   ├── agents.js         # Agent CRUD API (max 5 agents)
│   │   ├── tasks.js          # Conversation CRUD API (status: pending/in_progress/completed)
│   │   └── chats.js          # Chat message API (GET/POST /api/messages with conversation filter)
│   ├── services/
│   │   ├── agentRunner.js    # Process spawning, lifecycle management, CLI wrappers
│   │   ├── sessionManager.js # Agent session tracking per conversation
│   │   └── memoryManager.js  # (Pending) Cross-agent event recording
│   ├── db.js                 # SQLite wrapper with prepare/exec API
│   ├── index.js              # Express server entry with CORS and static serving
│   └── websocket.js          # WebSocket handler (start/send/stop/status actions)
├── data/
│   └── app.db                # SQLite database (auto-created on first run)
├── doc/                       # Design and bugfix documentation
│   ├── unified-chat-design.md
│   └── bugfix-at-mention-parsing.md
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
├── README.md                 # Project overview (Chinese)
└── CLAUDE.md                 # This file (project documentation)
```


