import { useState, useEffect, useCallback } from 'react';
import { taskApi } from '../services/api.js';
import { safeAsync } from '../utils/errorHandler.js';

export function useTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const result = await safeAsync(
      () => taskApi.list(),
      'useTasks.refetch',
      []
    );
    setTasks(Array.isArray(result) ? result : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { tasks, loading, refetch };
}