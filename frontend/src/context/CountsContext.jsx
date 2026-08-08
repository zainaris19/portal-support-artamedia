import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const CountsContext = createContext({ counts: null, refresh: () => {} });

export function CountsProvider({ children }) {
  const { user } = useAuth();
  const [counts, setCounts] = useState(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try { const { data } = await api.get('/counts'); setCounts(data); } catch {}
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  return <CountsContext.Provider value={{ counts, refresh }}>{children}</CountsContext.Provider>;
}

export const useCounts = () => useContext(CountsContext);
