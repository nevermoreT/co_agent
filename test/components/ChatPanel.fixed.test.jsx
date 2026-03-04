/**
 * ChatPanel 组件测试 - 修复版本
 * 修复了 DOM API mock 和 React Testing Library 兼容性问题
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatPanel from '../../client/components/ChatPanel';

// Mock DOM APIs
beforeEach(() => {
  // Mock scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
  
  // Mock IntersectionObserver if used
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    disconnect: vi.fn(),
    unobserve: vi.fn(),
  }));
  
  // Mock ResizeObserver if used
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    disconnect: vi.fn(),
    unobserve: vi.fn(),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('ChatPanel 组件测试 - 修复版', () => {
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

  it('should render chat panel correctly', () => {
    const { container } = render(<ChatPanel {...defaultProps} />);
    
    expect(screen.getByText('Test Conversation')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
    expect(container.querySelector('.chat-panel')).toBeInTheDocument();
  });

  it('should send message with @Agent mention', async () => {
    const user = userEvent.setup();
    const mockOnSendText = vi.fn();
    
    render(<ChatPanel {...defaultProps} onSendText={mockOnSendText} />);
    
    const input = screen.getByPlaceholderText(/输入消息/i);
    const sendButton = screen.getByRole('button', { name: /发送/i });
    
    // Type @Claude CLI and then the message
    await act(async () => {
      await user.type(input, '@Claude CLI Test message');
      await user.click(sendButton);
    });
    
    await waitFor(() => {
      expect(mockOnSendText).toHaveBeenCalledWith({
        text: '@Claude CLI Test message',
        conversationId: 1,
      });
    });
  });

  it('should show mention dropdown when typing @', async () => {
    const user = userEvent.setup();
    
    render(<ChatPanel {...defaultProps} />);
    
    const input = screen.getByPlaceholderText(/输入消息/i);
    
    await act(async () => {
      await user.type(input, '@');
    });
    
    await waitFor(() => {
      expect(screen.getByText('Claude CLI')).toBeInTheDocument();
      expect(screen.getByText('Opencode CLI')).toBeInTheDocument();
    });
  });

  it('should filter mentions by query', async () => {
    const user = userEvent.setup();
    
    render(<ChatPanel {...defaultProps} />);
    
    const input = screen.getByPlaceholderText(/输入消息/i);
    
    await act(async () => {
      await user.type(input, '@Claude');
    });
    
    await waitFor(() => {
      expect(screen.getByText('Claude CLI')).toBeInTheDocument();
      expect(screen.queryByText('Opencode CLI')).not.toBeInTheDocument();
    });
  });

  it('should disable input when WebSocket is not ready', () => {
    render(<ChatPanel {...defaultProps} wsReady={false} />);
    
    const input = screen.getByPlaceholderText(/输入消息/i);
    const sendButton = screen.getByRole('button', { name: /发送/i });
    
    expect(input).toBeDisabled();
    expect(sendButton).toBeDisabled();
  });

  it('should show stop button when agent is running', () => {
    render(<ChatPanel {...defaultProps} runningAgentIds={[1]} />);
    
    const stopButton = screen.getByRole('button', { name: /停止/i });
    expect(stopButton).toBeInTheDocument();
  });

  it('should handle keyboard shortcuts', async () => {
    const user = userEvent.setup();
    const mockOnSendText = vi.fn();
    
    render(<ChatPanel {...defaultProps} onSendText={mockOnSendText} />);
    
    const input = screen.getByPlaceholderText(/输入消息/i);
    
    // Enter to send
    await act(async () => {
      await user.type(input, 'Test message{enter}');
    });
    
    await waitFor(() => {
      expect(mockOnSendText).toHaveBeenCalledWith({
        text: 'Test message',
        conversationId: 1,
      });
    });
    
    // Shift+Enter for new line
    await act(async () => {
      await user.clear(input);
      await user.type(input, 'Line 1{Shift>}{enter}{/Shift}Line 2{enter}');
    });
    
    await waitFor(() => {
      expect(mockOnSendText).toHaveBeenCalledWith({
        text: 'Line 1\nLine 2',
        conversationId: 1,
      });
    });
  });

  it('should not send empty messages', async () => {
    const user = userEvent.setup();
    const mockOnSendText = vi.fn();
    
    render(<ChatPanel {...defaultProps} onSendText={mockOnSendText} />);
    
    const input = screen.getByPlaceholderText(/输入消息/i);
    const sendButton = screen.getByRole('button', { name: /发送/i });
    
    await act(async () => {
      await user.clear(input);
      await user.click(sendButton);
    });
    
    expect(mockOnSendText).not.toHaveBeenCalled();
  });

  it('should show message when only @Agent is typed', async () => {
    const user = userEvent.setup();
    
    render(<ChatPanel {...defaultProps} />);
    
    const input = screen.getByPlaceholderText(/输入消息/i);
    
    await act(async () => {
      await user.type(input, '@Claude CLI');
      await user.keyboard('{enter}');
    });
    
    await waitFor(() => {
      expect(screen.getByText(/请输入消息内容/i)).toBeInTheDocument();
    });
  });
});