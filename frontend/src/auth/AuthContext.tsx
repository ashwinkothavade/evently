import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { request, setUnauthorizedHandler, tokenStore } from '../api/client';
import type { Session, User } from '../api/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  // Restore the session on page load.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return;
    request<{ data: User }>('GET', '/me')
      .then((r) => setUser(r.data))
      .catch(logout)
      .finally(() => setLoading(false));
  }, [logout]);

  const start = useCallback((session: Session) => {
    tokenStore.set(session.token);
    setUser(session.user);
    return session.user;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      logout,
      login: (email, password) =>
        request<{ data: Session }>('POST', '/auth/login', { body: { email, password } }).then((r) => start(r.data)),
      register: (name, email, password) =>
        request<{ data: Session }>('POST', '/auth/register', { body: { name, email, password } }).then((r) => start(r.data)),
    }),
    [user, loading, logout, start],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
