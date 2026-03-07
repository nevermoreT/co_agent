import { useState, useEffect, useCallback } from 'react';
import { agentApi } from '../services/api.js';
import { safeAsync } from '../utils/errorHandler.js';

export function useAgents() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const result = await safeAsync(
      () => agentApi.list(),
      'useAgents.refetch',
      []
    );
    setAgents(Array.isArray(result) ? result : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { agents, loading, refetch };
}