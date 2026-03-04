import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownRenderer, ThinkingMessage, ImageMessage, ToolUseMessage, parseMessageContent } from '../../client/components/MarkdownRenderer.jsx';

// Mock ReactMarkdown
vi.mock('react-markdown', () => ({
  default: vi.fn(({ children, components }) => {
    // Simple mock for testing basic functionality
    return <div data-testid="react-markdown">{children}</div>;
  })
}));

// Mock remarkGfm and rehypeRaw
vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('rehype-raw', () => ({ default: vi.fn() }));

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ErrorBoundary', () => {
    it('should render children when no error', () => {
      const { MarkdownRenderer } = require('../../client/components/MarkdownRenderer.jsx');
      
      render(
        <MarkdownRenderer content="# Hello World" />
      );
      
      expect(screen.getByTestId('react-markdown')).toBeInTheDocument();
    });

    it('should handle rendering errors gracefully', () => {
      // Create a component that throws an error
      const ThrowErrorComponent = () => {
        throw new Error('Test error');
      };

      const { MarkdownRenderer } = require('../../client/components/MarkdownRenderer.jsx');
      
      // Mock ReactMarkdown to throw an error
      const ReactMarkdown = require('react-markdown').default;
      ReactMarkdown.mockImplementation(() => {
        throw new Error('Markdown rendering error');
      });

      render(
        <MarkdownRenderer content="# Hello World" />
      );
      
      expect(screen.getByText('渲染出错')).toBeInTheDocument();
    });
  });

  describe('MarkdownRenderer Component', () => {
    it('should render null when content is empty', () => {
      const { MarkdownRenderer } = require('../../client/components/MarkdownRenderer.jsx');
      
      const { container } = render(
        <MarkdownRenderer content="" />
      );
      
      expect(container.firstChild).toBeNull();
    });

    it('should render null when content is null', () => {
      const { MarkdownRenderer } = require('../../client/components/MarkdownRenderer.jsx');
      
      const { container } = render(
        <MarkdownRenderer content={null} />
      );
      
      expect(container.firstChild).toBeNull();
    });

    it('should render string content', () => {
      const { MarkdownRenderer } = require('../../client/components/MarkdownRenderer.jsx');
      
      render(
        <MarkdownRenderer content="# Hello World" />
      );
      
      expect(screen.getByTestId('react-markdown')).toBeInTheDocument();
    });

    it('should render object content as JSON string', () => {
      const { MarkdownRenderer } = require('../../client/components/MarkdownRenderer.jsx');
      const objectContent = { text: "Hello", value: 123 };
      
      render(
        <MarkdownRenderer content={objectContent} />
      );
      
      expect(screen.getByTestId('react-markdown')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { MarkdownRenderer } = require('../../client/components/MarkdownRenderer.jsx');
      
      const ReactMarkdown = require('react-markdown').default;
      ReactMarkdown.mockImplementation(({ children }) => (
        <div data-testid="react-markdown" className="test-content">{children}</div>
      ));
      
      render(
        <MarkdownRenderer content="Test" className="custom-class" />
      );
      
      const container = screen.getByTestId('react-markdown').parentElement;
      expect(container).toHaveClass('markdown-renderer', 'custom-class');
    });
  });

  describe('ThinkingMessage Component', () => {
    it('should render collapsed by default', () => {
      render(
        <ThinkingMessage content="This is a thinking process" agentName="Agent 1" />
      );
      
      expect(screen.getByText('Agent 1 的思考过程')).toBeInTheDocument();
      expect(screen.getByText('（点击展开，22 字符）')).toBeInTheDocument();
      expect(screen.getByText('▶')).toBeInTheDocument();
      expect(screen.queryByText('This is a thinking process')).not.toBeInTheDocument();
    });

    it('should expand when clicked', () => {
      render(
        <ThinkingMessage content="This is a thinking process" agentName="Agent 1" />
      );
      
      const header = screen.getByText('Agent 1 的思考过程');
      fireEvent.click(header);
      
      expect(screen.getByText('（点击折叠）')).toBeInTheDocument();
      expect(screen.getByText('▼')).toBeInTheDocument();
      expect(screen.getByText('This is a thinking process')).toBeInTheDocument();
    });

    it('should collapse when clicked again', () => {
      render(
        <ThinkingMessage content="This is a thinking process" agentName="Agent 1" />
      );
      
      const header = screen.getByText('Agent 1 的思考过程');
      
      // Expand
      fireEvent.click(header);
      expect(screen.getByText('（点击折叠）')).toBeInTheDocument();
      
      // Collapse
      fireEvent.click(header);
      expect(screen.getByText('（点击展开，22 字符）')).toBeInTheDocument();
    });
  });

  describe('ImageMessage Component', () => {
    it('should render image with caption', () => {
      render(
        <ImageMessage src="/test.jpg" alt="Test image" caption="Test caption" />
      );
      
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', '/test.jpg');
      expect(img).toHaveAttribute('alt', 'Test caption');
      expect(screen.getByText('Test caption')).toBeInTheDocument();
    });

    it('should render image without caption', () => {
      render(
        <ImageMessage src="/test.jpg" alt="Test image" />
      );
      
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', '/test.jpg');
      expect(img).toHaveAttribute('alt', 'Test image');
      expect(screen.queryByText('Test caption')).not.toBeInTheDocument();
    });

    it('should use caption as alt when alt is not provided', () => {
      render(
        <ImageMessage src="/test.jpg" caption="Test caption" />
      );
      
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('alt', 'Test caption');
    });
  });

  describe('ToolUseMessage Component', () => {
    it('should render null when no tool calls', () => {
      render(
        <ToolUseMessage toolCalls={[]} />
      );
      
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('should render null when toolCalls is null', () => {
      render(
        <ToolUseMessage toolCalls={null} />
      );
      
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('should render collapsed tool use message', () => {
      const toolCalls = [
        { tool: 'test_tool', title: 'Test Tool', status: 'completed', input: { param: 'value' }, output: 'Result' }
      ];
      
      render(
        <ToolUseMessage toolCalls={toolCalls} />
      );
      
      expect(screen.getByText('1 个工具调用')).toBeInTheDocument();
      expect(screen.getByText('Test Tool')).toBeInTheDocument();
      expect(screen.getByText('✓')).toBeInTheDocument();
      expect(screen.queryByText('Result')).not.toBeInTheDocument();
    });

    it('should expand when clicked', () => {
      const toolCalls = [
        { tool: 'test_tool', title: 'Test Tool', status: 'completed', input: { param: 'value' }, output: 'Result' }
      ];
      
      render(
        <ToolUseMessage toolCalls={toolCalls} />
      );
      
      const header = screen.getByText('1 个工具调用');
      fireEvent.click(header);
      
      expect(screen.getByText('工具:', { exact: false })).toBeInTheDocument();
      expect(screen.getByText('结果:', { exact: false })).toBeInTheDocument();
    });

    it('should display incomplete status when tool is not completed', () => {
      const toolCalls = [
        { tool: 'test_tool', status: 'running', input: { param: 'value' } }
      ];
      
      render(
        <ToolUseMessage toolCalls={toolCalls} />
      );
      
      expect(screen.getByText('...')).toBeInTheDocument();
      expect(screen.queryByText('✓')).not.toBeInTheDocument();
    });

    it('should handle multiple tool calls', () => {
      const toolCalls = [
        { tool: 'tool1', status: 'completed', input: {}, output: 'Result 1' },
        { tool: 'tool2', status: 'completed', input: {}, output: 'Result 2' }
      ];
      
      render(
        <ToolUseMessage toolCalls={toolCalls} />
      );
      
      expect(screen.getByText('2 个工具调用')).toBeInTheDocument();
      
      // Expand to see all tools
      const header = screen.getByText('2 个工具调用');
      fireEvent.click(header);
      
      expect(screen.getByText('tool1')).toBeInTheDocument();
      expect(screen.getByText('tool2')).toBeInTheDocument();
    });

    it('should handle string output formatting', () => {
      const toolCalls = [
        { tool: 'test_tool', status: 'completed', input: {}, output: 'String output' }
      ];
      
      render(
        <ToolUseMessage toolCalls={toolCalls} />
      );
      
      const header = screen.getByText('1 个工具调用');
      fireEvent.click(header);
      
      expect(screen.getByText('String output')).toBeInTheDocument();
    });

    it('should handle object output formatting', () => {
      const toolCalls = [
        { tool: 'test_tool', status: 'completed', input: {}, output: { result: 'success' } }
      ];
      
      render(
        <ToolUseMessage toolCalls={toolCalls} />
      );
      
      const header = screen.getByText('1 个工具调用');
      fireEvent.click(header);
      
      expect(screen.getByText('{"result":"success"}')).toBeInTheDocument();
    });

    it('should handle malformed output gracefully', () => {
      const circularObject = {};
      circularObject.self = circularObject; // Create circular reference
      
      const toolCalls = [
        { tool: 'test_tool', status: 'completed', input: {}, output: circularObject }
      ];
      
      render(
        <ToolUseMessage toolCalls={toolCalls} />
      );
      
      const header = screen.getByText('1 个工具调用');
      fireEvent.click(header);
      
      // Should not crash and should show some representation of the object
      expect(screen.getByText('结果:', { exact: false })).toBeInTheDocument();
    });
  });

  describe('parseMessageContent Function', () => {
    it('should return empty result for null content', () => {
      const result = parseMessageContent(null);
      expect(result).toEqual({ toolCalls: [], textParts: [] });
    });

    it('should return empty result for empty string', () => {
      const result = parseMessageContent('');
      expect(result).toEqual({ toolCalls: [], textParts: [] });
    });

    it('should parse simple text without tool calls', () => {
      const content = 'This is simple text';
      const result = parseMessageContent(content);
      
      expect(result.toolCalls).toEqual([]);
      expect(result.textParts).toEqual(['This is simple text']);
    });

    it('should parse single tool call', () => {
      const content = 'Text before [[TOOL_USE:{"tool":"test","input":{}}]] text after';
      const result = parseMessageContent(content);
      
      expect(result.toolCalls).toEqual([{ tool: 'test', input: {} }]);
      expect(result.textParts).toEqual(['Text before ', ' text after']);
    });

    it('should parse multiple tool calls', () => {
      const content = 'Start [[TOOL_USE:{"tool":"tool1","input":{}}]] middle [[TOOL_USE:{"tool":"tool2","input":{}}]] end';
      const result = parseMessageContent(content);
      
      expect(result.toolCalls).toEqual([
        { tool: 'tool1', input: {} },
        { tool: 'tool2', input: {} }
      ]);
      expect(result.textParts).toEqual(['Start ', ' middle ', ' end']);
    });

    it('should handle complex JSON in tool calls', () => {
      const content = '[[TOOL_USE:{"tool":"test","input":{"param1":"value1","param2":123},"status":"completed"}]]';
      const result = parseMessageContent(content);
      
      expect(result.toolCalls).toEqual([{
        tool: 'test',
        input: { param1: 'value1', param2: 123 },
        status: 'completed'
      }]);
      expect(result.textParts).toEqual([]);
    });

    it('should handle nested JSON with objects and arrays', () => {
      const content = '[[TOOL_USE:{"tool":"complex","input":{"nested":{"array":[1,2,3],"object":{"key":"value"}}}}]]';
      const result = parseMessageContent(content);
      
      expect(result.toolCalls).toEqual([{
        tool: 'complex',
        input: { nested: { array: [1, 2, 3], object: { key: 'value' } } }
      }]);
    });

    it('should ignore malformed JSON', () => {
      const content = 'Text [[TOOL_USE:{"tool":"test","input":{]] after malformed';
      const result = parseMessageContent(content);
      
      expect(result.toolCalls).toEqual([]);
      expect(result.textParts).toEqual(['Text ', ' after malformed']);
    });

    it('should filter out empty text parts', () => {
      const content = ' [[TOOL_USE:{"tool":"test","input":{}}]]   ';
      const result = parseMessageContent(content);
      
      expect(result.toolCalls).toEqual([{ tool: 'test', input: {} }]);
      expect(result.textParts).toEqual([]); // Empty parts should be filtered out
    });

    it('should handle incomplete tool call markers', () => {
      const content = 'Text [[TOOL_USE:{"tool":"test","input":{}} incomplete marker';
      const result = parseMessageContent(content);
      
      expect(result.toolCalls).toEqual([]);
      expect(result.textParts).toEqual(['Text [[TOOL_USE:{"tool":"test","input":{}} incomplete marker']);
    });

    it('should handle text-only content', () => {
      const content = 'Just plain text without any tool calls';
      const result = parseMessageContent(content);
      
      expect(result.toolCalls).toEqual([]);
      expect(result.textParts).toEqual(['Just plain text without any tool calls']);
    });
  });
});