import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe2, KeyRound, LogOut, Monitor, ShieldCheck, ShieldOff, Smartphone, UserCircle2, X } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import type { SessionInfo } from '../lib/types';
import { fmtTime, roleLabel, timeAgo } from '../lib/format';
import { Badge, Card, ErrorBox, Field, LangSwitcher, PageHeader, QueryState, Spinner } from '../components/ui';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { CopyButton } from '../components/pages2/CopyButton';
import { Logo } from '../components/Logo';

/* ------------------------------------------------------------------ */
/* Change password form (used by Account and the forced full-screen)   */
/* ------------------------------------------------------------------ */
export function ChangePasswordForm({ onDone, submitLabel }: { onDone?: () => void; submitLabel?: string }) {
  const t = useT();
  const { refresh } = useAuth();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [conf, setConf] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>('/api/auth/password', { current_password: cur, new_password: next }, { silent: true }),
    onSuccess: async () => {
      toast.success(t('account.pw.changed'), t('account.pw.changedBody'));
      setCur(''); setNext(''); setConf('');
      await refresh();
      onDone?.();
    },
    onError: (e) => setErr(errMsg(e)),
  });
  const localErr = next && next.length < 12 ? t('account.pw.tooShort')
    : next && cur && next === cur ? t('account.pw.same')
      : conf && next !== conf ? t('account.pw.mismatch') : null;
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (localErr || !cur || !next || next !== conf) return;
    m.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label={t('account.currentPassword')}>
        <input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
      </Field>
      <Field label={t('account.newPassword')} hint={t('account.pw.hint')}>
        <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label={t('account.confirmPassword')}>
        <input className="input" type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} />
      </Field>
      {(localErr || err) && <ErrorBox error={localErr || err} />}
      <button className="btn btn-primary" disabled={m.isPending || !cur || !next || !conf || !!localErr}>
        {m.isPending ? <Spinner className="!text-[#1a1204]" /> : <KeyRound size={13} />}{submitLabel ?? t('btn.changePassword')}
      </button>
    </form>
  );
}

/** Full-screen gate shown when the user must change a temporary password. */
export function ForcedPasswordChange() {
  const t = useT();
  const { me, logout } = useAuth();
  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-bg p-6">
      <div className="w-full max-w-[420px] rounded-lg border border-border bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <Logo size={36} />
          <div>
            <div className="text-[16px] font-semibold">{t('account.forced.title')}</div>
            <div className="text-[12px] text-muted">@{me?.user.username}</div>
          </div>
        </div>
        <p className="mb-4 text-[12.5px] text-muted">{t('account.forced.body')}</p>
        <ChangePasswordForm />
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <LangSwitcher />
          <button className="btn btn-ghost btn-sm" onClick={() => void logout(false)}><LogOut size={12} />{t('menu.logout')}</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MFA                                                                 */
/* ------------------------------------------------------------------ */
type Enroll = { secret: string; otpauth_uri: string; qr_svg: string };

function MfaCard() {
  const t = useT();
  const { me, refresh } = useAuth();
  const enabled = !!me?.user.mfa_enabled;
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [offCode, setOffCode] = useState('');

  const start = useMutation({
    mutationFn: () => api.post<Enroll>('/api/auth/mfa/enroll', {}),
    onSuccess: (r) => { setEnroll(r); setCode(''); },
    onError: (e) => toast.error(t('account.mfa.startFailed'), errMsg(e)),
  });
  const verify = useMutation({
    mutationFn: () => api.post<{ ok: boolean; recovery_codes: string[] }>('/api/auth/mfa/verify', { code: code.trim() }),
    onSuccess: async (r) => {
      setEnroll(null); setCode('');
      setCodes(r.recovery_codes ?? []);
      toast.success(t('account.mfa.enabledToast'));
      await refresh();
    },
  });
  const disable = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>('/api/auth/mfa/disable', { password: pw, code: offCode.trim() }),
    onSuccess: async () => { setDisableOpen(false); setPw(''); setOffCode(''); toast.success(t('account.mfa.disabledToast')); await refresh(); },
  });

  return (
    <Card id="mfa" title={t('account.mfa')} icon={<Smartphone size={14} className="text-cyan" />}
      actions={enabled ? <Badge tone="ok"><ShieldCheck size={11} />{t('account.mfa.on')}</Badge> : <Badge tone="muted">{t('account.mfa.off')}</Badge>}>
      {codes ? (
        <div className="space-y-3">
          <div className="rounded-md border border-amber/40 bg-amber/10 px-3 py-2 text-[12.5px] text-amber">
            {t('account.mfa.saveCodes')}
          </div>
          <div className="grid grid-cols-2 gap-1.5 rounded-md border border-border bg-bg p-3 font-mono text-[13px]">
            {codes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <div className="flex gap-2">
            <CopyButton text={codes.join('\n')} label={t('account.mfa.copyCodes')} />
            <button className="btn btn-sm btn-primary" onClick={() => setCodes(null)}>{t('account.mfa.saved')}</button>
          </div>
        </div>
      ) : enroll ? (
        <div className="space-y-3">
          <div className="text-[12.5px] text-muted">{t('account.mfa.step1')}</div>
          <div className="flex flex-wrap items-start gap-4">
            {/* qr_svg is generated by the Yukti backend (trusted, same origin) */}
            <div className="h-[180px] w-[180px] rounded-md bg-white p-2 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: enroll.qr_svg }} />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="label">{t('account.mfa.secret')}</div>
              <div className="flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1">
                <code className="flex-1 break-all font-mono text-[12px] text-cyan">{enroll.secret}</code>
                <CopyButton text={enroll.secret} />
              </div>
            </div>
          </div>
          <div className="text-[12.5px] text-muted">{t('account.mfa.step2')}</div>
          <div className="flex items-center gap-2">
            <input className="input !w-40 text-center font-mono tracking-[0.3em]" inputMode="numeric" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
            <button className="btn btn-primary" disabled={code.length !== 6 || verify.isPending} onClick={() => verify.mutate()}>
              {verify.isPending ? <Spinner className="!text-[#1a1204]" /> : <ShieldCheck size={13} />}{t('btn.verify')}
            </button>
            <button className="btn btn-ghost" onClick={() => setEnroll(null)}>{t('btn.cancel')}</button>
          </div>
          {verify.error ? <ErrorBox error={verify.error} /> : null}
        </div>
      ) : enabled ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 text-[12.5px] text-muted">{t('account.mfa.onHint')}</div>
          <button className="btn btn-danger btn-sm" onClick={() => { setPw(''); setOffCode(''); disable.reset(); setDisableOpen(true); }}><ShieldOff size={12} />{t('account.mfa.disable')}</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 text-[12.5px] text-muted">{t('account.mfa.offHint')}</div>
          <button className="btn btn-cyan btn-sm" disabled={start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? <Spinner size={12} /> : <ShieldCheck size={12} />}{t('account.mfa.setup')}
          </button>
        </div>
      )}
      <Modal open={disableOpen} onClose={() => setDisableOpen(false)} title={t('account.mfa.disable')} width={400}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setDisableOpen(false)}>{t('btn.cancel')}</button>
          <button className="btn btn-danger" disabled={!pw || !offCode.trim() || disable.isPending} onClick={() => disable.mutate()}>
            {disable.isPending ? <Spinner size={12} /> : <ShieldOff size={12} />}{t('account.mfa.disableBtn')}
          </button>
        </>}>
        <div className="space-y-3">
          <div className="text-[12.5px] text-muted">{t('account.mfa.disableHint')}</div>
          <Field label={t('login.password')}><input autoFocus className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label={t('account.mfa.code')}><input className="input font-mono" inputMode="numeric" autoComplete="one-time-code" value={offCode} onChange={(e) => setOffCode(e.target.value)} placeholder={t('account.mfa.codeHint')} /></Field>
          {disable.error ? <ErrorBox error={disable.error} /> : null}
        </div>
      </Modal>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */
function SessionsCard() {
  const t = useT();
  const { logout } = useAuth();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionInfo[]>('/api/auth/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/api/auth/sessions/${encodeURIComponent(id)}`),
    onSuccess: () => { toast.success(t('account.sess.revoked')); qc.invalidateQueries({ queryKey: ['sessions'] }); },
    onError: (e) => toast.error(t('account.sess.revokeFailed'), errMsg(e)),
  });
  const [confirmAll, setConfirmAll] = useState(false);
  return (
    <Card id="sessions" className="scroll-mt-4" title={t('account.sessions')} icon={<Monitor size={14} className="text-cyan" />} bodyClass="p-0"
      actions={confirmAll ? <>
        <span className="text-[12px] text-amber">{t('account.sess.confirmAll')}</span>
        <button className="btn btn-danger btn-sm" onClick={() => void logout(true)}><LogOut size={12} />{t('btn.confirm')}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmAll(false)}>{t('btn.cancel')}</button>
      </> : <button className="btn btn-danger btn-sm" onClick={() => setConfirmAll(true)}><LogOut size={12} />{t('menu.logoutAll')}</button>}>
      <QueryState q={sessions} empty={(sessions.data ?? []).length === 0} emptyTitle={t('account.sess.none')}>
        <div className="divide-y divide-border">
          {(sessions.data ?? []).map((ss) => (
            <div key={ss.id} className="flex items-center gap-3 px-3 py-2">
              <Monitor size={15} className={ss.current ? 'text-ok' : 'text-muted'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12.5px]">{ss.user_agent || t('account.sess.unknown')}</span>
                  {ss.current && <Badge tone="ok">{t('account.sess.thisDevice')}</Badge>}
                </div>
                <div className="font-mono text-[11px] text-faint">{ss.ip || '—'} · {t('account.sess.started', { at: fmtTime(ss.created_at) })} · {t('account.sess.active', { ago: timeAgo(ss.last_seen_at) })}</div>
              </div>
              {!ss.current && (
                <button className="btn btn-sm btn-ghost text-red-300" disabled={revoke.isPending} onClick={() => revoke.mutate(ss.id)}>
                  {revoke.isPending && revoke.variables === ss.id ? <Spinner size={12} /> : <X size={12} />}{t('account.sess.revoke')}
                </button>
              )}
            </div>
          ))}
        </div>
      </QueryState>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
export default function Account() {
  const t = useT();
  const { me } = useAuth();
  const u = me?.user;
  const loc = useLocation();
  useEffect(() => {
    if (!loc.hash) return;
    const el = document.getElementById(loc.hash.slice(1));
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('hl-flash'); setTimeout(() => el.classList.remove('hl-flash'), 2200); }
  }, [loc.hash]);

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={t('page.account')} icon={<UserCircle2 size={18} />} subtitle={t('account.subtitle')} />
      <div className="grid gap-4 p-5 xl:grid-cols-2">
        <Card title={u?.display_name ?? '—'} icon={<UserCircle2 size={14} className="text-amber" />}>
          {u && (
            <div className="space-y-3 text-[12.5px]">
              <div className="text-muted">{u.post} · {u.department}</div>
              <div className="flex flex-wrap gap-1.5">
                <Badge mono>@{u.username}</Badge>
                <Badge tone={u.clearance >= 3 ? 'amber' : 'cyan'} mono>L{u.clearance} {u.clearance_label}</Badge>
                {u.roles.map((r) => <Badge key={r} tone="amber" mono>{roleLabel(r)}</Badge>)}
              </div>
              {me?.org?.name && <div className="text-[11.5px] text-faint">{me.org.name}{me.org.deployment ? ` · ${me.org.deployment}` : ''}</div>}
            </div>
          )}
        </Card>
        <Card id="language" title={t('account.language')} icon={<Globe2 size={14} className="text-cyan" />}>
          <div className="space-y-2">
            <LangSwitcher />
            <div className="text-[11.5px] text-muted">{t('account.languageHint')}</div>
          </div>
        </Card>
        <Card id="password" title={t('account.password')} icon={<KeyRound size={14} className="text-amber" />}>
          <div className="max-w-[380px]"><ChangePasswordForm /></div>
        </Card>
        <MfaCard />
        <div className="xl:col-span-2"><SessionsCard /></div>
      </div>
    </div>
  );
}
