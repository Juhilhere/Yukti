import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, Monitor, Settings as SettingsIcon, User as UserIcon, X } from 'lucide-react';
import { api } from '../lib/api';
import type { SessionInfo } from '../lib/types';
import { countdown, fmtTime, timeAgo } from '../lib/format';
import { setSettings, useSettings } from '../lib/settings';
import { useAuth } from '../lib/auth';
import { Badge, Card, EmptyState, PageHeader, QueryState, Spinner, Toggle } from '../components/ui';
import { toast } from '../components/Toast';

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div><div className="font-medium">{title}</div>{hint && <div className="text-[12px] text-muted">{hint}</div>}</div>
      {children}
    </div>
  );
}

function useNow(ms = 1000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}

export default function Settings() {
  const st = useSettings();
  const { me, logout } = useAuth();
  const qc = useQueryClient();
  const now = useNow();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionInfo[]>('/api/auth/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/api/auth/sessions/${id}`),
    onSuccess: () => { toast.success('Session revoked'); qc.invalidateQueries({ queryKey: ['sessions'] }); },
    onError: (e) => toast.error('Could not revoke', (e as Error).message),
  });
  const [confirmAll, setConfirmAll] = useState(false);
  const u = me?.user;
  const loc = useLocation();
  useEffect(() => {
    if (!loc.hash) return;
    const el = document.getElementById(loc.hash.slice(1));
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('hl-flash'); setTimeout(() => el.classList.remove('hl-flash'), 2200); }
  }, [loc.hash]);

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Settings" icon={<SettingsIcon size={18} />} subtitle="Preferences, profile and active sessions" />
      <div className="grid gap-4 p-5 xl:grid-cols-2">
        <Card title="Application" icon={<Monitor size={14} className="text-cyan" />} bodyClass="px-3 py-1 divide-y divide-border">
          <Row title="Theme" hint="Yukti ships a single dark theme tuned for control rooms."><Toggle checked disabled onChange={() => undefined} label={<span className="text-muted">Dark</span>} /></Row>
          <Row title="Full-width chat" hint="Let conversations use the entire center panel."><Toggle checked={st.chatFullWidth} onChange={(v) => setSettings({ chatFullWidth: v })} /></Row>
          <Row title="Show generation stats" hint="tok/s, TTFT and token counts under each answer."><Toggle checked={st.showStats} onChange={(v) => setSettings({ showStats: v })} /></Row>
          <Row title="Send with Enter" hint="When off, use Ctrl+Enter to send."><Toggle checked={st.sendWithEnter} onChange={(v) => setSettings({ sendWithEnter: v })} /></Row>
        </Card>

        <Card id="profile" title="Profile" icon={<UserIcon size={14} className="text-amber" />}>
          {!u ? <EmptyState title="Not signed in" /> : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber/15 font-semibold text-amber">
                  {(u.display_name || u.username).split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold">{u.display_name}</div>
                  <div className="text-[12px] text-muted">{u.post} · {u.department}</div>
                </div>
                <Badge className="ml-auto" tone={u.clearance >= 3 ? 'danger' : u.clearance >= 2 ? 'amber' : 'cyan'} mono>L{u.clearance} · {u.clearance_label}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[12px]">
                <div><div className="label mb-1">Username</div><span className="font-mono">{u.username}</span></div>
                <div><div className="label mb-1">Roles</div><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} tone="amber" mono>{r}</Badge>)}</div></div>
                <div className="col-span-2"><div className="label mb-1">Asset scopes</div><div className="flex flex-wrap gap-1">{u.asset_scopes.length ? u.asset_scopes.map((r) => <Badge key={r} tone="cyan" mono>{r}</Badge>) : <span className="text-muted">—</span>}</div></div>
                <div className="col-span-2"><div className="label mb-1">Permissions</div><div className="flex flex-wrap gap-1">{(me?.permissions ?? []).map((p) => <Badge key={p} mono tone="muted">{p}</Badge>)}</div></div>
                <div className="col-span-2">
                  <div className="label mb-1">Active grants</div>
                  {(me?.grants ?? []).length === 0 ? <span className="text-muted">None</span> : (
                    <div className="space-y-1">{me!.grants.map((g) => (
                      <div key={g.id} className="flex items-center gap-2 rounded border border-border px-2 py-1">
                        <KeyRound size={12} className="text-amber" /><span className="font-mono">{g.scope}</span>
                        <span className="ml-auto font-mono text-cyan">{countdown(g.expires_at, now)}</span>
                      </div>
                    ))}</div>
                  )}
                </div>
                {me?.session && (
                  <div className="col-span-2 text-[11.5px] text-muted">
                    Idle timeout {Math.round(me.session.idle_timeout_s / 60)} min · session hard-expires {fmtTime(me.session.abs_expires_at)}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card id="sessions" className="xl:col-span-2 scroll-mt-4" title="Sessions" icon={<KeyRound size={14} className="text-cyan" />} bodyClass="p-0"
          actions={confirmAll ? <>
            <span className="text-[12px] text-amber">Sign out everywhere?</span>
            <button className="btn btn-danger btn-sm" onClick={() => logout(true)}><LogOut size={12} />Confirm</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmAll(false)}>Cancel</button>
          </> : <button className="btn btn-danger btn-sm" onClick={() => setConfirmAll(true)}><LogOut size={12} />Log out all devices</button>}>
          <QueryState q={sessions} empty={(sessions.data ?? []).length === 0} emptyTitle="No active sessions">
            <div className="divide-y divide-border">
              {(sessions.data ?? []).map((ss) => (
                <div key={ss.id} className="flex items-center gap-3 px-3 py-2">
                  <Monitor size={15} className={ss.current ? 'text-ok' : 'text-muted'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12.5px]">{ss.user_agent || 'Unknown client'}</span>
                      {ss.current && <Badge tone="ok">this device</Badge>}
                    </div>
                    <div className="font-mono text-[11px] text-faint">{ss.ip || '—'} · started {fmtTime(ss.created_at)} · active {timeAgo(ss.last_seen_at)}</div>
                  </div>
                  {!ss.current && (
                    <button className="btn btn-sm btn-ghost text-red-300" disabled={revoke.isPending} onClick={() => revoke.mutate(ss.id)}>
                      {revoke.isPending && revoke.variables === ss.id ? <Spinner size={12} /> : <X size={12} />}Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </QueryState>
        </Card>
      </div>
    </div>
  );
}
