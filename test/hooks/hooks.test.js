/**
 * React Hooks 单元测试
 * 测试 useAgents、useTasks、useGlobalMessages 等 hooks
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAgents } from '../../client/hooks/useAgents';
import { useTasks } from '../../client/hooks/useTasks';
import { useGlobalMessages } from '../../client/hooks/useGlobalMessages';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('React Hooks 测试', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('useAgents', () => {
    it('应该初始时 loading 为 true', () => {
      mockFetch.mockImplementation(() => new Promise(() => {})); // 永不 resolve
      
      const { result } = renderHook(() => useAgents());
      
      expect(result.current.loading).toBe(true);
      expect(result.current.agents).toEqual([]);
    });

    it('应该成功获取 agents', async () => {
      const mockAgents = [
        { id: 1, name: 'Claude CLI' },
        { id: 2, name: 'Opencode CLI' },
      ];
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAgents),
      });
      
      const { result } = renderHook(() => useAgents());
      
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      
      expect(result.current.agents).toEqual(mockAgents);
    });

    it('应该处理 fetch 错误', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      
      const { result } = renderHook(() => useAgents());
      
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      
      expect(result.current.agents).toEqual([]);
    });

    it('应该处理非数组响应', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ error: 'not an array' }),
      });
      
      const { result } = renderHook(() => useAgents());
      
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      
      expect(result.current.agents).toEqual([]);
    });

    it('refetch 应该重新获取数据', async () => {
      const mockAgents1 = [{ id: 1, name: 'Agent 1' }];
      const mockAgents2 = [{ id: 1, name: 'Agent 1' }, { id: 2, name: 'Agent 2' }];
      
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockAgents1),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockAgents2),
        });
      
      const { result } = renderHook(() => useAgents());
      
      await waitFor(() => {
        expect(result.current.agents).toEqual(mockAgents1);
      });
      
      await act(async () => {
        await result.current.refetch();
      });
      
      expect(result.current.agents).toEqual(mockAgents2);
    });
  });

  describe('useTasks', () => {
    it('应该成功获取 tasks', async () => {
      const mockTasks = [
        { id: 1, title: 'Task 1', status: 'pending' },
        { id: 2, title: 'Task 2', status: 'doing' },
      ];
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTasks),
      });
      
      const { result } = renderHook(() => useTasks());
      
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      
      expect(result.current.tasks).toEqual(mockTasks);
    });

    it('应该处理空任务列表', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });
      
      const { result } = renderHook(() => useTasks());
      
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      
      expect(result.current.tasks).toEqual([]);
    });
  });

  describe('useGlobalMessages', () => {
    it('应该成功获取全局消息', async () => {
      const mockMessages = [
        { id: 1, role: 'user', content: 'Hello' },
        { id: 2, role: 'assistant', content: 'Hi!' },
      ];
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMessages),
      });
      
      const { result } = renderHook(() => useGlobalMessages());
      
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      
      expect(result.current.messages).toEqual(mockMessages);
    });

    it('addMessage 应该添加消息到列表', async () => {
      const mockMessages = [{ id: 1, role: 'user', content: 'Hello' }];
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMessages),
      });
      
      const { result } = renderHook(() => useGlobalMessages());
      
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      
      const newMessage = { id: 2, role: 'assistant', content: 'Hi!' };
      
      act(() => {
        result.current.addMessage(newMessage);
      });
      
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[1]).toEqual(newMessage);
    });

    it('setMessages 应该替换消息列表', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });
      
      const { result } = renderHook(() => useGlobalMessages());
      
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      
      const newMessages = [
        { id: 1, role: 'user', content: 'New message' },
      ];
      
      act(() => {
        result.current.setMessages(newMessages);
      });
      
      expect(result.current.messages).toEqual(newMessages);
    });
  });
});
