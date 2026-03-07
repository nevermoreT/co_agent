import { useState, useEffect, useCallback } from 'react';
import { messageApi } from '../services/api.js';
import { safeAsync } from '../utils/errorHandler.js';

export function useGlobalMessages(conversationId = null) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    const result = await safeAsync(
      () => messageApi.list(conversationId, 200),
      'useGlobalMessages.refetch',
      []
    );
    setMessages(Array.isArray(result) ? result : []);
    setLoading(false);
  }, [conversationId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const addMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  return { messages, loading, refetch, addMessage, setMessages };
}