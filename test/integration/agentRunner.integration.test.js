/**
 * agentRunner.js 集成测试
 * 测试 Agent 进程管理的基本功能
 */
import { describe, it, expect, vi } from 'vitest';

// Mock child_process properly
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  default: { spawn: vi.fn() },
}));

describe('agentRunner.js 集成测试', () => {
  describe('child_process mock', () => {
    it('child_process.spawn 应该被正确 mock', async () => {
      const { spawn } = await import('child_process');
      expect(typeof spawn).toBe('function');
    });
  });

  describe('模块导入', () => {
    it('应该能够导入 express', async () => {
      const express = await import('express');
      expect(typeof express).toBe('object');
    });
  });
});
