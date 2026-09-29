import { Navigate, NavLink, Outlet } from 'react-router-dom';
import { ShieldHalf } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { cx } from '../../lib/format';
import { PageHeader } from '../../components/ui';

/** Any of these permissions opens the admin area. */
export const ADMIN_PERMS = ['admin', 'users.manage', 'ai.settings', 'usage.view', 'backup.manage', 'models.manage', 'developer'];

export const ADMIN_TABS: { to: string; label: string; perm: string | string[] }[] = [
  { to: 'users', label: 'Users', perm: 'users.manage' },
  { to: 'ai', label: 'AI settings', perm: 'ai.settings' },
  { to: 'usage', label: 'Usage & health', perm: 'usage.view' },
  { to: 'feedback', label: 'Feedback', perm: 'usage.view' },
  { to: 'backup', label: 'Backup & export', perm: ['backup.manage', 'audit.view'] },
  { to: 'policies', label: 'Policies & Laya', perm: 'admin' },
  { to: 'models', label: 'Models', perm: 'models.manage' },
  { to: 'developer', label: 'Developer', perm: 'developer' },
];

export function AdminIndex() {
  const { can } = useAuth();
  const first = ADMIN_TABS.find((t) => can(t.perm));
  return first ? <Navigate to={`/admin/${first.to}`} replace /> : <Navigate to="/403" replace />;
}

export default function AdminLayout() {
  const { can } = useAuth();
  const t = useT();
  const tabs = ADMIN_TABS.filter((x) => can(x.perm));
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('page.admin')} icon={<ShieldHalf size={18} />} subtitle="Users, organisation AI settings, usage, backups, policies and models — every change is audited" />
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-4">
        {tabs.map((x) => (
          <NavLink key={x.to} to={`/admin/${x.to}`}
            className={({ isActive }) => cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors',
              isActive ? 'border-amber text-text' : 'border-transparent text-muted hover:text-text')}>
            {x.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
