# 测试基础设施修复指南

## 1. DOM API Mock 修复

### 在测试文件中添加 DOM 元素 mock

```javascript
// 在每个涉及 DOM 操作的测试文件中添加
beforeEach(() => {
  // Mock scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
  
  // Mock other DOM APIs if needed
  IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    disconnect: vi.fn(),
  }));
});

afterEach(() => {
  // Clean up mocks
  vi.restoreAllMocks();
});
```

## 2. WebSocket Mock 修复

### 创建完善的 WebSocket Mock

```javascript
// test/mocks/websocket.js
export class MockWebSocket {
  static readyStates = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3
  };

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.readyStates.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    this.sentMessages = [];
    
    // Simulate connection
    setTimeout(() => {
      this.readyState = MockWebSocket.readyStates.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(data) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.readyStates.CLOSED;
    this.onclose?.();
  }

  simulateMessage(data) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
}

// 在测试文件中使用
import { MockWebSocket } from '../mocks/websocket.js';

beforeEach(() => {
  global.WebSocket = MockWebSocket;
});
```

## 3. React Testing Library act() 包装

### 所有状态更新都需要在 act() 中

```javascript
import { act } from '@testing-library/react';

// 错误示例
test('should handle state update', () => {
  const { result } = renderHook(useMyHook);
  result.current.updateState('new value'); // 未包装在 act 中
  expect(result.current.state).toBe('new value');
});

// 正确示例
test('should handle state update', async () => {
  const { result } = renderHook(useMyHook);
  
  await act(async () => {
    result.current.updateState('new value');
  });
  
  expect(result.current.state).toBe('new value');
});
```

## 4. 数据库测试隔离

### 使用内存数据库进行测试

```javascript
// test/setup.js
import { Sqlite3Database } from 'sqlite3';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

export async function createTestDatabase() {
  const db = await open({
    filename: ':memory:',
    driver: sqlite3.Database
  });
  
  // Run migrations
  await db.migrate({
    migrationsPath: './server/migrations'
  });
  
  return db;
}

// 在测试文件中
import { createTestDatabase } from '../setup.js';

describe('Database Tests', () => {
  let testDb;
  
  beforeEach(async () => {
    testDb = await createTestDatabase();
  });
  
  afterEach(async () => {
    await testDb.close();
  });
});
```

## 5. 组件测试最佳实践

### 完整的组件测试示例

```javascript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyComponent from '../MyComponent';

describe('MyComponent', () => {
  const defaultProps = {
    // Default props
  };

  beforeEach(() => {
    // Mock DOM APIs
    Element.prototype.scrollIntoView = vi.fn();
    
    // Mock fetch if needed
    global.fetch = vi.fn();
  });

  it('should handle user interaction', async () => {
    const user = userEvent.setup();
    
    const { container } = render(<MyComponent {...defaultProps} />);
    
    // 使用 act 包装状态更新
    await act(async () => {
      await user.click(screen.getByRole('button'));
    });
    
    // 等待 UI 更新
    await waitFor(() => {
      expect(screen.getByText('Updated')).toBeInTheDocument();
    });
  });
});
```

## 6. 错误处理测试

### 正确测试错误场景

```javascript
it('should handle API errors gracefully', async () => {
  // Mock API error
  fetch.mockRejectedValueOnce(new Error('Network error'));
  
  const { getByText, queryByText } = render(<MyComponent />);
  
  // 等待错误处理完成
  await waitFor(() => {
    expect(getByText(/error/i)).toBeInTheDocument();
  });
  
  // 确保没有显示不应该的内容
  expect(queryByText('Success')).not.toBeInTheDocument();
});
```

## 7. 异步测试最佳实践

### 正确处理异步操作

```javascript
// 使用 async/await
it('should fetch data', async () => {
  fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: 'test' })
  });
  
  const { getByText } = render(<MyComponent />);
  
  // 等待异步操作完成
  await waitFor(() => {
    expect(getByText('test')).toBeInTheDocument();
  });
});

// 使用 findBy 查询（自动等待）
it('should find element asynchronously', async () => {
  fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: 'test' })
  });
  
  const { findByText } = render(<MyComponent />);
  
  // findBy 会自动等待元素出现
  await expect(findByText('test')).resolves.toBeInTheDocument();
});
```