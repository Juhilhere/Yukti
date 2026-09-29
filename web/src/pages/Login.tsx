import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Eye, EyeOff, Lock, LogIn, ServerCog, ShieldCheck, User2, Users } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { DemoUser } from '../lib/types';
import { Logo } from '../components/Logo';
import { Spinner } from '../components/ui';
import { cx } from '../lib/format';

export default function Login() {
  const { status, login } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const next = params.get('next') || '/chat';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const demo = useQuery({
    queryKey: ['demo-users'],
    queryFn: () => api.get<DemoUser[]>('/api/auth/demo-users', { silent: true }),
    retry: false,
  });

  useEffect(() => { document.title = 'Sign in · Yukti'; return () => { document.title = 'Yukti — Sovereign Industrial AI Workbench'; }; }, []);

  if (status === 'authed') return <Navigate to={next.startsWith('/login') ? '/chat' : next} replace />;

  const doLogin = async (u: string, p: string) => {
    setBusy(true);
    setError(null);
    try {
      await login(u, p);
      nav(next.startsWith('/login') ? '/chat' : next, { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) setError({ code: 'bad_credentials', message: 'Incorrect username or password.' });
        else if (e.status === 423) setError({ code: 'locked', message: e.message || 'Account temporarily locked after repeated failures.' });
        else if (e.status === 0) setError({ code: 'network', message: 'Cannot reach the Yukti server. Is the backend running?' });
        else setError({ code: e.code, message: e.message });
      } else setError({ code: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => { e.preventDefault(); if (username && password) void doLogin(username, password); };
  const demoUsers = Array.isArray(demo.data) ? demo.data : [];

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-auto p-6"
      style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(34,211,238,.08), transparent), radial-gradient(900px 500px at 110% 110%, rgba(245,165,36,.07), transparent), #0B1220' }}>
      <div className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{ backgroundImage: 'linear-gradient(#8A98B3 1px, transparent 1px), linear-gradient(90deg, #8A98B3 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      <div className={cx('relative flex w-full flex-col gap-4 lg:flex-row lg:items-start', demoUsers.length ? 'max-w-[900px]' : 'max-w-[400px]')}>
        <div className="w-full shrink-0 rounded-lg border border-border bg-surface/95 p-7 shadow-2xl lg:w-[400px]">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <Logo size={52} />
            <div className="mt-1 text-[22px] font-semibold tracking-tight">Yukti</div>
            <div className="text-[12.5px] text-muted">Sovereign Industrial AI Workbench</div>
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-2.5 py-0.5 text-[11.5px] font-medium text-green-300">
              <ShieldCheck size={12} /> Runs 100% on-premise
            </span>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <label className="block space-y-1">
              <span className="text-[12px] font-medium text-muted">Username</span>
              <div className="relative">
                <User2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input className="input !pl-8 !py-2" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. shift.engineer" />
              </div>
            </label>
            <label className="block space-y-1">
              <span className="text-[12px] font-medium text-muted">Password</span>
              <div className="relative">
                <Lock size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input className="input !pl-8 !pr-9 !py-2" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" tabIndex={-1} className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-text" onClick={() => setShow((s) => !s)}>
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
            {error && (
              <div className={cx('flex items-start gap-2 rounded-md border px-3 py-2 text-[12.5px]',
                error.code === 'locked' ? 'border-amber/40 bg-amber/10 text-amber' : 'border-danger/40 bg-danger/10 text-red-200')}>
                {error.code === 'locked' ? <Lock size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                <span>{error.message}</span>
              </div>
            )}
            <button className="btn btn-primary w-full justify-center !py-2" disabled={busy || !username || !password}>
              {busy ? <Spinner className="!text-[#1a1204]" /> : <LogIn size={14} />} Sign in
            </button>
          </form>
          <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-faint">
            <ServerCog size={12} /> No data leaves the plant network · every action is audited
          </div>
        </div>

        {demoUsers.length > 0 && (
          <div className="w-full rounded-lg border border-dashed border-amber/50 bg-surface/90 p-4 shadow-2xl">
            <div className="mb-1 flex items-center gap-2">
              <Users size={14} className="text-amber" />
              <span className="font-semibold">Demo personas</span>
              <span className="ml-auto rounded bg-amber/15 px-1.5 py-px font-mono text-[10.5px] font-semibold text-amber">DEMO MODE — judge helper</span>
            </div>
            <div className="mb-3 text-[12px] text-muted">Click a persona to sign in. Each has a different post, department and clearance — watch what Yukti withholds.</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {demoUsers.map((u) => (
                <button key={u.username} disabled={busy}
                  onClick={() => { setUsername(u.username); setPassword(u.password); void doLogin(u.username, u.password); }}
                  className="group flex items-start gap-2.5 rounded-md border border-border bg-surface-2 p-2.5 text-left transition-colors hover:border-cyan/50 hover:bg-surface-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan/15 font-semibold text-cyan">
                    {(u.display_name || u.username).slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium group-hover:text-cyan">{u.display_name}</div>
                    <div className="truncate text-[11.5px] text-muted">{u.post} · {u.department}</div>
                    <div className="mt-0.5 font-mono text-[10.5px] text-faint">{u.username} / {u.password}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
