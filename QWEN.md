# QWEN.md - 项目上下文文档

## 项目概述

**多 Agent 协作平台** - 基于 Node.js + React 的多 Agent 协作系统，支持左侧任务（对话）管理、中间与 Agent 对话、右侧 Agent 状态与聊天记录。Agent 通过 spawn CLI 方式调用，数据持久化到 SQLite。

### 核心功能

| 模块 | 功能描述 |
|------|----------|
| **任务管理** | 左侧面板，新建/编辑/删除任务，状态：待办 (pending)、进行中 (in_progress)、已完成 (completed) |
| **Agent 对话** | 中间面板，选择 Agent，发送消息后自动 spawn 对应 CLI，实时流式显示 stdout/stderr |
| **Agent 管理** | 右侧面板，添加/编辑/删除 Agent（最多 5 个），配置名称、CLI 命令、工作目录 |
| **状态与历史** | 右侧显示连接状态、各 Agent 运行状态及当前 Agent 的聊天记录 |

### 内置 Agent

- **Claude CLI** - `builtin:claude-cli`，需要系统安装 Claude CLI
- **Opencode CLI** - `builtin:opencode-cli`，需要系统安装 Opencode CLI

## 技术栈

### 后端
- **运行时**: Node.js (ES Modules)
- **框架**: Express.js
- **实时通信**: WebSocket (ws)
- **数据库**: SQLite (sql.js - 内存 + 文件持久化)
- **进程管理**: child_process.spawn / node-pty

### 前端
- **框架**: React 18 (函数组件 + Hooks)
- **构建工具**: Vite 6
- **测试**: Vitest + Testing Library
- **状态管理**: 自定义 Hooks

## 目录结构

```
co_agent/
├── client/                      # React 前端
│   ├── components/
│   │   ├── TaskPanel.jsx        # 任务/对话管理面板
│   │   ├── ChatPanel.jsx        # 统一聊天面板（支持 @mention）
│   │   ├── RightPanel.jsx       # Agent 管理与状态面板
│   │   ├── MarkdownRenderer.jsx # Markdown 渲染组件（新增）
│   │   └── ErrorBoundary.jsx    # 错误边界
│   ├── hooks/
│   │   ├── useAgents.js         # Agent 数据获取
│   │   ├── useTasks.js          # 任务数据获取
│   │   ├── useWs.js             # WebSocket 连接管理
│   │   ├── useGlobalMessages.js # 全局消息获取（按对话过滤）
│   │   └── useMessages.js       # 遡留：单 Agent 消息获取
│   ├── utils/
│   │   └── logger.js            # 时间戳日志工具
│   ├── App.jsx                  # 主应用组件（三栏布局）
│   ├── main.jsx                 # 入口文件
│   └── *.css                    # 组件样式
├── server/                      # Node.js 后端
│   ├── routes/
│   │   ├── agents.js            # Agent CRUD API
│   │   ├── tasks.js             # 任务 CRUD API
│   │   ├── chats.js             # 聊天消息 API
│   │   ├── stats.js             # 统计 API
│   │   ├── sessions.js          # 会话管理 API
│   │   └── memory.js            # 记忆管理 API
│   ├── services/
│   │   ├── agentRunner.js       # 进程启动与管理
│   │   ├── sessionManager.js    # Agent 会话跟踪
│   │   └── memoryManager.js     # 记忆事件记录
│   ├── db.js                    # SQLite 封装（prepare/all/get/run）
│   ├── index.js                 # Express 入口
│   ├── websocket.js             # WebSocket 处理器
│   └── logger.js                # 后端日志
├── test/                        # 测试文件
│   ├── api/                     # API 路由测试
│   ├── components/              # React 组件测试
│   ├── hooks/                   # Hook 测试
│   ├── mocks/                   # Mock 模块
│   ├── unit/                    # 单元测试
│   │   └── markdown-renderer.test.jsx # Markdown 渲染器测试
│   └── setup.js                 # 测试配置
├── doc/                         # 设计文档与 Bugfix 记录
├── docs/                        # 新功能文档
│   ├── markdown-thinking-support.md # Markdown 渲染与 Thinking 消息文档
│   └── opencode-session-chain.md    # Opencode CLI 会话链文档
├── data/                        # SQLite 数据库（自动创建）
│   └── app.db
├── minimal-claude.js            # Claude CLI 封装（NDJSON 解析）
├── minimal-opencode.js          # Opencode CLI 封装（NDJSON 解析）
├── index.html                   # HTML 模板
├── package.json                 # 依赖与脚本
├── vite.config.js               # Vite 配置（含代理）
├── vitest.config.js             # Vitest 测试配置
├── eslint.config.js             # ESLint 配置
└── README.md / CLAUDE.md / AGENTS.md / RULES.md  # 文档
```

## 构建与运行

### 安装依赖
```bash
npm install
```

### 开发模式
```bash
# 同时启动后端 (3000) 和前端 (5173)
npm run dev

# 仅启动后端
npm run server

# 仅启动前端（需后端已运行）
npm run client
```

### 生产构建
```bash
npm run build
npm run server  # 访问 http://localhost:3000
```

### 测试
```bash
# 运行所有测试
npm run test:run

# 监视模式
npm test

# 覆盖率报告
npm run test:coverage

# 运行单个测试文件
npx vitest run test/unit/xxx.test.js

# 运行匹配模式的测试
npx vitest run -t "pattern"
```

### 代码检查
```bash
# ESLint 检查
npm run lint

# 自动修复
npm run lint:fix
```

## 数据库 Schema

### agents - Agent 配置表
```sql
CREATE TABLE agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cli_command TEXT NOT NULL,
  cli_cwd TEXT,              -- 工作目录
  builtin_key TEXT,          -- 内置 Agent 标识
  session_id TEXT,
  created_at TEXT
);
```

### tasks - 任务/对话表
```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/in_progress/completed/doing
  created_at TEXT,
  updated_at TEXT,
  last_activity_at TEXT,
  group_name TEXT,
  is_archived INTEGER DEFAULT 0
);
```

### global_messages - 全局消息表（统一聊天）
```sql
CREATE TABLE global_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,           -- user/assistant/system
  content TEXT NOT NULL,
  agent_id INTEGER,
  agent_name TEXT,
  task_id INTEGER,              -- 对话 ID
  message_type TEXT DEFAULT 'text',  -- text, thinking, image
  metadata TEXT,                -- JSON 格式存储附加信息
  created_at TEXT
);
```

### shared_events - 跨 Agent 共享事件表
```sql
CREATE TABLE shared_events (
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
  created_at TEXT
);
```

### agent_sessions - Agent 会话表
```sql
CREATE TABLE agent_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(agent_id, task_id)
);
```

## API 路由

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/agents` | 获取所有 Agent |
| POST | `/api/agents` | 创建 Agent（最多 5 个） |
| PUT | `/api/agents/:id` | 更新 Agent |
| DELETE | `/api/agents/:id` | 删除 Agent |
| GET | `/api/tasks` | 获取所有任务/对话 |
| POST | `/api/tasks` | 创建任务 |
| PUT | `/api/tasks/:id` | 更新任务 |
| DELETE | `/api/tasks/:id` | 删除任务 |
| GET | `/api/messages?conversation_id=X` | 获取对话消息 |
| POST | `/api/messages` | 发送消息 |
| GET | `/api/agents/:id/messages` | 获取单 Agent 消息（遗贸） |
| GET | `/api/sessions` | 获取会话列表 |
| POST | `/api/sessions` | 创建/更新会话 |
| GET | `/api/memory` | 获取记忆事件 |
| POST | `/api/memory` | 记录记忆事件 |

## WebSocket 协议

### 连接路径
`ws://localhost:3000/ws`

### 客户端发送动作

| 动作 | 参数 | 描述 |
|------|------|------|
| `start` | `{ agentId }` | 启动 Agent 进程 |
| `send` | `{ agentId, text, conversationId }` | 发送文本到 Agent |
| `stop` | `{ agentId }` | 偲止 Agent 进程 |
| `status` | - | 请求状态 |

### 服务端响应

| 类型 | 数据 | 描述 |
|------|------|------|
| `started` | `{ agentId }` | Agent 已启动 |
| `stopped` | `{ agentId }` | Agent 已停止 |
| `output` | `{ agentId, stream: 'stdout'|'stderr', data }` | 输出流 |
| `exit` | `{ agentId, code, signal }` | 进程退出 |
| `error` | `{ agentId, error }` | 错误 |
| `status` | `{ runningAgentIds: [] }` | 状态响应 |

## 代码规范

### 模块系统
- 使用 ES Modules (`import`/`export`)
- `.js` 用于 JavaScript 文件
- `.jsx` 用于 React 组件

### 导入顺序
```javascript
// 1. Node.js 内置模块
import { spawn } from 'child_process';
import path from 'path';

// 2. 第三方包
import express from 'express';

// 3. 本地导入
import db from '../db.js';
```

### 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 变量 | camelCase | `agentId`, `cliCommand` |
| 函数 | camelCase | `parseCommand()`, `sendInput()` |
| React 组件 | PascalCase | `ChatPanel`, `TaskPanel` |
| 自定义 Hook | use-前缀 | `useAgents()`, `useWs()` |
| 常量 | SCREAMING_SNAKE_CASE | `MAX_AGENTS`, `API` |
| CSS 类 | kebab-case | `chat-panel`, `chat-msg-content` |
| 数据库表 | snake_case | `chat_messages`, `global_messages` |

### 导出风格
- **React 组件**: 默认导出
  ```javascript
  export default function ChatPanel({ agents, ... }) { }
  ```
- **工具函数/Hooks**: 命名导出
  ```javascript
  export function useAgents() { }
  ```

### React 约定
- 使用函数组件 + Hooks（无类组件）
- 在函数签名中解构 props
- 自定义 Hooks 放在 `client/hooks/`
- 组件放在 `client/components/`
- 每个组件有对应的 CSS 文件
- React 17+ 自动 JSX 转换（无需导入 React）

### 错误处理
- 异步操作使用 try-catch
- 空 catch 块添加注释：
  ```javascript
  } catch {
    // ignore fetch errors
  }
  ```

### 日志
- 使用 logger 模块：
  ```javascript
  import logger from './logger.js';
  logger.log('[module] action: key=%s', key);
  ```

## 关键特性

### @Mention 解析
- 格式：`@AgentName 消息内容`
- 支持带空格的 Agent 名（如 `@Claude CLI`）
- 按名称长度降序匹配（避免短名误匹配）
- 大小写不敏感
- 名称后必须跟空格或字符串结束
- 无 @ 的消息保存为普通笔记

### Agent 进程管理
- 使用 `child_process.spawn()` 或 `node-pty`
- 进程追踪：`Map<String(agentId), childProcess>`
- 支持 stdin 写入、stdout/stderr 流式输出
- CLI 命令解析：按空格/制表符分割，支持引号包裹路径

### 内置 CLI Agent
- **Claude CLI**: `claude -p "prompt" --output-format stream-json --verbose`
- **Opencode CLI**: `opencode run --format json "prompt"`
- 使用 node-pty（8192 cols 防止换行破坏 NDJSON）
- 解析 NDJSON 输出，提取文本块

### 会话管理
- 每个 Agent 在每个对话中有独立 session_id
- 存储在 `agent_sessions` 表
- 支持对话上下文连续性

### Markdown 渲染与 Thinking 消息
- **Markdown 支持**: 代码块、列表、表格、任务列表、引用等
- **Thinking 消息**: 折叠面板显示思考过程，不计入上下文
- **多模态支持**: 图片消息通过 metadata.url 传递
- **消息类型字段**: `message_type` (text/thinking/image)、`metadata` (JSON)

## 约束条件

- 最多 5 个 Agent
- WebSocket 路径：`/ws`
- 后端端口：3000（可通过 PORT 环境变量配置）
- 前端开发端口：5173
- 测试单线程运行（SQLite 限制）

## 提交前检查

1. `npm run lint` - 修复所有问题
2. `npm run test:run` - 所有测试通过
3. `npm run build` - 构建成功
4. **使用 feature branch** - 不要直接推送到 main

## 分支策略

```bash
# 创建功能分支
git checkout main
git pull
git checkout -b feature/description

# 推送并创建 PR
git push -u origin feature/xxx
gh pr create --title "标题" --body "描述"
```

## 相关文档

- `README.md` - 项目概述
- `CLAUDE.md` - 详细架构文档
- `AGENTS.md` - Agent 编码指南
- `RULES.md` - 项目规则
- `doc/` - 设计文档与 Bugfix 记录
- `docs/markdown-thinking-support.md` - Markdown 渲染与 Thinking 消息文档
- `docs/opencode-session-chain.md` - Opencode CLI 会话链文档