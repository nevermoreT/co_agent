import { useState, useEffect, useCallback } from 'react';
import { messageApi } from '../services/api.js';
import { safeAsync } from '../utils/errorHandler.js';

export function useMessages(agentId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (agentId == null) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await safeAsync(
      () => messageApi.listByAgent(agentId, 100),
      'useMessages.refetch',
      []
    );
    setMessages(Array.isArray(result) ? result : []);
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { messages, loading, refetch };
}