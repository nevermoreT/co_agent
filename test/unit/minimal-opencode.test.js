/**
 * minimal-opencode.js 单元测试
 * 测试 NDJSON 解析、ANSI 清理、工具调用处理等功能
 */
import { describe, it, expect } from 'vitest';
import { OpencodeCliMock, createNdjsonOutput } from '../mocks/cliMock.js';

/**
 * 从文本中提取完整的 JSON 对象（从 minimal-opencode.js 复制）
 */
function extractJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    
    if (c === '\x1b') {
      let j = i + 1;
      if (j < text.length && text[j] === '[') {
        j++;
        while (j < text.length && /[0-9;]/.test(text[j])) j++;
        if (j < text.length && /[A-Za-z]/.test(text[j])) j++;
        i = j - 1;
        continue;
      } else if (j < text.length && text[j] === ']') {
        const endBell = text.indexOf('\x07', j);
        const endEsc = text.indexOf('\x1b\\', j);
        if (endBell !== -1 && (endEsc === -1 || endBell < endEsc)) {
          i = endBell;
        } else if (endEsc !== -1) {
          i = endEsc + 1;
        } else {
          i = j;
        }
        continue;
      }
    }
    
    if (c === '\r') continue;
    
    if (escape) {
      escape = false;
      continue;
    }
    
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    
    if (c === '"') {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push({ text: text.substring(start, i + 1), start });
        start = -1;
      }
    }
  }
  
  const lastObj = objects[objects.length - 1];
  const consumed = lastObj ? lastObj.start + lastObj.text.length : 0;
  const remaining = text.substring(consumed);
  
  return { objects: objects.map(o => o.text), remaining };
}

/**
 * 解析 JSON 对象（从 minimal-opencode.js 复制）
 */
function parseJsonObject(jsonStr, callbacks, onSession) {
  const { onOutput, onToolUse } = callbacks;
  
  try {
    const obj = JSON.parse(jsonStr);
    
    let sessionId = null;
    if (obj.type === 'session') {
      sessionId = obj.id || obj.session_id;
    } else if (obj.session_id) {
      sessionId = obj.session_id;
    }
    if (sessionId) {
      onSession && onSession(sessionId);
    }
    
    if (obj.type === 'text' && obj.part?.text) {
      onOutput && onOutput('stdout', obj.part.text);
    } else if (obj.type === 'tool_use') {
      const toolName = obj.part?.tool || 'tool';
      const state = obj.part?.state || {};
      const title = obj.part?.title || state.title || toolName;
      const status = state.status || 'completed';
      const input = state.input || {};
      const output = state.output || '';
      const callID = obj.part?.callID || '';
      
      if (onToolUse) {
        onToolUse({ tool: toolName, title, status, input, output, callID });
      }
    } else if (obj.type === 'permission_request') {
      onOutput && onOutput('stderr', `[权限请求] ${obj.description || JSON.stringify(obj)}\n`);
    }
  } catch {
    if (!jsonStr.trim().startsWith('{')) {
      callbacks.onOutput && callbacks.onOutput('stdout', jsonStr);
    }
  }
}

describe('minimal-opencode.js 核心功能', () => {
  describe('extractJsonObjects 函数', () => {
    it('应该提取单个 JSON 对象', () => {
      const input = '{"type":"text","part":{"text":"hello"}}';
      const { objects } = extractJsonObjects(input);
      
      expect(objects).toHaveLength(1);
      expect(JSON.parse(objects[0])).toEqual({ type: 'text', part: { text: 'hello' } });
    });

    it('应该提取多个 JSON 对象', () => {
      const input = '{"a":1}{"b":2}{"c":3}';
      const { objects } = extractJsonObjects(input);
      
      expect(objects).toHaveLength(3);
      expect(JSON.parse(objects[0])).toEqual({ a: 1 });
      expect(JSON.parse(objects[1])).toEqual({ b: 2 });
      expect(JSON.parse(objects[2])).toEqual({ c: 3 });
    });

    it('应该处理包含换行符的 JSON', () => {
      // 注意：JSON.stringify 会将换行符转义为 \n，这是正确的 JSON 格式
      const input = '{"type":"tool_use","part":{"state":{"output":"line1\\nline2\\nline3"}}}';
      const { objects } = extractJsonObjects(input);
      
      expect(objects).toHaveLength(1);
      const parsed = JSON.parse(objects[0]);
      expect(parsed.part.state.output).toBe('line1\nline2\nline3');
    });

    it('应该处理包含转义引号的 JSON', () => {
      const input = '{"text":"He said \\"hello\\""}';
      const { objects } = extractJsonObjects(input);
      
      expect(objects).toHaveLength(1);
      const parsed = JSON.parse(objects[0]);
      expect(parsed.text).toBe('He said "hello"');
    });

    it('应该跳过 ANSI 转义序列', () => {
      const input = '\x1b[32m{"type":"text"}\x1b[0m';
      const { objects } = extractJsonObjects(input);
      
      expect(objects).toHaveLength(1);
    });

    it('应该处理不完整的 JSON（返回 remaining）', () => {
      const input = '{"type":"text","part":{';
      const { objects, remaining } = extractJsonObjects(input);
      
      expect(objects).toHaveLength(0);
      expect(remaining).toBe('{"type":"text","part":{');
    });

    it('应该处理嵌套 JSON 对象', () => {
      const input = '{"outer":{"inner":{"deep":"value"}}}';
      const { objects } = extractJsonObjects(input);
      
      expect(objects).toHaveLength(1);
      const parsed = JSON.parse(objects[0]);
      expect(parsed.outer.inner.deep).toBe('value');
    });

    it('应该处理大型 tool_use JSON', () => {
      const largeOutput = 'x'.repeat(10000);
      const input = JSON.stringify({
        type: 'tool_use',
        part: {
          tool: 'read',
          state: {
            status: 'completed',
            output: largeOutput
          }
        }
      });
      
      const { objects } = extractJsonObjects(input);
      
      expect(objects).toHaveLength(1);
      const parsed = JSON.parse(objects[0]);
      expect(parsed.part.state.output).toBe(largeOutput);
    });
  });

  describe('parseJsonObject 函数', () => {
    it('应该解析 text 类型消息', () => {
      const outputs = [];
      const callbacks = {
        onOutput: (stream, data) => outputs.push({ stream, data }),
        onToolUse: () => {}
      };
      
      const json = '{"type":"text","part":{"text":"Hello World"}}';
      parseJsonObject(json, callbacks);
      
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toEqual({ stream: 'stdout', data: 'Hello World' });
    });

    it('应该解析 tool_use 类型消息并调用 onToolUse', () => {
      const toolCalls = [];
      const callbacks = {
        onOutput: () => {},
        onToolUse: (data) => toolCalls.push(data)
      };
      
      const json = JSON.stringify({
        type: 'tool_use',
        part: {
          tool: 'read',
          title: 'read test\\api\\routes.test.js',
          callID: 'call_123',
          state: {
            status: 'completed',
            input: { filePath: 'test/api/routes.test.js' },
            output: 'file content here'
          }
        }
      });
      
      parseJsonObject(json, callbacks);
      
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toEqual({
        tool: 'read',
        title: 'read test\\api\\routes.test.js',
        status: 'completed',
        input: { filePath: 'test/api/routes.test.js' },
        output: 'file content here',
        callID: 'call_123'
      });
    });

    it('应该提取 session ID', () => {
      let sessionId = null;
      const callbacks = { onOutput: () => {}, onToolUse: () => {} };
      
      const json = '{"type":"session","session_id":"ses_abc123"}';
      parseJsonObject(json, callbacks, (sid) => { sessionId = sid; });
      
      expect(sessionId).toBe('ses_abc123');
    });

    it('应该解析 permission_request 类型消息', () => {
      const outputs = [];
      const callbacks = {
        onOutput: (stream, data) => outputs.push({ stream, data }),
        onToolUse: () => {}
      };
      
      const json = '{"type":"permission_request","description":"Allow file access?"}';
      parseJsonObject(json, callbacks);
      
      expect(outputs).toHaveLength(1);
      expect(outputs[0].stream).toBe('stderr');
      expect(outputs[0].data).toContain('[权限请求]');
    });
  });

  describe('OpencodeCliMock 工具测试', () => {
    it('应该创建正确的 text 响应', () => {
      const response = OpencodeCliMock.createTextResponse('Hello');
      
      expect(response.type).toBe('text');
      expect(response.part.text).toBe('Hello');
    });

    it('应该创建正确的 tool_use 响应', () => {
      const response = OpencodeCliMock.createToolUseResponse('bash', 'ls -la', 'List Files');
      
      expect(response.type).toBe('tool_use');
      expect(response.part.tool).toBe('bash');
      expect(response.part.state.title).toBe('List Files');
      expect(response.part.state.output).toBe('ls -la');
    });

    it('应该创建正确的 permission_request 响应', () => {
      const response = OpencodeCliMock.createPermissionRequest('Allow access?');
      
      expect(response.type).toBe('permission_request');
      expect(response.description).toBe('Allow access?');
    });

    it('应该创建完整的对话响应序列', () => {
      const responses = OpencodeCliMock.createConversationResponse('Hello World');
      
      expect(responses).toHaveLength(3);
      expect(responses[0].type).toBe('step_start');
      expect(responses[1].type).toBe('text');
      expect(responses[2].type).toBe('step_finish');
    });

    it('应该创建步骤事件', () => {
      const startEvent = OpencodeCliMock.createStepStart('step-1');
      const finishEvent = OpencodeCliMock.createStepFinish('step-1');
      
      expect(startEvent.type).toBe('step_start');
      expect(startEvent.step_id).toBe('step-1');
      expect(finishEvent.type).toBe('step_finish');
      expect(finishEvent.step_id).toBe('step-1');
    });
  });

  describe('createNdjsonOutput 工具测试', () => {
    it('应该创建正确的 NDJSON 格式', () => {
      const chunks = [
        OpencodeCliMock.createStepStart('step-1'),
        OpencodeCliMock.createTextResponse('Hello'),
        OpencodeCliMock.createStepFinish('step-1'),
      ];
      
      const ndjson = createNdjsonOutput(chunks);
      const lines = ndjson.split('\n');
      
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).type).toBe('step_start');
      expect(JSON.parse(lines[1]).type).toBe('text');
      expect(JSON.parse(lines[2]).type).toBe('step_finish');
    });
  });
});
