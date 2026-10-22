import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createApiClient, type ApiCall } from '../api/client';
import { useTenant } from '../tenant/TenantContext';
import { clearSession, readSession, writeSession } from './session';
import { fromSnapshot } from '../data/merge';
import { carryPending } from '../data/pending';
import type { CoreData, CoreSnapshot, Session } from '../data/types';
import { coreKey } from '../data/useCoreData';

interface AuthState {
  session: Session | null;
  api: ApiCall;
  login: (password: string) => Promise<void>;
  logout: (reason?: string) => void;
  /** Replaces the token, e.g. after a password change issues a new one. */
  setSession: (session: Session) => void;
  logoutReason: string | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children, onLogout }: { children: ReactNode; onLogout: () => unknown }) {
  const tenant = useTenant();
  const queryClient = useQueryClient();
  const [session, setSessionState] = useState<Session | null>(() => readSession(tenant.slug));
  const [logoutReason, setLogoutReason] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const logout = useCallback(
    (reason?: string) => {
      clearSession(tenant.slug);
      setSessionState(null);
      setLogoutReason(reason ?? null);
      queryClient.clear();
      void Promise.resolve(onLogout());
    },
    [tenant.slug, queryClient, onLogout],
  );

  const api = useMemo(
    () =>
      createApiClient({
        tenant,
        getToken: () => sessionRef.current?.token ?? null,
        onAuthError: () => logout('Your session has ended. Please log in again.'),
      }),
    [tenant, logout],
  );

  const setSession = useCallback(
    (next: Session) => {
      writeSession(tenant.slug, next);
      setSessionState(next);
      setLogoutReason(null);
    },
    [tenant.slug],
  );

  const login = useCallback(
    async (password: string) => {
      // The server returns the bootstrap data with the token, so the first screen needs no second call.
      const { data, ...next } = await api<Session & { data?: CoreSnapshot }>('auth.login', { password, withData: true });
      if (data) {
        const key = coreKey(tenant.slug);
        queryClient.setQueryData(key, carryPending(queryClient.getQueryData<CoreData>(key), fromSnapshot(data)));
      }
      setSession(next);
    },
    [api, setSession, queryClient, tenant.slug],
  );

  const value = useMemo(
    () => ({ session, api, login, logout, setSession, logoutReason }),
    [session, api, login, logout, setSession, logoutReason],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
