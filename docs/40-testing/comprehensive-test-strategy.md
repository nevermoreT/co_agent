# Comprehensive Test Strategy for Co-Agent Platform

## 1. Current System Overview

The Co-Agent platform currently consists of these core features:

### 1.1 Core Features
- **Task Management**: Create/edit/delete tasks with status tracking (pending/in_progress/completed)
- **Agent Management**: Add/edit/delete up to 5 agents with CLI commands
- **Chat Interface**: Unified chat with @mention to invoke specific agents
- **Agent Runtime**: Spawn CLI processes and stream output via WebSocket
- **Data Persistence**: SQLite database for agents, tasks, and messages

### 1.2 Current Test Coverage
- Unit tests for Markdown renderer
- Component tests for UI components
- Hook tests for custom React hooks
- API route tests for backend endpoints

## 2. Test Gap Analysis

### 2.1 Missing Test Areas
- **Conversation Isolation**: Messages from one conversation appearing in another
- **WebSocket Reliability**: Connection handling, message delivery guarantees
- **Agent Lifecycle**: Proper start/stop/kill of CLI processes
- **@Mention Parsing**: Correct agent identification with spaces in names
- **Built-in CLI Wrappers**: Claude CLI and Opencode CLI integration
- **Session Management**: Conversation context continuity
- **Error Handling**: Graceful degradation on failures

### 2.2 Risk Areas
- **Concurrency**: Multiple agents running simultaneously
- **Resource Leaks**: Unclosed processes, memory leaks
- **Data Integrity**: Incorrect message routing, corrupted state
- **Performance**: Slow responses, UI blocking

## 3. Comprehensive Test Strategy

### 3.1 Test Levels

```
┌─────────────────────────────────────────────────────────────────┐
│                        Test Hierarchy                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Unit      │  │ Integration │  │   E2E       │            │
│  │   Tests     │  │   Tests     │  │   Tests     │            │
│  │  (70%)      │  │   (20%)     │  │   (10%)     │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  Individual      Component/Service    End-to-End User          │
│  Functions       Integration          Scenarios               │
│  Fast Feedback   Moderate Speed      Full Flow Validation     │
└─────────────────────────────────────────────────────────────────┘
```

## 4. Detailed Test Scenarios

### 4.1 Conversation Isolation Tests

#### 4.1.1 Unit Tests
```javascript
// test/unit/conversation-isolation.test.js
describe('Conversation Isolation', () => {
  it('should maintain separate streaming states for different conversations', () => {
    // Test that streaming output is isolated by conversation ID
  });
  
  it('should filter WebSocket messages by conversation ID', () => {
    // Test message routing logic
  });
  
  it('should preserve conversation state when switching between conversations', () => {
    // Test state preservation during switching
  });
});
```

#### 4.1.2 Integration Tests
```javascript
// test/integration/conversation-flow.test.js
describe('Conversation Flow Integration', () => {
  it('should handle multiple concurrent conversations without interference', () => {
    // Test multiple conversations running simultaneously
  });
  
  it('should route agent responses to correct conversation', () => {
    // Test response routing with multiple agents
  });
});
```

### 4.2 WebSocket Reliability Tests

#### 4.2.1 Unit Tests
```javascript
// test/unit/websocket-handler.test.js
describe('WebSocket Handler', () => {
  it('should handle connection errors gracefully', () => {
    // Test error handling
  });
  
  it('should maintain message order during high throughput', () => {
    // Test message ordering
  });
  
  it('should recover from temporary disconnections', () => {
    // Test reconnection logic
  });
});
```

#### 4.2.2 Integration Tests
```javascript
// test/integration/websocket-stress.test.js
describe('WebSocket Stress Test', () => {
  it('should handle multiple simultaneous connections', () => {
    // Test concurrent connections
  });
  
  it('should maintain performance under load', () => {
    // Test performance metrics
  });
});
```

### 4.3 Agent Lifecycle Tests

#### 4.3.1 Unit Tests
```javascript
// test/unit/agent-runner.test.js
describe('Agent Runner', () => {
  it('should properly spawn and terminate CLI processes', () => {
    // Test process lifecycle
  });
  
  it('should handle process errors and timeouts', () => {
    // Test error conditions
  });
  
  it('should manage stdin/stdout/stderr streams correctly', () => {
    // Test stream handling
  });
});
```

#### 4.3.2 Integration Tests
```javascript
// test/integration/agent-management.test.js
describe('Agent Management Integration', () => {
  it('should handle multiple agents running simultaneously', () => {
    // Test concurrency
  });
  
  it('should prevent resource conflicts between agents', () => {
    // Test resource management
  });
});
```

### 4.4 @Mention Parsing Tests

#### 4.4.1 Unit Tests
```javascript
// test/unit/mention-parser.test.js
describe('Mention Parser', () => {
  it('should correctly identify agents with spaces in names', () => {
    // Test "Claude CLI" parsing
  });
  
  it('should handle multiple mentions in one message', () => {
    // Test multiple mentions
  });
  
  it('should be case insensitive', () => {
    // Test case handling
  });
  
  it('should handle non-existent agents gracefully', () => {
    // Test error handling
  });
});
```

### 4.5 Built-in CLI Wrapper Tests

#### 4.5.1 Unit Tests
```javascript
// test/unit/cli-wrapper.test.js
describe('CLI Wrapper', () => {
  it('should parse Claude CLI NDJSON output correctly', () => {
    // Test Claude output parsing
  });
  
  it('should parse Opencode CLI NDJSON output correctly', () => {
    // Test Opencode output parsing
  });
  
  it('should handle malformed JSON gracefully', () => {
    // Test error handling
  });
});
```

#### 4.5.2 Integration Tests
```javascript
// test/integration/cli-integration.test.js
describe('CLI Integration', () => {
  it('should handle Claude CLI one-shot execution', () => {
    // Test Claude CLI integration
  });
  
  it('should handle Opencode CLI one-shot execution', () => {
    // Test Opencode CLI integration
  });
});
```

## 5. Test Engineering Practices

### 5.1 Parallel Testing Configuration
```javascript
// vitest.config.js
export default defineConfig({
  test: {
    // Unit tests can run in parallel
    threads: true,
    maxThreads: 4,
    
    // Integration tests should run in sequence to avoid DB conflicts
    pool: 'forks',
    singleThread: true, // For integration tests specifically
    
    // Coverage settings
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
```

### 5.2 Test Utilities and Factories
```javascript
// test/utils/test-factories.js
export const factories = {
  agent: (overrides = {}) => ({
    id: overrides.id || Math.floor(Math.random() * 1000),
    name: overrides.name || 'Test Agent',
    cli_command: overrides.cli_command || 'node test-agent.js',
    created_at: new Date().toISOString(),
    ...overrides,
  }),
  
  task: (overrides = {}) => ({
    id: overrides.id || Math.floor(Math.random() * 1000),
    title: overrides.title || 'Test Task',
    status: overrides.status || 'pending',
    created_at: new Date().toISOString(),
    ...overrides,
  }),
  
  message: (overrides = {}) => ({
    id: overrides.id || Math.floor(Math.random() * 100000),
    role: overrides.role || 'user',
    content: overrides.content || 'Test message',
    task_id: overrides.task_id,
    created_at: new Date().toISOString(),
    ...overrides,
  }),
};
```

### 5.3 Database Isolation
```javascript
// test/utils/test-db.js
export class TestDatabase {
  constructor() {
    this.connection = null;
  }
  
  async setup() {
    // Create isolated in-memory SQLite database for each test
    this.connection = new Database(':memory:');
    await this.migrate();
    return this.connection;
  }
  
  async migrate() {
    // Apply schema migrations
  }
  
  async cleanup() {
    // Close and destroy database
  }
}
```

## 6. Test Execution Strategy

### 6.1 Development Time
```bash
# Run unit tests quickly during development
npm run test:unit

# Run specific test file
npx vitest run test/unit/conversation-isolation.test.js

# Run tests in watch mode
npx vitest
```

### 6.2 CI/CD Pipeline
```yaml
# .github/workflows/test.yml
test:
  strategy:
    matrix:
      node-version: [18.x, 20.x]
  steps:
    - name: Unit Tests
      run: npm run test:unit -- --coverage
      env:
        COVERAGE_THRESHOLD: 80
    
    - name: Integration Tests
      run: npm run test:integration
      env:
        DATABASE_URL: sqlite://test.db  # Isolated test DB
    
    - name: E2E Tests
      run: npm run test:e2e
```

### 6.3 Quality Gates
```javascript
// Test quality standards
const qualityStandards = {
  unitTestCoverage: 80,        // Minimum 80% coverage for unit tests
  integrationTestPass: 100,    // All integration tests must pass
  performanceBudget: 2000,     // Page load under 2 seconds
  reliabilityScore: 95,       // System reliability threshold
};
```

## 7. Monitoring and Reporting

### 7.1 Test Reports
- **JUnit XML**: For CI/CD integration
- **HTML Coverage**: For detailed analysis
- **JSON Results**: For programmatic analysis

### 7.2 Failure Detection
- **Flaky Test Detection**: Identify inconsistent tests
- **Performance Regression**: Monitor performance changes
- **Coverage Drift**: Track coverage changes over time

## 8. Implementation Roadmap

### Phase 1: Core Stability (Week 1-2)
- Conversation isolation tests
- WebSocket reliability tests
- Agent lifecycle tests

### Phase 2: Feature Completeness (Week 3-4)  
- @Mention parsing tests
- CLI wrapper tests
- Error handling tests

### Phase 3: Performance & Scale (Week 5-6)
- Load testing
- Stress testing
- Performance benchmarking

This comprehensive test strategy ensures the Co-Agent platform remains stable, reliable, and scalable as new features are added.