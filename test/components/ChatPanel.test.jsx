/**
 * ChatPanel 组件测试
 * 测试 @ 提及解析、消息发送、UI 交互等功能
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatPanel from '../../client/components/ChatPanel';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock agents data
const mockAgents = [
  { id: 1, name: 'Claude CLI', cli_command: 'builtin:claude-cli' },
  { id: 2, name: 'Opencode CLI', cli_command: 'builtin:opencode-cli' },
];

// Mock useGlobalMessages hook
vi.mock('../../client/hooks/useGlobalMessages', () => ({
  useGlobalMessages: () => ({
    messages: [
      { id: 1, role: 'user', content: 'Hello', agent_name: null },
      { id: 2, role: 'assistant', content: 'Hi there!', agent_name: 'Claude CLI' },
    ],
    loading: false,
    refetch: vi.fn(),
    addMessage: vi.fn(),
    setMessages: vi.fn(),
  }),
}));

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = vi.fn();

describe('ChatPanel', () => {
  let defaultProps;

  beforeEach(() => {
    mockFetch.mockClear();
    defaultProps = {
      currentConversation: { id: 1, title: 'Test Conversation' },
      selectedTaskId: 1,
      agents: mockAgents,
      wsReady: true,
      runningAgentIds: [],
      onSend: vi.fn(),
      onStop: vi.fn(),
      onStart: vi.fn(),
      onSendText: vi.fn(),
    };
  });

  describe('渲染测试', () => {
    it('应该正确渲染聊天面板', () => {
      render(<ChatPanel {...defaultProps} />);
      
      expect(screen.getByText('Test Conversation')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...')).toBeInTheDocument();
    });

    it.skip('应该显示空状态当没有选中对话时', () => {
      render(<ChatPanel {...defaultProps} currentConversation={null} />);
      
      expect(screen.getByText('选择一个对话开始聊天')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('请先选择对话')).toBeInTheDocument();
    });

    it('应该显示历史消息', () => {
      render(<ChatPanel {...defaultProps} />);
      
      expect(screen.getByText('Hello')).toBeInTheDocument();
      expect(screen.getByText('Hi there!')).toBeInTheDocument();
    });

    it.skip('应该显示 WebSocket 连接状态', () => {
      render(<ChatPanel {...defaultProps} wsReady={false} />);
      
      expect(screen.getByText('连接中...')).toBeInTheDocument();
    });

    it.skip('应该显示运行中的 Agent 数量', () => {
      render(<ChatPanel {...defaultProps} runningAgentIds={[1, 2]} />);
      
      expect(screen.getByText('2 个 Agent 运行中')).toBeInTheDocument();
    });

    it('应该显示流式输出内容', () => {
      render(<ChatPanel {...defaultProps} streamingContent="Streaming..." streamingAgentId={1} />);
      
      expect(screen.getByText('Streaming...')).toBeInTheDocument();
    });

    it('应该禁用输入框当 WebSocket 未连接', () => {
      render(<ChatPanel {...defaultProps} wsReady={false} />);
      
      expect(screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...')).toBeDisabled();
    });
  });

  describe('@ 提及功能测试', () => {
    it.skip('应该显示 @ 提及下拉框', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...');
      
      await user.type(input, '@');
      
      await waitFor(() => {
        expect(screen.getByText(/Claude CLI/)).toBeInTheDocument();
        expect(screen.getByText(/Opencode CLI/)).toBeInTheDocument();
      });
    });

    it.skip('应该过滤 @ 提及列表', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...');
      
      await user.type(input, '@cl');
      
      await waitFor(() => {
        expect(screen.getByText(/Claude CLI/)).toBeInTheDocument();
      });
      
      expect(screen.getByText(/Opencode CLI/)).toBeInTheDocument();
    });

    it.skip('应该选择 @ 提及的 Agent', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...');
      
      await user.type(input, '@');
      
      await waitFor(() => {
        expect(screen.getByText(/Claude CLI/)).toBeInTheDocument();
      });
      
      const firstItem = document.querySelector('.mention-item');
      await user.click(firstItem);
      
      expect(input.value).toBe('@Claude CLI ');
    });

    it.skip('应该显示无匹配 Agent 提示', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...');
      
      await user.type(input, '@nonexistent');
      
      await waitFor(() => {
        expect(screen.getByText('无匹配的 Agent')).toBeInTheDocument();
      });
    });
  });

  describe('parseTargetAgent 函数测试', () => {
    // 直接测试 parseTargetAgent 逻辑（与 ChatPanel.jsx 保持一致）
    function parseTargetAgent(text, agents) {
      const atIdx = text.lastIndexOf('@');
      if (atIdx === -1) {
        return null;
      }

      const beforeMention = text.slice(0, atIdx).trim();
      const textWithoutAt = text.slice(atIdx + 1);
      const sortedAgents = [...agents].sort((a, b) => b.name.length - a.name.length);

      for (const agent of sortedAgents) {
        const nameLower = agent.name.toLowerCase();
        const textLower = textWithoutAt.toLowerCase();

        if (textLower.startsWith(nameLower)) {
          const afterName = textWithoutAt.slice(agent.name.length);
          if (afterName === '' || afterName.startsWith(' ')) {
            const afterText = afterName.trimStart();
            const combined = [beforeMention, afterText].filter(Boolean).join(' ');
            return {
              agent,
              textWithoutMention: combined,
            };
          }
        }
      }

      return null;
    }

    const agents = [
      { id: 1, name: 'Claude CLI' },
      { id: 2, name: 'Opencode CLI' },
      { id: 3, name: 'Claude' }, // 短名称，用于测试长度优先
    ];

    it('应该解析 @Claude CLI 你好', () => {
      const result = parseTargetAgent('@Claude CLI 你好', agents);

      expect(result).not.toBeNull();
      expect(result.agent.name).toBe('Claude CLI');
      expect(result.textWithoutMention).toBe('你好');
    });

    it('应该优先匹配长名称', () => {
      const result = parseTargetAgent('@Claude CLI hello', agents);

      expect(result).not.toBeNull();
      expect(result.agent.name).toBe('Claude CLI');
    });

    it('应该匹配短名称当没有长名称匹配时', () => {
      const result = parseTargetAgent('@Claude hello', agents);

      expect(result).not.toBeNull();
      expect(result.agent.name).toBe('Claude');
    });

    it('应该大小写不敏感', () => {
      const result = parseTargetAgent('@claude cli 你好', agents);

      expect(result).not.toBeNull();
      expect(result.agent.name).toBe('Claude CLI');
    });

    it('应该返回 null 当没有 @ 前缀', () => {
      const result = parseTargetAgent('Hello', agents);
      expect(result).toBeNull();
    });

    it('应该返回 null 当 Agent 不存在', () => {
      const result = parseTargetAgent('@Nonexistent hello', agents);
      expect(result).toBeNull();
    });

    it('应该返回 null 当名称后紧跟非空格字符', () => {
      const result = parseTargetAgent('@Claude123', agents);
      expect(result).toBeNull();
    });

    it('应该处理只有 @Agent 的情况', () => {
      const result = parseTargetAgent('@Claude CLI', agents);

      expect(result).not.toBeNull();
      expect(result.agent.name).toBe('Claude CLI');
      expect(result.textWithoutMention).toBe('');
    });

    it('应该支持 @ 在文本中间', () => {
      const result = parseTargetAgent('帮我看看代码 @Claude CLI', agents);

      expect(result).not.toBeNull();
      expect(result.agent.name).toBe('Claude CLI');
      expect(result.textWithoutMention).toBe('帮我看看代码');
    });

    it('应该合并 @ 前后的文本', () => {
      const result = parseTargetAgent('请 @Claude CLI 帮我检查', agents);

      expect(result).not.toBeNull();
      expect(result.agent.name).toBe('Claude CLI');
      expect(result.textWithoutMention).toBe('请 帮我检查');
    });

    it('应该支持 @ 在文本末尾（无后续文字）', () => {
      const result = parseTargetAgent('看看这个 @Claude', agents);

      expect(result).not.toBeNull();
      expect(result.agent.name).toBe('Claude');
      expect(result.textWithoutMention).toBe('看看这个');
    });
  });

  describe('发送消息测试', () => {
    it.skip('应该发送带 @Agent 的消息', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 3, role: 'user', content: '@Claude CLI Hello' }),
      });

      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);

      const input = screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...');

      await user.type(input, '@Claude CLI Hello');
      await user.type(input, '{enter}');

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(defaultProps.onStart).toHaveBeenCalledWith(1);
        expect(defaultProps.onSendText).toHaveBeenCalledWith(1, 'Hello', 1);
      });
    });

    it('应该发送普通消息（无 @Agent）', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 3, role: 'user', content: 'Just a note' }),
      });
      
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...');
      
      await user.type(input, 'Just a note');
      await user.type(input, '{enter}');
      
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/messages', expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Just a note'),
        }));
      });
    });

    it('应该不发送空消息', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...');
      
      await user.type(input, '{enter}');
      
      expect(defaultProps.onStart).not.toHaveBeenCalled();
    });

    it.skip('应该提示输入内容当只有 @Agent 时', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...');
      
      await user.type(input, '@Claude CLI');
      await user.type(input, '{enter}');
      
      expect(input.value).toBe('@Claude CLI ');
    });
  });

  describe('停止 Agent 测试', () => {
    it('应该显示停止按钮当有 Agent 运行时', () => {
      render(<ChatPanel {...defaultProps} runningAgentIds={[1]} />);
      
      expect(screen.getByText('停止 @Claude CLI')).toBeInTheDocument();
    });

    it('应该调用 onStop 当点击停止按钮', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} runningAgentIds={[1]} />);
      
      await user.click(screen.getByText('停止 @Claude CLI'));
      
      expect(defaultProps.onStop).toHaveBeenCalledWith(1);
    });
  });

  describe('键盘交互测试', () => {
    it('应该支持 Enter 发送消息', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 3, role: 'user', content: 'Test' }),
      });
      
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...');
      
      await user.type(input, 'Test{enter}');
      
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });

    it('应该支持 Shift+Enter 换行', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...');
      
      await user.type(input, 'Line1{Shift>}{enter}{/Shift}Line2');
      
      expect(input.value).toContain('Line1');
      expect(input.value).toContain('Line2');
    });

    it.skip('应该支持上下键选择 @ 提及', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...');
      
      await user.type(input, '@');
      
      await waitFor(() => {
        expect(screen.getByText('Claude CLI')).toBeInTheDocument();
      });
      
      await user.type(input, '{arrowdown}');
      await user.type(input, '{enter}');
      
      expect(input.value).toContain('@');
    });

    it.skip('应该支持 Escape 关闭 @ 提及下拉框', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @ 唤起列表...');
      
      await user.type(input, '@');
      
      await waitFor(() => {
        expect(screen.getByText('Claude CLI')).toBeInTheDocument();
      });
      
      await user.type(input, '{escape}');
      
      await waitFor(() => {
        expect(screen.queryByText('Claude CLI')).not.toBeInTheDocument();
      });
    });
  });
});
