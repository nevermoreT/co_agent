import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWs } from '../../client/hooks/useWs.js';

// Mock WebSocket
class MockWebSocket {
  static readyStates = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3
  };

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.readyStates.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    this.sentMessages = [];
    
    // Simulate connection
    setTimeout(() => {
      this.readyState = MockWebSocket.readyStates.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(data) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.readyStates.CLOSED;
    this.onclose?.();
  }

  // Helper for testing
  simulateMessage(data) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  simulateError() {
    this.onerror?.();
  }

  simulateClose() {
    this.readyState = MockWebSocket.readyStates.CLOSED;
    this.onclose?.();
  }
}

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    protocol: 'http:',
    host: 'localhost:5173',
    port: '5173'
  },
  writable: true
});

// Mock logger
vi.mock('../../client/utils/logger.js', () => ({
  default: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('useWs Hook', () => {
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = global.WebSocket;
    global.WebSocket = MockWebSocket;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
  });

  describe('WebSocket Connection', () => {
    it('should establish WebSocket connection on mount', () => {
      const { result } = renderHook(() => useWs());

      expect(result.current.ready).toBe(false);
      
      // Wait for connection
      act(() => {
        vi.advanceTimersByTime(0);
      });

      expect(result.current.ready).toBe(true);
      expect(result.current.ws).toBeInstanceOf(MockWebSocket);
    });

    it('should construct correct WebSocket URL for development port', () => {
      window.location.port = '5173';
      
      const { result } = renderHook(() => useWs());

      expect(result.current.ws.url).toBe('ws://localhost:3000/ws');
    });

    it('should construct correct WebSocket URL for production', () => {
      window.location.port = '80';
      window.location.protocol = 'https:';
      window.location.host = 'example.com:80';
      
      const { result } = renderHook(() => useWs());

      expect(result.current.ws.url).toBe('wss://example.com:80/ws');
    });

    it('should close connection on unmount', () => {
      const { result, unmount } = renderHook(() => useWs());

      act(() => {
        vi.advanceTimersByTime(0);
      });

      const ws = result.current.ws;
      expect(ws.readyState).toBe(MockWebSocket.readyStates.OPEN);

      act(() => {
        unmount();
      });

      expect(ws.readyState).toBe(MockWebSocket.readyStates.CLOSED);
    });

    it('should handle connection close and reconnect', () => {
      vi.useFakeTimers();
      
      const { result } = renderHook(() => useWs());

      act(() => {
        vi.advanceTimersByTime(0);
      });

      const ws = result.current.ws;
      
      act(() => {
        ws.simulateClose();
      });

      expect(result.current.ready).toBe(false);
      expect(result.current.runningAgentIds).toEqual([]);

      // Should attempt reconnection after 2 seconds
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.ready).toBe(true);
      
      vi.useRealTimers();
    });
  });

  describe('Message Handling', () => {
    it('should handle status messages', () => {
      const { result } = renderHook(() => useWs());

      act(() => {
        vi.advanceTimersByTime(0);
      });

      const statusMessage = {
        type: 'status',
        running: ['agent1', 'agent2']
      };

      act(() => {
        result.current.ws.simulateMessage(statusMessage);
      });

      expect(result.current.runningAgentIds).toEqual(['agent1', 'agent2']);
    });

    it('should handle started messages', () => {
      const { result } = renderHook(() => useWs());

      act(() => {
        vi.advanceTimersByTime(0);
      });

      const startedMessage = {
        type: 'started',
        agentId: 'agent3'
      };

      act(() => {
        result.current.ws.simulateMessage(startedMessage);
      });

      expect(result.current.runningAgentIds).toContain('agent3');
    });

    it('should handle exit messages', () => {
      const { result } = renderHook(() => useWs());
      const onExit = vi.fn();

      act(() => {
        vi.advanceTimersByTime(0);
      });

      result.current.ws.simulateMessage({ type: 'started', agentId: 'agent1' });

      const exitMessage = {
        type: 'exit',
        agentId: 'agent1',
        code: 0,
        signal: null
      };

      act(() => {
        result.current.ws.simulateMessage(exitMessage);
      });

      expect(result.current.runningAgentIds).not.toContain('agent1');
    });

    it('should handle stopped messages', () => {
      const { result } = renderHook(() => useWs());

      act(() => {
        vi.advanceTimersByTime(0);
      });

      result.current.ws.simulateMessage({ type: 'started', agentId: 'agent1' });

      const stoppedMessage = {
        type: 'stopped',
        agentId: 'agent1',
        ok: true
      };

      act(() => {
        result.current.ws.simulateMessage(stoppedMessage);
      });

      expect(result.current.runningAgentIds).not.toContain('agent1');
    });

    it('should handle output messages', () => {
      const { result } = renderHook(() => useWs());
      const onOutput = vi.fn();

      renderHook(() => useWs({ onOutput }));

      act(() => {
        vi.advanceTimersByTime(0);
      });

      const outputMessage = {
        type: 'output',
        agentId: 'agent1',
        stream: 'stdout',
        data: 'Hello World'
      };

      act(() => {
        result.current.ws.simulateMessage(outputMessage);
      });

      expect(onOutput).toHaveBeenCalledWith('agent1', 'stdout', 'Hello World', null);
    });

    it('should handle tool_use messages', () => {
      const { result } = renderHook(() => useWs());
      const onToolUse = vi.fn();

      renderHook(() => useWs({ onToolUse }));

      act(() => {
        vi.advanceTimersByTime(0);
      });

      const toolUseMessage = {
        type: 'tool_use',
        agentId: 'agent1',
        tool: 'test_tool',
        title: 'Test Tool',
        status: 'completed',
        input: { param: 'value' },
        output: 'Result',
        callID: 'call123'
      };

      act(() => {
        result.current.ws.simulateMessage(toolUseMessage);
      });

      expect(onToolUse).toHaveBeenCalledWith('agent1', {
        tool: 'test_tool',
        title: 'Test Tool',
        status: 'completed',
        input: { param: 'value' },
        output: 'Result',
        callID: 'call123'
      }, null);
    });

    it('should handle error messages', () => {
      const { result } = renderHook(() => useWs());
      const onError = vi.fn();

      renderHook(() => useWs({ onError }));

      act(() => {
        vi.advanceTimersByTime(0);
      });

      const errorMessage = {
        type: 'error',
        message: 'Something went wrong'
      };

      act(() => {
        result.current.ws.simulateMessage(errorMessage);
      });

      expect(result.current.lastError).toBe('Something went wrong');
      expect(onError).toHaveBeenCalled();
    });

    it('should handle malformed messages', () => {
      const { result } = renderHook(() => useWs());

      act(() => {
        vi.advanceTimersByTime(0);
      });

      act(() => {
        result.current.ws.simulateMessage('invalid json');
      });

      expect(result.current.lastError).toBeTruthy();
    });

    it('should extract conversationId from messages', () => {
      const { result } = renderHook(() => useWs());
      const onOutput = vi.fn();

      renderHook(() => useWs({ onOutput }));

      act(() => {
        vi.advanceTimersByTime(0);
      });

      const messageWithConversationId = {
        type: 'output',
        agentId: 'agent1',
        stream: 'stdout',
        data: 'Hello',
        conversationId: '123'
      };

      act(() => {
        result.current.ws.simulateMessage(messageWithConversationId);
      });

      expect(onOutput).toHaveBeenCalledWith('agent1', 'stdout', 'Hello', 123);
    });
  });

  describe('Sending Messages', () => {
    it('should send messages when ready', () => {
      const { result } = renderHook(() => useWs());

      act(() => {
        vi.advanceTimersByTime(0);
      });

      const payload = { action: 'test', data: 'example' };

      act(() => {
        result.current.send(payload);
      });

      expect(result.current.ws.sentMessages).toContain(JSON.stringify(payload));
    });

    it('should not send messages when not ready', () => {
      const { result } = renderHook(() => useWs());

      // Don't wait for connection
      const payload = { action: 'test', data: 'example' };

      act(() => {
        result.current.send(payload);
      });

      expect(result.current.ws.sentMessages).not.toContain(JSON.stringify(payload));
    });

    it('should provide convenience methods', () => {
      const { result } = renderHook(() => useWs());

      act(() => {
        vi.advanceTimersByTime(0);
      });

      act(() => {
        result.current.sendStart('agent1');
      });

      expect(result.current.ws.sentMessages).toContain(
        JSON.stringify({ action: 'start', agentId: 'agent1' })
      );

      act(() => {
        result.current.sendStop('agent1');
      });

      expect(result.current.ws.sentMessages).toContain(
        JSON.stringify({ action: 'stop', agentId: 'agent1' })
      );

      act(() => {
        result.current.sendText('agent1', 'Hello', '123');
      });

      expect(result.current.ws.sentMessages).toContain(
        JSON.stringify({ action: 'send', agentId: 'agent1', text: 'Hello', conversationId: '123' })
      );
    });
  });

  describe('Error Handling', () => {
    it('should clear error state', () => {
      const { result } = renderHook(() => useWs());

      act(() => {
        vi.advanceTimersByTime(0);
      });

      const errorMessage = { type: 'error', message: 'Test error' };
      
      act(() => {
        result.current.ws.simulateMessage(errorMessage);
      });

      expect(result.current.lastError).toBe('Test error');

      act(() => {
        result.current.clearError();
      });

      expect(result.current.lastError).toBe(null);
    });

    it('should handle WebSocket errors', () => {
      const { result } = renderHook(() => useWs());

      act(() => {
        vi.advanceTimersByTime(0);
      });

      act(() => {
        result.current.ws.simulateError();
      });

      // Should not crash and should maintain connection
      expect(result.current.ready).toBe(true);
    });
  });

  describe('Callback Updates', () => {
    it('should update callbacks when they change', () => {
      const { result, rerender } = renderHook(
        ({ onOutput }) => useWs({ onOutput }),
        { initialProps: { onOutput: vi.fn() } }
      );

      act(() => {
        vi.advanceTimersByTime(0);
      });

      const newOnOutput = vi.fn();
      
      rerender({ onOutput: newOnOutput });

      const outputMessage = {
        type: 'output',
        agentId: 'agent1',
        stream: 'stdout',
        data: 'Hello'
      };

      act(() => {
        result.current.ws.simulateMessage(outputMessage);
      });

      expect(newOnOutput).toHaveBeenCalledWith('agent1', 'stdout', 'Hello', null);
    });
  });

  describe('Reconnection Logic', () => {
    it('should cancel reconnection on unmount', () => {
      vi.useFakeTimers();
      
      const { result, unmount } = renderHook(() => useWs());

      act(() => {
        vi.advanceTimersByTime(0);
      });

      act(() => {
        result.current.ws.simulateClose();
      });

      // Unmount before reconnection happens
      act(() => {
        unmount();
      });

      // Should not reconnect
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.ready).toBe(false);
      
      vi.useRealTimers();
    });
  });

  describe('Agent State Management', () => {
    it('should not duplicate running agents', () => {
      const { result } = renderHook(() => useWs());

      act(() => {
        vi.advanceTimersByTime(0);
      });

      // Start same agent twice
      act(() => {
        result.current.ws.simulateMessage({ type: 'started', agentId: 'agent1' });
        result.current.ws.simulateMessage({ type: 'started', agentId: 'agent1' });
      });

      expect(result.current.runningAgentIds).toEqual(['agent1']);
    });

    it('should handle multiple agents', () => {
      const { result } = renderHook(() => useWs());

      act(() => {
        vi.advanceTimersByTime(0);
      });

      act(() => {
        result.current.ws.simulateMessage({ type: 'started', agentId: 'agent1' });
        result.current.ws.simulateMessage({ type: 'started', agentId: 'agent2' });
        result.current.ws.simulateMessage({ type: 'started', agentId: 'agent3' });
      });

      expect(result.current.runningAgentIds).toEqual(['agent1', 'agent2', 'agent3']);

      act(() => {
        result.current.ws.simulateMessage({ type: 'exit', agentId: 'agent2' });
      });

      expect(result.current.runningAgentIds).toEqual(['agent1', 'agent3']);
    });
  });
});