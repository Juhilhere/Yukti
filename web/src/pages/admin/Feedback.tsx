import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareText, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api } from '../../lib/api';
import type { FeedbackRow } from '../../lib/types';
import { cx, fmtTime } from '../../lib/format';
import { Badge, Card, EmptyState, QueryState } from '../../components/ui';
import { DataTable, type Column } from '../../components/DataTable';

export default function FeedbackAdmin() {
  const q = useQuery({ queryKey: ['admin', 'feedback'], queryFn: () => api.get<FeedbackRow[]>('/api/admin/feedback'), refetchInterval: 30_000 });
  const [filter, setFilter] = useState<'all' | 'up' | 'down'>('all');
  const all = q.data ?? [];
  const rows = useMemo(() => all.filter((r) => filter === 'all' || (filter === 'up' ? r.rating > 0 : r.rating < 0)), [all, filter]);
  const up = all.filter((r) => r.rating > 0).length;
  const down = all.filter((r) => r.rating < 0).length;
  const cols: Column<FeedbackRow>[] = [
    { key: 'created_at', header: 'When', sortValue: (r) => r.created_at, render: (r) => <span className="whitespace-nowrap font-mono text-[11.5px]">{fmtTime(r.created_at)}</span> },
    { key: 'user', header: 'User', render: (r) => r.user || '—' },
    { key: 'rating', header: 'Rating', render: (r) => r.rating > 0 ? <Badge tone="ok"><ThumbsUp size={10} />helpful</Badge> : <Badge tone="amber"><ThumbsDown size={10} />not helpful</Badge> },
    { key: 'comment', header: 'Comment', render: (r) => r.comment ? <div className="max-w-[280px] whitespace-pre-wrap text-[12px]">{r.comment}</div> : <span className="text-faint">—</span> },
    { key: 'question', header: 'Question', render: (r) => <div className="line-clamp-3 max-w-[260px] text-[12px] text-muted">{r.question || '—'}</div> },
    { key: 'answer_excerpt', header: 'Answer (excerpt)', render: (r) => <div className="line-clamp-3 max-w-[320px] text-[12px] text-muted">{r.answer_excerpt || '—'}</div> },
  ];
  return (
    <div className="p-5">
      <Card title="Answer feedback" icon={<MessageSquareText size={14} className="text-cyan" />} bodyClass="p-0"
        actions={<div className="flex gap-1">
          {([['all', `All ${all.length}`], ['up', `Helpful ${up}`], ['down', `Not helpful ${down}`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={cx('rounded border px-2 py-0.5 text-[11.5px]', filter === k ? 'border-cyan bg-cyan/10 text-cyan' : 'border-border text-muted hover:text-text')}>{l}</button>
          ))}
        </div>}>
        <QueryState q={q} empty={all.length === 0} emptyTitle="No feedback yet" emptyHint="Employees can rate answers with thumbs up / down in chat.">
          <DataTable rows={rows} columns={cols} rowKey={(r) => `${r.message_id}-${r.user}-${r.created_at}`} empty={<EmptyState title="No feedback matches" />} />
        </QueryState>
      </Card>
    </div>
  );
}
