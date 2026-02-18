# 多 Agent 协作平台

基于 Node.js + React 的多 Agent 协作平台：左侧任务管理、中间与 Agent 对话、右侧 Agent 状态与聊天记录。Agent 通过 spawn CLI 方式调用，数据持久化到 SQLite。

## 功能

- **任务管理**：左侧新建/编辑/删除任务，状态：待办、进行中、已完成
- **Agent 对话**：中间选择 Agent，发送消息后自动 spawn 对应 CLI，实时流式显示 stdout/stderr
- **Agent 管理**：右侧添加/编辑/删除 Agent（最多 5 个），配置名称、CLI 命令、工作目录
- **状态与历史**：右侧显示连接状态、各 Agent 运行状态及当前 Agent 的聊天记录

## 技术栈

- 后端：Node.js、Express、WebSocket (ws)、SQLite (better-sqlite3)
- 前端：React、Vite

## 运行

```bash
# 安装依赖
npm install

# 开发：同时启动后端(3000)与前端(5173)，前端代理 /api 和 /ws 到后端
npm run dev

# 或分别启动
npm run server   # 仅后端 http://localhost:3000
npm run client   # 仅前端 http://localhost:5173（需先或同时运行后端）
```

生产构建：

```bash
npm run build
npm run server
# 访问 http://localhost:3000 即可使用打包后的前端
```

## Agent 配置说明

- **CLI 命令**：如 `node agent.js`、`python -u agent.py`，会按空格解析为 command + args（支持引号包裹路径）
- **工作目录**：可选，不填则使用进程当前目录
- 发送消息后会启动该 Agent 的 CLI 进程，用户输入会通过 stdin 写入；stdout/stderr 实时推送到页面。进程退出后，输出会保存为一条 assistant 消息。

## 数据

- SQLite 数据库文件：`data/app.db`（首次启动自动创建）
