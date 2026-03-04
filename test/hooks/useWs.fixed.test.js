/**
 * useWs Hook 测试 - 修复版本
 * 修复了 WebSocket mock 和 React act() 包装问题
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWs } from '../../client/hooks/useWs.js';

// WebSocket Mock
export class MockWebSocket {
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
    
    // Simulate connection after a short delay
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

  // Helper methods for testing
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

// WebSocket mock cleanup
beforeEach(() => {
  global.WebSocket = MockWebSocket;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWs Hook - 修复版', () => {
  const defaultProps = {
    onMessage: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
    onOpen: vi.fn(),
  };

  it('should establish WebSocket connection on mount', async () => {
    const { result } = renderHook(() => useWs(defaultProps));
    
    expect(result.current.ready).toBe(false);
    
    await act(async () => {
      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    
    expect(result.current.ready).toBe(true);
    expect(defaultProps.onOpen).toHaveBeenCalled();
  });

  it('should construct correct WebSocket URL for development port', () => {
    delete process.env.NODE_ENV;
    const { result } = renderHook(() => useWs(defaultProps));
    
    expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost:3000/ws');
  });

  it('should construct correct WebSocket URL for production', () => {
    process.env.NODE_ENV = 'production';
    const { result } = renderHook(() => useWs(defaultProps));
    
    expect(global.WebSocket).toHaveBeenCalledWith(`ws://${window.location.host}/ws`);
    
    delete process.env.NODE_ENV;
  });

  it('should close connection on unmount', () => {
    const { unmount } = renderHook(() => useWs(defaultProps));
    
    const wsInstance = global.WebSocket.mock.instances[0];
    const closeSpy = vi.spyOn(wsInstance, 'close');
    
    unmount();
    
    expect(closeSpy).toHaveBeenCalled();
  });

  it('should handle connection close and reconnect', async () => {
    const { result } = renderHook(() => useWs(defaultProps));
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    
    const wsInstance = global.WebSocket.mock.instances[0];
    
    // Simulate connection close
    await act(async () => {
      wsInstance.simulateClose();
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    
    // Should attempt to reconnect
    expect(global.WebSocket).toHaveBeenCalledTimes(2);
  });

  it('should handle output messages', async () => {
    const { result } = renderHook(() => useWs(defaultProps));
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    
    const wsInstance = global.WebSocket.mock.instances[0];
    const testMessage = {
      type: 'output',
      agentId: 'agent1',
      stream: 'stdout',
      data: 'Hello world'
    };
    
    await act(async () => {
      wsInstance.simulateMessage(testMessage);
    });
    
    expect(defaultProps.onMessage).toHaveBeenCalledWith(testMessage);
  });

  it('should handle tool_use messages', async () => {
    const { result } = renderHook(() => useWs(defaultProps));
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    
    const wsInstance = global.WebSocket.mock.instances[0];
    const testMessage = {
      type: 'tool_use',
      agentId: 'agent1',
      tool: 'bash',
      title: 'Run command',
      status: 'completed',
      input: 'echo hello',
      output: 'hello',
      callID: 'call123'
    };
    
    await act(async () => {
      wsInstance.simulateMessage(testMessage);
    });
    
    expect(defaultProps.onMessage).toHaveBeenCalledWith(testMessage);
  });

  it('should handle error messages', async () => {
    const { result } = renderHook(() => useWs(defaultProps));
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    
    const wsInstance = global.WebSocket.mock.instances[0];
    const testMessage = {
      type: 'error',
      agentId: 'agent1',
      message: 'Something went wrong'
    };
    
    await act(async () => {
      wsInstance.simulateMessage(testMessage);
    });
    
    expect(defaultProps.onMessage).toHaveBeenCalledWith(testMessage);
  });

  it('should extract conversationId from messages', async () => {
    const { result } = renderHook(() => useWs(defaultProps));
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    
    const wsInstance = global.WebSocket.mock.instances[0];
    const testMessage = {
      type: 'output',
      agentId: 'agent1',
      conversationId: 'conv123',
      data: 'Hello'
    };
    
    await act(async () => {
      wsInstance.simulateMessage(testMessage);
    });
    
    expect(defaultProps.onMessage).toHaveBeenCalledWith(testMessage);
  });

  it('should send messages when ready', async () => {
    const { result } = renderHook(() => useWs(defaultProps));
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    
    const testMessage = {
      action: 'send',
      agentId: 'agent1',
      text: 'Hello',
      conversationId: 'conv123'
    };
    
    await act(async () => {
      result.current.send(testMessage);
    });
    
    const wsInstance = global.WebSocket.mock.instances[0];
    expect(wsInstance.sentMessages).toContain(JSON.stringify(testMessage));
  });

  it('should not send messages when not ready', () => {
    const { result } = renderHook(() => useWs(defaultProps));
    
    const testMessage = {
      action: 'send',
      agentId: 'agent1',
      text: 'Hello',
      conversationId: 'conv123'
    };
    
    result.current.send(testMessage);
    
    const wsInstance = global.WebSocket.mock.instances[0];
    expect(wsInstance.sentMessages).not.toContain(JSON.stringify(testMessage));
  });

  it('should provide convenience methods', async () => {
    const { result } = renderHook(() => useWs(defaultProps));
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    
    // Test start method
    await act(async () => {
      result.current.start('agent1', 'node server.js', 'conv123');
    });
    
    const wsInstance = global.WebSocket.mock.instances[0];
    expect(wsInstance.sentMessages).toContain(JSON.stringify({
      action: 'start',
      agentId: 'agent1',
      text: 'node server.js',
      conversationId: 'conv123'
    }));
    
    // Test stop method
    await act(async () => {
      result.current.stop('agent1');
    });
    
    expect(wsInstance.sentMessages).toContain(JSON.stringify({
      action: 'stop',
      agentId: 'agent1'
    }));
  });

  it('should clear error state', async () => {
    const { result } = renderHook(() => useWs(defaultProps));
    
    // Simulate error
    const wsInstance = global.WebSocket.mock.instances[0];
    await act(async () => {
      wsInstance.simulateError();
    });
    
    expect(result.current.error).toBeTruthy();
    
    // Clear error
    await act(async () => {
      result.current.clearError();
    });
    
    expect(result.current.error).toBeNull();
  });

  it('should handle WebSocket errors', async () => {
    const { result } = renderHook(() => useWs(defaultProps));
    
    const wsInstance = global.WebSocket.mock.instances[0];
    
    await act(async () => {
      wsInstance.simulateError();
    });
    
    expect(result.current.error).toBeTruthy();
    expect(defaultProps.onError).toHaveBeenCalled();
  });

  it('should update callbacks when they change', async () => {
    const onMessage1 = vi.fn();
    const onMessage2 = vi.fn();
    
    const { rerender } = renderHook(
      ({ onMessage }) => useWs({ ...defaultProps, onMessage }),
      { initialProps: { onMessage: onMessage1 } }
    );
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    
    const wsInstance = global.WebSocket.mock.instances[0];
    const testMessage = { type: 'output', data: 'test' };
    
    await act(async () => {
      wsInstance.simulateMessage(testMessage);
    });
    
    expect(onMessage1).toHaveBeenCalledWith(testMessage);
    
    // Update callback
    rerender({ onMessage: onMessage2 });
    
    await act(async () => {
      wsInstance.simulateMessage(testMessage);
    });
    
    expect(onMessage2).toHaveBeenCalledWith(testMessage);
  });
});