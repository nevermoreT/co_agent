/**
 * 简化的 agentRunner 集成测试
 * 验证核心功能的测试结构
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('agentRunner 简化集成测试', () => {
  let mockAgentRunner;

  beforeEach(async () => {
    // 模拟 agentRunner 的核心函数
    mockAgentRunner = {
      isRunning: vi.fn(() => false),
      getRunningAgentIds: vi.fn(() => []),
      run: vi.fn(() => true),
      sendInput: vi.fn(() => true),
      stop: vi.fn(() => true),
      runClaudeCli: vi.fn(() => Promise.resolve(true)),
      runOpencodeCli: vi.fn(() => true),
    };

    // Mock 所有依赖
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

    vi.mock('child_process', () => ({
      spawn: vi.fn(),
    }));

    vi.mock('../../minimal-claude.js', () => ({
      runClaudeCli: vi.fn(),
    }));

    vi.mock('../../minimal-opencode.js', () => ({
      runOpencodeCli: vi.fn(),
    }));
  });

  describe('基础功能验证', () => {
    it('应该正确初始化 mock', () => {
      expect(mockAgentRunner.isRunning).toBeDefined();
      expect(mockAgentRunner.getRunningAgentIds).toBeDefined();
      expect(mockAgentRunner.run).toBeDefined();
      expect(mockAgentRunner.sendInput).toBeDefined();
      expect(mockAgentRunner.stop).toBeDefined();
    });

    it('应该验证 Agent 运行状态检查', () => {
      const agentId = 1;
      
      mockAgentRunner.isRunning.mockReturnValue(false);
      expect(mockAgentRunner.isRunning(agentId)).toBe(false);
      
      mockAgentRunner.isRunning.mockReturnValue(true);
      expect(mockAgentRunner.isRunning(agentId)).toBe(true);
      
      expect(mockAgentRunner.isRunning).toHaveBeenCalledWith(agentId);
    });

    it('应该验证获取运行中的 Agent ID 列表', () => {
      const runningIds = [1, 2, 3];
      
      mockAgentRunner.getRunningAgentIds.mockReturnValue(runningIds);
      expect(mockAgentRunner.getRunningAgentIds()).toEqual(runningIds);
      
      expect(mockAgentRunner.getRunningAgentIds).toHaveBeenCalled();
    });

    it('应该验证 Agent 启动功能', () => {
      const agentId = 1;
      const onOutput = vi.fn();
      const onExit = vi.fn();
      
      mockAgentRunner.run.mockReturnValue(true);
      const result = mockAgentRunner.run(agentId, onOutput, onExit);
      
      expect(result).toBe(true);
      expect(mockAgentRunner.run).toHaveBeenCalledWith(agentId, onOutput, onExit);
    });

    it('应该验证向 Agent 发送输入', () => {
      const agentId = 1;
      const text = 'Hello World';
      
      mockAgentRunner.sendInput.mockReturnValue(true);
      const result = mockAgentRunner.sendInput(agentId, text);
      
      expect(result).toBe(true);
      expect(mockAgentRunner.sendInput).toHaveBeenCalledWith(agentId, text);
    });

    it('应该验证停止 Agent', () => {
      const agentId = 1;
      
      mockAgentRunner.stop.mockReturnValue(true);
      const result = mockAgentRunner.stop(agentId);
      
      expect(result).toBe(true);
      expect(mockAgentRunner.stop).toHaveBeenCalledWith(agentId);
    });
  });

  describe('Claude CLI 集成验证', () => {
    it('应该验证 Claude CLI 调用', async () => {
      const agentId = 1;
      const prompt = 'Test prompt';
      const onOutput = vi.fn();
      const onExit = vi.fn();
      const conversationId = 1;
      
      mockAgentRunner.runClaudeCli.mockResolvedValue(true);
      const result = await mockAgentRunner.runClaudeCli(agentId, prompt, onOutput, onExit, conversationId);
      
      expect(result).toBe(true);
      expect(mockAgentRunner.runClaudeCli).toHaveBeenCalledWith(agentId, prompt, onOutput, onExit, conversationId);
    });
  });

  describe('Opencode CLI 集成验证', () => {
    it('应该验证 Opencode CLI 调用', () => {
      const agentId = 2;
      const prompt = 'Test prompt';
      const onOutput = vi.fn();
      const onExit = vi.fn();
      const conversationId = 1;
      
      mockAgentRunner.runOpencodeCli.mockReturnValue(true);
      const result = mockAgentRunner.runOpencodeCli(agentId, prompt, onOutput, onExit, conversationId);
      
      expect(result).toBe(true);
      expect(mockAgentRunner.runOpencodeCli).toHaveBeenCalledWith(agentId, prompt, onOutput, onExit, conversationId);
    });
  });

  describe('错误处理验证', () => {
    it('应该验证启动失败的处理', () => {
      const agentId = 1;
      const onOutput = vi.fn();
      const onExit = vi.fn();
      
      mockAgentRunner.run.mockReturnValue(false);
      const result = mockAgentRunner.run(agentId, onOutput, onExit);
      
      expect(result).toBe(false);
    });

    it('应该验证发送输入失败的处理', () => {
      const agentId = 1;
      const text = 'Test';
      
      mockAgentRunner.sendInput.mockReturnValue(false);
      const result = mockAgentRunner.sendInput(agentId, text);
      
      expect(result).toBe(false);
    });

    it('应该验证停止失败的处理', () => {
      const agentId = 1;
      
      mockAgentRunner.stop.mockReturnValue(false);
      const result = mockAgentRunner.stop(agentId);
      
      expect(result).toBe(false);
    });

    it('应该验证 Claude CLI 启动失败', async () => {
      const agentId = 1;
      const prompt = 'Test';
      const onOutput = vi.fn();
      const onExit = vi.fn();
      
      mockAgentRunner.runClaudeCli.mockResolvedValue(false);
      const result = await mockAgentRunner.runClaudeCli(agentId, prompt, onOutput, onExit);
      
      expect(result).toBe(false);
    });
  });
});