/**
 * 测试环境设置文件
 * 配置全局测试环境和 mock
 */
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
global.localStorage = localStorageMock;

// Mock fetch
global.fetch = vi.fn();

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
    
    // 模拟异步连接
    setTimeout(() => {
      this.readyState = 1;
      if (this.onopen) this.onopen({ type: 'open' });
    }, 10);
  }
  
  send(data) {
    if (this.readyState !== 1) {
      throw new Error('WebSocket is not open');
    }
    // 由测试用例控制响应
  }
  
  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose({ type: 'close' });
  }
  
  // 测试辅助方法
  _receiveMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
  
  _simulateError(error) {
    if (this.onerror) {
      this.onerror({ error });
    }
  }
}

global.WebSocket = MockWebSocket;

// Mock node-pty
vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// 清理每个测试后的状态
afterEach(() => {
  vi.clearAllMocks();
});
