import { Link } from 'react-router-dom';
import { ShieldX, Compass } from 'lucide-react';
import { useT } from '../lib/i18n';

function ErrorPage({ code, title, body, icon }: { code: string; title: string; body: string; icon: React.ReactNode }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="text-faint">{icon}</div>
      <div className="font-mono text-[40px] font-semibold text-border-strong">{code}</div>
      <div className="text-[16px] font-semibold">{title}</div>
      <div className="max-w-md text-muted">{body}</div>
      <Link to="/chat" className="btn btn-cyan mt-2">{t('errors.backToChat')}</Link>
    </div>
  );
}
export function Forbidden() {
  const t = useT();
  return <ErrorPage code="403" title={t('errors.403.title')} icon={<ShieldX size={36} />} body={t('errors.403.body')} />;
}
export function NotFound() {
  const t = useT();
  return <ErrorPage code="404" title={t('errors.404.title')} icon={<Compass size={36} />} body={t('errors.404.body')} />;
}
