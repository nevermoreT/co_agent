import { useState, useEffect, useCallback } from 'react';

const API = '/api';

export function useAgents() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/agents`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setAgents(Array.isArray(data) ? data : []);
    } catch (e) {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { agents, loading, refetch };
}
