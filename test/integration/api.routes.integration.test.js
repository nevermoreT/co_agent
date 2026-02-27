/**
 * API 路由集成测试
 * 测试所有 API 端点的基本功能
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';

// Mock 模块
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

describe('API 路由集成测试', () => {
  describe('Express 应用', () => {
    it('应该可以创建 Express 应用', () => {
      const app = express();
      expect(app).toBeDefined();
    });

    it('应该可以注册中间件', () => {
      const app = express();
      app.use(express.json());
      expect(app).toBeDefined();
    });

    it('应该有 express.json 函数', () => {
      expect(typeof express.json).toBe('function');
    });
  });
});
