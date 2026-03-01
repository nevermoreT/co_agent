# 测试设计文档

## 1. 概述

### 1.1 文档目的
本文档描述多 Agent 协作平台的测试策略、测试架构和 CLI Mock 工具设计，为开发团队提供测试指导。

### 1.2 测试目标
- 确保代码质量和稳定性
- 提高测试覆盖率，目标覆盖率 > 80%
- 隔离外部依赖（CLI 工具），实现可重复的单元测试
- 支持 CI/CD 自动化测试

### 1.3 测试范围
| 模块 | 测试类型 | 说明 |
|------|----------|------|
| minimal-claude.js | 单元测试 | NDJSON 解析、ANSI 清理 |
| minimal-opencode.js | 单元测试 | NDJSON 解析、工具调用处理 |
| agentRunner.js | 单元测试 | 进程管理、命令解析 |
| API 路由 | 单元测试 | CRUD 操作、业务逻辑 |
| React Hooks | 单元测试 | 数据获取、状态管理 |
| ChatPanel 组件 | 组件测试 | @ 提及解析、消息发送 |

---

## 2. 测试技术栈

### 2.1 测试框架
| 工具 | 版本 | 用途 |
|------|------|------|
| Vitest | 4.x | 测试运行器、断言库 |
| @testing-library/react | 16.x | React 组件测试 |
| @testing-library/user-event | 14.x | 用户交互模拟 |
| jsdom | 28.x | DOM 环境模拟 |
| happy-dom | 20.x | 备选 DOM 环境 |

### 2.2 测试配置

```javascript
// vitest.config.js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['server/**/*.js', 'client/**/*.js', 'client/**/*.jsx'],
    },
  },
});
```

### 2.3 测试命令
```bash
npm run test          # 运行测试（watch 模式）
npm run test:run      # 运行测试（单次）
npm run test:coverage # 运行测试并生成覆盖率报告
```

---

## 3. CLI Mock 工具设计

### 3.1 设计背景
`minimal-claude.js` 和 `minimal-opencode.js` 通过 `spawn` 或 `node-pty` 调用外部 CLI 工具（Claude CLI、Opencode CLI）。在测试环境中无法真实调用这些 CLI，因此需要设计 Mock 工具来模拟其行为。

### 3.2 Mock 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        测试用例                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CLI Mock 工具                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ClaudeCliMock │  │OpencodeCliMock│  │MockChildProcess│         │
│  │ 响应生成器    │  │ 响应生成器    │  │ 进程模拟器     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      被测模块                                    │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │minimal-claude│  │minimal-opencode│                           │
│  │    .js       │  │     .js       │                            │
│  └──────────────┘  └──────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 ClaudeCliMock 工具

#### 3.3.1 功能说明
模拟 Claude CLI 的 NDJSON 输出格式。

#### 3.3.2 API 设计

```javascript
// 创建标准的 assistant 响应
ClaudeCliMock.createAssistantResponse(text)
// 返回: { type: 'assistant', message: { content: [{ type: 'text', text }] } }

// 创建流式响应（多个文本块）
ClaudeCliMock.createStreamingResponse(textChunks)
// 返回: Array<{ type: 'assistant', ... }>

// 创建带 ANSI 转义的响应（用于测试 stripAnsi）
ClaudeCliMock.createAnsiResponse(text)
// 返回: 带 ANSI 转义序列的字符串

// 创建错误响应
ClaudeCliMock.createErrorResponse(message)
// 返回: 错误消息字符串
```

#### 3.3.3 使用示例

```javascript
import { ClaudeCliMock, createNdjsonOutput } from '../mocks/cliMock.js';

// 创建单条响应
const response = ClaudeCliMock.createAssistantResponse('Hello World');

// 创建流式响应
const streamResponses = ClaudeCliMock.createStreamingResponse(['Hello', ' ', 'World']);
const ndjson = createNdjsonOutput(streamResponses);

// 测试 ANSI 清理
const ansiText = ClaudeCliMock.createAnsiResponse('Test');
```

### 3.4 OpencodeCliMock 工具

#### 3.4.1 功能说明
模拟 Opencode CLI 的 NDJSON 输出格式，支持多种事件类型。

#### 3.4.2 API 设计

```javascript
// 创建文本响应
OpencodeCliMock.createTextResponse(text)
// 返回: { type: 'text', part: { text } }

// 创建工具调用响应
OpencodeCliMock.createToolUseResponse(toolName, output, title)
// 返回: { type: 'tool_use', part: { tool, state: { title, output } } }

// 创建权限请求响应
OpencodeCliMock.createPermissionRequest(description)
// 返回: { type: 'permission_request', description }

// 创建步骤事件
OpencodeCliMock.createStepStart(stepId)
OpencodeCliMock.createStepFinish(stepId)

// 创建完整的对话响应序列
OpencodeCliMock.createConversationResponse(text)
// 返回: [stepStart, textResponse, stepFinish]
```

#### 3.4.3 使用示例

```javascript
import { OpencodeCliMock, createNdjsonOutput } from '../mocks/cliMock.js';

// 创建工具调用响应
const toolResponse = OpencodeCliMock.createToolUseResponse('bash', 'ls -la', 'List Files');

// 创建完整对话
const conversation = OpencodeCliMock.createConversationResponse('Hello World');
const ndjson = createNdjsonOutput(conversation);
```

### 3.5 MockChildProcess 类

#### 3.5.1 功能说明
模拟 Node.js 的 `child_process.ChildProcess` 对象，用于测试进程管理逻辑。

#### 3.5.2 API 设计

```javascript
class MockChildProcess {
  constructor(options = {})
  
  // 属性
  pid: number          // 进程 ID
  killed: boolean      // 是否已被杀死
  exitCode: number     // 退出码
  signalCode: string   // 信号
  
  // 流
  stdout: { on, emit } // 标准输出
  stderr: { on, emit } // 标准错误
  stdin: { write, end }// 标准输入
  
  // 方法
  on(event, callback)  // 事件监听
  kill(signal)         // 杀死进程
  
  // 测试辅助方法
  emitStdout(data)     // 模拟发送 stdout 数据
  emitStderr(data)     // 模拟发送 stderr 数据
  emitExit(code, signal) // 模拟进程退出
  emitError(error)     // 模拟进程错误
}
```

#### 3.5.3 使用示例

```javascript
import { MockChildProcess, simulateCliRun } from '../mocks/cliMock.js';

const mockProcess = new MockChildProcess({ pid: 12345 });

// 监听输出
mockProcess.stdout.on('data', (data) => {
  console.log('stdout:', data.toString());
});

// 模拟输出
mockProcess.emitStdout('Hello World');
mockProcess.emitExit(0);

// 或使用辅助函数模拟完整运行
await simulateCliRun(mockProcess, {
  stdoutChunks: ['Hello', ' World'],
  exitCode: 0,
  delay: 10
});
```

### 3.6 MockPtyProcess 类

#### 3.6.1 功能说明
模拟 `node-pty` 的 PTY 进程对象。

#### 3.6.2 API 设计

```javascript
class MockPtyProcess {
  constructor(options = {})
  
  // 属性
  pid: number
  killed: boolean
  
  // 方法
  on(event, callback)  // 'data' | 'exit'
  kill(signal)
  
  // 测试辅助方法
  emitData(data)       // 模拟 PTY 数据输出
  emitExit(code, signal)
}
```

---

## 4. 测试用例设计

### 4.1 minimal-claude.js 测试

#### 4.1.1 stripAnsi 函数测试
| 测试用例 | 输入 | 期望输出 |
|----------|------|----------|
| 基本颜色代码 | `\x1b[32mHello\x1b[0m` | `Hello` |
| 多种 ANSI 序列 | `\x1b[1;32m\x1b[4mText\x1b[0m` | `Text` |
| 回车符 | `Hello\r\nWorld` | `Hello\nWorld` |
| OSC 序列 | `\x1b]0;Title\x07Content` | `Content` |
| 空字符串 | `` | `` |
| 纯文本 | `Hello World` | `Hello World` |

#### 4.1.2 parseNdjsonLine 函数测试
| 测试用例 | 输入 | 期望行为 |
|----------|------|----------|
| assistant 消息 | `{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}` | 输出 `Hello` |
| 多文本块 | `{"type":"assistant","message":{"content":[{"type":"text","text":"A"},{"type":"text","text":"B"}]}}` | 输出 `A` 和 `B` |
| 非 assistant 类型 | `{"type":"system","message":"..."}` | 无输出 |
| 非 text 内容块 | `{"type":"assistant","message":{"content":[{"type":"image","url":"..."}]}}` | 无输出 |
| 无效 JSON | `not valid json` | 静默忽略 |
| 空行 | `` | 无输出 |
| 带 ANSI 的行 | `\x1b[32m{"type":"assistant"...}\x1b[0m` | 正确解析 |

### 4.2 minimal-opencode.js 测试

#### 4.2.1 stripAnsi 函数测试
| 测试用例 | 输入 | 期望输出 |
|----------|------|----------|
| `\x1b?` 序列 | `\x1b?25lHello\x1b?25h` | `Hello` |
| `[?` 序列 | `[?25lHello[?25h` | `Hello` |
| 复杂组合 | `\x1b[?25l\x1b[2J\x1b[H\x1b[32mSuccess\x1b[0m` | `Success` |

#### 4.2.2 parseNdjsonLine 函数测试
| 测试用例 | 输入 | 期望行为 |
|----------|------|----------|
| text 类型 | `{"type":"text","part":{"text":"Hello"}}` | stdout 输出 `Hello` |
| tool_use 类型 | `{"type":"tool_use","part":{"tool":"bash","state":{"title":"Cmd","output":"ls"}}}` | stdout 输出 `[Cmd]\nls` |
| permission_request 类型 | `{"type":"permission_request","description":"Allow?"}` | stderr 输出 `[权限请求] Allow?` |
| 交互提示（非 JSON） | `Do you want to continue? [Y/n]` | stderr 输出 `[交互提示] ...` |

### 4.3 agentRunner.js 测试

#### 4.3.1 parseCommand 函数测试
| 测试用例 | 输入 | 期望输出 |
|----------|------|----------|
| 简单命令 | `node script.js` | `{command: 'node', args: ['script.js']}` |
| 带参数 | `node script.js --arg value` | `{command: 'node', args: ['script.js', '--arg', 'value']}` |
| 引号内空格 | `node "script with spaces.js"` | `{command: 'node', args: ['script with spaces.js']}` |
| 空命令 | `` | `{command: '', args: []}` |

#### 4.3.2 进程状态管理测试
| 测试用例 | 操作 | 期望结果 |
|----------|------|----------|
| 检测运行状态 | 添加进程后检查 | `isRunning(id)` 返回 `true` |
| 防止重复启动 | 已运行时再次启动 | 返回 `false`，不调用 `onExit` |
| 获取运行列表 | 多个进程运行 | 返回所有运行中的 ID |

### 4.4 API 路由测试

#### 4.4.1 agents 路由测试
| 测试用例 | 方法 | 路径 | 期望结果 |
|----------|------|------|----------|
| 获取列表 | GET | /api/agents | 返回所有 agents |
| 获取单个 | GET | /api/agents/1 | 返回指定 agent |
| 创建 | POST | /api/agents | 创建成功，返回 201 |
| 超过限制 | POST | /api/agents | 已有 5 个时返回 400 |
| 更新 | PATCH | /api/agents/1 | 更新成功 |
| 删除 | DELETE | /api/agents/1 | 删除成功，返回 204 |

#### 4.4.2 tasks 路由测试
| 测试用例 | 方法 | 路径 | 期望结果 |
|----------|------|------|----------|
| 获取列表 | GET | /api/tasks | 返回所有 tasks |
| 创建 | POST | /api/tasks | 创建成功，status 默认 pending |
| 状态验证 | POST | /api/tasks | 只接受 pending/doing/done |
| 更新状态 | PATCH | /api/tasks/1 | 状态更新成功 |

#### 4.4.3 chats 路由测试
| 测试用例 | 方法 | 路径 | 期望结果 |
|----------|------|------|----------|
| 获取全局消息 | GET | /api/messages | 返回所有全局消息 |
| 创建消息 | POST | /api/messages | 创建成功 |
| 无 agent 消息 | POST | /api/messages | agent_id 为 null 时正常创建 |

### 4.5 React Hooks 测试

#### 4.5.1 useAgents 测试
| 测试用例 | 场景 | 期望结果 |
|----------|------|----------|
| 初始状态 | 组件挂载 | loading=true, agents=[] |
| 成功获取 | fetch 成功 | loading=false, agents=数据 |
| 错误处理 | fetch 失败 | loading=false, agents=[] |
| refetch | 调用 refetch | 重新获取数据 |

#### 4.5.2 useGlobalMessages 测试
| 测试用例 | 场景 | 期望结果 |
|----------|------|----------|
| 获取消息 | fetch 成功 | messages=数据 |
| addMessage | 调用 addMessage | 消息添加到列表末尾 |
| setMessages | 调用 setMessages | 消息列表被替换 |

### 4.6 ChatPanel 组件测试

#### 4.6.1 渲染测试
| 测试用例 | 场景 | 期望结果 |
|----------|------|----------|
| 基本渲染 | 正常 props | 显示标题、输入框、历史消息 |
| WebSocket 状态 | wsReady=false | 显示"连接中..." |
| 运行状态 | runningAgentIds=[1,2] | 显示"2 个 Agent 运行中" |
| 流式输出 | streamingContent 有值 | 显示流式内容 |
| 禁用输入 | wsReady=false | 输入框禁用 |

#### 4.6.2 @ 提及功能测试
| 测试用例 | 操作 | 期望结果 |
|----------|------|----------|
| 显示下拉框 | 输入 @ | 显示 Agent 列表 |
| 过滤列表 | 输入 @cl | 只显示匹配的 Agent |
| 选择 Agent | 点击 Agent | 输入框变为 @AgentName |
| 无匹配 | 输入 @nonexistent | 显示"无匹配的 Agent" |

#### 4.6.3 parseTargetAgent 函数测试
| 测试用例 | 输入 | 期望结果 |
|----------|------|----------|
| 标准格式 | `@Claude CLI 你好` | agent=Claude CLI, text=你好 |
| 长度优先 | `@Claude CLI hello` | 匹配 Claude CLI 而非 Claude |
| 大小写不敏感 | `@claude cli 你好` | 匹配 Claude CLI |
| 无 @ 前缀 | `Hello` | 返回 null |
| Agent 不存在 | `@Nonexistent hello` | 返回 null |
| 名称后非空格 | `@Claude123` | 返回 null |

#### 4.6.4 发送消息测试
| 测试用例 | 操作 | 期望结果 |
|----------|------|----------|
| @Agent 消息 | 输入 @Claude CLI Hello 并发送 | 调用 onStart, onSendText |
| 普通消息 | 输入普通文本并发送 | 只保存消息，不触发 Agent |
| 空消息 | 直接发送 | 不执行任何操作 |
| 只有 @Agent | 输入 @Claude CLI 并发送 | 保留 @Agent 在输入框 |

#### 4.6.5 键盘交互测试
| 测试用例 | 操作 | 期望结果 |
|----------|------|----------|
| Enter 发送 | 输入文本后按 Enter | 发送消息 |
| Shift+Enter | 按 Shift+Enter | 换行 |
| 上下键选择 | @ 后按上下键 | 切换选中项 |
| Escape | @ 后按 Escape | 关闭下拉框 |

---

## 5. 测试覆盖率目标

### 5.1 覆盖率要求
| 模块 | 行覆盖率 | 分支覆盖率 | 函数覆盖率 |
|------|----------|------------|------------|
| minimal-claude.js | > 90% | > 85% | > 95% |
| minimal-opencode.js | > 90% | > 85% | > 95% |
| agentRunner.js | > 85% | > 80% | > 90% |
| API 路由 | > 80% | > 75% | > 85% |
| React Hooks | > 85% | > 80% | > 90% |
| ChatPanel 组件 | > 80% | > 75% | > 85% |

### 5.2 覆盖率报告
运行 `npm run test:coverage` 后，覆盖率报告将生成在 `coverage/` 目录下：
- `coverage/index.html` - HTML 报告
- `coverage/coverage-final.json` - JSON 格式报告

---

## 6. 测试文件结构

```
test/
├── setup.js                    # 测试环境设置
├── mocks/
│   ├── cliMock.js              # CLI Mock 工具
│   └── dbMock.js               # 数据库 Mock 工具
├── unit/
│   ├── minimal-claude.test.js  # Claude CLI 单元测试
│   ├── minimal-opencode.test.js# Opencode CLI 单元测试
│   └── agentRunner.test.js     # Agent Runner 单元测试
├── api/
│   └── routes.test.js          # API 路由测试
├── hooks/
│   └── hooks.test.js           # React Hooks 测试
└── components/
    └── ChatPanel.test.js       # ChatPanel 组件测试
```

---

## 7. CI/CD 集成

### 7.1 GitHub Actions 配置示例

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v4
        with:
          files: ./coverage/coverage-final.json
```

### 7.2 测试失败处理
- 测试失败时，CI 应阻止代码合并
- 覆盖率低于目标时，应发出警告
- 关键路径测试失败应阻止部署

---

## 8. 最佳实践

### 8.1 测试编写原则
1. **隔离性**: 每个测试用例应独立，不依赖其他测试
2. **可读性**: 测试名称应清晰描述测试场景
3. **完整性**: 覆盖正常流程和异常流程
4. **快速**: 单元测试应快速执行，避免真实 I/O

### 8.2 Mock 使用原则
1. 只 Mock 外部依赖，不 Mock 被测代码
2. Mock 应模拟真实行为，包括错误情况
3. 每个 test 后清理 Mock 状态

### 8.3 测试数据管理
1. 使用工厂函数创建测试数据
2. 测试数据应具有代表性
3. 避免在测试中硬编码敏感数据

---

## 9. 版本历史

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| 1.0 | 2026-02-19 | CodeArts | 初始版本 |
