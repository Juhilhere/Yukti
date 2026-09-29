import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { KeyRound, Monitor, Settings as SettingsIcon, ShieldCheck, User as UserIcon } from 'lucide-react';
import { countdown, fmtTime, roleLabel } from '../lib/format';
import { useT } from '../lib/i18n';
import { setSettings, useSettings } from '../lib/settings';
import { useAuth } from '../lib/auth';
import { Badge, Card, EmptyState, LangSwitcher, PageHeader, Toggle } from '../components/ui';

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
  const { me } = useAuth();
  const t = useT();
  const now = useNow();
  const u = me?.user;
  const loc = useLocation();
  useEffect(() => {
    if (!loc.hash) return;
    const el = document.getElementById(loc.hash.slice(1));
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('hl-flash'); setTimeout(() => el.classList.remove('hl-flash'), 2200); }
  }, [loc.hash]);

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={t('page.settings')} icon={<SettingsIcon size={18} />} subtitle={t('settings.subtitle')}
        actions={<Link to="/account" className="btn btn-sm"><ShieldCheck size={12} />{t('menu.account')}</Link>} />
      <div className="grid gap-4 p-5 xl:grid-cols-2">
        <Card title={t('settings.app')} icon={<Monitor size={14} className="text-cyan" />} bodyClass="px-3 py-1 divide-y divide-border">
          <Row title={t('account.language')} hint="English / हिंदी / ಕನ್ನಡ"><LangSwitcher /></Row>
          <Row title={t('settings.fullWidth')} hint={t('settings.fullWidth.hint')}><Toggle checked={st.chatFullWidth} onChange={(v) => setSettings({ chatFullWidth: v })} /></Row>
          <Row title={t('settings.stats')} hint={t('settings.stats.hint')}><Toggle checked={st.showStats} onChange={(v) => setSettings({ showStats: v })} /></Row>
          <Row title={t('settings.enter')} hint={t('settings.enter.hint')}><Toggle checked={st.sendWithEnter} onChange={(v) => setSettings({ sendWithEnter: v })} /></Row>
        </Card>

        <Card id="profile" title={t('settings.profile')} icon={<UserIcon size={14} className="text-amber" />}>
          {!u ? <EmptyState title={t('settings.notSignedIn')} /> : (
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
                <div><div className="label mb-1">{t('login.username')}</div><span className="font-mono">{u.username}</span></div>
                <div><div className="label mb-1">{t('settings.roles')}</div><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} tone="amber" mono>{roleLabel(r)}</Badge>)}</div></div>
                <div className="col-span-2"><div className="label mb-1">{t('settings.assetScopes')}</div><div className="flex flex-wrap gap-1">{u.asset_scopes.length ? u.asset_scopes.map((r) => <Badge key={r} tone="cyan" mono>{r}</Badge>) : <span className="text-muted">—</span>}</div></div>
                <div className="col-span-2"><div className="label mb-1">{t('settings.permissions')}</div><div className="flex flex-wrap gap-1">{(me?.permissions ?? []).map((p) => <Badge key={p} mono tone="muted">{p}</Badge>)}</div></div>
                <div className="col-span-2">
                  <div className="label mb-1">{t('settings.grants')}</div>
                  {(me?.grants ?? []).length === 0 ? <span className="text-muted">{t('common.none')}</span> : (
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
                    {t('settings.sessionInfo', { min: Math.round(me.session.idle_timeout_s / 60), at: fmtTime(me.session.abs_expires_at) })}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>

      </div>
    </div>
  );
}
