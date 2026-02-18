# 多 Agent 协作平台 - 总体设计文档

## 1. 文档概述

### 1.1 文档目的
本文档旨在描述多 Agent 协作平台的总体架构设计，为开发团队提供统一的技术视图和设计指导。

### 1.2 项目背景
随着 AI Agent 技术的发展，单一 Agent 已无法满足复杂任务的需求。本项目旨在构建一个支持多 Agent 协作的平台，实现任务分配、实时对话、状态管理等功能，提升 AI 辅助开发的效率。

### 1.3 术语定义
| 术语 | 说明 |
|------|------|
| Agent | 智能代理，能够执行特定任务的 AI 实体 |
| Task | 任务，用户创建的工作单元 |
| WebSocket | 全双工通信协议，用于实时数据传输 |
| PTY | 伪终端，用于与子进程进行交互 |
| NDJSON | 换行分隔的 JSON 格式，用于流式数据传输 |

---

## 2. 系统概述

### 2.1 系统目标
- 提供多 Agent 管理能力，支持内置和自定义 Agent
- 实现任务的创建、分配、状态跟踪
- 支持 Agent 与用户的实时流式对话
- 提供友好的 Web 界面，支持三栏布局的任务管理

### 2.2 系统特性
| 特性 | 描述 |
|------|------|
| 实时性 | 基于 WebSocket 的流式对话，实时展示 Agent 输出 |
| 可扩展 | 支持自定义 Agent，通过 CLI 命令集成 |
| 持久化 | SQLite 数据库存储任务、消息、Agent 配置 |
| 易用性 | 响应式三栏布局，清晰的任务和对话视图 |

---

## 3. 系统架构

### 3.1 总体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户界面层 (React)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Agent 列表   │  │   任务列表    │  │   对话面板    │          │
│  │   (280px)    │  │    (1fr)     │  │   (320px)    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP / WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        服务层 (Express)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  REST API    │  │  WebSocket   │  │  静态资源    │          │
│  │  /api/*      │  │    /ws       │  │  /dist/*     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        业务逻辑层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ AgentRunner  │  │ TaskManager  │  │ MessageStore │          │
│  │  进程管理     │  │  任务管理     │  │  消息存储     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        数据持久层 (SQLite)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   agents     │  │    tasks     │  │chat_messages │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      外部 Agent CLI                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Claude CLI  │  │ Opencode CLI │  │  自定义 CLI   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 技术架构

#### 3.2.1 前端技术栈
| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.x | UI 框架 |
| Vite | 6.x | 构建工具 |
| WebSocket API | - | 实时通信 |

#### 3.2.2 后端技术栈
| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | 18+ | 运行时环境 |
| Express | 4.x | Web 框架 |
| ws | 8.x | WebSocket 服务 |
| sql.js | 1.x | SQLite 数据库 |
| node-pty | 1.x | 伪终端管理 |

---

## 4. 功能模块设计

### 4.1 模块划分

```
多 Agent 协作平台
├── Agent 管理模块
│   ├── Agent 列表展示
│   ├── Agent 创建/删除
│   ├── 内置 Agent 管理
│   └── Agent 状态监控
├── 任务管理模块
│   ├── 任务创建
│   ├── 任务列表展示
│   ├── 任务状态流转
│   └── 任务删除
├── 对话管理模块
│   ├── 实时流式对话
│   ├── 消息历史查询
│   ├── 对话状态管理
│   └── 消息持久化
└── 系统管理模块
    ├── WebSocket 连接管理
    ├── 进程生命周期管理
    └── 错误处理与日志
```

### 4.2 模块详细说明

#### 4.2.1 Agent 管理模块
**职责**: 管理 Agent 的生命周期，包括创建、删除、状态监控

**核心功能**:
- 支持最多 5 个 Agent 同时运行
- 内置 Agent: Claude CLI、Opencode CLI
- 自定义 Agent: 通过 CLI 命令和路径配置
- Agent 状态: idle（空闲）、running（运行中）

**关键文件**:
- `server/services/agentRunner.js` - Agent 进程管理
- `client/components/AgentList.jsx` - Agent 列表 UI

#### 4.2.2 任务管理模块
**职责**: 管理任务的创建、分配、状态流转

**核心功能**:
- 任务 CRUD 操作
- 任务状态: pending（待处理）、in_progress（进行中）、completed（已完成）
- 任务与 Agent 的关联

**关键文件**:
- `server/db.js` - 数据库操作
- `client/components/TaskList.jsx` - 任务列表 UI

#### 4.2.3 对话管理模块
**职责**: 管理 Agent 与用户的实时对话

**核心功能**:
- WebSocket 实时通信
- 流式消息输出（NDJSON 格式）
- 消息历史持久化
- ANSI 转义序列清理

**关键文件**:
- `server/websocket.js` - WebSocket 服务
- `client/components/ChatPanel.jsx` - 对话面板 UI

#### 4.2.4 系统管理模块
**职责**: 管理系统级功能

**核心功能**:
- WebSocket 连接管理
- 子进程生命周期管理
- 错误边界处理
- 日志记录

**关键文件**:
- `server/index.js` - 服务入口
- `minimal-claude.js` - Claude CLI 封装

---

## 5. 数据模型设计

### 5.1 实体关系图

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   agents    │       │    tasks    │       │chat_messages│
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id (PK)     │       │ id (PK)     │       │ id (PK)     │
│ name        │       │ title       │       │ agent_id(FK)│
│ cli_command │       │ description │       │ role        │
│ cli_cwd     │       │ status      │       │ content     │
│ builtin_key │       │ created_at  │       │ task_id(FK) │
│ created_at  │       │ updated_at  │       │ created_at  │
└─────────────┘       └─────────────┘       └─────────────┘
       │                     │                     │
       └─────────────────────┴─────────────────────┘
                  通过 task_id 关联
```

### 5.2 表结构详细设计

#### 5.2.1 agents 表
| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PRIMARY KEY | Agent 唯一标识 |
| name | TEXT | NOT NULL | Agent 名称 |
| cli_command | TEXT | NOT NULL | CLI 启动命令 |
| cli_cwd | TEXT | - | CLI 工作目录 |
| builtin_key | TEXT | - | 内置 Agent 标识 |
| created_at | DATETIME | DEFAULT NOW | 创建时间 |

#### 5.2.2 tasks 表
| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PRIMARY KEY | 任务唯一标识 |
| title | TEXT | NOT NULL | 任务标题 |
| description | TEXT | - | 任务描述 |
| status | TEXT | DEFAULT 'pending' | 任务状态 |
| created_at | DATETIME | DEFAULT NOW | 创建时间 |
| updated_at | DATETIME | DEFAULT NOW | 更新时间 |

#### 5.2.3 chat_messages 表
| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PRIMARY KEY | 消息唯一标识 |
| agent_id | INTEGER | FOREIGN KEY | 关联 Agent |
| role | TEXT | NOT NULL | 角色（user/assistant） |
| content | TEXT | NOT NULL | 消息内容 |
| task_id | INTEGER | FOREIGN KEY | 关联任务 |
| created_at | DATETIME | DEFAULT NOW | 创建时间 |

---

## 6. 接口设计

### 6.1 REST API

#### 6.1.1 Agent 相关接口
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/agents | 获取 Agent 列表 |
| POST | /api/agents | 创建 Agent |
| DELETE | /api/agents/:id | 删除 Agent |
| GET | /api/agents/:id/messages | 获取 Agent 消息历史 |

#### 6.1.2 Task 相关接口
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/tasks | 获取任务列表 |
| POST | /api/tasks | 创建任务 |
| PUT | /api/tasks/:id | 更新任务 |
| DELETE | /api/tasks/:id | 删除任务 |

### 6.2 WebSocket 协议

#### 6.2.1 消息格式
```json
{
  "type": "start|send|stop|status",
  "agentId": 1,
  "taskId": 1,
  "message": "用户消息内容"
}
```

#### 6.2.2 消息类型
| 类型 | 方向 | 说明 |
|------|------|------|
| start | 客户端→服务端 | 启动 Agent |
| send | 客户端→服务端 | 发送消息 |
| stop | 客户端→服务端 | 停止 Agent |
| status | 服务端→客户端 | 状态更新 |
| output | 服务端→客户端 | 流式输出 |
| error | 服务端→客户端 | 错误消息 |

---

## 7. 关键技术实现

### 7.1 PTY 伪终端管理
**问题**: 子进程输出缓冲导致流式输出延迟

**解决方案**: 使用 `node-pty` 创建伪终端，实现实时输出

```javascript
// server/services/agentRunner.js
const pty = require('node-pty');
const ptyProcess = pty.spawn(command, args, {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: cwd,
  env: process.env
});
```

### 7.2 NDJSON 流式解析
**问题**: Agent CLI 输出 NDJSON 格式，需要实时解析

**解决方案**: 按行分割并逐行解析 JSON

```javascript
// minimal-claude.js
output.split('\n')
  .filter(line => line.trim())
  .forEach(line => {
    const data = JSON.parse(line);
    // 处理数据
  });
```

### 7.3 ANSI 转义序列清理
**问题**: PTY 输出包含 ANSI 转义序列，影响显示

**解决方案**: 使用正则表达式清理

```javascript
// server/websocket.js
const cleanText = (text) => {
  return text
    .replace(/\x1b\[[0-9;]*m/g, '')  // 颜色代码
    .replace(/\x1b\[[0-9]*[A-Z]/g, '') // 光标控制
    .replace(/\r/g, '');              // 回车符
};
```

### 7.4 进程生命周期管理
**问题**: 防止 Agent 重复启动

**解决方案**: 维护运行状态映射

```javascript
// server/services/agentRunner.js
const runningAgents = new Map();

function startAgent(agentId) {
  if (runningAgents.has(agentId)) {
    throw new Error('Agent already running');
  }
  // 启动逻辑
}
```

---

## 8. 部署架构

### 8.1 开发环境
```
┌─────────────────┐     ┌─────────────────┐
│  Vite Dev Server│     │  Express Server │
│   Port: 5173    │────▶│   Port: 3000    │
│   (热重载)       │     │   (API + WS)    │
└─────────────────┘     └─────────────────┘
```

### 8.2 生产环境
```
┌─────────────────────────────────────────┐
│           Express Server                │
│             Port: 3000                  │
│  ┌─────────────┐    ┌─────────────┐    │
│  │  静态资源    │    │  API + WS   │    │
│  │  /dist/*    │    │  /api/*     │    │
│  └─────────────┘    └─────────────┘    │
└─────────────────────────────────────────┘
```

### 8.3 启动命令
```bash
npm run dev      # 开发模式（前后端同时启动）
npm run build    # 生产构建
npm run server   # 生产运行
```

---

## 9. 安全设计

### 9.1 输入验证
- 所有用户输入进行转义处理
- CLI 命令参数验证
- SQL 参数化查询

### 9.2 进程隔离
- Agent 进程独立运行
- 限制 Agent 数量（最多 5 个）
- 进程资源限制

### 9.3 错误处理
- 前端错误边界
- 后端统一错误响应
- 进程异常捕获

---

## 10. 性能设计

### 10.1 前端优化
- React 组件按需渲染
- WebSocket 消息节流
- 虚拟滚动（消息列表）

### 10.2 后端优化
- 数据库连接池
- 进程复用
- 流式输出减少内存占用

### 10.3 网络优化
- WebSocket 长连接
- 消息压缩
- 静态资源缓存

---

## 11. 扩展性设计

### 11.1 Agent 扩展
- 支持自定义 Agent CLI
- Agent 插件机制
- Agent 能力注册

### 11.2 存储扩展
- 支持切换到 PostgreSQL/MySQL
- 消息存储分表
- 历史数据归档

### 11.3 功能扩展
- 多用户支持
- 权限管理
- Agent 协作编排

---

## 12. 附录

### 12.1 项目目录结构
```
co_agent/
├── client/                 # 前端代码
│   ├── App.jsx            # 主应用组件
│   ├── components/        # UI 组件
│   │   ├── AgentList.jsx
│   │   ├── TaskList.jsx
│   │   └── ChatPanel.jsx
│   └── index.html         # HTML 模板
├── server/                 # 后端代码
│   ├── index.js           # 服务入口
│   ├── db.js              # 数据库操作
│   ├── websocket.js       # WebSocket 服务
│   └── services/
│       └── agentRunner.js # Agent 进程管理
├── doc/                    # 文档
├── minimal-claude.js       # Claude CLI 封装
├── package.json            # 项目配置
└── vite.config.js          # Vite 配置
```

### 12.2 参考文档
- [plan-多agent协作平台.md](./plan-多agent协作平台.md) - 项目规划文档
- [plan-集成claude-cli内置agent.md](./plan-集成claude-cli内置agent.md) - Claude CLI 集成文档
- [AGENTS.md](../AGENTS.md) - 开发规范

### 12.3 版本历史
| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| 1.0 | 2026-02-18 | CodeArts | 初始版本 |

---

**文档结束**
