import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkdownRenderer, ThinkingMessage, ToolUseMessage, parseMessageContent } from '../../client/components/MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('renders plain text correctly', () => {
    render(<MarkdownRenderer content="Plain text" />);
    expect(screen.getByText('Plain text')).toBeInTheDocument();
  });

  it('renders bold and italic text', () => {
    render(<MarkdownRenderer content="**Bold** and *italic*" />);
    expect(screen.getByText('Bold')).toBeInTheDocument();
    expect(screen.getByText('italic')).toBeInTheDocument();
  });

  it('renders inline code', () => {
    render(<MarkdownRenderer content="This is `inline code`" />);
    expect(screen.getByText('inline code')).toBeInTheDocument();
  });

  it('renders links', () => {
    render(<MarkdownRenderer content="[Link](https://example.com)" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com');
  });

  it('renders blockquotes', () => {
    render(<MarkdownRenderer content="> This is a quote" />);
    expect(screen.getByText('This is a quote')).toBeInTheDocument();
  });

  it('handles empty content', () => {
    const { container } = render(<MarkdownRenderer content="" />);
    expect(container.firstChild).toBeNull();
  });

  it('handles null content', () => {
    const { container } = render(<MarkdownRenderer content={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('handles object content by stringifying', () => {
    const { container } = render(<MarkdownRenderer content={{ foo: 'bar' }} />);
    expect(container.textContent).toContain('foo');
    expect(container.textContent).toContain('bar');
  });
});

describe('ThinkingMessage', () => {
  it('renders collapsed by default', () => {
    render(<ThinkingMessage content="Thinking content" agentName="Test Agent" />);
    expect(screen.getByText('Test Agent 的思考过程')).toBeInTheDocument();
    expect(screen.queryByText('Thinking content')).not.toBeInTheDocument();
  });

  it('expands when clicked', async () => {
    const user = userEvent.setup();
    render(<ThinkingMessage content="Thinking content" agentName="Test Agent" />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    expect(screen.getByText('Thinking content')).toBeInTheDocument();
  });

  it('collapses when clicked again', async () => {
    const user = userEvent.setup();
    render(<ThinkingMessage content="Thinking content" agentName="Test Agent" />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    expect(screen.getByText('Thinking content')).toBeInTheDocument();
    
    await user.click(header);
    expect(screen.queryByText('Thinking content')).not.toBeInTheDocument();
  });
});

describe('ToolUseMessage', () => {
  it('renders collapsed by default with summary visible', () => {
    const toolCalls = [{ tool: 'read', title: 'read file.js', status: 'completed' }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    // Header 显示 tool call count 和 summary
    expect(screen.getByText('1 个工具调用')).toBeInTheDocument();
    expect(screen.getByText('read file.js')).toBeInTheDocument();
    // 详情区域默认折叠，参数标签不可见
    expect(screen.queryByText('参数:')).not.toBeInTheDocument();
  });

  it('expands when clicked to show details', async () => {
    const user = userEvent.setup();
    const toolCalls = [{ tool: 'read', title: 'read file.js', status: 'completed' }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    // 展开后显示工具名称和状态
    expect(screen.getByText('read')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('displays input parameters when expanded', async () => {
    const user = userEvent.setup();
    const toolCalls = [{ 
      tool: 'read', 
      title: 'read file.js', 
      status: 'completed',
      input: { filePath: 'test.js' }
    }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    expect(screen.getByText('参数:')).toBeInTheDocument();
    expect(screen.getByText(/filePath/)).toBeInTheDocument();
  });

  it('displays output when present', async () => {
    const user = userEvent.setup();
    const toolCalls = [{ 
      tool: 'read', 
      title: 'read file.js', 
      status: 'completed',
      output: 'file content here'
    }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    expect(screen.getByText('结果:')).toBeInTheDocument();
  });

  it('handles multiple tool calls', async () => {
    const user = userEvent.setup();
    const toolCalls = [
      { tool: 'read', title: 'read a.js', status: 'completed' },
      { tool: 'write', title: 'write b.js', status: 'completed' }
    ];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    // 显示 2 个工具调用
    expect(screen.getByText('2 个工具调用')).toBeInTheDocument();
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    // 展开后两个工具都可见（使用 getAllByText 处理重复元素）
    expect(screen.getAllByText('read a.js').length).toBeGreaterThan(0);
    expect(screen.getAllByText('write b.js').length).toBeGreaterThan(0);
    // 验证工具名称
    expect(screen.getAllByText('read').length).toBeGreaterThan(0);
    expect(screen.getAllByText('write').length).toBeGreaterThan(0);
  });

  it('handles null toolCalls', () => {
    const { container } = render(<ToolUseMessage toolCalls={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('handles empty toolCalls array', () => {
    const { container } = render(<ToolUseMessage toolCalls={[]} />);
    expect(container.firstChild).toBeNull();
  });

  // 边界情况测试
  it('handles tool call with missing tool name', async () => {
    const user = userEvent.setup();
    const toolCalls = [{ title: 'some action', status: 'completed' }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    // 应该显示 'unknown' 作为默认值
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });

  it('handles tool call with missing status', async () => {
    const user = userEvent.setup();
    const toolCalls = [{ tool: 'read', title: 'read file' }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });

  it('handles tool call with object output', async () => {
    const user = userEvent.setup();
    const toolCalls = [{ 
      tool: 'read', 
      title: 'read file', 
      status: 'completed',
      output: { content: 'file content', lines: 100 }
    }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    expect(screen.getByText('结果:')).toBeInTheDocument();
    // 对象输出应该被 JSON.stringify
    expect(screen.getByText(/content/)).toBeInTheDocument();
  });

  it('handles tool call with null input', async () => {
    const user = userEvent.setup();
    const toolCalls = [{ 
      tool: 'read', 
      title: 'read file', 
      status: 'completed',
      input: null
    }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    // 不应该显示参数标签
    expect(screen.queryByText('参数:')).not.toBeInTheDocument();
  });

  it('handles tool call with empty input object', async () => {
    const user = userEvent.setup();
    const toolCalls = [{ 
      tool: 'read', 
      title: 'read file', 
      status: 'completed',
      input: {}
    }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    // 空对象不应该显示参数标签
    expect(screen.queryByText('参数:')).not.toBeInTheDocument();
  });

  it('handles large output by using pre tag', async () => {
    const user = userEvent.setup();
    const largeOutput = 'x'.repeat(600);
    const toolCalls = [{ 
      tool: 'read', 
      title: 'read file', 
      status: 'completed',
      output: largeOutput
    }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    // 大输出应该使用 pre 标签
    const preElement = document.querySelector('.tool-use-item-code');
    expect(preElement).toBeInTheDocument();
    expect(preElement.textContent).toContain(largeOutput);
  });

  it('shows checkmark when all tools completed', () => {
    const toolCalls = [
      { tool: 'read', status: 'completed' },
      { tool: 'write', status: 'completed' }
    ];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('shows ellipsis when tools not all completed', () => {
    const toolCalls = [
      { tool: 'read', status: 'completed' },
      { tool: 'write', status: 'running' }
    ];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    expect(screen.getByText('...')).toBeInTheDocument();
  });

  it('uses title from tool call or state', async () => {
    const user = userEvent.setup();
    const toolCalls = [{ 
      tool: 'bash',
      title: 'Execute command',
      status: 'completed'
    }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    // 折叠状态显示 title
    const titles = screen.getAllByText('Execute command');
    expect(titles.length).toBeGreaterThan(0);
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    // 展开后也显示 title（使用 getAllByText 因为可能出现在多个位置）
    const expandedTitles = screen.getAllByText('Execute command');
    expect(expandedTitles.length).toBeGreaterThan(0);
  });

  it('uses tool name as title when title is same as tool', () => {
    const toolCalls = [{ tool: 'bash', title: 'bash', status: 'completed' }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    // 当 title 与 tool 相同时，应该正常显示
    const bashElements = screen.getAllByText('bash');
    expect(bashElements.length).toBeGreaterThan(0);
  });

  it('uses tool name as title when title is same as tool', async () => {
    const toolCalls = [{ tool: 'bash', title: 'bash', status: 'completed' }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    // 当 title 与 tool 相同时，应该正常显示
    expect(screen.getByText('bash')).toBeInTheDocument();
  });

  it('handles callID field', async () => {
    const user = userEvent.setup();
    const toolCalls = [{ 
      tool: 'read', 
      title: 'read file',
      status: 'completed',
      callID: 'call_abc123'
    }];
    render(<ToolUseMessage toolCalls={toolCalls} />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    // 组件应该正常渲染（不崩溃）
    expect(screen.getByText('read')).toBeInTheDocument();
  });
});

describe('parseMessageContent', () => {
  it('parses tool_use marker from content', () => {
    const content = '[[TOOL_USE:{"tool":"read","title":"read file","status":"completed"}]]';
    const { toolCalls } = parseMessageContent(content);
    
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toEqual({ tool: 'read', title: 'read file', status: 'completed' });
  });

  it('extracts text before and after tool_use marker', () => {
    const content = 'Before[[TOOL_USE:{"tool":"read"}]]After';
    const { toolCalls, textParts } = parseMessageContent(content);
    
    expect(toolCalls).toHaveLength(1);
    expect(textParts).toEqual(['Before', 'After']);
  });

  it('handles multiple tool_use markers', () => {
    const content = '[[TOOL_USE:{"tool":"a"}]][[TOOL_USE:{"tool":"b"}]]';
    const { toolCalls } = parseMessageContent(content);
    
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].tool).toBe('a');
    expect(toolCalls[1].tool).toBe('b');
  });

  it('handles nested JSON in tool_use', () => {
    const content = '[[TOOL_USE:{"tool":"read","input":{"path":"file.js"}}]]';
    const { toolCalls } = parseMessageContent(content);
    
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].input).toEqual({ path: 'file.js' });
  });

  it('handles content without tool_use markers', () => {
    const content = 'Just plain text';
    const { toolCalls, textParts } = parseMessageContent(content);
    
    expect(toolCalls).toHaveLength(0);
    expect(textParts).toEqual(['Just plain text']);
  });

  it('handles empty content', () => {
    const { toolCalls, textParts } = parseMessageContent('');
    
    expect(toolCalls).toHaveLength(0);
    expect(textParts).toHaveLength(0);
  });

  it('handles null content', () => {
    const { toolCalls, textParts } = parseMessageContent(null);
    
    expect(toolCalls).toHaveLength(0);
    expect(textParts).toHaveLength(0);
  });

  it('handles undefined content', () => {
    const { toolCalls, textParts } = parseMessageContent(undefined);
    
    expect(toolCalls).toHaveLength(0);
    expect(textParts).toHaveLength(0);
  });

  it('handles malformed JSON in tool_use marker', () => {
    const content = '[[TOOL_USE:{invalid json}]]';
    const { toolCalls, textParts } = parseMessageContent(content);
    
    // 无效 JSON 应该被忽略，不会出现在任何结果中
    expect(toolCalls).toHaveLength(0);
    expect(textParts).toHaveLength(0);
  });

  it('handles malformed JSON with surrounding text', () => {
    const content = 'Before[[TOOL_USE:{invalid}]]After';
    const { toolCalls, textParts } = parseMessageContent(content);
    
    // 无效 JSON 被跳过，但前后的文本应该保留
    expect(toolCalls).toHaveLength(0);
    expect(textParts).toEqual(['Before', 'After']);
  });
});