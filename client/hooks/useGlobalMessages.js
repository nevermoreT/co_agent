import { useState, useEffect, useCallback } from 'react';

const API = '/api';

export function useGlobalMessages() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/messages?limit=200`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch (e) {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const addMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  return { messages, loading, refetch, addMessage, setMessages };
}
