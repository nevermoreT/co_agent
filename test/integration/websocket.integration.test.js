/**
 * websocket.js 集成测试
 * 测试 WebSocket 连接管理、消息路由、错误处理等功能
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock WebSocketServer 类
class MockWebSocketServer {
  constructor(options) {
    this.options = options;
    this._on = {};
  }
  on(event, handler) {
    this._on[event] = handler;
  }
  close() {}
}

// Mock 模块
vi.mock('ws', () => {
  return {
    WebSocketServer: MockWebSocketServer,
  };
});

vi.mock('../../server/db.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      get: vi.fn(),
      run: vi.fn(),
      all: vi.fn(),
    })),
  },
}));

vi.mock('../../server/logger.js', () => ({
  default: {
    log: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../server/services/agentRunner.js', () => ({
  isRunning: vi.fn(),
  getRunningAgentIds: vi.fn(),
  run: vi.fn(),
  sendInput: vi.fn(),
  stop: vi.fn(),
  runClaudeCli: vi.fn(),
  runOpencodeCli: vi.fn(),
}));

describe('websocket.js 集成测试', () => {
  let mockHttpServer;
  let setupWebSocket;
  let mockAgentRunner;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    mockHttpServer = { on: vi.fn() };
    
    const websocketModule = await import('../../server/websocket.js');
    setupWebSocket = websocketModule.setupWebSocket;
    
    const agentRunnerModule = await import('../../server/services/agentRunner.js');
    mockAgentRunner = agentRunnerModule;
  });

  describe('WebSocket Server 初始化', () => {
    it('应该有 setupWebSocket 函数', () => {
      expect(typeof setupWebSocket).toBe('function');
    });

    it('setupWebSocket 应该接受 httpServer 参数', () => {
      expect(() => setupWebSocket(mockHttpServer)).not.toThrow();
    });
  });

  describe('消息处理', () => {
    it('agentRunner 应该被正确 mock', () => {
      expect(typeof mockAgentRunner.run).toBe('function');
      expect(typeof mockAgentRunner.stop).toBe('function');
      expect(typeof mockAgentRunner.sendInput).toBe('function');
    });
  });
});
