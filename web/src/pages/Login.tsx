import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Eye, EyeOff, Lock, LogIn, ServerCog, ShieldCheck, Smartphone, User2, Users, Sparkles } from 'lucide-react';
import { canAddHere } from '../components/FeatureOffers';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { DemoUser } from '../lib/types';
import { Logo } from '../components/Logo';
import { LangSwitcher, Spinner } from '../components/ui';
import { useT } from '../lib/i18n';
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
  // `key` errors are translated when shown, so they follow a language change made after the error appeared
  const [error, setError] = useState<{ code: string; message?: string; key?: string; vars?: Record<string, number> } | null>(null);
  const [mfaStep, setMfaStep] = useState(false);
  const [totp, setTotp] = useState('');
  const t = useT();

  const demo = useQuery({
    queryKey: ['demo-users'],
    queryFn: () => api.get<DemoUser[]>('/api/auth/demo-users', { silent: true }),
    retry: false,
  });

  useEffect(() => { document.title = `${t('login.docTitle')} · Yukti`; return () => { document.title = `Yukti — ${t('login.title')}`; }; }, [t]);

  if (status === 'authed') return <Navigate to={next.startsWith('/login') ? '/chat' : next} replace />;

  const doLogin = async (u: string, p: string, code?: string) => {
    setBusy(true);
    setError(null);
    try {
      await login(u, p, code);
      nav(next.startsWith('/login') ? '/chat' : next, { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401 && e.code === 'mfa_required') { setMfaStep(true); setTotp(''); }
        else if (e.status === 401 && e.code === 'mfa_invalid') { setMfaStep(true); setTotp(''); setError({ code: 'mfa_invalid', key: 'login.mfa.wrongCode' }); }
        else if (e.status === 401) { setMfaStep(false); setError({ code: 'bad_credentials', key: 'login.badCredentials' }); }
        else if (e.status === 423) {
          const n = Number(e.detail?.minutes);
          setError(n > 0 ? { code: 'locked', key: n === 1 ? 'login.lockedFor1' : 'login.lockedFor', vars: { n } } : { code: 'locked', message: e.message || t('login.locked') });
        }
        else if (e.status === 0) setError({ code: 'network', key: 'login.network' });
        else setError({ code: e.code, message: e.message });
      } else setError({ code: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // codes are sent as typed ("123 456", recovery codes with a dash); the server ignores spaces and dashes
    if (mfaStep) { if (totp.trim()) void doLogin(username, password, totp.trim()); return; }
    if (username && password) void doLogin(username, password);
  };
  const demoUsers = Array.isArray(demo.data) ? demo.data : [];

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-auto p-6"
      style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(34,211,238,.08), transparent), radial-gradient(900px 500px at 110% 110%, rgba(245,165,36,.07), transparent), #0E0E10' }}>
      <div className="absolute right-4 top-4 z-10"><LangSwitcher /></div>
      <div className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{ backgroundImage: 'linear-gradient(#9A9AA3 1px, transparent 1px), linear-gradient(90deg, #9A9AA3 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      <div className={cx('relative flex w-full flex-col gap-4 lg:flex-row lg:items-start', demoUsers.length ? 'max-w-[900px]' : 'max-w-[400px]')}>
        <div className="w-full shrink-0 rounded-lg border border-border bg-surface/95 p-7 shadow-2xl lg:w-[400px]">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <Logo size={52} />
            <div className="mt-1 text-[22px] font-semibold tracking-tight">Yukti</div>
            <div className="text-[12.5px] text-muted">{t('login.title')}</div>
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-2.5 py-0.5 text-[11.5px] font-medium text-green-300">
              <ShieldCheck size={12} /> {t('login.onprem')}
            </span>
          </div>
          <form onSubmit={submit} className="space-y-3">
            {mfaStep ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 font-medium"><Smartphone size={15} className="text-cyan" />{t('login.mfa.title')}</div>
                <div className="text-[12px] text-muted">{t('login.mfa.hint')}</div>
                <label className="block space-y-1">
                  <span className="text-[12px] font-medium text-muted">{t('login.mfa.code')}</span>
                  <input className="input !py-2 text-center font-mono tracking-[0.25em]" autoFocus autoComplete="one-time-code" spellCheck={false}
                    autoCapitalize="off" maxLength={40} value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="000000" />
                </label>
                <div className="text-[11.5px] text-faint">{t('login.mfa.lost')}</div>
                <button type="button" className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-text"
                  onClick={() => { setMfaStep(false); setTotp(''); setError(null); }}><ArrowLeft size={12} />{t('btn.back')}</button>
              </div>
            ) : (<>
            <label className="block space-y-1">
              <span className="text-[12px] font-medium text-muted">{t('login.username')}</span>
              <div className="relative">
                <User2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input className="input !pl-8 !py-2" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('login.usernameHint')} />
              </div>
            </label>
            <label className="block space-y-1">
              <span className="text-[12px] font-medium text-muted">{t('login.password')}</span>
              <div className="relative">
                <Lock size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input className="input !pl-8 !pr-9 !py-2" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" tabIndex={-1} className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-text" onClick={() => setShow((s) => !s)}
                  title={show ? t('login.hidePassword') : t('login.showPassword')} aria-label={show ? t('login.hidePassword') : t('login.showPassword')}>
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
            </>)}
            {error && (
              <div className={cx('flex items-start gap-2 rounded-md border px-3 py-2 text-[12.5px]',
                error.code === 'locked' ? 'border-amber/40 bg-amber/10 text-amber' : 'border-danger/40 bg-danger/10 text-red-200')}>
                {error.code === 'locked' ? <Lock size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                <span role="alert">{error.key ? t(error.key, error.vars) : error.message}</span>
              </div>
            )}
            <button className="btn btn-primary w-full justify-center !py-2" disabled={busy || !username || !password || (mfaStep && !totp.trim())}>
              {busy ? <Spinner className="!text-[#1a1204]" /> : <LogIn size={14} />} {mfaStep ? t('btn.verify') : t('btn.signIn')}
            </button>
          </form>
          <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-faint">
            <ServerCog size={12} /> {t('login.footer')}
          </div>
          {canAddHere() && (
            // add-ons are downloaded by the desktop app on the server computer; reachable before signing in
            <button type="button" onClick={() => window.location.assign('/desktop/features')}
              className="mt-4 flex w-full items-center gap-2 rounded-md border border-cyan/30 bg-cyan/5 px-3 py-2 text-left text-[12.5px] hover:border-cyan/60">
              <Sparkles size={14} className="shrink-0 text-cyan" />
              <span><span className="font-medium text-cyan">{t('feat.login.title')}</span><br /><span className="text-muted">{t('feat.login.body')}</span></span>
            </button>
          )}
        </div>

        {demoUsers.length > 0 && (
          <div className="w-full rounded-lg border border-dashed border-amber/50 bg-surface/90 p-4 shadow-2xl">
            <div className="mb-1 flex items-center gap-2">
              <Users size={14} className="text-amber" />
              <span className="font-semibold">{t('login.demo.title')}</span>
              <span className="ml-auto rounded bg-amber/15 px-1.5 py-px font-mono text-[10.5px] font-semibold text-amber">{t('login.demo.badge')}</span>
            </div>
            <div className="mb-3 text-[12px] text-muted">{t('login.demo.hint')}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {demoUsers.map((u) => (
                <button key={u.username} disabled={busy}
                  onClick={() => { setMfaStep(false); setUsername(u.username); setPassword(u.password); void doLogin(u.username, u.password); }}
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
