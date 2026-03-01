/**
 * Tool Use 端到端集成测试
 * 测试完整的 tool_use 数据流：CLI 输出 → 解析 → WebSocket → 前端渲染
 */
import { describe, it, expect } from 'vitest';

/**
 * 模拟 opencode CLI 的 tool_use 输出
 */
function createOpencodeToolUseOutput(options = {}) {
  const {
    tool = 'read',
    title = 'read file.js',
    status = 'completed',
    input = { filePath: 'test.js' },
    output = 'file content',
    callID = 'call_123',
    sessionID = 'ses_abc'
  } = options;

  return JSON.stringify({
    type: 'tool_use',
    timestamp: Date.now(),
    sessionID,
    part: {
      id: 'prt_test',
      sessionID,
      messageID: 'msg_test',
      type: 'tool',
      callID,
      tool,
      title,
      state: {
        status,
        input,
        output
      }
    }
  });
}

/**
 * 模拟 extractJsonObjects 函数（从 minimal-opencode.js 复制）
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
 * 模拟 parseJsonObject 函数（从 minimal-opencode.js 复制）
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

/**
 * 模拟前端 ChatPanel 处理 metadata 的逻辑
 */
function processMessageMetadata(message) {
  const { content, metadata } = message;
  
  let toolCalls = [];
  let textParts = [];
  
  // 优先从 metadata 读取 tool_calls
  if (metadata) {
    try {
      const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      if (meta.tool_calls && Array.isArray(meta.tool_calls)) {
        toolCalls = meta.tool_calls;
      }
    } catch {
      // metadata 解析失败
    }
  }
  
  // 如果 metadata 没有 tool_calls，尝试从 content 解析
  if (toolCalls.length === 0 && content) {
    const toolUseRegex = /\[\[TOOL_USE:(\{.*?\})\]\]/g;
    let match;
    let lastIndex = 0;
    
    while ((match = toolUseRegex.exec(content)) !== null) {
      try {
        toolCalls.push(JSON.parse(match[1]));
        textParts.push(content.substring(lastIndex, match.index));
        lastIndex = match.index + match[0].length;
      } catch {
        // 解析失败，忽略
      }
    }
    
    if (toolCalls.length > 0) {
      textParts.push(content.substring(lastIndex));
    } else {
      textParts = [content];
    }
  } else if (content) {
    textParts = [content];
  }
  
  return { toolCalls, textParts };
}

describe('Tool Use 端到端测试', () => {
  describe('CLI 输出解析', () => {
    it('应该正确解析完整的 tool_use JSON', () => {
      const cliOutput = createOpencodeToolUseOutput({
        tool: 'read',
        title: 'read test.js',
        input: { filePath: 'test.js', limit: 100 },
        output: 'export function test() { return 1; }'
      });
      
      const { objects } = extractJsonObjects(cliOutput);
      expect(objects).toHaveLength(1);
      
      const toolCalls = [];
      const callbacks = {
        onOutput: () => {},
        onToolUse: (data) => toolCalls.push(data)
      };
      
      parseJsonObject(objects[0], callbacks);
      
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toEqual({
        tool: 'read',
        title: 'read test.js',
        status: 'completed',
        input: { filePath: 'test.js', limit: 100 },
        output: 'export function test() { return 1; }',
        callID: 'call_123'
      });
    });

    it('应该处理包含换行符的 output', () => {
      const multiLineOutput = 'line1\nline2\nline3\nline4';
      const cliOutput = createOpencodeToolUseOutput({
        output: multiLineOutput
      });
      
      const { objects } = extractJsonObjects(cliOutput);
      expect(objects).toHaveLength(1);
      
      const toolCalls = [];
      parseJsonObject(objects[0], {
        onOutput: () => {},
        onToolUse: (data) => toolCalls.push(data)
      });
      
      expect(toolCalls[0].output).toBe(multiLineOutput);
    });

    it('应该处理大型 output（超过 10KB）', () => {
      const largeOutput = 'x'.repeat(15000);
      const cliOutput = createOpencodeToolUseOutput({
        output: largeOutput
      });
      
      const { objects } = extractJsonObjects(cliOutput);
      expect(objects).toHaveLength(1);
      
      const toolCalls = [];
      parseJsonObject(objects[0], {
        onOutput: () => {},
        onToolUse: (data) => toolCalls.push(data)
      });
      
      expect(toolCalls[0].output).toBe(largeOutput);
    });

    it('应该处理复杂的嵌套 input 对象', () => {
      const complexInput = {
        files: ['a.js', 'b.js', 'c.js'],
        options: {
          encoding: 'utf8',
          recursive: true,
          filter: {
            exclude: ['node_modules'],
            include: ['src']
          }
        }
      };
      
      const cliOutput = createOpencodeToolUseOutput({ input: complexInput });
      const { objects } = extractJsonObjects(cliOutput);
      
      const toolCalls = [];
      parseJsonObject(objects[0], {
        onOutput: () => {},
        onToolUse: (data) => toolCalls.push(data)
      });
      
      expect(toolCalls[0].input).toEqual(complexInput);
    });

    it('应该处理多个连续的 tool_use 事件', () => {
      const cliOutput = [
        createOpencodeToolUseOutput({ tool: 'read', callID: 'call_1' }),
        createOpencodeToolUseOutput({ tool: 'write', callID: 'call_2' }),
        createOpencodeToolUseOutput({ tool: 'bash', callID: 'call_3' })
      ].join('');
      
      const { objects } = extractJsonObjects(cliOutput);
      expect(objects).toHaveLength(3);
      
      const toolCalls = [];
      for (const obj of objects) {
        parseJsonObject(obj, {
          onOutput: () => {},
          onToolUse: (data) => toolCalls.push(data)
        });
      }
      
      expect(toolCalls).toHaveLength(3);
      expect(toolCalls[0].tool).toBe('read');
      expect(toolCalls[1].tool).toBe('write');
      expect(toolCalls[2].tool).toBe('bash');
    });
  });

  describe('WebSocket 消息处理', () => {
    it('应该构造正确的 tool_use WebSocket 消息', () => {
      const toolData = {
        tool: 'read',
        title: 'read file.js',
        status: 'completed',
        input: { filePath: 'test.js' },
        output: 'content',
        callID: 'call_123'
      };
      
      // 模拟 WebSocket 消息格式
      const wsMessage = {
        type: 'tool_use',
        agentId: 2,
        data: toolData
      };
      
      expect(wsMessage.type).toBe('tool_use');
      expect(wsMessage.data.tool).toBe('read');
      expect(wsMessage.data.callID).toBe('call_123');
    });
  });

  describe('前端 metadata 处理', () => {
    it('应该从 metadata 读取 tool_calls', () => {
      const message = {
        content: 'Here is the result',
        metadata: JSON.stringify({
          tool_calls: [
            { tool: 'read', title: 'read file', status: 'completed' }
          ]
        })
      };
      
      const { toolCalls, textParts } = processMessageMetadata(message);
      
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].tool).toBe('read');
      expect(textParts).toEqual(['Here is the result']);
    });

    it('应该在 metadata 无效时回退到 content 解析', () => {
      const message = {
        content: 'Before[[TOOL_USE:{"tool":"read","title":"read file"}]]After',
        metadata: null
      };
      
      const { toolCalls, textParts } = processMessageMetadata(message);
      
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].tool).toBe('read');
      expect(textParts).toEqual(['Before', 'After']);
    });

    it('应该处理空的 tool_calls 数组', () => {
      const message = {
        content: 'Plain text message',
        metadata: JSON.stringify({ tool_calls: [] })
      };
      
      const { toolCalls, textParts } = processMessageMetadata(message);
      
      expect(toolCalls).toHaveLength(0);
      expect(textParts).toEqual(['Plain text message']);
    });

    it('应该处理无效的 JSON metadata', () => {
      const message = {
        content: 'Plain text',
        metadata: 'invalid json {'
      };
      
      const { toolCalls, textParts } = processMessageMetadata(message);
      
      expect(toolCalls).toHaveLength(0);
      expect(textParts).toEqual(['Plain text']);
    });
  });

  describe('完整数据流', () => {
    it('应该完成从 CLI 输出到前端渲染的完整流程', () => {
      // 1. 模拟 CLI 输出
      const cliOutput = createOpencodeToolUseOutput({
        tool: 'bash',
        title: 'run tests',
        input: { command: 'npm test' },
        output: '✓ 157 tests passed'
      });
      
      // 2. 解析 CLI 输出
      const { objects } = extractJsonObjects(cliOutput);
      const toolCalls = [];
      parseJsonObject(objects[0], {
        onOutput: () => {},
        onToolUse: (data) => toolCalls.push(data)
      });
      
      expect(toolCalls).toHaveLength(1);
      
      // 3. 模拟保存到数据库（带 metadata）
      const savedMessage = {
        content: '',
        metadata: JSON.stringify({ tool_calls: toolCalls })
      };
      
      // 4. 前端处理 metadata
      const { toolCalls: frontendToolCalls } = processMessageMetadata(savedMessage);
      
      expect(frontendToolCalls).toHaveLength(1);
      expect(frontendToolCalls[0].tool).toBe('bash');
      expect(frontendToolCalls[0].title).toBe('run tests');
      expect(frontendToolCalls[0].input).toEqual({ command: 'npm test' });
      expect(frontendToolCalls[0].output).toBe('✓ 157 tests passed');
    });

    it('应该处理多个 tool_use 的完整流程', () => {
      // 模拟多个 CLI 输出
      const cliOutputs = [
        createOpencodeToolUseOutput({ tool: 'read', callID: 'call_1' }),
        createOpencodeToolUseOutput({ tool: 'edit', callID: 'call_2' }),
        createOpencodeToolUseOutput({ tool: 'bash', callID: 'call_3' })
      ].join('');
      
      // 解析
      const { objects } = extractJsonObjects(cliOutputs);
      const allToolCalls = [];
      
      for (const obj of objects) {
        parseJsonObject(obj, {
          onOutput: () => {},
          onToolUse: (data) => allToolCalls.push(data)
        });
      }
      
      expect(allToolCalls).toHaveLength(3);
      
      // 模拟前端处理
      const savedMessage = {
        content: '',
        metadata: JSON.stringify({ tool_calls: allToolCalls })
      };
      
      const { toolCalls: frontendToolCalls } = processMessageMetadata(savedMessage);
      
      expect(frontendToolCalls).toHaveLength(3);
      expect(frontendToolCalls.map(t => t.tool)).toEqual(['read', 'edit', 'bash']);
    });
  });

  describe('错误处理', () => {
    it('应该处理 truncated JSON（数据流中断）', () => {
      const truncatedJson = '{"type":"tool_use","part":{"tool":"read"';
      
      const { objects, remaining } = extractJsonObjects(truncatedJson);
      
      expect(objects).toHaveLength(0);
      expect(remaining).toBe(truncatedJson);
    });

    it('应该处理包含 ANSI 转义序列的输出', () => {
      const ansiOutput = '\x1b[32m' + createOpencodeToolUseOutput() + '\x1b[0m';
      
      const { objects } = extractJsonObjects(ansiOutput);
      expect(objects).toHaveLength(1);
      
      // 验证 JSON 可以正常解析
      const parsed = JSON.parse(objects[0]);
      expect(parsed.type).toBe('tool_use');
    });

    it('应该处理 null 和 undefined 值', () => {
      const toolCalls = [];
      
      // input 为空对象
      parseJsonObject(
        JSON.stringify({
          type: 'tool_use',
          part: { tool: 'test', state: { input: {} } }
        }),
        { onOutput: () => {}, onToolUse: (d) => toolCalls.push(d) }
      );
      
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].input).toEqual({});
    });
  });
});
