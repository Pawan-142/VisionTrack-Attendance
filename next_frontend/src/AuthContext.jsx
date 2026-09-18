import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('vt_user');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const [token, setToken] = useState(() => localStorage.getItem('vt_token') || null);

  const logout = useCallback(() => {
    localStorage.removeItem('vt_user');
    localStorage.removeItem('vt_token');
    setUser(null);
    setToken(null);
  }, []);

  const login = useCallback((userData, accessToken) => {
    localStorage.setItem('vt_user', JSON.stringify(userData));
    localStorage.setItem('vt_token', accessToken);
    setUser(userData);
    setToken(accessToken);
  }, []);

  // Auto-logout if token is expired
  useEffect(() => {
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiresIn = (payload.exp * 1000) - Date.now();
      if (expiresIn <= 0) { logout(); return; }
      const timer = setTimeout(logout, Math.min(expiresIn, 2147483647));
      return () => clearTimeout(timer);
    } catch { logout(); }
  }, [token, logout]);

  const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

  // Intercept 401s globally via custom fetch wrapper
  const authFetch = useCallback(async (url, options = {}) => {
    const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };
    const res = await fetch(fullUrl, { ...options, headers });
    if (res.status === 401) { logout(); throw new Error('Session expired'); }
    return res;
  }, [token, logout]);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
