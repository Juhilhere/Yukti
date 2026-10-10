import { useQuery } from '@tanstack/react-query';
import { Layers, ListOrdered } from 'lucide-react';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { timeAgo } from '../../lib/format';
import type { QueueStats, TaskOut } from '../../lib/work';
import { Badge, Card, Dot, Loading, ErrorBox, StatusChip } from '../../components/ui';
import { DataTable, type Column } from '../../components/DataTable';
import { WorkerBadge } from '../../components/work/TaskParts';
import { KvStatsView } from './PerfEngine';

const ORDER = ['queued', 'running', 'waiting_review', 'done', 'error', 'interrupted'];

export default function WorkQueue() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'queue'], queryFn: () => api.get<QueueStats>('/api/admin/queue'), refetchInterval: 3000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="p-5"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>;
  const d = q.data!;
  const cols: Column<TaskOut>[] = [
    { key: 'created_at', header: t('wq.col.when'), render: (x) => <span className="text-muted">{timeAgo(x.created_at)}</span> },
    { key: 'kind', header: t('wq.col.kind'), mono: true, render: (x) => t(`wq.kind.${x.kind}`, x.kind) },
    { key: 'worker', header: t('wq.col.worker'), render: (x) => <WorkerBadge worker={x.worker} label={x.worker_label} /> },
    { key: 'status', header: t('wq.col.status'), render: (x) => <StatusChip status={x.status} /> },
    { key: 'steps', header: t('wq.col.steps'), sortValue: (x) => x.steps.length,
      render: (x) => <span className="font-mono text-[11.5px] text-muted">{x.steps.filter((s) => s.status === 'done').length}/{x.steps.length}</span> },
    { key: 'attempts', header: t('wq.col.attempts'), mono: true, render: (x) => String(x.attempts ?? 0) },
    { key: 'served_by', header: t('wq.col.servedBy'), render: (x) => <span className="font-mono text-[11.5px] text-muted">{x.served_by || '—'}</span> },
    { key: 'error', header: t('wq.col.error'), render: (x) => <span className="line-clamp-1 text-[11.5px] text-red-300" title={x.error ?? ''}>{x.error || ''}</span> },
  ];
  return (
    <div className="space-y-4 p-5">
      <div className="text-[12.5px] text-muted">{t('wq.intro')}</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {d.workers.map((w) => (
          <div key={w.id} className="rounded-md border border-border bg-surface p-3">
            <div className="flex items-center gap-2">
              <Dot tone={w.running > 0 ? 'cyan' : 'muted'} pulse={w.running > 0} />
              <WorkerBadge worker={w.id} label={w.label} fallback={w.served_by?.fallback} />
              <span className="ml-auto font-mono text-[11px] text-faint">{t('wq.concurrency', { run: w.running, max: w.concurrency })}</span>
            </div>
            <div className="mt-1.5 text-[12px] text-muted">{t(`wq.purpose.${w.id}`, w.purpose)}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {ORDER.filter((s) => w.counts?.[s]).map((s) => <span key={s} className="inline-flex items-center gap-1"><StatusChip status={s} /><span className="font-mono text-[11px]">{w.counts[s]}</span></span>)}
              {Object.keys(w.counts ?? {}).length === 0 && <span className="text-[11px] text-faint">{t('wq.noTasks')}</span>}
            </div>
            <div className="mt-2 text-[11px] text-muted">
              {t('wq.servedBy')}: <span className="font-mono">{w.served_by?.model === 'deterministic' ? t('wq.deterministic') : (w.served_by?.model || t('wq.noModel'))}</span>
              {w.served_by?.assigned && <span> · {t('wq.assigned')}: <span className="font-mono">{w.served_by.assigned}</span></span>}
              {w.served_by?.fallback && <Badge tone="amber" className="ml-1">{t('wb.worker.fallback')}</Badge>}
            </div>
          </div>
        ))}
      </div>
      {d.kv && <Card title={t('perf.kv.title')} icon={<Layers size={14} className="text-cyan" />}><KvStatsView kv={d.kv} /></Card>}
      <Card title={t('wq.recent', { n: d.recent.length })} icon={<ListOrdered size={14} className="text-cyan" />} bodyClass="p-0">
        <DataTable rows={d.recent} columns={cols} rowKey={(x) => x.id} maxHeight="520px" />
      </Card>
    </div>
  );
}
