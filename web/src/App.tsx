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
import Developer from './pages/Developer';
import Models from './pages/Models';
import Discover from './pages/Discover';
import Audit from './pages/Audit';
import Admin from './pages/Admin';
import Settings from './pages/Settings';
import Company from './pages/Company';
import { Forbidden, NotFound } from './pages/Errors';
import { Logo } from './components/Logo';
import { Spinner } from './components/ui';

function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
      <Logo size={44} />
      <div className="flex items-center gap-2"><Spinner /> Starting Yukti…</div>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'anon') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
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
        <Route path="/developer" element={<Developer />} />
        <Route path="/models" element={<Models />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/audit" element={<Perm perm="audit.view"><Audit /></Perm>} />
        <Route path="/admin" element={<Perm perm="admin"><Admin /></Perm>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/403" element={<Forbidden />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
