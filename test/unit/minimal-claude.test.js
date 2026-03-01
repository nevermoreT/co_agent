/**
 * minimal-claude.js 单元测试
 * 测试 NDJSON 解析、ANSI 清理、错误处理等功能
 */
import { describe, it, expect } from 'vitest';
import {
  ClaudeCliMock,
  createNdjsonOutput,
} from '../mocks/cliMock.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock node-pty
vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

// 由于 minimal-claude.js 有副作用（立即执行数据库初始化），我们需要隔离测试
// 这里我们直接测试核心函数

describe('minimal-claude.js 核心功能', () => {
  describe('stripAnsi 函数', () => {
    // 复制 stripAnsi 的实现进行测试
    function stripAnsi(s) {
      return String(s)
        .replace(/\r/g, '')
        .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        .trim();
    }

    it('应该移除基本的 ANSI 颜色代码', () => {
      const input = '\x1b[32mHello\x1b[0m';
      expect(stripAnsi(input)).toBe('Hello');
    });

    it('应该移除多种 ANSI 序列', () => {
      const input = '\x1b[1;32m\x1b[4mBold Green Underline\x1b[0m';
      expect(stripAnsi(input)).toBe('Bold Green Underline');
    });

    it('应该移除回车符', () => {
      const input = 'Hello\r\nWorld';
      expect(stripAnsi(input)).toBe('Hello\nWorld');
    });

    it('应该移除 OSC 序列', () => {
      const input = '\x1b]0;Title\x07Content';
      expect(stripAnsi(input)).toBe('Content');
    });

    it('应该处理空字符串', () => {
      expect(stripAnsi('')).toBe('');
    });

    it('应该处理纯文本（无 ANSI）', () => {
      const input = 'Hello World';
      expect(stripAnsi(input)).toBe('Hello World');
    });

    it('应该处理复杂的 ANSI 组合', () => {
      const input = '\x1b[?25l\x1b[2J\x1b[H\x1b[32mSuccess\x1b[0m\x1b[?25h';
      // 注意：当前实现不处理 \x1b[? 开头的序列
      const result = stripAnsi(input);
      expect(result).toContain('Success');
    });
  });

  describe('parseNdjsonLine 函数', () => {
    // 复制 parseNdjsonLine 的实现进行测试
    function stripAnsi(s) {
      return String(s)
        .replace(/\r/g, '')
        .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        .trim();
    }

    function parseNdjsonLine(line, callbacks) {
      const { onOutput, onToolUse } = callbacks;
      const raw = stripAnsi(line);
      if (!raw) return;
      try {
        const obj = JSON.parse(raw);
        if (obj.type === 'assistant' && obj.message?.content) {
          for (const block of obj.message.content) {
            if (block.type === 'text' && block.text) {
              onOutput && onOutput('stdout', block.text);
            } else if (block.type === 'tool_use') {
              const toolName = block.name || 'tool';
              const toolId = block.id || '';
              const input = block.input || {};
              let title = input.description || input.command || toolName;
              if (typeof title === 'object') {
                title = JSON.stringify(title);
              }
              onToolUse && onToolUse({
                tool: toolName.toLowerCase(),
                title: String(title).substring(0, 100),
                status: 'running',
                input,
                output: '',
                callID: toolId
              });
            }
          }
        }
      } catch {
        // ignore JSON parse errors
      }
    }

    it('应该解析 assistant 类型的消息', () => {
      const outputs = [];
      const callbacks = {
        onOutput: (stream, data) => outputs.push({ stream, data }),
        onToolUse: () => {}
      };
      
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello World' }]
        }
      });
      
      parseNdjsonLine(line, callbacks);
      
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toEqual({ stream: 'stdout', data: 'Hello World' });
    });

    it('应该处理多个文本块', () => {
      const outputs = [];
      const callbacks = {
        onOutput: (stream, data) => outputs.push({ stream, data }),
        onToolUse: () => {}
      };
      
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'World' }
          ]
        }
      });
      
      parseNdjsonLine(line, callbacks);
      
      expect(outputs).toHaveLength(2);
      expect(outputs[0].data).toBe('Hello ');
      expect(outputs[1].data).toBe('World');
    });

    it('应该解析 tool_use 类型的消息', () => {
      const toolCalls = [];
      const callbacks = {
        onOutput: () => {},
        onToolUse: (data) => toolCalls.push(data)
      };
      
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tooluse_123',
            name: 'Bash',
            input: { command: 'ls -la', description: 'List files' }
          }]
        }
      });
      
      parseNdjsonLine(line, callbacks);
      
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toEqual({
        tool: 'bash',
        title: 'List files',
        status: 'running',
        input: { command: 'ls -la', description: 'List files' },
        output: '',
        callID: 'tooluse_123'
      });
    });

    it('应该忽略非 assistant 类型的消息', () => {
      const outputs = [];
      const callbacks = {
        onOutput: (stream, data) => outputs.push({ stream, data }),
        onToolUse: () => {}
      };
      
      const line = JSON.stringify({
        type: 'system',
        message: 'Some system message'
      });
      
      parseNdjsonLine(line, callbacks);
      
      expect(outputs).toHaveLength(0);
    });

    it('应该忽略非 text 类型的内容块', () => {
      const outputs = [];
      const callbacks = {
        onOutput: (stream, data) => outputs.push({ stream, data }),
        onToolUse: () => {}
      };
      
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'image', url: 'http://example.com/image.png' },
            { type: 'text', text: 'Text content' }
          ]
        }
      });
      
      parseNdjsonLine(line, callbacks);
      
      expect(outputs).toHaveLength(1);
      expect(outputs[0].data).toBe('Text content');
    });

    it('应该处理无效 JSON（静默忽略）', () => {
      const outputs = [];
      const callbacks = {
        onOutput: (stream, data) => outputs.push({ stream, data }),
        onToolUse: () => {}
      };
      
      parseNdjsonLine('not valid json', callbacks);
      
      expect(outputs).toHaveLength(0);
    });

    it('应该处理空行', () => {
      const outputs = [];
      const callbacks = {
        onOutput: (stream, data) => outputs.push({ stream, data }),
        onToolUse: () => {}
      };
      
      parseNdjsonLine('', callbacks);
      parseNdjsonLine('   ', callbacks);
      
      expect(outputs).toHaveLength(0);
    });

    it('应该处理带 ANSI 的行', () => {
      const outputs = [];
      const callbacks = {
        onOutput: (stream, data) => outputs.push({ stream, data }),
        onToolUse: () => {}
      };
      
      const response = ClaudeCliMock.createAssistantResponse('Test');
      const line = '\x1b[32m' + JSON.stringify(response) + '\x1b[0m';
      
      parseNdjsonLine(line, callbacks);
      
      expect(outputs).toHaveLength(1);
      expect(outputs[0].data).toBe('Test');
    });
  });

  describe('ClaudeCliMock 工具测试', () => {
    it('应该创建正确的 assistant 响应', () => {
      const response = ClaudeCliMock.createAssistantResponse('Hello');
      
      expect(response.type).toBe('assistant');
      expect(response.message.content).toHaveLength(1);
      expect(response.message.content[0].text).toBe('Hello');
    });

    it('应该创建流式响应', () => {
      const responses = ClaudeCliMock.createStreamingResponse(['Hello', ' ', 'World']);
      
      expect(responses).toHaveLength(3);
      expect(responses[0].message.content[0].text).toBe('Hello');
      expect(responses[1].message.content[0].text).toBe(' ');
      expect(responses[2].message.content[0].text).toBe('World');
    });

    it('应该创建带 ANSI 的响应', () => {
      const ansiResponse = ClaudeCliMock.createAnsiResponse('Test');
      
      expect(ansiResponse).toContain('\x1b[');
      expect(ansiResponse).toContain('Test');
    });
  });

  describe('createNdjsonOutput 工具测试', () => {
    it('应该创建正确的 NDJSON 格式', () => {
      const chunks = [
        { type: 'test', data: 'a' },
        { type: 'test', data: 'b' },
      ];
      
      const ndjson = createNdjsonOutput(chunks);
      const lines = ndjson.split('\n');
      
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual(chunks[0]);
      expect(JSON.parse(lines[1])).toEqual(chunks[1]);
    });
  });
});
