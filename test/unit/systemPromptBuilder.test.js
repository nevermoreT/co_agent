/**
 * systemPromptBuilder.js 单元测试
 * 只测试不需要数据库连接的纯函数
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeForShell,
  containsSpecialChars,
  toOneLine,
  buildA2APromptForCLI
} from '../../server/services/systemPromptBuilder.js';

describe('systemPromptBuilder', () => {
  describe('sanitizeForShell', () => {
    it('should wrap string in quotes', () => {
      expect(sanitizeForShell('hello world')).toBe('"hello world"');
    });

    it('should escape double quotes', () => {
      const result = sanitizeForShell('say "hello"');
      expect(result).toBe('"say \\"hello\\""');
    });

    it('should escape double quotes', () => {
      const result = sanitizeForShell('say "hello"');
      expect(result).toBe('"say \\"hello\\""');
    });

    it('should return empty quoted string for null/undefined', () => {
      expect(sanitizeForShell(null)).toBe('""');
      expect(sanitizeForShell(undefined)).toBe('""');
      expect(sanitizeForShell('')).toBe('""');
    });
  });

  describe('containsSpecialChars', () => {
    it('should detect parentheses', () => {
      expect(containsSpecialChars('hello (world)')).toBe(true);
    });

    it('should detect ampersand', () => {
      expect(containsSpecialChars('a & b')).toBe(true)
    });

    it('should detect pipe', () => {
      expect(containsSpecialChars('a | b')).toBe(true)
    });

    it('should detect angle brackets', () => {
      expect(containsSpecialChars('<tag>')).toBe(true)
    });

    it('should detect caret', () => {
      expect(containsSpecialChars('a^b')).toBe(true)
    });

    it('should return false for normal strings', () => {
      expect(containsSpecialChars('hello world')).toBe(false)
      expect(containsSpecialChars('test 123')).toBe(false)
    });

    it('should return false for null/undefined', () => {
      expect(containsSpecialChars(null)).toBe(false)
      expect(containsSpecialChars(undefined)).toBe(false)
    });
  });

  describe('toOneLine', () => {
    it('should replace newlines with spaces', () => {
      expect(toOneLine('hello\nworld')).toBe('hello world');
      expect(toOneLine('test\nline\ntest')).toBe('test line test');
    });

    it('should handle empty string', () => {
      expect(toOneLine('')).toBe('');
    });

    it('should handle null/undefined', () => {
      expect(toOneLine(null)).toBe('');
      expect(toOneLine(undefined)).toBe('');
    });
  });

  describe('buildA2APromptForCLI', () => {
    it('should build prompt with source agent info', () => {
      const invocation = {
        sourceAgentId: 1,
        invocationText: 'please help',
        fullOutput: 'This is the output',
      };

      const result = buildA2APromptForCLI(invocation);

      // 新格式：{sourceName} 的完整输出: {output} --- 请处理: {invocation}
      expect(result).toContain('的完整输出:');
      expect(result).toContain('请处理:');
      expect(result).toContain('please help');
      expect(result).toContain('This is the output');
      expect(result).not.toContain('\n'); // 换行符已替换
    });

    it('should convert multi-line output to single line', () => {
      const invocation = {
        sourceAgentId: 1,
        invocationText: 'help',
        fullOutput: 'line1\nline2\nline3',
      };

      const result = buildA2APromptForCLI(invocation);

      expect(result).not.toContain('\n');
      expect(result).toContain('line1 line2 line3');
      expect(result).toContain('help');
    })
  });
});
