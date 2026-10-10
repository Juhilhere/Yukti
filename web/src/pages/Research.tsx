import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FlaskConical, Send, ShieldOff } from 'lucide-react';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { num } from '../lib/format';
import type { ResearchAnswer, ResearchStatus } from '../lib/work';
import { Badge, Card, ErrorBox, PageHeader, Spinner, StatusChip } from '../components/ui';

export default function Research() {
  const t = useT();
  const st = useQuery({ queryKey: ['research', 'status'], queryFn: () => api.get<ResearchStatus>('/api/research/status'), refetchInterval: 5000 });
  const [question, setQuestion] = useState('');
  const ask = useMutation({ mutationFn: () => api.post<ResearchAnswer>('/api/research/ask', { question: question.trim() }) });
  const ready = st.data?.status === 'ready';
  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={<FlaskConical size={18} />} title={t('rs.title')} subtitle={t('rs.subtitle')}
        actions={st.data ? <><StatusChip status={st.data.status} />{st.data.model && <Badge mono tone="muted">{st.data.model}</Badge>}</> : undefined} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="rounded-md border-2 border-danger/60 bg-danger/10 px-4 py-3 text-center">
          <div className="text-[22px] font-bold tracking-[0.2em] text-red-300">{t('rs.experimental')}</div>
          <div className="mt-1 text-[12.5px] text-red-200">{st.data?.label || t('rs.labelFallback')}</div>
        </div>
        {st.error ? <ErrorBox error={st.error} onRetry={() => st.refetch()} /> : null}
        {st.data && !ready && <div className="rounded-md border border-amber/40 bg-amber/10 px-3 py-2 text-[12.5px] text-amber">{st.data.error || t('rs.notReady')}</div>}
        <Card title={t('rs.ask')}>
          <div className="space-y-2">
            <textarea className="input min-h-[90px]" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('rs.ph')} />
            <div className="flex items-center gap-2">
              <button className="btn btn-primary" disabled={!ready || question.trim().length < 3 || ask.isPending} onClick={() => ask.mutate()}>
                {ask.isPending ? <Spinner className="!text-[#1a1204]" /> : <Send size={13} />}{t('rs.send')}
              </button>
              <span className="text-[11.5px] text-faint">{t('rs.noDocs')}</span>
            </div>
          </div>
        </Card>
        {ask.error ? <ErrorBox error={ask.error} /> : null}
        {ask.data && (
          <Card title={<span className="flex items-center gap-2">{t('rs.answer')} <Badge tone="danger">{t('rs.experimental')}</Badge></span>}
            actions={<>{ask.data.model && <Badge mono tone="muted">{ask.data.model}</Badge>}<span className="font-mono text-[11px] text-faint">{num(ask.data.ms / 1000, 1)} s</span></>}>
            <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{ask.data.answer}</div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-2 text-[11.5px] text-muted">
              <ShieldOff size={12} className="text-amber" />
              {t('rs.isolation')}
              <Badge tone={ask.data.isolation.documents === 'denied' ? 'ok' : 'danger'} mono>{t('rs.documents', { v: ask.data.isolation.documents })}</Badge>
              {(ask.data.isolation.rule ?? []).map((r) => <Badge key={r} mono tone="muted">{r}</Badge>)}
            </div>
            <div className="mt-1 text-[11px] text-faint">{ask.data.label}</div>
          </Card>
        )}
      </div>
    </div>
  );
}
