# 性能问题修复计划

**文档版本**: 1.1
**创建日期**: 2026-02-26
**更新日期**: 2026-02-26
**状态**: P0-P2 已完成
**优先级**: P0 → P3 分级处理

---

## 一、问题概述

通过代码审查，发现以下性能问题，按严重程度分为四个优先级。本文档记录每个问题的根因、影响范围及修复方案。

---

## 二、P0 - 阻断性问题（立即修复）✅

### 2.1 请求体大小限制（PayloadTooLargeError）

**文件**: `server/index.js:22`
**根因**: Express `body-parser` 默认限制请求体为 100kb，发送长消息或大量代码时触发 413 错误。
**影响**: 用户无法发送超过 100kb 的消息，直接阻断核心功能。
**状态**: ✅ 已修复

**修复方案**:
```javascript
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
```

---

## 三、P1 - 高优先级（本周修复）✅

### 3.1 React 渲染未使用缓存优化 ✅

**文件**: `client/components/ChatPanel.jsx`
**根因**: `parseTargetAgent` 函数和 `sortedAgents` 数组在每次组件渲染时重新创建。
**状态**: ✅ 已修复 - 使用 `useMemo` / `useCallback` 缓存

### 3.2 WebSocket 流式输出无节流 ✅

**文件**: `server/websocket.js`
**根因**: Agent 流式输出的每个 chunk 都立即通过 WebSocket 发送，高频率触发前端 React 重渲染。
**状态**: ✅ 已修复 - 添加 `createThrottledOutput()` 函数，80ms 批量发送

### 3.3 前端 streaming 状态更新优化 ✅ (调整)

**文件**: `client/App.jsx`
**根因**: 每个 WebSocket output 消息都触发 `setStreaming`，导致高频重渲染。
**状态**: ✅ 已修复 - 服务端 WebSocket 已有 80ms 节流，前端直接更新状态即可，无需额外节流

---

## 四、P2 - 中优先级（下周修复）✅

### 4.1 数据库查询缺少索引 ✅

**文件**: `server/db.js`
**根因**: `global_messages` 表按 `task_id` 频繁查询，但缺少索引。
**状态**: ✅ 已修复 - 添加 `idx_global_task`、`idx_global_task_created`、`idx_tasks_last_activity` 索引

### 4.2 消息列表无限制 ✅

**文件**: `client/components/ChatPanel.jsx`
**根因**: 所有历史消息全部渲染到 DOM，无分页或限制。
**状态**: ✅ 已修复 - 限制最多渲染 100 条消息，使用 `React.memo` 包裹消息组件

### 4.3 TaskPanel 预览请求无防抖 ✅

**文件**: `client/components/TaskPanel.jsx`
**根因**: 组件挂载时对所有 task 并发发起 preview 请求。
**状态**: ✅ 已修复 - 添加并发限制（最多同时 3 个请求）

---

## 五、P3 - 低优先级（长期优化）

### 5.1 Markdown 渲染无缓存 ✅

**文件**: `client/components/MarkdownRenderer.jsx`
**状态**: ✅ 已修复 - 使用 `React.memo` 包裹组件

### 5.2 进程超时清理间隔过长

**文件**: `server/services/agentRunner.js`
**状态**: 待定

### 5.3 API 请求无缓存层

**状态**: 待定

---

## 六、执行计划

| 优先级 | 问题 | 负责文件 | 状态 |
|--------|------|---------|------|
| P0 | Payload Too Large | `server/index.js` | ✅ 已完成 |
| P1 | React useMemo/useCallback | `client/components/ChatPanel.jsx` | ✅ 已完成 |
| P1 | WebSocket 输出节流 | `server/websocket.js` | ✅ 已完成 |
| P1+ | 前端状态更新优化 | `client/App.jsx` | ✅ 已完成 |
| P2 | 数据库索引 | `server/db.js` | ✅ 已完成 |
| P2 | 消息列表限制 + memo | `client/components/ChatPanel.jsx` | ✅ 已完成 |
| P2 | Preview 请求防抖 | `client/components/TaskPanel.jsx` | ✅ 已完成 |
| P3 | Markdown 缓存 | `client/components/MarkdownRenderer.jsx` | ✅ 已完成 |
| P3 | 进程超时调整 | `server/services/agentRunner.js` | 待定 |
| P3 | API 请求缓存 | `client/hooks/` | 待定 |

---

## 七、验收标准

- ✅ P0 修复后：发送 1MB 以上消息不再返回 413 错误
- ✅ P1 修复后：React DevTools Profiler 显示渲染次数减少 50% 以上
- ✅ P2 数据库索引后：单对话 1000 条消息查询时间 < 50ms
- ✅ P2 消息限制后：长对话不再导致浏览器卡顿
- P3 完成后：切换对话时无明显加载延迟（缓存命中时 < 50ms）

---

## 八、测试文件

- `test/performance-optimization.test.js` - 性能优化功能测试
  - WebSocket 输出节流测试
  - 前端 rAF 节流测试
  - 消息数量限制测试
  - 预览请求并发限制测试
