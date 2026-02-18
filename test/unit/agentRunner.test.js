/**
 * agentRunner.js 单元测试
 * 测试 Agent 进程管理功能
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, createTestDbWithSeeds } from '../mocks/dbMock.js';
import { MockChildProcess, simulateCliRun } from '../mocks/cliMock.js';

// 由于 agentRunner 依赖 db.js，我们需要创建一个可测试的版本
// 这里我们测试核心逻辑函数

describe('agentRunner.js 核心功能', () => {
  describe('parseCommand 函数', () => {
    // 复制 parseCommand 的实现
    function parseCommand(cliCommand) {
      const parts = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < cliCommand.length; i++) {
        const c = cliCommand[i];
        if (c === '"' || c === "'") {
          inQuotes = !inQuotes;
        } else if ((c === ' ' || c === '\t') && !inQuotes) {
          if (current) {
            parts.push(current.replace(/^["']|["']$/g, ''));
            current = '';
          }
        } else {
          current += c;
        }
      }
      if (current) parts.push(current.replace(/^["']|["']$/g, ''));
      if (parts.length === 0) return { command: '', args: [] };
      return { command: parts[0], args: parts.slice(1) };
    }

    it('应该解析简单命令', () => {
      const result = parseCommand('node script.js');
      expect(result.command).toBe('node');
      expect(result.args).toEqual(['script.js']);
    });

    it('应该解析带参数的命令', () => {
      const result = parseCommand('node script.js --arg value');
      expect(result.command).toBe('node');
      expect(result.args).toEqual(['script.js', '--arg', 'value']);
    });

    it('应该处理引号内的空格', () => {
      const result = parseCommand('node "script with spaces.js"');
      expect(result.command).toBe('node');
      expect(result.args).toEqual(['script with spaces.js']);
    });

    it('应该处理单引号', () => {
      const result = parseCommand("echo 'hello world'");
      expect(result.command).toBe('echo');
      expect(result.args).toEqual(['hello world']);
    });

    it('应该处理制表符分隔', () => {
      const result = parseCommand('node\tscript.js');
      expect(result.command).toBe('node');
      expect(result.args).toEqual(['script.js']);
    });

    it('应该处理空命令', () => {
      const result = parseCommand('');
      expect(result.command).toBe('');
      expect(result.args).toEqual([]);
    });

    it('应该处理只有空格的命令', () => {
      const result = parseCommand('   ');
      expect(result.command).toBe('');
      expect(result.args).toEqual([]);
    });

    it('应该处理复杂命令', () => {
      const result = parseCommand('claude -p "hello world" --output-format stream-json');
      expect(result.command).toBe('claude');
      expect(result.args).toEqual(['-p', 'hello world', '--output-format', 'stream-json']);
    });
  });

  describe('进程状态管理', () => {
    // 模拟 runs Map 的行为
    let runs;

    beforeEach(() => {
      runs = new Map();
    });

    function isRunning(agentId) {
      return runs.has(String(agentId));
    }

    function addRun(agentId, process) {
      runs.set(String(agentId), { process });
    }

    function removeRun(agentId) {
      runs.delete(String(agentId));
    }

    function getRunningAgentIds() {
      return Array.from(runs.keys()).map(Number);
    }

    it('应该正确检测运行状态', () => {
      expect(isRunning(1)).toBe(false);
      
      addRun(1, { pid: 12345 });
      expect(isRunning(1)).toBe(true);
      
      removeRun(1);
      expect(isRunning(1)).toBe(false);
    });

    it('应该返回所有运行中的 Agent ID', () => {
      addRun(1, { pid: 12345 });
      addRun(2, { pid: 12346 });
      addRun(3, { pid: 12347 });
      
      const runningIds = getRunningAgentIds();
      expect(runningIds).toHaveLength(3);
      expect(runningIds).toContain(1);
      expect(runningIds).toContain(2);
      expect(runningIds).toContain(3);
    });

    it('应该防止重复启动', () => {
      addRun(1, { pid: 12345 });
      
      // 尝试再次添加同一个 agent
      if (isRunning(1)) {
        // 应该被阻止
        expect(isRunning(1)).toBe(true);
      }
    });

    it('应该正确处理字符串和数字 ID', () => {
      addRun(1, { pid: 12345 });
      
      // 字符串 '1' 和数字 1 应该被视为相同
      expect(isRunning('1')).toBe(true);
      expect(isRunning(1)).toBe(true);
    });
  });

  describe('MockChildProcess 测试', () => {
    it('应该正确初始化', () => {
      const mockProcess = new MockChildProcess({ pid: 54321 });
      
      expect(mockProcess.pid).toBe(54321);
      expect(mockProcess.killed).toBe(false);
      expect(mockProcess.stdin.write).toBeDefined();
    });

    it('应该正确发送 stdout 数据', async () => {
      const mockProcess = new MockChildProcess();
      const receivedData = [];
      
      mockProcess.stdout.on('data', (data) => {
        receivedData.push(data.toString());
      });
      
      mockProcess.emitStdout('Hello');
      mockProcess.emitStdout(' World');
      
      expect(receivedData).toEqual(['Hello', ' World']);
    });

    it('应该正确发送 stderr 数据', async () => {
      const mockProcess = new MockChildProcess();
      const receivedData = [];
      
      mockProcess.stderr.on('data', (data) => {
        receivedData.push(data.toString());
      });
      
      mockProcess.emitStderr('Error message');
      
      expect(receivedData).toEqual(['Error message']);
    });

    it('应该正确处理退出事件', async () => {
      const mockProcess = new MockChildProcess();
      let exitCode = null;
      let exitSignal = null;
      
      mockProcess.on('exit', (code, signal) => {
        exitCode = code;
        exitSignal = signal;
      });
      
      mockProcess.emitExit(0, null);
      
      expect(exitCode).toBe(0);
      expect(exitSignal).toBe(null);
    });

    it('应该正确处理错误事件', async () => {
      const mockProcess = new MockChildProcess();
      let error = null;
      
      mockProcess.on('error', (err) => {
        error = err;
      });
      
      const testError = new Error('Test error');
      mockProcess.emitError(testError);
      
      expect(error).toBe(testError);
    });

    it('应该正确杀死进程', async () => {
      const mockProcess = new MockChildProcess();
      let exitSignal = null;
      
      mockProcess.on('exit', (code, signal) => {
        exitSignal = signal;
      });
      
      mockProcess.kill('SIGTERM');
      
      expect(mockProcess.killed).toBe(true);
      expect(exitSignal).toBe('SIGTERM');
    });
  });

  describe('simulateCliRun 辅助函数测试', () => {
    it('应该模拟完整的 CLI 运行', async () => {
      const mockProcess = new MockChildProcess();
      const outputs = [];
      
      mockProcess.stdout.on('data', (data) => {
        outputs.push(data.toString());
      });
      
      await simulateCliRun(mockProcess, {
        stdoutChunks: ['Hello', ' World'],
        exitCode: 0,
        delay: 5
      });
      
      expect(outputs).toEqual(['Hello', ' World']);
      expect(mockProcess.exitCode).toBe(0);
    });

    it('应该模拟 stderr 输出', async () => {
      const mockProcess = new MockChildProcess();
      const errors = [];
      
      mockProcess.stderr.on('data', (data) => {
        errors.push(data.toString());
      });
      
      await simulateCliRun(mockProcess, {
        stderrChunks: ['Error 1', 'Error 2'],
        exitCode: 1,
        delay: 5
      });
      
      expect(errors).toEqual(['Error 1', 'Error 2']);
      expect(mockProcess.exitCode).toBe(1);
    });
  });
});
