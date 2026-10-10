import { useEffect, useState, type FormEvent } from 'react';
import { Backdrop } from '../components/Backdrop';
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

  const principles: [string, string][] = [['login.p1.title', 'login.p1.body'], ['login.p2.title', 'login.p2.body'], ['login.p3.title', 'login.p3.body']];

  return (
    <div className="relative h-full overflow-auto bg-bg">
      <Backdrop />
      <div className="app-layer grid min-h-full lg:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">

        {/* brand panel */}
        <section className="relative hidden flex-col justify-between px-14 py-12 lg:flex">
          <div className="flex items-center gap-3">
            <Logo size={34} />
            <span className="font-display text-[26px] leading-none">Yukti</span>
          </div>
          <div className="max-w-[560px]">
            <div className="mb-5 flex items-center gap-3 tracking-latin text-[10.5px] font-medium uppercase tracking-[0.28em] text-amber">
              <span className="h-px w-10 bg-amber/60" />{t('login.title')}
            </div>
            <h1 className="font-display text-[56px] leading-[1.02] tracking-[-0.01em] text-text">{t('login.hero.title')}</h1>
            <p className="mt-5 max-w-[480px] text-[14px] leading-relaxed text-muted">{t('login.hero.sub')}</p>
            <ol className="mt-10 space-y-0">
              {principles.map(([a, b], i) => (
                <li key={a} className="grid grid-cols-[44px_1fr] gap-x-2 border-t border-amber/15 py-4 last:border-b">
                  <span className="font-display text-[20px] leading-none text-amber/80">{['I', 'II', 'III'][i]}</span>
                  <div>
                    <div className="text-[13.5px] font-medium text-text">{t(a)}</div>
                    <div className="mt-0.5 text-[12.5px] text-muted">{t(b)}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex items-center gap-2 tracking-latin font-mono text-[10.5px] uppercase tracking-[0.18em] text-faint">
            <ShieldCheck size={12} className="text-ok" /> {t('login.onprem')}
          </div>
        </section>

        {/* sign-in column */}
        <section className="relative flex min-h-full flex-col border-l border-border/70 bg-black/55 backdrop-blur-xl">
          <div className="flex justify-end px-6 pt-5"><LangSwitcher /></div>
          <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center px-6 py-10">
            <div className="mb-8 lg:hidden flex items-center gap-3">
              <Logo size={34} /><span className="font-display text-[30px] leading-none">Yukti</span>
            </div>
            <h2 className="font-display text-[34px] leading-none">{mfaStep ? t('login.mfa.title') : t('login.signInTitle')}</h2>
            <p className="mt-2 text-[12.5px] text-muted">{mfaStep ? t('login.mfa.hint') : t('login.signInSub')}</p>

            <form onSubmit={submit} className="mt-8 space-y-4">
              {mfaStep ? (
                <div className="space-y-2">
                  <label className="block space-y-1.5">
                    <span className="label flex items-center gap-1.5"><Smartphone size={12} />{t('login.mfa.code')}</span>
                    <input className="input !py-2.5 text-center font-mono tracking-[0.3em]" autoFocus autoComplete="one-time-code" spellCheck={false}
                      autoCapitalize="off" maxLength={40} value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="000000" />
                  </label>
                  <div className="text-[11.5px] text-faint">{t('login.mfa.lost')}</div>
                  <button type="button" className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-text"
                    onClick={() => { setMfaStep(false); setTotp(''); setError(null); }}><ArrowLeft size={12} />{t('btn.back')}</button>
                </div>
              ) : (<>
              <label className="block space-y-1.5">
                <span className="label">{t('login.username')}</span>
                <div className="relative">
                  <User2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                  <input className="input !pl-9 !py-2.5" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('login.usernameHint')} />
                </div>
              </label>
              <label className="block space-y-1.5">
                <span className="label">{t('login.password')}</span>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                  <input className="input !pl-9 !pr-10 !py-2.5" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" tabIndex={-1} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-text" onClick={() => setShow((s) => !s)}
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
              <button className="btn btn-primary w-full justify-center !py-2.5 !text-[13.5px]" disabled={busy || !username || !password || (mfaStep && !totp.trim())}>
                {busy ? <Spinner className="!text-[#15110A]" /> : <LogIn size={15} />} {mfaStep ? t('btn.verify') : t('btn.signIn')}
              </button>
            </form>

            <div className="mt-5 flex items-center gap-1.5 text-[11px] text-faint">
              <ServerCog size={12} /> {t('login.footer')}
            </div>

            {canAddHere() && (
              // add-ons are downloaded by the desktop app on the server computer; reachable before signing in
              <button type="button" onClick={() => window.location.assign('/desktop/features')}
                className="mt-5 flex w-full items-center gap-2 rounded-md border border-border bg-surface-2/60 px-3 py-2 text-left text-[12.5px] hover:border-amber/40">
                <Sparkles size={14} className="shrink-0 text-amber" />
                <span><span className="font-medium text-text">{t('feat.login.title')}</span><br /><span className="text-muted">{t('feat.login.body')}</span></span>
              </button>
            )}

            {demoUsers.length > 0 && (
              <div className="mt-10">
                <div className="mb-2 flex items-center gap-2">
                  <Users size={13} className="text-amber" />
                  <span className="label !text-text">{t('login.demo.title')}</span>
                  <span className="ml-auto rounded-sm border border-amber/30 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wider text-amber">{t('login.demo.badge')}</span>
                </div>
                <div className="mb-2 text-[11.5px] text-faint">{t('login.demo.hint')}</div>
                <div className="max-h-[248px] divide-y divide-border/70 overflow-y-auto rounded-md border border-border bg-black/40">
                  {demoUsers.map((u) => (
                    <button key={u.username} disabled={busy}
                      onClick={() => { setMfaStep(false); setUsername(u.username); setPassword(u.password); void doLogin(u.username, u.password); }}
                      className="group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-amber/[0.06]">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber/30 font-display text-[14px] text-amber">
                        {(u.display_name || u.username).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-text group-hover:text-amber">{u.display_name}</span>
                        <span className="block truncate text-[11px] text-muted">{u.post} · {u.department}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-faint">{u.username}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
