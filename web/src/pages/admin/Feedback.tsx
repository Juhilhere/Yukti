import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareText, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api } from '../../lib/api';
import type { FeedbackRow } from '../../lib/types';
import { cx, fmtTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { Badge, Card, EmptyState, QueryState } from '../../components/ui';
import { DataTable, type Column } from '../../components/DataTable';

export default function FeedbackAdmin() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'feedback'], queryFn: () => api.get<FeedbackRow[]>('/api/admin/feedback'), refetchInterval: 30_000 });
  const [filter, setFilter] = useState<'all' | 'up' | 'down'>('all');
  const all = q.data ?? [];
  const rows = useMemo(() => all.filter((r) => filter === 'all' || (filter === 'up' ? r.rating > 0 : r.rating < 0)), [all, filter]);
  const up = all.filter((r) => r.rating > 0).length;
  const down = all.filter((r) => r.rating < 0).length;
  const cols: Column<FeedbackRow>[] = [
    { key: 'created_at', header: t('admin.fb.col.when'), sortValue: (r) => r.created_at, render: (r) => <span className="whitespace-nowrap font-mono text-[11.5px]">{fmtTime(r.created_at)}</span> },
    { key: 'user', header: t('admin.fb.col.user'), render: (r) => r.user || '—' },
    { key: 'rating', header: t('admin.fb.col.rating'), render: (r) => r.rating > 0 ? <Badge tone="ok"><ThumbsUp size={10} />{t('admin.fb.helpful')}</Badge> : <Badge tone="amber"><ThumbsDown size={10} />{t('admin.fb.notHelpful')}</Badge> },
    { key: 'comment', header: t('admin.fb.col.comment'), render: (r) => r.comment ? <div className="max-w-[280px] whitespace-pre-wrap text-[12px]">{r.comment}</div> : <span className="text-faint">—</span> },
    { key: 'question', header: t('admin.fb.col.question'), render: (r) => <div className="line-clamp-3 max-w-[260px] text-[12px] text-muted">{r.question || '—'}</div> },
    { key: 'answer_excerpt', header: t('admin.fb.col.answer'), render: (r) => <div className="line-clamp-3 max-w-[320px] text-[12px] text-muted">{r.answer_excerpt || '—'}</div> },
  ];
  const filters: [typeof filter, string][] = [
    ['all', t('admin.fb.filter.all', { n: all.length })],
    ['up', t('admin.fb.filter.up', { n: up })],
    ['down', t('admin.fb.filter.down', { n: down })],
  ];
  return (
    <div className="p-5">
      <Card title={t('admin.fb.title')} icon={<MessageSquareText size={14} className="text-cyan" />} bodyClass="p-0"
        actions={<div className="flex gap-1">
          {filters.map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={cx('rounded border px-2 py-0.5 text-[11.5px]', filter === k ? 'border-cyan bg-cyan/10 text-cyan' : 'border-border text-muted hover:text-text')}>{l}</button>
          ))}
        </div>}>
        <QueryState q={q} empty={all.length === 0} emptyTitle={t('admin.fb.empty')} emptyHint={t('admin.fb.emptyHint')}>
          <DataTable rows={rows} columns={cols} rowKey={(r) => `${r.message_id}-${r.user}-${r.created_at}`} empty={<EmptyState title={t('admin.fb.noMatch')} />} />
        </QueryState>
      </Card>
    </div>
  );
}
