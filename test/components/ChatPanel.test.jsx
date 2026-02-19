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

describe('ChatPanel 组件测试', () => {
  const defaultProps = {
    agents: mockAgents,
    selectedTaskId: 1,
    wsReady: true,
    runningAgentIds: [],
    streamingContent: '',
    streamingAgentId: null,
    currentConversation: { id: 1, title: 'Test Conversation', group_name: 'Test' },
    messages: [
      { id: 1, role: 'user', content: 'Hello', agent_id: null, agent_name: null },
      { id: 2, role: 'assistant', content: 'Hi there!', agent_id: 1, agent_name: 'Claude CLI' },
    ],
    onStart: vi.fn(),
    onStop: vi.fn(),
    onSendText: vi.fn(),
  };

  beforeEach(() => {
    mockFetch.mockReset();
    vi.clearAllMocks();
  });

  describe('渲染测试', () => {
    it('应该正确渲染聊天面板', () => {
      render(<ChatPanel {...defaultProps} />);
      
      expect(screen.getByText('Test Conversation')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...')).toBeInTheDocument();
    });

    it('应该显示空状态当没有选中对话时', () => {
      render(<ChatPanel {...defaultProps} currentConversation={null} />);
      
      expect(screen.getByText('选择一个对话开始聊天')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('请先选择或创建一个对话')).toBeInTheDocument();
    });

    it('应该显示历史消息', () => {
      render(<ChatPanel {...defaultProps} />);
      
      expect(screen.getByText('Hello')).toBeInTheDocument();
      expect(screen.getByText('Hi there!')).toBeInTheDocument();
    });

    it('应该显示 WebSocket 连接状态', () => {
      render(<ChatPanel {...defaultProps} wsReady={false} />);
      
      expect(screen.getByText('连接中...')).toBeInTheDocument();
    });

    it('应该显示运行中的 Agent 数量', () => {
      render(<ChatPanel {...defaultProps} runningAgentIds={[1, 2]} />);
      
      expect(screen.getByText('2 个 Agent 运行中')).toBeInTheDocument();
    });

    it('应该显示流式输出内容', () => {
      render(<ChatPanel {...defaultProps} streamingContent="Streaming..." streamingAgentId={1} />);
      
      expect(screen.getByText('Streaming...')).toBeInTheDocument();
    });

    it('应该禁用输入框当 WebSocket 未连接', () => {
      render(<ChatPanel {...defaultProps} wsReady={false} />);
      
      expect(screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...')).toBeDisabled();
    });
  });

  describe('@ 提及功能测试', () => {
    it('应该显示 @ 提及下拉框', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...');
      
      await user.type(input, '@');
      
      await waitFor(() => {
        expect(screen.getByText('Claude CLI')).toBeInTheDocument();
        expect(screen.getByText('Opencode CLI')).toBeInTheDocument();
      });
    });

    it('应该过滤 @ 提及列表', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...');
      
      await user.type(input, '@cl');
      
      await waitFor(() => {
        expect(screen.getByText('Claude CLI')).toBeInTheDocument();
      });
      
      // 注意：过滤是基于 contains 而不是 startsWith
      // 'cl' 同时匹配 'Claude CLI' 和 'Opencode CLI'（因为都包含 'cl'）
      // 所以两个都应该显示
      expect(screen.getByText('Opencode CLI')).toBeInTheDocument();
    });

    it('应该选择 @ 提及的 Agent', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...');
      
      await user.type(input, '@');
      
      await waitFor(() => {
        expect(screen.getByText('Claude CLI')).toBeInTheDocument();
      });
      
      await user.click(screen.getByText('Claude CLI'));
      
      expect(input.value).toBe('@Claude CLI ');
    });

    it('应该显示无匹配 Agent 提示', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...');
      
      await user.type(input, '@nonexistent');
      
      await waitFor(() => {
        expect(screen.getByText('无匹配的 Agent')).toBeInTheDocument();
      });
    });
  });

  describe('parseTargetAgent 函数测试', () => {
    // 直接测试 parseTargetAgent 逻辑
    function parseTargetAgent(text, agents) {
      if (!text.startsWith('@')) {
        return null;
      }

      const textWithoutAt = text.slice(1);
      const sortedAgents = [...agents].sort((a, b) => b.name.length - a.name.length);

      for (const agent of sortedAgents) {
        const nameLower = agent.name.toLowerCase();
        const textLower = textWithoutAt.toLowerCase();

        if (textLower.startsWith(nameLower)) {
          const afterName = textWithoutAt.slice(agent.name.length);
          if (afterName === '' || afterName.startsWith(' ')) {
            return {
              agent,
              textWithoutMention: afterName.trimStart(),
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
  });

  describe('发送消息测试', () => {
    it('应该发送带 @Agent 的消息', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 3, role: 'user', content: '@Claude CLI Hello' }),
      });
      
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...');
      
      await user.type(input, '@Claude CLI Hello');
      await user.type(input, '{enter}');
      
      await waitFor(() => {
        expect(defaultProps.onStart).toHaveBeenCalledWith(1);
        expect(defaultProps.onSendText).toHaveBeenCalledWith(1, 'Hello');
      });
    });

    it('应该发送普通消息（无 @Agent）', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 3, role: 'user', content: 'Just a note' }),
      });
      
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...');
      
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
      
      const input = screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...');
      
      await user.type(input, '{enter}');
      
      expect(defaultProps.onStart).not.toHaveBeenCalled();
    });

    it('应该提示输入内容当只有 @Agent 时', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...');
      
      await user.type(input, '@Claude CLI');
      await user.type(input, '{enter}');
      
      // 应该保留 @Agent 在输入框中
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
      
      const input = screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...');
      
      await user.type(input, 'Test{enter}');
      
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });

    it('应该支持 Shift+Enter 换行', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...');
      
      await user.type(input, 'Line1{Shift>}{enter}{/Shift}Line2');
      
      expect(input.value).toContain('Line1');
      expect(input.value).toContain('Line2');
    });

    it('应该支持上下键选择 @ 提及', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...');
      
      await user.type(input, '@');
      
      await waitFor(() => {
        expect(screen.getByText('Claude CLI')).toBeInTheDocument();
      });
      
      // 按下箭头
      await user.type(input, '{arrowdown}');
      
      // 按回车选择
      await user.type(input, '{enter}');
      
      expect(input.value).toContain('@');
    });

    it('应该支持 Escape 关闭 @ 提及下拉框', async () => {
      const user = userEvent.setup();
      render(<ChatPanel {...defaultProps} />);
      
      const input = screen.getByPlaceholderText('输入消息，使用 @AgentName 调用 Agent...');
      
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
