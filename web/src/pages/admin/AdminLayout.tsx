import { Fragment, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet } from 'react-router-dom';
import { ShieldHalf } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { cx } from '../../lib/format';
import { PageHeader } from '../../components/ui';

/** Any of these permissions opens the admin area. */
export const ADMIN_PERMS = ['admin', 'users.manage', 'ai.settings', 'usage.view', 'backup.manage', 'models.manage', 'developer', 'audit.export'];

export const ADMIN_TABS: { to: string; label: string; perm: string | string[] }[] = [
  { to: 'users', label: 'Users', perm: 'users.manage' },
  { to: 'ai', label: 'AI settings', perm: 'ai.settings' },
  { to: 'usage', label: 'Usage & health', perm: 'usage.view' },
  { to: 'feedback', label: 'Feedback', perm: 'usage.view' },
  { to: 'backup', label: 'Backup & export', perm: ['backup.manage', 'audit.export'] },
  { to: 'policies', label: 'Policies & Laya', perm: 'admin' },
  { to: 'models', label: 'Models', perm: 'models.manage' },
  { to: 'features', label: 'New abilities', perm: 'models.manage' },
  { to: 'developer', label: 'Developer', perm: 'developer' },
];

/**
 * Render a translated sentence that contains **bold** text and {name} placeholders filled with elements,
 * so translators always see (and translate) the whole sentence.
 */
export function rich(s: string, parts: Record<string, ReactNode> = {}, boldClass?: string): ReactNode {
  return s.split(/(\{\w+\}|\*\*[^*]+\*\*)/g).map((seg, i) => {
    const m = /^\{(\w+)\}$/.exec(seg);
    if (m && m[1] in parts) return <Fragment key={i}>{parts[m[1]]}</Fragment>;
    if (seg.length > 4 && seg.startsWith('**') && seg.endsWith('**')) return <b key={i} className={boldClass}>{seg.slice(2, -2)}</b>;
    return seg;
  });
}

export function AdminIndex() {
  const { can } = useAuth();
  const first = ADMIN_TABS.find((t) => can(t.perm));
  return first ? <Navigate to={`/admin/${first.to}`} replace /> : <Navigate to="/403" replace />;
}

export default function AdminLayout() {
  const { can } = useAuth();
  const t = useT();
  const tabs = ADMIN_TABS.filter((x) => can(x.perm));
  const label: Record<string, string> = {
    users: t('admin.tab.users'),
    ai: t('admin.tab.ai'),
    usage: t('admin.tab.usage'),
    feedback: t('admin.tab.feedback'),
    backup: t('admin.tab.backup'),
    policies: t('admin.tab.policies'),
    models: t('admin.tab.models'),
    features: t('admin.tab.features'),
    developer: t('admin.tab.developer'),
  };
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('page.admin')} icon={<ShieldHalf size={18} />} subtitle={t('admin.subtitle')} />
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-4">
        {tabs.map((x) => (
          <NavLink key={x.to} to={`/admin/${x.to}`}
            className={({ isActive }) => cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors',
              isActive ? 'border-amber text-text' : 'border-transparent text-muted hover:text-text')}>
            {label[x.to] ?? x.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
