import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import type { ChatTask } from '../../lib/types';
import type { Checkpoint } from '../../lib/work';
import { Badge, Spinner } from '../ui';
import { WorkerBadge } from '../work/TaskParts';

/** The worker of the durable queue that handled this turn; a note when the assigned model was not available. */
export function TaskBadge({ task }: { task: ChatTask }) {
  const t = useT();
  const fb = !!task.served_by?.fallback;
  return (
    <span className="inline-flex items-center gap-1" title={fb ? t('wb.worker.fallbackTip', { assigned: task.served_by?.assigned ?? '', model: task.served_by?.model ?? '' }) : undefined}>
      <WorkerBadge worker={task.worker} label={task.label} fallback={fb} />
    </span>
  );
}

/** Per-turn checkpoint: KV slot state, cached tokens, tools and approvals (GET /api/chats/{cid}/checkpoints). */
export function TurnDetails({ chatId, messageId }: { chatId: string; messageId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['checkpoints', chatId],
    queryFn: () => api.get<Checkpoint[]>(`/api/chats/${encodeURIComponent(chatId)}/checkpoints`, { silent: true }),
    enabled: open, staleTime: 0, retry: false,
  });
  const cp = (q.data ?? []).find((c) => c.message_id === messageId);
  return (
    <div className="mt-1">
      <button className="inline-flex items-center gap-1 text-[11px] text-faint hover:text-muted" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}<Layers size={11} />{t('wb.turn.title')}
      </button>
      {open && (
        <div className="mt-1 rounded-md border border-border bg-surface/60 px-2.5 py-2 text-[11.5px]">
          {q.isLoading ? <Spinner size={11} /> : !cp ? <span className="text-muted">{t('wb.turn.none')}</span> : (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <WorkerBadge worker={cp.worker} />
                {cp.model && <Badge mono tone="muted">{cp.model}</Badge>}
                <Badge tone={cp.kv?.state === 'hot' || cp.kv?.state === 'restored' ? 'ok' : 'muted'} mono>
                  {t('wb.turn.kv', { state: t(`wb.kv.${cp.kv?.state ?? 'n/a'}`, cp.kv?.state ?? 'n/a') })}
                </Badge>
                {cp.kv?.slot !== undefined && cp.kv?.slot !== null && <Badge mono tone="muted">{t('wb.turn.slot', { n: cp.kv.slot })}</Badge>}
                {typeof cp.kv?.cached_tokens === 'number' && (
                  <Badge mono tone="cyan">{t('wb.turn.cached', { c: cp.kv.cached_tokens, p: cp.kv.prompt_tokens ?? '—' })}</Badge>
                )}
                {cp.kv?.kv_type && <Badge mono tone="muted">KV {cp.kv.kv_type}</Badge>}
              </div>
              {(cp.tools ?? []).length > 0 && (
                <div className="text-muted">{t('wb.turn.tools')}: {cp.tools.map((x, i) => <span key={i} className="mr-1 font-mono">{x.tool}{x.result !== undefined && typeof x.result !== 'object' ? ` (${String(x.result)})` : ''}</span>)}</div>
              )}
              {(cp.approvals ?? []).length > 0 && (
                <div className="text-muted">{t('wb.turn.approvals')}: {cp.approvals.map((a, i) => <span key={i} className="mr-1 font-mono">{a.rule}={a.decision}</span>)}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
