import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, onForbidden, onUnauthorized, setCsrf } from './api';
import type { Me } from './types';
import { toast } from '../components/Toast';

type AuthCtx = {
  me: Me | null;
  status: 'loading' | 'authed' | 'anon';
  login: (username: string, password: string) => Promise<Me>;
  logout: (all?: boolean) => Promise<void>;
  refresh: () => Promise<Me | null>;
  can: (perm?: string | string[]) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

function redirectToLogin() {
  const here = window.location.pathname + window.location.search;
  if (window.location.pathname.startsWith('/login')) return;
  window.history.pushState({}, '', `/login?next=${encodeURIComponent(here)}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<AuthCtx['status']>('loading');
  const qc = useQueryClient();

  const apply = useCallback((m: Me | null) => {
    setMe(m);
    setCsrf(m?.csrf_token ?? '');
    setStatus(m ? 'authed' : 'anon');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>('/api/auth/me', { silent: true });
      apply(m);
      return m;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) apply(null);
      else if (e instanceof ApiError && e.status === 0) { apply(null); }
      else apply(null);
      return null;
    }
  }, [apply]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const off1 = onUnauthorized(() => {
      if (status === 'authed' || me) toast.warn('Session expired', 'Please sign in again.');
      apply(null);
      qc.clear();
      redirectToLogin();
    });
    const off2 = onForbidden((e) => toast.error('Access denied by policy', e.message));
    return () => { off1(); off2(); };
  }, [apply, qc, status, me]);

  const login = useCallback(async (username: string, password: string) => {
    const m = await api.post<Me>('/api/auth/login', { username, password }, { silent: true });
    apply(m);
    qc.clear();
    return m;
  }, [apply, qc]);

  const logout = useCallback(async (all = false) => {
    try {
      if (all) {
        const r = await api.post<{ ok: boolean; revoked?: number }>('/api/auth/logout-all', {}, { silent: true });
        toast.success('Signed out of all devices', r?.revoked !== undefined ? `${r.revoked} session(s) revoked` : undefined);
      } else {
        await api.post('/api/auth/logout', {}, { silent: true });
      }
    } catch { /* ignore */ }
    apply(null);
    qc.clear();
    window.history.pushState({}, '', '/login');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [apply, qc]);

  const can = useCallback((perm?: string | string[]) => {
    if (!perm) return true;
    if (!me) return false;
    const perms = me.permissions ?? [];
    if (perms.includes('admin') || perms.includes('*')) return true;
    const list = Array.isArray(perm) ? perm : [perm];
    return list.some((p) => perms.includes(p) || perms.some((x) => x.endsWith('.*') && p.startsWith(x.slice(0, -1))));
  }, [me]);

  const value = useMemo(() => ({ me, status, login, logout, refresh, can }), [me, status, login, logout, refresh, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
