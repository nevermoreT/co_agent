import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgents } from '../../client/hooks/useAgents.js';
import fetch from 'node-fetch';

// Mock fetch
vi.mock('node-fetch');

describe('useAgents Hook', () => {
  const mockAgents = [
    { id: 1, name: 'Agent 1', cli_command: 'node test1.js' },
    { id: 2, name: 'Agent 2', cli_command: 'python test2.py' }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    fetch.mockClear();
  });

  describe('Initial Loading', () => {
    it('should start in loading state', () => {
      fetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useAgents());

      expect(result.current.loading).toBe(true);
      expect(result.current.agents).toEqual([]);
    });

    it('should fetch agents on mount', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAgents)
      });

      const { result } = renderHook(() => useAgents());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(fetch).toHaveBeenCalledWith('/api/agents');
      expect(result.current.agents).toEqual(mockAgents);
    });

    it('should handle non-array response data', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ error: 'Invalid data' })
      });

      const { result } = renderHook(() => useAgents());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.agents).toEqual([]);
    });

    it('should handle fetch errors gracefully', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useAgents());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.agents).toEqual([]);
    });

    it('should handle HTTP errors', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found'
      });

      const { result } = renderHook(() => useAgents());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.agents).toEqual([]);
    });
  });

  describe('Refetch Functionality', () => {
    it('should provide refetch function', () => {
      fetch.mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() => useAgents());

      expect(typeof result.current.refetch).toBe('function');
    });

    it('should refetch agents when refetch is called', async () => {
      // Initial fetch
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAgents)
      });

      const { result } = renderHook(() => useAgents());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Refetch with different data
      const updatedAgents = [...mockAgents, { id: 3, name: 'Agent 3', cli_command: 'node test3.js' }];
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updatedAgents)
      });

      act(() => {
        result.current.refetch();
      });

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.agents).toEqual(updatedAgents);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle refetch errors', async () => {
      // Initial successful fetch
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAgents)
      });

      const { result } = renderHook(() => useAgents());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Refetch error
      fetch.mockRejectedValueOnce(new Error('Network error'));

      act(() => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.agents).toEqual([]);
    });
  });

  describe('Data Integrity', () => {
    it('should return empty array when response is null', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(null)
      });

      const { result } = renderHook(() => useAgents());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.agents).toEqual([]);
    });

    it('should return empty array when response is undefined', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(undefined)
      });

      const { result } = renderHook(() => useAgents());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.agents).toEqual([]);
    });

    it('should handle empty response array', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([])
      });

      const { result } = renderHook(() => useAgents());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.agents).toEqual([]);
    });

    it('should preserve agent data structure', async () => {
      const complexAgent = {
        id: 1,
        name: 'Complex Agent',
        cli_command: 'node complex.js',
        cli_cwd: '/path/to/dir',
        role: 'developer',
        responsibilities: ['coding', 'testing'],
        system_prompt: 'You are a helpful assistant',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T01:00:00.000Z'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([complexAgent])
      });

      const { result } = renderHook(() => useAgents());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.agents).toEqual([complexAgent]);
    });
  });

  describe('Loading State Management', () => {
    it('should set loading to true during refetch', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAgents)
      });

      const { result } = renderHook(() => useAgents());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Mock a slow refetch
      fetch.mockImplementationOnce(() => new Promise(resolve => {
        setTimeout(() => resolve({
          ok: true,
          json: () => Promise.resolve(mockAgents)
        }), 100);
      }));

      act(() => {
        result.current.refetch();
      });

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should set loading to false even on error', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAgents)
      });

      const { result } = renderHook(() => useAgents());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      fetch.mockRejectedValueOnce(new Error('Network error'));

      act(() => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.agents).toEqual([]);
    });
  });

  describe('Return Value Consistency', () => {
    it('should always return agents, loading, and refetch', () => {
      fetch.mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() => useAgents());

      expect(result.current).toHaveProperty('agents');
      expect(result.current).toHaveProperty('loading');
      expect(result.current).toHaveProperty('refetch');
      expect(Array.isArray(result.current.agents)).toBe(true);
      expect(typeof result.current.loading).toBe('boolean');
      expect(typeof result.current.refetch).toBe('function');
    });

    it('should maintain same refetch function reference', () => {
      fetch.mockImplementation(() => new Promise(() => {}));

      const { result, rerender } = renderHook(() => useAgents());

      const initialRefetch = result.current.refetch;

      rerender();

      expect(result.current.refetch).toBe(initialRefetch);
    });
  });

  describe('API Endpoint', () => {
    it('should call correct API endpoint', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAgents)
      });

      renderHook(() => useAgents());

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/agents');
      });
    });
  });
});

// Helper function for act() in tests
function act(callback) {
  callback();
}