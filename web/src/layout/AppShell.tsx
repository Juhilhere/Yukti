import { useEffect, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, Bell, BookOpen, Building2, Cpu, Factory, Globe2, HelpCircle, Inbox, KeyRound, LogOut, MemoryStick, MessageSquare,
  MonitorSmartphone, Settings, ShieldCheck, ShieldHalf, ScrollText, User2, Wrench, Gauge, Zap, AlertTriangle, CheckCheck,
} from 'lucide-react';
import { useT } from '../lib/i18n';
import { ADMIN_PERMS } from '../pages/admin/AdminLayout';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { uiStore, useLoaded, useSystem, useUI } from '../lib/queries';
import type { AccessRequest, Alert, Finding, Notification } from '../lib/types';
import { cx, fmtMB, timeAgo } from '../lib/format';
import { Logo } from '../components/Logo';
import { Badge, Dot, LangSwitcher, MenuItem, Popover, Spinner, Tip } from '../components/ui';
import { ModelLoader, ENGINE_LABEL } from './ModelLoader';
import { IdleWatcher } from './IdleWatcher';

type NavItem = { to: string; label: string; icon: ReactNode; perm?: string | string[]; badge?: number };

function RailLink({ item }: { item: NavItem }) {
  return (
    <Tip text={item.label}>
      <NavLink to={item.to}
        className={({ isActive }) => cx('relative flex h-10 w-10 items-center justify-center rounded-md transition-colors',
          isActive ? 'bg-surface-3 text-text before:absolute before:-left-2 before:h-5 before:w-[3px] before:rounded-r before:bg-amber' : 'text-muted hover:bg-surface-2 hover:text-text')}>
        {item.icon}
        {!!item.badge && item.badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber px-1 font-mono text-[9.5px] font-bold text-[#1a1204]">
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
      </NavLink>
    </Tip>
  );
}

function useInboxCount(enabled: boolean) {
  const findings = useQuery({ queryKey: ['findings'], queryFn: () => api.get<Finding[]>('/api/findings'), refetchInterval: 30_000, enabled, retry: false });
  const ar = useQuery({ queryKey: ['access-requests'], queryFn: () => api.get<{ mine: AccessRequest[]; to_approve: AccessRequest[] }>('/api/access-requests'), refetchInterval: 15_000, enabled, retry: false });
  // findings where the current user can still act (backend computes allowed_actions per user & state)
  const openFindings = (findings.data ?? []).filter((f) => (f.allowed_actions ?? []).some((a) => a !== 'note')).length;
  const pendingAR = (ar.data?.to_approve ?? []).filter((a) => String(a.state).toLowerCase() === 'pending').length;
  return openFindings + pendingAR;
}

function UserMenu({ close }: { close: () => void }) {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const t = useT();
  return (
    <div className="py-1">
      <div className="border-b border-border px-3 py-2">
        <div className="font-medium">{me?.user.display_name}</div>
        <div className="text-[11.5px] text-muted">{me?.user.post} · {me?.user.department}</div>
        <div className="mt-1 font-mono text-[10.5px] text-faint">@{me?.user.username} · L{me?.user.clearance} {me?.user.clearance_label}</div>
      </div>
      <MenuItem icon={<User2 size={13} />} onClick={() => { close(); nav('/account'); }}>{t('menu.account')}</MenuItem>
      <MenuItem icon={<MonitorSmartphone size={13} />} onClick={() => { close(); nav('/account#sessions'); }}>{t('menu.sessions')}</MenuItem>
      <MenuItem icon={<Settings size={13} />} onClick={() => { close(); nav('/settings'); }}>{t('menu.settings')}</MenuItem>
      <MenuItem icon={<HelpCircle size={13} />} onClick={() => { close(); nav('/help'); }}>{t('menu.help')}</MenuItem>
      <div className="border-t border-border px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted"><Globe2 size={11} />{t('menu.language')}</div>
        <LangSwitcher />
      </div>
      <div className="my-1 border-t border-border" />
      <MenuItem icon={<LogOut size={13} />} onClick={() => { close(); void logout(false); }}>{t('menu.logout')}</MenuItem>
      <MenuItem danger icon={<KeyRound size={13} />} onClick={() => { close(); void logout(true); }}>{t('menu.logoutAll')}</MenuItem>
    </div>
  );
}

function Rail() {
  const { can, me } = useAuth();
  const t = useT();
  const inbox = useInboxCount(!!me);
  const top: NavItem[] = [
    { to: '/chat', label: t('nav.chat'), icon: <MessageSquare size={18} />, perm: 'chat' },
    { to: '/company', label: t('nav.company'), icon: <Building2 size={18} /> },
    { to: '/knowledge', label: t('nav.knowledge'), icon: <BookOpen size={18} /> },
    { to: '/inbox', label: t('nav.inbox'), icon: <Inbox size={18} />, badge: inbox },
    { to: '/assets', label: t('nav.assets'), icon: <Wrench size={18} /> },
    { to: '/production', label: t('nav.production'), icon: <Factory size={18} />, perm: 'production.view' },
  ];
  const bottom: NavItem[] = [
    { to: '/audit', label: t('nav.audit'), icon: <ScrollText size={18} />, perm: 'audit.view' },
    { to: '/admin', label: t('nav.admin'), icon: <ShieldHalf size={18} />, perm: ADMIN_PERMS },
    { to: '/settings', label: t('nav.settings'), icon: <Settings size={18} /> },
    { to: '/help', label: t('nav.help'), icon: <HelpCircle size={18} /> },
  ];
  const initials = (me?.user.display_name || me?.user.username || '?').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-2">
      <Tip text="Yukti — Sovereign Industrial AI Workbench"><NavLink to="/chat" className="mb-2 mt-0.5"><Logo size={30} /></NavLink></Tip>
      {top.filter((i) => can(i.perm)).map((i) => <RailLink key={i.to} item={i} />)}
      <div className="flex-1" />
      {bottom.filter((i) => can(i.perm)).map((i) => <RailLink key={i.to} item={i} />)}
      <Popover direction="up" className="!bottom-0 !left-full !mb-0 ml-2 w-64"
        trigger={(_o, toggle) => (
          <button onClick={toggle} className="mt-1 flex h-9 w-9 items-center justify-center rounded-full border border-border-strong bg-cyan/15 text-[12px] font-semibold text-cyan hover:border-cyan">
            {initials}
          </button>
        )}>
        {(close) => <UserMenu close={close} />}
      </Popover>
    </nav>
  );
}

/** Read-only model chip for employees (LLM configuration is admin-only). */
function ModelChip() {
  const loaded = useLoaded();
  const st = loaded.data;
  const ready = st?.status === 'ready';
  return (
    <div title="The AI model is managed by your Yukti administrator"
      className="flex h-8 min-w-[240px] max-w-[460px] items-center gap-2 rounded-md border border-border bg-surface-2 px-3">
      {st?.status === 'loading' ? <Spinner size={13} /> : <Dot tone={ready ? 'ok' : st?.status === 'error' ? 'danger' : 'muted'} />}
      <span className={cx('flex-1 truncate text-left', ready ? 'font-medium' : 'text-muted')}>
        {ready ? st?.model_name ?? st?.model_id : st?.status === 'loading' ? 'AI model loading…' : 'AI model not loaded'}
      </span>
    </div>
  );
}

function ModelPill() {
  const loaded = useLoaded();
  const st = loaded.data;
  const ready = st?.status === 'ready';
  const loading = st?.status === 'loading';
  const errored = st?.status === 'error';
  return (
    <button onClick={() => uiStore.openLoader()}
      className={cx('group flex h-8 min-w-[320px] max-w-[560px] items-center gap-2 rounded-md border px-3 transition-colors',
        ready ? 'border-border-strong bg-surface-2 hover:border-cyan/60' : 'border-dashed border-amber/60 bg-amber/5 hover:bg-amber/10')}>
      {loading ? <Spinner size={13} /> : <Dot tone={ready ? 'ok' : errored ? 'danger' : 'amber'} pulse={!ready && !errored} />}
      <span className={cx('flex-1 truncate text-left', ready ? 'font-medium' : 'text-amber')}>
        {ready ? st?.model_name ?? st?.model_id : loading ? `Loading ${st?.model_name ?? st?.model_id ?? 'model'}…` : errored ? 'Load failed — click to retry' : 'Select a model to load'}
      </span>
      {(ready || loading) && st?.engine && <Badge tone="cyan" mono>{ENGINE_LABEL[st.engine] ?? st.engine}</Badge>}
      {ready && typeof st?.ctx_used_pct === 'number' && (
        <span className="flex items-center gap-1 font-mono text-[10.5px] text-muted" title="Context used">
          <span className="h-1.5 w-10 overflow-hidden rounded bg-surface-3"><span className="block h-full bg-cyan" style={{ width: `${Math.min(100, st.ctx_used_pct)}%` }} /></span>
          {Math.round(st.ctx_used_pct)}%
        </span>
      )}
      <span className="hidden font-mono text-[10px] text-faint group-hover:inline">Ctrl+L</span>
    </button>
  );
}

function Notifications() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/api/notifications'), refetchInterval: 20_000, retry: false });
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api.get<Alert[]>('/api/alerts'), refetchInterval: 60_000, retry: false });
  const unread = (notes.data ?? []).filter((n) => !n.read).length;
  const redAlerts = (alerts.data ?? []).filter((a) => a.severity === 'red').length;
  const markRead = async (n: Notification) => {
    if (!n.read) { try { await api.post(`/api/notifications/${n.id}/read`, {}); void qc.invalidateQueries({ queryKey: ['notifications'] }); } catch { /* ignore */ } }
  };
  return (
    <Popover align="right" className="w-[380px]"
      trigger={(open, toggle) => (
        <button onClick={toggle} className={cx('relative flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text', open && 'bg-surface-2 text-text')}>
          <Bell size={16} />
          {unread + redAlerts > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber ring-2 ring-surface" />}
        </button>
      )}>
      {(close) => (
        <div className="max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="font-semibold">Notifications</span>
            <span className="font-mono text-[11px] text-muted">{unread} unread</span>
          </div>
          {(alerts.data ?? []).length > 0 && (
            <div className="border-b border-border">
              <div className="label px-3 pt-2">Compliance alerts</div>
              {(alerts.data ?? []).slice(0, 8).map((a) => (
                <button key={a.id} onClick={() => { close(); nav('/assets'); }} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-3">
                  <AlertTriangle size={13} className={cx('mt-0.5 shrink-0', a.severity === 'red' ? 'text-danger' : a.severity === 'amber' ? 'text-amber' : 'text-cyan')} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px]">{a.title}</div>
                    <div className="truncate text-[11px] text-muted">{a.tag && <span className="font-mono">{a.tag} · </span>}{a.detail}</div>
                  </div>
                  {a.due && <span className="shrink-0 font-mono text-[10.5px] text-faint">{a.due}</span>}
                </button>
              ))}
            </div>
          )}
          {notes.isLoading && <div className="flex items-center gap-2 p-3 text-muted"><Spinner /> Loading…</div>}
          {notes.error ? <div className="p-3 text-[12px] text-muted">Notifications unavailable</div> : null}
          {(notes.data ?? []).length === 0 && !notes.isLoading && !notes.error && (
            <div className="flex flex-col items-center gap-1 p-6 text-muted"><CheckCheck size={18} /> All caught up</div>
          )}
          {(notes.data ?? []).map((n) => (
            <button key={n.id} onClick={() => { void markRead(n); if (n.link) { close(); nav(n.link); } }}
              className="flex w-full items-start gap-2 border-b border-border/50 px-3 py-2 text-left hover:bg-surface-3">
              <span className={cx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-cyan')} />
              <div className="min-w-0 flex-1">
                <div className={cx('text-[12.5px]', !n.read && 'font-medium')}>{n.title}</div>
                {n.body && <div className="line-clamp-2 text-[11.5px] text-muted">{n.body}</div>}
              </div>
              <span className="shrink-0 text-[10.5px] text-faint">{timeAgo(n.created_at)}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

function TopBar() {
  const { me, isLlmAdmin } = useAuth();
  const sys = useSystem();
  const offline = sys.data ? sys.data.offline_guard : true;
  return (
    <header className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-semibold tracking-tight">Yukti</span>
        <span className="hidden truncate text-[11.5px] text-faint xl:inline">Sovereign Industrial AI Workbench</span>
      </div>
      {isLlmAdmin ? <ModelPill /> : <ModelChip />}
      <div className="flex items-center justify-end gap-2">
        <Tip side="bottom" text={offline ? 'Offline guard active: outbound network blocked, all inference on-prem.' : 'Offline guard is OFF'}>
          <span className={cx('hidden items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium md:inline-flex',
            offline ? 'border-ok/40 bg-ok/10 text-green-300' : 'border-amber/40 bg-amber/10 text-amber')}>
            <ShieldCheck size={12} /> {offline ? 'On-prem · offline' : 'Online'}
          </span>
        </Tip>
        <Notifications />
        {me && (
          <Popover align="right" className="w-64"
            trigger={(open, toggle) => (
              <button onClick={toggle} className={cx('flex items-center gap-2 rounded-md border bg-surface-2 py-0.5 pl-2 pr-1 hover:border-border-strong', open ? 'border-border-strong' : 'border-border')}>
                <div className="text-right leading-tight">
                  <div className="max-w-[160px] truncate text-[12px] font-medium">{me.user.display_name}</div>
                  <div className="max-w-[160px] truncate text-[10.5px] text-muted">{me.user.post}</div>
                </div>
                <Badge tone={me.user.clearance >= 3 ? 'amber' : 'cyan'} mono title={`Clearance ${me.user.clearance}`}>L{me.user.clearance} {me.user.clearance_label}</Badge>
              </button>
            )}>
            {(close) => <UserMenu close={close} />}
          </Popover>
        )}
      </div>
    </header>
  );
}

function StatusBar() {
  const sys = useSystem();
  const loaded = useLoaded();
  const { lastGen } = useUI();
  const s = sys.data;
  const st = loaded.data;
  const ramPct = s?.ram ? (s.ram.used_mb / Math.max(1, s.ram.total_mb)) * 100 : 0;
  const Item = ({ children, title }: { children: ReactNode; title?: string }) => (
    <span title={title} className="flex items-center gap-1.5 whitespace-nowrap border-r border-border px-2.5 last:border-r-0">{children}</span>
  );
  return (
    <footer className="flex h-6 shrink-0 items-center overflow-hidden border-t border-border bg-surface font-mono text-[10.5px] text-muted">
      {sys.error && !s ? <Item><Dot tone="danger" /> system stats unavailable</Item> : null}
      {s?.offline_guard && <Item title="All outbound network connections are blocked; nothing leaves this server"><Dot tone="ok" /> offline</Item>}
      {s?.ram && <>
        <Item title="System RAM"><MemoryStick size={11} /> RAM {fmtMB(s.ram.used_mb)} / {fmtMB(s.ram.total_mb)}
          <span className="h-1 w-8 overflow-hidden rounded bg-surface-3"><span className={cx('block h-full', ramPct > 85 ? 'bg-danger' : 'bg-cyan')} style={{ width: `${ramPct}%` }} /></span>
        </Item>
        <Item title={s.cpu?.name}><Cpu size={11} /> CPU {Math.round(s.cpu?.util_pct ?? 0)}%</Item>
        <Item title="GPU">
          <Gauge size={11} />
          {s.gpu ? <>{s.gpu.name} · VRAM {fmtMB(s.gpu.vram_used_mb)} / {fmtMB(s.gpu.vram_total_mb)} · {Math.round(s.gpu.util_pct ?? 0)}%</> : 'No GPU (CPU inference)'}
        </Item>
      </>}
      <Item title="Engine & model">
        <Activity size={11} />
        {st?.status === 'ready' ? <>{ENGINE_LABEL[st.engine ?? ''] ?? st.engine} · <span className="text-text">{st.model_name}</span></> : st?.status === 'loading' ? 'loading…' : 'no model loaded'}
      </Item>
      {lastGen && <Item title="Last generation speed"><Zap size={11} className="text-amber" /> {lastGen.tok_per_s.toFixed(1)} tok/s</Item>}
      <div className="flex-1" />
      {s?.llama_build && <Item title="llama.cpp build">llama.cpp {s.llama_build}</Item>}
      {s && <Item>Yukti v{s.version}</Item>}
    </footer>
  );
}

function Shortcuts() {
  const nav = useNavigate();
  const { isLlmAdmin } = useAuth();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'l' && isLlmAdmin) { e.preventDefault(); uiStore.openLoader(); }
      else if (k === 'n') { e.preventDefault(); nav('/chat'); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [nav, isLlmAdmin]);
  return null;
}

export function AppShell() {
  const loc = useLocation();
  const { isLlmAdmin } = useAuth();
  const key = loc.pathname.split('/')[1];
  return (
    <div className="flex h-full w-full overflow-hidden">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main key={key} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
        <StatusBar />
      </div>
      {isLlmAdmin && <ModelLoader />}
      <IdleWatcher />
      <Shortcuts />
    </div>
  );
}
