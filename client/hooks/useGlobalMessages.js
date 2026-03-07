import { useState, useEffect, useCallback } from 'react';

const API = '/api';

export function useGlobalMessages(conversationId = null) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const url = conversationId 
        ? `${API}/messages?conversation_id=${conversationId}&limit=200`
        : `${API}/messages?limit=200`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const addMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  return { messages, loading, refetch, addMessage, setMessages };
}
