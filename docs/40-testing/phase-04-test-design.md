# Phase 4: A2A 与主动开口机制 - 测试设计

## 1. 测试范围与策略

### 1.1 测试层级

```
┌─────────────────────────────────────────────────────────────────┐
│                        测试层级架构                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   单元测试    │  │  集成测试    │  │  端到端测试   │            │
│  │   (UT)      │  │   (IT)      │  │   (E2E)     │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  组件/函数级别        模块/服务级别       用户场景级别              │
│  高频快速反馈         中等复杂度           真实用户流程              │
│  开发时运行         CI/CD 运行          发布前验证               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 测试策略

| 测试类型 | 比例 | 执行频率 | 环境 | 说明 |
|---------|------|---------|------|------|
| 单元测试 (UT) | 70% | 开发时 | Node.js | 快速反馈，验证函数逻辑 |
| 集成测试 (IT) | 20% | CI/CD | Node.js/SQLite | 验证模块间协作 |
| 端到端测试 (E2E) | 10% | 发布前 | 真实环境 | 验证用户场景 |

## 2. 当前 E2E 特性分析

### 2.1 现有特性

```javascript
// 现有的主要用户流程
1. 任务管理流程
   - 创建/编辑/删除任务
   - 任务状态变更 (pending → in_progress → completed)

2. Agent 管理流程
   - 添加/编辑/删除 Agent
   - Agent 配置验证

3. 聊天流程
   - 选择 Agent 发送消息
   - @mention 语法解析
   - 消息历史查看

4. Agent 运行流程
   - 启动/停止 Agent 进程
   - 实时流式输出
   - 进程退出处理
```

### 2.2 当前测试覆盖

```javascript
// 现有测试文件结构
test/
├── unit/                 # 单元测试
│   └── markdown-renderer.test.jsx
├── hooks/               # Hook 测试
├── components/          # 组件测试
├── api/                 # API 端点测试
└── mocks/               # Mock 模块
```

## 3. Phase 4 新增特性场景拆分

### 3.1 A2A 机制场景

#### 3.1.1 基础 A2A 通信

| 场景 | 优先级 | 复杂度 | 验证点 |
|------|--------|--------|--------|
| Agent 发现与注册 | 高 | 低 | 能否正确获取 Agent Card |
| 任务创建与状态管理 | 高 | 中 | Task 生命周期状态转换 |
| 消息路由与转发 | 高 | 中 | 消息正确发送到目标 Agent |
| 会话关联 | 中 | 低 | Task 与 Conversation 正确关联 |

#### 3.1.2 高级 A2A 功能

| 场景 | 优先级 | 复杂度 | 验证点 |
|------|--------|--------|
| 多 Agent 协作 | 高 | 高 | 多个 Agent 依次协作 |
| 循环调用防护 | 高 | 高 | 检测并阻止循环调用 |
| 超时与重试 | 中 | 中 | 任务超时处理 |
| 错误传播 | 中 | 中 | 错误正确传递 |

### 3.2 主动开口机制场景

#### 3.2.1 主动消息触发

| 场景 | 优先级 | 复杂度 | 验证点 |
|------|--------|--------|
| 任务完成通知 | 高 | 低 | 完成后主动推送消息 |
| 需要协助请求 | 高 | 中 | 检测到需要协助时主动开口 |
| 定期报告 | 中 | 中 | 定时推送报告 |
| 异常提醒 | 高 | 低 | 检测到异常时主动通知 |

#### 3.2.2 消息类型与格式

| 场景 | 优先级 | 复杂度 | 验证点 |
|------|--------|--------|
| 任务完成消息 | 高 | 低 | 消息格式正确 |
| 协助请求消息 | 高 | 中 | 包含正确的目标 Agent 信息 |
| 系统提醒消息 | 中 | 低 | 优先级和展示方式正确 |

### 3.3 意图识别与路由场景

| 场景 | 优先级 | 复杂度 | 验证点 |
|------|--------|--------|
| 简单聊天识别 | 高 | 低 | 正确识别无需 A2A 的简单问题 |
| A2A 需求识别 | 高 | 中 | 正确识别需要 A2A 的复杂任务 |
| Agent 选择 | 高 | 中 | 选择最合适的 Agent |
| 路由决策 | 高 | 高 | 正确路由到合适模式 |

## 4. 测试工程化设计

### 4.1 并行测试架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        并行测试架构                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   UT Worker 1   │  │   IT Worker 2   │  │   E2E Worker 3  │ │
│  │  (单元测试)     │  │  (集成测试)     │  │  (端到端测试)   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│            │                   │                   │           │
│            ▼                   ▼                   ▼           │
│  ┌─────────────────────────────────────────────────────────────┤
│  │              Vitest Parallel Executor                       │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │ │
│  │  │   测试A     │  │   测试B     │  │   测试C     │       │ │
│  │  │  (UT)       │  │  (IT)       │  │  (E2E)      │       │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘       │ │
│  └─────────────────────────────────────────────────────────────┤
│                                                                 │
│  配置: vitest.config.js → threads: true (单元测试)             │
│                            threads: false (集成/端到端)          │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 代码复用策略

#### 4.2.1 测试工具库

```javascript
// test/utils/test-helpers.js
export const testHelpers = {
  // 数据工厂
  factories: {
    agent: (overrides = {}) => ({ /* agent factory */ }),
    task: (overrides = {}) => ({ /* task factory */ }),
    message: (overrides = {}) => ({ /* message factory */ }),
  },
  
  // 测试数据清理
  cleanup: {
    clearDatabase: async () => { /* clear test db */ },
    resetState: async () => { /* reset app state */ },
  },
  
  // 模拟工具
  mocks: {
    createMockWebSocket: () => { /* mock ws */ },
    createMockAgentRunner: () => { /* mock runner */ },
  },
  
  // 辅助函数
  waitFor: {
    elementVisible: (selector) => { /* wait util */ },
    condition: (fn, timeout = 5000) => { /* wait util */ },
  },
};
```

#### 4.2.2 测试基类

```javascript
// test/base/test-base.js
export class TestBase {
  constructor() {
    this.setup = this.setup.bind(this);
    this.teardown = this.teardown.bind(this);
  }
  
  async setup() {
    // 公共设置逻辑
  }
  
  async teardown() {
    // 公共清理逻辑
  }
}

// 不同类型的测试继承基类
export class UnitTestBase extends TestBase { /* 单元测试基类 */ }
export class IntegrationTestBase extends TestBase { /* 集成测试基类 */ }
export class E2ETestBase extends TestBase { /* 端到端测试基类 */ }
```

### 4.3 测试配置

```javascript
// vitest.config.js - 测试配置
export default defineConfig({
  test: {
    // 单元测试可以并行
    threads: true,
    maxThreads: 4,
    minThreads: 2,
    
    // 集成测试和端到端测试串行（避免数据库冲突）
    pool: 'forks', // 或使用 'threads' 但需要数据库隔离
    
    // 测试环境配置
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    
    // 测试文件匹配
    include: [
      'test/unit/**/*.test.{js,jsx}',
      'test/integration/**/*.test.{js,jsx}',
      'test/e2e/**/*.test.{js,jsx}'
    ],
    
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['server/**/*', 'client/**/*', 'minimal-*.js'],
      exclude: ['test/**', 'server/index.js', 'server/logger.js'],
    },
  },
});
```

## 5. 具体测试套件设计

### 5.1 单元测试套件

#### 5.1.1 A2A 相关单元测试

```javascript
// test/unit/a2a/
├── agent-card.test.js          # Agent Card 解析
├── task-manager.test.js        # 任务管理器
├── message-router.test.js      # 消息路由
├── cycle-detector.test.js      # 循环检测
└── mention-counter.test.js     # 提及计数器
```

#### 5.1.2 主动开口相关单元测试

```javascript
// test/unit/proactive/
├── trigger-classifier.test.js  # 触发器分类器
├── decision-engine.test.js     # 决策引擎
├── message-builder.test.js     # 消息构建器
└── scheduler.test.js          # 调度器
```

#### 5.1.3 意图识别相关单元测试

```javascript
// test/unit/intent/
├── intent-classifier.test.js   # 意图分类器
├── decision-engine.test.js     # 决策引擎
└── router.test.js             # 路由器
```

### 5.2 集成测试套件

#### 5.2.1 A2A 集成测试

```javascript
// test/integration/a2a/
├── agent-discovery.test.js     # Agent 发现集成
├── task-lifecycle.test.js      # 任务生命周期
├── message-routing.test.js     # 消息路由集成
└── security-guard.test.js      # 安全防护集成
```

#### 5.2.2 主动开口集成测试

```javascript
// test/integration/proactive/
├── trigger-flow.test.js        # 触发流程
├── message-delivery.test.js    # 消息投递
└── user-notification.test.js   # 用户通知
```

### 5.3 端到端测试套件

#### 5.3.1 A2A E2E 测试

```javascript
// test/e2e/a2a/
├── basic-interaction.test.js   # 基础交互
├── multi-agent-workflow.test.js # 多 Agent 工作流
├── cycle-protection.test.js    # 循环防护
└── error-handling.test.js      # 错误处理
```

#### 5.3.2 主动开口 E2E 测试

```javascript
// test/e2e/proactive/
├── task-completion.test.js     # 任务完成通知
├── assistance-request.test.js  # 协助请求
├── scheduled-report.test.js    # 定期报告
└── user-experience.test.js     # 用户体验
```

## 6. 数据库隔离策略

### 6.1 测试数据库管理

```javascript
// test/utils/database.js
export class TestDatabase {
  constructor() {
    this.connection = null;
  }
  
  async setup() {
    // 为每个测试创建独立的内存数据库
    this.connection = await createTestDb();
    await this.migrate();
    return this.connection;
  }
  
  async migrate() {
    // 运行迁移脚本
  }
  
  async cleanup() {
    // 清理测试数据
  }
}

// 每个测试文件使用独立数据库
export const testDb = new TestDatabase();
```

### 6.2 测试数据工厂

```javascript
// test/factories/
├── agent.factory.js
├── task.factory.js  
├── message.factory.js
├── a2a-task.factory.js
└── proactive-message.factory.js
```

## 7. 测试运行策略

### 7.1 开发时运行

```bash
# 运行所有单元测试（并行）
npm run test:unit

# 运行特定模块单元测试
npm run test:unit -- --grep "a2a"

# 运行集成测试（串行）
npm run test:integration
```

### 7.2 CI/CD 运行

```yaml
# .github/workflows/test.yml
test:
  strategy:
    matrix:
      node-version: [18.x, 20.x]
  steps:
    - name: Unit Tests
      run: npm run test:unit -- --coverage
    - name: Integration Tests  
      run: npm run test:integration
    - name: E2E Tests
      run: npm run test:e2e
```

### 7.3 发布前验证

```bash
# 完整测试套件
npm run test:all

# 带覆盖率检查
npm run test:coverage

# 性能基准测试
npm run test:benchmark
```

## 8. 监控与报告

### 8.1 测试报告

```javascript
// test/reporters/
├── junit-reporter.js          # JUnit XML 报告
├── html-reporter.js           # HTML 报告
└── coverage-reporter.js       # 覆盖率报告
```

### 8.2 质量门禁

```javascript
// 测试质量标准
const qualityGate = {
  unitTestCoverage: 90,        // 单元测试覆盖率
  integrationTestCoverage: 80, // 集成测试覆盖率
  e2eTestCoverage: 70,        // 端到端测试覆盖率
  performanceThreshold: 2000,  // 性能阈值 (ms)
  reliabilityScore: 95,       // 可靠性分数
};
```

## 9. 总结

本测试设计为 Phase 4 的 A2A 与主动开口机制提供了全面的测试防护，包括：

1. **多层次测试覆盖** - 从单元到端到端的完整测试体系
2. **并行化执行** - 提升测试执行效率
3. **代码复用** - 减少重复代码，提高维护性
4. **数据隔离** - 避免测试间相互干扰
5. **质量保障** - 确保新功能的稳定性和可靠性

接下来将按照此设计逐步实现各项测试套件。