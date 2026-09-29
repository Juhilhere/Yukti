import { Link } from 'react-router-dom';
import { ShieldX, Compass } from 'lucide-react';

function ErrorPage({ code, title, body, icon }: { code: string; title: string; body: string; icon: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="text-faint">{icon}</div>
      <div className="font-mono text-[40px] font-semibold text-border-strong">{code}</div>
      <div className="text-[16px] font-semibold">{title}</div>
      <div className="max-w-md text-muted">{body}</div>
      <Link to="/chat" className="btn btn-cyan mt-2">Back to Chat</Link>
    </div>
  );
}
export function Forbidden() {
  return <ErrorPage code="403" title="Access denied by policy" icon={<ShieldX size={36} />}
    body="Your post, department or clearance does not permit this area. Every decision is recorded in the tamper-evident audit log. Ask an approver for a time-bound grant if you need access." />;
}
export function NotFound() {
  return <ErrorPage code="404" title="Page not found" icon={<Compass size={36} />} body="The page you are looking for does not exist in this workbench." />;
}
