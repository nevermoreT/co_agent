/**
 * CLI Mock 工具
 * 用于模拟 Claude CLI 和 Opencode CLI 的行为，无需真实调用
 */
import { vi } from 'vitest';

/**
 * 创建模拟的 NDJSON 输出
 * @param {Array} chunks - 输出块数组
 * @returns {string} NDJSON 格式的字符串
 */
export function createNdjsonOutput(chunks) {
  return chunks.map(chunk => JSON.stringify(chunk)).join('\n');
}

/**
 * Claude CLI 模拟响应生成器
 */
export const ClaudeCliMock = {
  /**
   * 创建标准的 assistant 响应
   * @param {string} text - 响应文本
   * @returns {Object} NDJSON 响应对象
   */
  createAssistantResponse(text) {
    return {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text }
        ]
      }
    };
  },

  /**
   * 创建多块响应
   * @param {string[]} textChunks - 文本块数组
   * @returns {Object[]} NDJSON 响应对象数组
   */
  createStreamingResponse(textChunks) {
    return textChunks.map(text => ({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text }
        ]
      }
    }));
  },

  /**
   * 创建带 ANSI 转义的响应（用于测试 stripAnsi）
   * @param {string} text - 响应文本
   * @returns {string} 带 ANSI 转义的文本
   */
  createAnsiResponse(text) {
    const response = this.createAssistantResponse(text);
    const json = JSON.stringify(response);
    // 添加常见的 ANSI 转义序列
    return `\x1b[32m${json}\x1b[0m\r\n`;
  },

  /**
   * 创建错误响应
   * @param {string} message - 错误消息
   * @returns {string} 错误输出
   */
  createErrorResponse(message) {
    return `Error: ${message}\n`;
  }
};

/**
 * Opencode CLI 模拟响应生成器
 */
export const OpencodeCliMock = {
  /**
   * 创建文本响应
   * @param {string} text - 响应文本
   * @returns {Object} NDJSON 响应对象
   */
  createTextResponse(text) {
    return {
      type: 'text',
      part: { text }
    };
  },

  /**
   * 创建工具调用响应
   * @param {string} toolName - 工具名称
   * @param {string} output - 工具输出
   * @param {string} title - 标题
   * @returns {Object} NDJSON 响应对象
   */
  createToolUseResponse(toolName, output, title) {
    return {
      type: 'tool_use',
      part: {
        tool: toolName,
        state: {
          title: title || toolName,
          output
        }
      }
    };
  },

  /**
   * 创建权限请求响应
   * @param {string} description - 权限描述
   * @returns {Object} NDJSON 响应对象
   */
  createPermissionRequest(description) {
    return {
      type: 'permission_request',
      description
    };
  },

  /**
   * 创建步骤开始事件
   * @param {string} stepId - 步骤 ID
   * @returns {Object} NDJSON 响应对象
   */
  createStepStart(stepId) {
    return {
      type: 'step_start',
      step_id: stepId
    };
  },

  /**
   * 创建步骤结束事件
   * @param {string} stepId - 步骤 ID
   * @returns {Object} NDJSON 响应对象
   */
  createStepFinish(stepId) {
    return {
      type: 'step_finish',
      step_id: stepId
    };
  },

  /**
   * 创建完整的对话响应序列
   * @param {string} text - 响应文本
   * @returns {Object[]} NDJSON 响应对象数组
   */
  createConversationResponse(text) {
    return [
      this.createStepStart('step-1'),
      this.createTextResponse(text),
      this.createStepFinish('step-1')
    ];
  }
};

/**
 * 模拟子进程类
 */
export class MockChildProcess {
  constructor(options = {}) {
    this.pid = options.pid || 12345;
    this.killed = false;
    this.exitCode = null;
    this.signalCode = null;
    
    this.stdout = {
      data: [],
      listeners: [],
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          this.stdout.listeners.push(callback);
        }
      }),
      emit: (data) => {
        this.stdout.data.push(data);
        this.stdout.listeners.forEach(cb => cb(data));
      },
      end: vi.fn(),
    };
    
    this.stderr = {
      data: [],
      listeners: [],
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          this.stderr.listeners.push(callback);
        }
      }),
      emit: (data) => {
        this.stderr.data.push(data);
        this.stderr.listeners.forEach(cb => cb(data));
      },
    };
    
    this.stdin = {
      write: vi.fn(),
      end: vi.fn(),
      destroyed: false,
    };
    
    this.errorListeners = [];
    this.exitListeners = [];
    
    this.on = vi.fn((event, callback) => {
      if (event === 'error') {
        this.errorListeners.push(callback);
      } else if (event === 'exit') {
        this.exitListeners.push(callback);
      }
    });
  }
  
  /**
   * 模拟发送 stdout 数据
   * @param {string|Buffer} data - 数据
   */
  emitStdout(data) {
    this.stdout.emit(Buffer.from(data));
  }
  
  /**
   * 模拟发送 stderr 数据
   * @param {string|Buffer} data - 数据
   */
  emitStderr(data) {
    this.stderr.emit(Buffer.from(data));
  }
  
  /**
   * 模拟进程退出
   * @param {number} code - 退出码
   * @param {string|null} signal - 信号
   */
  emitExit(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.exitListeners.forEach(cb => cb(code, signal));
  }
  
  /**
   * 模拟进程错误
   * @param {Error} error - 错误对象
   */
  emitError(error) {
    this.errorListeners.forEach(cb => cb(error));
  }
  
  /**
   * 模拟杀死进程
   * @param {string} signal - 信号
   */
  kill(signal = 'SIGTERM') {
    this.killed = true;
    this.emitExit(null, signal);
  }
}

/**
 * 模拟 PTY 进程类
 */
export class MockPtyProcess {
  constructor(options = {}) {
    this.pid = options.pid || 12345;
    this.killed = false;
    this.dataListeners = [];
    this.exitListeners = [];
  }
  
  on(event, callback) {
    if (event === 'data') {
      this.dataListeners.push(callback);
    } else if (event === 'exit') {
      this.exitListeners.push(callback);
    }
  }
  
  /**
   * 模拟发送数据
   * @param {string} data - 数据
   */
  emitData(data) {
    this.dataListeners.forEach(cb => cb(data));
  }
  
  /**
   * 模拟退出
   * @param {number} code - 退出码
   * @param {string|null} signal - 信号
   */
  emitExit(code = 0, signal = null) {
    this.exitListeners.forEach(cb => cb(code, signal));
  }
  
  /**
   * 模拟杀死进程
   * @param {string} signal - 信号
   */
  kill(signal = 'SIGTERM') {
    this.killed = true;
    this.emitExit(null, signal);
  }
}

/**
 * 创建 spawn mock 函数
 * @param {MockChildProcess} mockProcess - 模拟进程实例
 * @returns {Function} spawn mock 函数
 */
export function createSpawnMock(mockProcess) {
  return vi.fn(() => mockProcess);
}

/**
 * 创建 PTY spawn mock 函数
 * @param {MockPtyProcess} mockPty - 模拟 PTY 实例
 * @returns {Function} pty.spawn mock 函数
 */
export function createPtySpawnMock(mockPty) {
  return vi.fn(() => mockPty);
}

/**
 * 模拟 CLI 运行的辅助函数
 * @param {MockChildProcess} mockProcess - 模拟进程
 * @param {Object} options - 选项
 * @param {string[]} options.stdoutChunks - stdout 输出块
 * @param {string[]} options.stderrChunks - stderr 输出块
 * @param {number} options.exitCode - 退出码
 * @param {number} options.delay - 输出延迟（毫秒）
 */
export async function simulateCliRun(mockProcess, options = {}) {
  const {
    stdoutChunks = [],
    stderrChunks = [],
    exitCode = 0,
    delay = 10
  } = options;
  
  // 模拟 stdout 输出
  for (const chunk of stdoutChunks) {
    await new Promise(resolve => setTimeout(resolve, delay));
    mockProcess.emitStdout(chunk);
  }
  
  // 模拟 stderr 输出
  for (const chunk of stderrChunks) {
    await new Promise(resolve => setTimeout(resolve, delay));
    mockProcess.emitStderr(chunk);
  }
  
  // 模拟进程退出
  await new Promise(resolve => setTimeout(resolve, delay));
  mockProcess.emitExit(exitCode);
}

/**
 * 模拟 PTY CLI 运行的辅助函数
 * @param {MockPtyProcess} mockPty - 模拟 PTY 实例
 * @param {Object} options - 选项
 * @param {string[]} options.dataChunks - 数据块
 * @param {number} options.exitCode - 退出码
 * @param {number} options.delay - 输出延迟（毫秒）
 */
export async function simulatePtyCliRun(mockPty, options = {}) {
  const {
    dataChunks = [],
    exitCode = 0,
    delay = 10
  } = options;
  
  // 模拟数据输出
  for (const chunk of dataChunks) {
    await new Promise(resolve => setTimeout(resolve, delay));
    mockPty.emitData(chunk);
  }
  
  // 模拟退出
  await new Promise(resolve => setTimeout(resolve, delay));
  mockPty.emitExit(exitCode);
}
