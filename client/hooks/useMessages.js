import { useState, useEffect, useCallback } from 'react';

const API = '/api';

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
    try {
      const res = await fetch(`${API}/agents/${agentId}/messages?limit=100`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const addMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  return { messages, loading, refetch, addMessage };
}
