import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, ShieldAlert } from 'lucide-react';
import type { Denied, Source } from '../../lib/types';
import { Badge, ProvenanceBadges, StatusChip } from '../ui';
import { useT } from '../../lib/i18n';
import { sourceElId } from './types';
import { AccessRequestDialog } from './AccessRequestDialog';

export function SourcesRow({ msgId, sources }: { msgId: string; sources: Source[] }) {
  const nav = useNavigate();
  const t = useT();
  if (!sources?.length) return null;
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-2">
        <FileText size={12} className="text-cyan" />
        <span className="label">{t('chat.sources')}</span>
        <span className="font-mono text-[10.5px] text-faint">{sources.length}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1.5">
        {sources.map((s) => (
          <button key={s.id} id={sourceElId(msgId, s.id)} onClick={() => nav(`/knowledge/${s.document_id}?page=${s.page}`)}
            className="group w-[260px] shrink-0 rounded-md border border-border bg-surface p-2.5 text-left transition-colors hover:border-cyan/50 hover:bg-surface-2">
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-cyan/15 px-1.5 font-mono text-[10.5px] font-semibold text-cyan">{s.id}</span>
              <span className="truncate font-mono text-[11px] text-muted">{s.doc_number}</span>
              <span className="ml-auto font-mono text-[10.5px] text-faint">{typeof s.score === 'number' ? s.score.toFixed(2) : ''}</span>
            </div>
            <div className="mt-1 line-clamp-1 font-medium text-[12.5px] group-hover:text-cyan">{s.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Badge mono tone="muted">Rev {s.revision || '—'}</Badge>
              <StatusChip status={s.status} />
              <Badge mono tone="muted">p.{s.page}</Badge>
              {s.classification && <StatusChip status={s.classification} />}
              <ProvenanceBadges isExample={s.is_example} isPublic={s.is_public} />
            </div>
            <div className="mt-1.5 line-clamp-3 text-[11.5px] leading-snug text-muted">{s.snippet}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function DeniedCard({ denied, question }: { denied: Denied; question?: string }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  if (!denied || !denied.count) return null;
  const depts = denied.departments ?? [];
  return (
    <div className="mt-3 flex items-center gap-3 rounded-md border border-amber/40 bg-amber/[0.06] px-3 py-2">
      <ShieldAlert size={16} className="shrink-0 text-amber" />
      <div className="min-w-0 flex-1 text-[12.5px]">
        <span className="font-semibold text-amber">{denied.count} source{denied.count === 1 ? '' : 's'} withheld by policy</span>
        {depts.length > 0 && <span className="text-muted"> ({depts.join(', ')})</span>}
        <div className="text-[11.5px] text-muted">Your clearance or department does not cover these documents. The answer above uses only what you may read.</div>
      </div>
      <button className="btn btn-sm !border-amber/50 !text-amber" onClick={() => setOpen(true)}>{t('btn.requestAccess')}</button>
      <AccessRequestDialog open={open} onClose={() => setOpen(false)} departments={depts} context={question} />
    </div>
  );
}
