import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { AppShell } from './layout/AppShell';
import Login from './pages/Login';
import Chat from './pages/Chat';
import Knowledge from './pages/Knowledge';
import DocumentView from './pages/DocumentView';
import Inbox from './pages/Inbox';
import Assets from './pages/Assets';
import Production from './pages/Production';
import Audit from './pages/Audit';
import Settings from './pages/Settings';
import Company from './pages/Company';
import Account, { ForcedPasswordChange } from './pages/Account';
import Help from './pages/Help';
import AdminLayout, { AdminIndex, ADMIN_PERMS } from './pages/admin/AdminLayout';
import AdminUsers from './pages/admin/Users';
import AiSettings from './pages/admin/AiSettings';
import UsageHealth from './pages/admin/Usage';
import FeedbackAdmin from './pages/admin/Feedback';
import BackupExport from './pages/admin/Backup';
import PoliciesLaya from './pages/admin/Policies';
import ModelsAdmin from './pages/admin/ModelsAdmin';
import FeatureOffers from './components/FeatureOffers';
import Developer from './pages/Developer';
import { Forbidden, NotFound } from './pages/Errors';
import { Logo } from './components/Logo';
import { Spinner } from './components/ui';
import { useT } from './lib/i18n';

function Splash() {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
      <Logo size={44} />
      <div className="flex items-center gap-2"><Spinner /> {t('shell.starting')}</div>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status, mustChangePassword } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'anon') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (mustChangePassword) return <ForcedPasswordChange />;
  return <>{children}</>;
}

function Perm({ perm, children }: { perm: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? <>{children}</> : <Forbidden />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Navigate to="/chat" replace />} />
        <Route path="/chat/:chatId?" element={<Chat />} />
        <Route path="/company" element={<Company />} />
        <Route path="/knowledge" element={<Knowledge />} />
        <Route path="/knowledge/:id" element={<DocumentView />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/production" element={<Perm perm="production.view"><Production /></Perm>} />
        <Route path="/audit" element={<Perm perm="audit.view"><Audit /></Perm>} />
        <Route path="/admin" element={<Perm perm={ADMIN_PERMS}><AdminLayout /></Perm>}>
          <Route index element={<AdminIndex />} />
          <Route path="users" element={<Perm perm="users.manage"><AdminUsers /></Perm>} />
          <Route path="ai" element={<Perm perm="ai.settings"><AiSettings /></Perm>} />
          <Route path="usage" element={<Perm perm="usage.view"><UsageHealth /></Perm>} />
          <Route path="feedback" element={<Perm perm="usage.view"><FeedbackAdmin /></Perm>} />
          <Route path="backup" element={<Perm perm={['backup.manage', 'audit.export']}><BackupExport /></Perm>} />
          <Route path="policies" element={<Perm perm="admin"><PoliciesLaya /></Perm>} />
          <Route path="models" element={<Perm perm="models.manage"><ModelsAdmin /></Perm>} />
          <Route path="features" element={<Perm perm="models.manage"><div className="p-4"><FeatureOffers variant="panel" /></div></Perm>} />
          <Route path="developer" element={<Perm perm="developer"><Developer /></Perm>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        {/* legacy routes */}
        <Route path="/models" element={<Navigate to="/admin/models" replace />} />
        <Route path="/discover" element={<Navigate to="/admin/models" replace />} />
        <Route path="/developer" element={<Navigate to="/admin/developer" replace />} />
        <Route path="/account" element={<Account />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/help" element={<Help />} />
        <Route path="/403" element={<Forbidden />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
