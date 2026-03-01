# 前端功能优化设计文档

## 概述

参考 Cat Cafe 多会话协作平台设计，完善以下功能：
1. 对话管理功能（左侧面板）
2. Session 管理功能（右侧面板）
3. 消息统计功能

## 1. 对话管理功能

### 当前状态
- 显示对话列表
- 点击切换对话
- 显示最后活动时间

### 新增功能

#### 1.1 未读消息标记
- 对话项右上角显示未读数（红色徽章）
- 点击对话后清除未读标记

#### 1.2 对话预览
- 显示最后一条消息预览（截断 30 字符）
- 显示消息类型图标（用户/AI）

#### 1.3 对话操作
- 右键菜单：重命名、删除、归档
- 新建对话按钮（顶部）
- 搜索/过滤对话

#### 1.4 分组功能
- 支持对话分组（项目/主题）
- 分组可折叠展开

### 数据结构

```javascript
// tasks 表新增字段
{
  id: 1,
  title: "对话标题",
  group_name: "项目A",  // 已有
  last_activity_at: "2026-02-21 04:00:00",  // 已有
  unread_count: 3,  // 新增
  last_message: "最后一条消息预览...",  // 新增（运行时计算）
  is_archived: false  // 新增
}
```

### API 变更

```javascript
// GET /api/tasks?include=last_message,unread
// PATCH /api/tasks/:id { title, group_name, is_archived }
// DELETE /api/tasks/:id
// POST /api/tasks/:id/read  // 标记已读
```

---

## 2. Session 管理功能（右侧面板）

### 当前状态
- 显示 Agent 列表
- 显示运行状态

### 新增功能

#### 2.1 状态栏
- 显示当前模式：空闲 / 处理中 / 等待输入
- 显示活跃 Agent 数量

#### 2.2 消息统计（当前对话）
```
┌─────────────────────┐
│ 消息统计            │
├─────────────────────┤
│ 总数: 52            │
│ 用户消息: 20        │
│ AI消息: 30          │
│ 系统消息: 2         │
└─────────────────────┘
```

#### 2.3 Session Chain（当前 Agent）
```
┌─────────────────────┐
│ Session Info        │
├─────────────────────┤
│ ID: abc-123...      │
│ 开始: 2小时前       │
│ 状态: 运行中        │
└─────────────────────┘
```

#### 2.4 审计日志（简化版）
- 最近 10 条操作记录
- 格式：时间 + 操作描述

### 数据结构

```javascript
// 前端状态
const sessionInfo = {
  mode: 'idle' | 'processing' | 'waiting',
  activeAgents: 1,
  currentSession: {
    id: 'abc-123',
    agentId: 1,
    startedAt: '2026-02-21 04:00:00',
    status: 'running'
  }
};

const messageStats = {
  total: 52,
  user: 20,
  assistant: 30,
  system: 2
};
```

### API 变更

```javascript
// GET /api/stats/messages?task_id=1
// 返回消息统计

// GET /api/agents/:id/session
// 返回当前 session 信息
```

---

## 3. 消息统计功能

### 3.1 当前对话统计（右侧面板顶部）
- 消息总数
- 用户消息数
- AI 消息数（按 Agent 分类）
- 系统消息数

### 3.2 全局统计（可选，仪表盘）
- 总对话数
- 总消息数
- Agent 调用次数
- Token 消耗估算

### API

```javascript
// GET /api/stats/messages?task_id=1
{
  total: 52,
  byRole: {
    user: 20,
    assistant: 30,
    system: 2
  },
  byAgent: {
    'Claude CLI': 15,
    'Opencode CLI': 15
  }
}

// GET /api/stats/global
{
  totalConversations: 5,
  totalMessages: 200,
  agentCalls: 50
}
```

---

---

## 实现计划

### Phase 1: 对话管理增强 (2-3h) ✅ 已完成
1. [x] 后端：添加 unread_count 字段
2. [x] 后端：实现消息预览 API
3. [x] 前端：未读消息徽章
4. [x] 前端：消息预览显示
5. [x] 前端：新建对话按钮
6. [x] 前端：右键菜单（重命名、删除）

### Phase 2: Session 管理 (2-3h) ✅ 已完成
1. [x] 数据库：创建 agent_sessions 表
2. [x] 后端：sessionManager 服务
3. [x] 后端：agentRunner 使用对话级 session
4. [x] 后端：session API
5. [x] 前端：RightPanel 显示 session 信息

### Phase 3: 消息统计 (1-2h) ✅ 已完成
1. [x] 后端：消息统计 API
2. [x] 前端：统计卡片组件
3. [x] 前端：集成到 RightPanel

### Phase 4: 优化打磨 (1h) ✅ 已完成
1. [x] 样式调整 - 增强视觉效果、阴影、过渡
2. [x] 响应式适配 - 添加媒体查询断点
3. [x] 动画过渡 - 交错动画、悬停效果、加载动画

---

## UI 布局参考

```
┌──────────────────────────────────────────────────────────────┐
│                        Header                                │
├────────────┬─────────────────────────────┬──────────────────┤
│            │                             │ ┌──────────────┐ │
│  对话列表   │                             │ │ 状态: 空闲   │ │
│            │                             │ ├──────────────┤ │
│ [+新建]    │                             │ │ 消息统计     │ │
│ ────────── │        聊天区域              │ │ 总数: 52     │ │
│ > 对话1 (2)│                             │ │ 用户: 20     │ │
│   预览...  │                             │ │ AI: 30       │ │
│            │                             │ ├──────────────┤ │
│   对话2    │                             │ │ Session      │ │
│   预览...  │                             │ │ ID: abc...   │ │
│            │                             │ │ 开始: 2h前   │ │
│   对话3    │                             │ ├──────────────┤ │
│   预览...  │                             │ │ Agent列表    │ │
│            │                             │ │              │ │
└────────────┴─────────────────────────────┴──────────────────┘
```

---

## 文件变更清单

### 后端
- `server/db.js` - 添加字段
- `server/routes/tasks.js` - 新增 API
- `server/routes/stats.js` - 新增统计 API
- `server/routes/agents.js` - session API

### 前端
- `client/components/TaskPanel.jsx` - 对话列表增强
- `client/components/RightPanel.jsx` - 重构布局
- `client/components/StatsCard.jsx` - 新增统计卡片
- `client/components/SessionInfo.jsx` - 新增 session 信息
- `client/components/StatusBar.jsx` - 新增状态栏
- `client/hooks/useStats.js` - 新增统计 hook
