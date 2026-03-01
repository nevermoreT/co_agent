# Co-Agent Platform - Test Infrastructure

This document describes the comprehensive test infrastructure implemented for the Co-Agent platform.

## Overview

The test infrastructure provides:

1. **Multi-layered testing approach** (Unit, Integration, E2E)
2. **Test utilities and factories** for rapid test creation
3. **Mocking capabilities** for external dependencies
4. **Test base classes** for consistent test setup
5. **Comprehensive test strategy** covering all platform features

## Test Layers

### 1. Unit Tests (`test/unit/`)
- Individual functions and components
- Fast execution, high coverage
- Focus on pure logic and state management

### 2. Integration Tests (`test/integration/`)
- Component/service interactions
- Database and API integrations
- WebSocket communication flows

### 3. End-to-End Tests (`test/e2e/`)
- Complete user workflows
- Full system validation
- Realistic scenario testing

## Test Utilities

### Test Base Classes
```javascript
import { TestBase, UnitTestBase, IntegrationTestBase } from './test/base/test-base.js';

class MyTest extends UnitTestBase {
  async setup() {
    await super.setup();
    // Additional setup
  }
}
```

### Data Factories
```javascript
import { factories } from './test/utils/test-helpers.js';

const agent = factories.agent({ name: 'Test Agent' });
const task = factories.task({ title: 'Test Task' });
const message = factories.message({ content: 'Test Message' });
```

### Mocking Tools
```javascript
import { mocks } from './test/utils/test-helpers.js';

const mockWs = mocks.createMockWebSocket();
const mockRunner = mocks.createMockAgentRunner();
const mockDb = mocks.createMockDb();
```

## Current Test Coverage

The test infrastructure validates:

### Conversation Isolation
- Separate streaming states per conversation
- Proper message routing by conversation ID
- State preservation during conversation switching

### Agent Management
- Agent creation with required properties
- Built-in agent support (Claude CLI, Opencode CLI)
- Agent limit enforcement (max 5 agents)

### @Mention Parsing
- Agent names with spaces (e.g., "@Claude CLI")
- Case insensitive matching
- Multiple mentions in single message

### Task Management
- Task creation with required properties
- Different task statuses (pending, in_progress, completed)
- Activity tracking

### Message Handling
- Different message roles (user, assistant, system)
- Different message types (text, thinking, image)
- Association with tasks

### WebSocket Communication
- Different message types (output, exit, started, error)
- Connection state management
- Message ordering

### CLI Integration
- Process lifecycle management
- Built-in CLI wrapper integration
- Error handling

## Test Execution

### Run all tests
```bash
npm run test
```

### Run specific test suites
```bash
# Unit tests
npm run test:unit

# Integration tests  
npm run test:integration

# Current feature tests
npx vitest run test/current-features.test.js
```

### Run validation tests
```bash
# Test infrastructure validation
npx vitest run test/final-validation.test.js

# Test utilities validation
npx vitest run test/validate-test-tools.test.js
```

## Test Strategy

### Parallel Execution
- Unit tests run in parallel for speed
- Integration tests run sequentially to avoid DB conflicts

### Data Isolation
- Each test gets isolated data context
- Database cleanup between tests
- No test interdependency

### Quality Gates
- High test coverage (>80%)
- Fast execution times
- Reliable, non-flaky tests

## Future Testing for Phase 4

The infrastructure is prepared for:
- A2A (Agent-to-Agent) communication tests
- Proactive speaking mechanism tests
- Intent routing tests
- Mention guard and cycle detection tests
- Advanced multi-agent workflow tests

## Architecture

```
test/
├── base/                 # Test base classes
│   └── test-base.js
├── utils/               # Test utilities and helpers
│   └── test-helpers.js
├── unit/                # Unit tests
├── integration/         # Integration tests
├── e2e/                # End-to-end tests
├── current-features.test.js  # Current platform validation
├── final-validation.test.js   # Infrastructure validation
└── test-suite.js        # Test suite orchestration
```

This test infrastructure ensures the Co-Agent platform remains stable, reliable, and scalable as new features are added in Phase 4 and beyond.