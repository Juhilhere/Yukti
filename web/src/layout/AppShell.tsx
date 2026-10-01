import { ErrorBoundary } from '../components/ErrorBoundary';
import { ReportProblem } from '../components/ReportProblem';
import { useEffect, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, Bell, BookOpen, Building2, Cpu, Factory, Globe2, HelpCircle, Inbox, KeyRound, LogOut, MemoryStick, MessageSquare,
  MonitorSmartphone, Settings, ShieldCheck, ShieldHalf, ScrollText, User2, Wrench, Gauge, Zap, AlertTriangle, CheckCheck,
  Bug, Eye,
} from 'lucide-react';
import { useT } from '../lib/i18n';
import { ADMIN_PERMS } from '../pages/admin/AdminLayout';
import { FINDINGS_PERMS, INBOX_PERMS, useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { uiStore, useLoaded, useSystem, useUI } from '../lib/queries';
import type { AccessRequest, Alert, Finding, Notification } from '../lib/types';
import { cx, fmtMB, timeAgo } from '../lib/format';
import { Logo } from '../components/Logo';
import { Badge, Dot, LangSwitcher, MenuItem, Popover, Spinner, Tip } from '../components/ui';
import { ModelLoader, ENGINE_LABEL } from './ModelLoader';
import { IdleWatcher } from './IdleWatcher';

/** strict: need-to-know page; the IT 'admin' role alone does not show it (see useAuth().has). */
type NavItem = { to: string; label: string; icon: ReactNode; perm?: string | string[]; strict?: boolean; badge?: number };

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
  const { can } = useAuth();
  // only ask for findings when the role may see them (otherwise the server refuses every 30 s)
  const findings = useQuery({ queryKey: ['findings'], queryFn: () => api.get<Finding[]>('/api/findings'), refetchInterval: 30_000, enabled: enabled && can(FINDINGS_PERMS), retry: false });
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
        <div className="text-[11.5px] text-muted">{[me?.user.post, me?.user.department].filter(Boolean).join(' · ')}</div>
        <div className="mt-1 font-mono text-[10.5px] text-faint">@{me?.user.username} · L{me?.user.clearance} {me?.user.clearance_label}</div>
      </div>
      <MenuItem icon={<User2 size={13} />} onClick={() => { close(); nav('/account'); }}>{t('menu.account')}</MenuItem>
      <MenuItem icon={<MonitorSmartphone size={13} />} onClick={() => { close(); nav('/account#sessions'); }}>{t('menu.sessions')}</MenuItem>
      <MenuItem icon={<Settings size={13} />} onClick={() => { close(); nav('/settings'); }}>{t('menu.settings')}</MenuItem>
      <MenuItem icon={<HelpCircle size={13} />} onClick={() => { close(); nav('/help'); }}>{t('menu.help')}</MenuItem>
      <MenuItem icon={<Bug size={13} />} onClick={() => { close(); uiStore.openReport(); }}>{t('menu.report', 'Report a problem')}</MenuItem>
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
  const { can, has, me } = useAuth();
  const t = useT();
  const inbox = useInboxCount(!!me && can(INBOX_PERMS));
  const top: NavItem[] = [
    { to: '/chat', label: t('nav.chat'), icon: <MessageSquare size={18} />, perm: 'chat' },
    { to: '/company', label: t('nav.company'), icon: <Building2 size={18} />, perm: 'company.view', strict: true },
    { to: '/knowledge', label: t('nav.knowledge'), icon: <BookOpen size={18} />, perm: 'documents.view' },
    { to: '/inbox', label: t('nav.inbox'), icon: <Inbox size={18} />, perm: INBOX_PERMS, badge: inbox },
    { to: '/assets', label: t('nav.assets'), icon: <Wrench size={18} />, perm: 'assets.view' },
    { to: '/production', label: t('nav.production'), icon: <Factory size={18} />, perm: 'production.view' },
  ];
  const bottom: NavItem[] = [
    { to: '/audit', label: t('nav.audit'), icon: <ScrollText size={18} />, perm: 'audit.view' },
    { to: '/admin', label: t('nav.admin'), icon: <ShieldHalf size={18} />, perm: ADMIN_PERMS },
    { to: '/settings', label: t('nav.settings'), icon: <Settings size={18} /> },
    { to: '/help', label: t('nav.help'), icon: <HelpCircle size={18} /> },
  ];
  const allowed = (i: NavItem) => (i.strict && i.perm ? has(i.perm) : can(i.perm));
  const initials = (me?.user.display_name || me?.user.username || '?').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-2">
      <Tip text={`Yukti — ${t('login.title')}`}><NavLink to="/chat" className="mb-2 mt-0.5"><Logo size={30} /></NavLink></Tip>
      {top.filter(allowed).map((i) => <RailLink key={i.to} item={i} />)}
      <div className="flex-1" />
      {bottom.filter(allowed).map((i) => <RailLink key={i.to} item={i} />)}
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
  const t = useT();
  const loaded = useLoaded();
  const st = loaded.data;
  const ready = st?.status === 'ready';
  return (
    <div title={t('shell.model.managedByAdmin')}
      className="flex h-8 min-w-[240px] max-w-[460px] items-center gap-2 rounded-md border border-border bg-surface-2 px-3">
      {st?.status === 'loading' ? <Spinner size={13} /> : <Dot tone={ready ? 'ok' : st?.status === 'error' ? 'danger' : 'muted'} />}
      <span className={cx('flex-1 truncate text-left', ready ? 'font-medium' : 'text-muted')}>
        {ready ? st?.model_name ?? st?.model_id : st?.status === 'loading' ? t('shell.model.loading') : t('shell.model.notLoaded')}
      </span>
      {ready && st?.vision && <VisionMark />}
    </div>
  );
}

/** Small eye mark: the loaded AI model can look at photos itself. */
function VisionMark() {
  const t = useT();
  return (
    <span title={t('photo.model.visionTip')} aria-label={t('photo.model.vision')}
      className="inline-flex items-center gap-1 rounded border border-violet-500/40 bg-violet-500/10 px-1 py-px text-[10.5px] text-violet-300">
      <Eye size={11} /><span className="hidden xl:inline">{t('photo.model.vision')}</span>
    </span>
  );
}

function ModelPill() {
  const t = useT();
  const loaded = useLoaded();
  const st = loaded.data;
  const ready = st?.status === 'ready';
  const loading = st?.status === 'loading';
  const errored = st?.status === 'error';
  return (
    <button onClick={() => uiStore.openLoader()}
      className={cx('group flex h-8 min-w-[260px] max-w-[420px] items-center xl:min-w-[320px] 2xl:max-w-[560px] gap-2 rounded-md border px-3 transition-colors',
        ready ? 'border-border-strong bg-surface-2 hover:border-cyan/60' : 'border-dashed border-amber/60 bg-amber/5 hover:bg-amber/10')}>
      {loading ? <Spinner size={13} /> : <Dot tone={ready ? 'ok' : errored ? 'danger' : 'amber'} pulse={!ready && !errored} />}
      <span className={cx('flex-1 truncate text-left', ready ? 'font-medium' : 'text-amber')}>
        {ready ? st?.model_name ?? st?.model_id : loading ? t('shell.model.loadingName', { name: st?.model_name ?? st?.model_id ?? t('shell.model.theModel') }) : errored ? t('shell.model.loadFailed') : t('shell.model.select')}
      </span>
      {ready && st?.vision && <VisionMark />}
      {(ready || loading) && st?.engine && <Badge tone="cyan" mono>{ENGINE_LABEL[st.engine] ?? st.engine}</Badge>}
      {ready && typeof st?.ctx_used_pct === 'number' && (
        <span className="flex items-center gap-1 font-mono text-[10.5px] text-muted" title={t('shell.model.ctxUsed')}>
          <span className="h-1.5 w-10 overflow-hidden rounded bg-surface-3"><span className="block h-full bg-cyan" style={{ width: `${Math.min(100, st.ctx_used_pct)}%` }} /></span>
          {Math.round(st.ctx_used_pct)}%
        </span>
      )}
      <span className="hidden font-mono text-[10px] text-faint group-hover:inline">Ctrl+L</span>
    </button>
  );
}

function Notifications() {
  const t = useT();
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
        <button onClick={toggle} title={t('shell.notif.title')} aria-label={t('shell.notif.title')} className={cx('relative flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text', open && 'bg-surface-2 text-text')}>
          <Bell size={16} />
          {unread + redAlerts > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber ring-2 ring-surface" />}
        </button>
      )}>
      {(close) => (
        <div className="max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="font-semibold">{t('shell.notif.title')}</span>
            <span className="font-mono text-[11px] text-muted">{t('shell.notif.unread', { n: unread })}</span>
          </div>
          {(alerts.data ?? []).length > 0 && (
            <div className="border-b border-border">
              <div className="label px-3 pt-2">{t('shell.notif.alerts')}</div>
              {(alerts.data ?? []).slice(0, 8).map((a) => (
                <button key={a.id} onClick={() => { close(); nav(a.tag ? `/assets?q=${encodeURIComponent(a.tag)}` : '/assets'); }} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-3">
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
          {notes.isLoading && <div className="flex items-center gap-2 p-3 text-muted"><Spinner /> {t('common.loading')}</div>}
          {notes.error ? <div className="p-3 text-[12px] text-muted">{t('shell.notif.unavailable')}</div> : null}
          {(notes.data ?? []).length === 0 && !notes.isLoading && !notes.error && (
            <div className="flex flex-col items-center gap-1 p-6 text-muted"><CheckCheck size={18} /> {t('shell.notif.empty')}</div>
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
  const t = useT();
  const { me, isLlmAdmin } = useAuth();
  const sys = useSystem();
  const offline = sys.data ? sys.data.offline_guard : true;
  return (
    <header className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-semibold tracking-tight">Yukti</span>
        <span className="hidden truncate text-[11.5px] text-faint xl:inline">{t('login.title')}</span>
      </div>
      {isLlmAdmin ? <ModelPill /> : <ModelChip />}
      <div className="flex items-center justify-end gap-2">
        <Tip side="bottom" text={offline ? t('shell.offline.onTip') : t('shell.offline.offTip')}>
          <span className={cx('hidden items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium md:inline-flex',
            offline ? 'border-ok/40 bg-ok/10 text-green-300' : 'border-amber/40 bg-amber/10 text-amber')}>
            <ShieldCheck size={12} /> {offline ? t('shell.offline.on') : t('shell.offline.off')}
          </span>
        </Tip>
        <Notifications />
        {me && (
          <Popover align="right" className="w-64"
            trigger={(open, toggle) => (
              <button onClick={toggle} className={cx('flex items-center gap-2 rounded-md border bg-surface-2 py-0.5 pl-2 pr-1 hover:border-border-strong', open ? 'border-border-strong' : 'border-border')}>
                <div className={cx('text-right leading-tight', isLlmAdmin && 'hidden xl:block')}>
                  <div className="max-w-[160px] truncate text-[12px] font-medium">{me.user.display_name}</div>
                  <div className="max-w-[160px] truncate text-[10.5px] text-muted">{me.user.post}</div>
                </div>
                <Badge tone={me.user.clearance >= 3 ? 'amber' : 'cyan'} mono title={t('shell.clearance', { n: me.user.clearance })}>L{me.user.clearance} {me.user.clearance_label}</Badge>
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
  const t = useT();
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
      {sys.error && !s ? <Item><Dot tone="danger" /> {t('shell.status.statsUnavailable')}</Item> : null}
      {s?.offline_guard && <Item title={t('shell.status.offlineTip')}><Dot tone="ok" /> {t('shell.status.offline')}</Item>}
      {s?.ram && <>
        <Item title={t('shell.status.ram')}><MemoryStick size={11} /> RAM {fmtMB(s.ram.used_mb)} / {fmtMB(s.ram.total_mb)}
          <span className="h-1 w-8 overflow-hidden rounded bg-surface-3"><span className={cx('block h-full', ramPct > 85 ? 'bg-danger' : 'bg-cyan')} style={{ width: `${ramPct}%` }} /></span>
        </Item>
        <Item title={s.cpu?.name}><Cpu size={11} /> CPU {Math.round(s.cpu?.util_pct ?? 0)}%</Item>
        <Item title={s.gpu?.name ?? 'GPU'}>
          <Gauge size={11} />
          {s.gpu ? <><span className="hidden 2xl:inline">{s.gpu.name} · </span>VRAM {fmtMB(s.gpu.vram_used_mb)} / {fmtMB(s.gpu.vram_total_mb)} · {Math.round(s.gpu.util_pct ?? 0)}%</> : t('shell.status.noGpu')}
        </Item>
      </>}
      <Item title={t('shell.status.engineModel')}>
        <Activity size={11} />
        {st?.status === 'ready' ? <>{ENGINE_LABEL[st.engine ?? ''] ?? st.engine} · <span className="text-text">{st.model_name}</span></> : st?.status === 'loading' ? t('shell.status.loading') : t('shell.status.noModel')}
      </Item>
      {lastGen && typeof lastGen.tok_per_s === 'number' && <Item title={t('shell.status.lastSpeed')}><Zap size={11} className="text-amber" /> {lastGen.tok_per_s.toFixed(1)} tok/s</Item>}
      <div className="flex-1" />
      {s?.llama_build && <span className="hidden xl:contents"><Item title={t('shell.status.llamaBuild')}>llama.cpp {s.llama_build}</Item></span>}
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
  const { isLlmAdmin, seesSystem } = useAuth();
  const key = loc.pathname.split('/')[1];
  // the desktop app's Help > Report a problem (and any link to #report-problem) opens the report dialog
  useEffect(() => {
    const check = () => { if (window.location.hash === '#report-problem') { uiStore.openReport(); history.replaceState(null, '', window.location.pathname + window.location.search); } };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);
  return (
    <div className="flex h-full w-full overflow-hidden">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main key={key} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ErrorBoundary resetKey={loc.pathname}><Outlet /></ErrorBoundary>
        </main>
        {/* computer, engine and build details are for administrators; the top bar already shows everyone that Yukti runs
            on-premise and offline, and which AI model answers */}
        {seesSystem && <StatusBar />}
      </div>
      {isLlmAdmin && <ModelLoader />}
      <ReportProblem />
      <IdleWatcher />
      <Shortcuts />
    </div>
  );
}
