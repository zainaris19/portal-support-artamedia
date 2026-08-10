import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { formatApiError } from '@/lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);      // null = loading/anonymous
  const [checking, setChecking] = useState(true);

  const bootstrap = useCallback(async () => {
    const token = localStorage.getItem('noc_token');
    if (!token) {
      setChecking(false);
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
    } catch {
      localStorage.removeItem('noc_token');
    } finally {
      setChecking(false);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
      return data;
    } catch (err) {
      return null;
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('noc_token', data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch {}
    localStorage.removeItem('noc_token');
    setUser(null);
  };

  const hasRole = (...roles) => !!user && roles.includes(user.role);
  const canWrite = hasRole('admin', 'supervisor', 'engineer', 'teknisi');
  const canDelete = hasRole('admin', 'supervisor');
  const isAdmin = hasRole('admin');

  return (
    <AuthContext.Provider value={{ user, setUser, refreshUser, checking, login, logout, hasRole, canWrite, canDelete, isAdmin, formatApiError }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
