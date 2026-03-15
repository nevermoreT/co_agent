/**
 * 测试基类
 * 提供公共的测试设置和清理逻辑
 */

import { factories, mocks, utils } from '../utils/test-helpers.js';

export class TestBase {
  constructor() {
    this.mocks = mocks;
    this.factories = factories;
    this.utils = utils;
    this.cleanupFunctions = [];
  }

  /**
   * 设置测试环境
   */
  async setup() {
    // 重置所有模拟
    vi.clearAllMocks();
    vi.restoreAllMocks();
    
    // 设置通用模拟
    this.setupCommonMocks();
    
    // 设置清理函数
    this.setupCleanup();
  }

  /**
   * 清理测试环境
   */
  async teardown() {
    // 执行所有清理函数
    for (const cleanup of this.cleanupFunctions) {
      try {
        await cleanup();
      } catch (e) {
        console.warn('Cleanup error:', e);
      }
    }
    
    // 清理模拟
    vi.clearAllTimers();
    vi.useRealTimers();
  }

  /**
   * 设置通用模拟
   */
  setupCommonMocks() {
    // 模拟 console.log 以避免测试输出混乱
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  }

  /**
   * 设置清理函数
   */
  setupCleanup() {
    // 在测试结束后自动清理
    afterEach(async () => {
      await this.teardown();
    });
  }

  /**
   * 添加清理函数
   */
  addCleanup(cleanupFn) {
    this.cleanupFunctions.push(cleanupFn);
  }

  /**
   * 模拟 fetch
   */
  mockFetch(response = {}) {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(response),
      text: vi.fn().mockResolvedValue(JSON.stringify(response)),
    });
    
    global.fetch = mockFetch;
    this.addCleanup(() => {
      delete global.fetch;
    });
    
    return mockFetch;
  }

  /**
   * 模拟 WebSocket
   */
  mockWebSocket() {
    const mockWs = this.mocks.createMockWebSocket();
    
    // 保存原始 WebSocket
    const originalWebSocket = global.WebSocket;
    global.WebSocket = vi.fn(() => mockWs);
    
    this.addCleanup(() => {
      global.WebSocket = originalWebSocket;
    });
    
    return mockWs;
  }

  /**
   * 模拟 setTimeout
   */
  mockTimers() {
    vi.useFakeTimers();
    this.addCleanup(() => {
      vi.useRealTimers();
    });
  }

  /**
   * 模拟 Date
   */
  mockDate(date = new Date()) {
    vi.setSystemTime(date);
    this.addCleanup(() => {
      vi.useRealTimers();
    });
  }

  /**
   * 等待所有异步操作完成
   */
  async waitForAsync() {
    // 等待所有微任务完成
    await new Promise(resolve => setImmediate(resolve));
    // 等待所有宏任务完成（如果有定时器）
    if (vi.isFakeTimer()) {
      vi.runAllTimers();
    }
  }
}

/**
 * 单元测试基类
 */
export class UnitTestBase extends TestBase {
  constructor() {
    super();
  }

  async setup() {
    await super.setup();
    // 单元测试特定设置
  }
}

/**
 * 集成测试基类
 */
export class IntegrationTestBase extends TestBase {
  constructor() {
    super();
    this.testDb = null;
  }

  async setup() {
    await super.setup();
    // 集成测试特定设置
    this.setupDatabase();
  }

  setupDatabase() {
    // 集成测试可能需要数据库
    this.testDb = this.mocks.createMockDb();
  }
}

/**
 * 端到端测试基类
 */
export class E2ETestBase extends TestBase {
  constructor() {
    super();
    this.page = null;
    this.browser = null;
  }

  async setup() {
    await super.setup();
    // 端到端测试特定设置
  }
}

/**
 * 便捷的测试装饰器
 */
export const withTestSetup = (TestClass, testFn) => {
  return async (ctx) => {
    const testInstance = new TestClass();
    await testInstance.setup();
    
    try {
      return await testFn({ ...ctx, test: testInstance });
    } finally {
      await testInstance.teardown();
    }
  };
};

/**
 * 便捷的单元测试装饰器
 */
export const withUnitTest = (testFn) => withTestSetup(UnitTestBase, testFn);

/**
 * 便捷的集成测试装饰器
 */
export const withIntegrationTest = (testFn) => withTestSetup(IntegrationTestBase, testFn);

/**
 * 便捷的 E2E 测试装饰器
 */
export const withE2ETest = (testFn) => withTestSetup(E2ETestBase, testFn);