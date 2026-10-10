// Inbox: human review of uncertain scan fields, and the lane / verification / evidence details of a finding.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Download, FileText, Pencil, ScanLine, X } from 'lucide-react';
import { api, downloadFile, errMsg } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { fmtTime, timeAgo } from '../../lib/format';
import type { Finding } from '../../lib/types';
import { pct, type ReviewItem } from '../../lib/work';
import { Badge, QueryState, Spinner } from '../ui';
import { toast } from '../Toast';
import { CheckChip } from './TaskParts';

/** A page-shaped rectangle with the evidence region drawn in proportion (x, y, w, h are fractions of the page). */
export function EvidenceRegion({ region, page }: { region: { x: number; y: number; w: number; h: number; page?: number }; page?: number | null }) {
  const t = useT();
  const clamp = (v: number) => Math.max(0, Math.min(1, Number(v) || 0));
  const x = clamp(region.x), y = clamp(region.y);
  const w = Math.max(0.02, Math.min(1 - x, clamp(region.w))), h = Math.max(0.02, Math.min(1 - y, clamp(region.h)));
  const pg = region.page ?? page;
  return (
    <div className="flex items-end gap-2" title={t('wb.region.tip')}>
      <div className="relative h-[68px] w-[48px] shrink-0 rounded-sm border border-border-strong bg-surface-2">
        <div className="absolute rounded-[1px] border border-amber bg-amber/30" style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />
      </div>
      <span className="text-[11px] text-muted">{pg ? t('wb.region.page', { n: pg }) : t('wb.region.label')}</span>
    </div>
  );
}

/** Extra details on a finding card: approver lane, owner, procedure, verification, evidence region, approval note. */
export function FindingExtras({ f }: { f: Finding }) {
  const t = useT();
  const ver = f.verification ?? [];
  const hasAny = f.lane_label || f.owner_department || f.procedure || ver.length || f.evidence_region || f.note_url || f.acknowledged_at || f.open_review_items;
  if (!hasAny) return null;
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border/70 bg-surface-2/40 px-2.5 py-2 text-[11.5px]">
      <div className="flex flex-wrap items-center gap-1.5">
        {f.lane_label && <Badge tone="violet" title={t('wb.lane.tip')}>{t('wb.lane', { lane: f.lane_label })}</Badge>}
        {f.owner_department && <Badge tone="muted">{t('wb.owner', { dept: f.owner_department })}</Badge>}
        {f.acknowledged_at && <span className="text-muted">{t('wb.acknowledgedAt', { at: fmtTime(f.acknowledged_at) })}</span>}
        {!!f.open_review_items && <Badge tone="amber">{t('wb.scan.reviewN', { n: f.open_review_items })}</Badge>}
        {f.note_url && (
          <button className="btn btn-sm btn-cyan ml-auto" onClick={() => downloadFile(f.note_url!, `approval_note_${f.tag || f.id}.docx`).catch((e) => toast.error(t('wb.downloadFailed'), errMsg(e)))}>
            <Download size={12} />{t('wb.note.download')}
          </button>
        )}
      </div>
      {f.procedure && (
        <Link to={`/knowledge/${f.procedure.id}`} className="flex items-center gap-1 text-cyan hover:underline">
          <FileText size={11} />{t('wb.procedure')}: <span className="font-mono">{f.procedure.doc_number}</span> {t('sources.rev', { rev: f.procedure.revision || '—' })} · {f.procedure.title}
        </Link>
      )}
      <div className="flex flex-wrap items-start gap-3">
        {ver.length > 0 && (
          <ul className="min-w-0 flex-1 space-y-0.5">
            {ver.map((v, i) => <li key={i} className="flex items-start gap-1.5"><CheckChip result={v.result} /><span><span className="font-medium">{v.check}</span>{v.detail && <span className="text-muted"> — {v.detail}</span>}</span></li>)}
          </ul>
        )}
        {f.evidence_region && <EvidenceRegion region={f.evidence_region} page={f.page} />}
      </div>
    </div>
  );
}

function fmtVal(v: unknown) { return v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v); }

function ReviewRow({ it }: { it: ReviewItem }) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(fmtVal(it.value) === '—' ? '' : fmtVal(it.value));
  const act = useMutation({
    mutationFn: (b: { resolution: 'confirm' | 'correct' | 'dismiss'; value?: string }) => api.post<{ finding_id: string; state: string }>(`/api/review-items/${encodeURIComponent(it.id)}`, b),
    onSuccess: (r) => {
      toast.success(t('wb.review.done'), r?.state === 'PENDING' ? t('wb.review.routed') : undefined);
      qc.invalidateQueries({ queryKey: ['review-items'] });
      qc.invalidateQueries({ queryKey: ['findings'] });
    },
    onError: (e) => toast.error(t('wb.review.failed'), errMsg(e)),
  });
  const c = pct(it.confidence);
  return (
    <div className="flex flex-wrap items-start gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge mono tone="cyan">{it.tag || '—'}</Badge>
          <span className="font-mono text-[12px] font-medium">{it.field}</span>
          {c !== null && <Badge mono tone={c >= 85 ? 'ok' : c >= 70 ? 'amber' : 'danger'}>{t('wb.src.conf', { n: c })}</Badge>}
          <span className="ml-auto text-[11px] text-faint">{timeAgo(it.created_at)}</span>
        </div>
        <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
          <span className="text-muted">{t('wb.review.read')}</span><span className="font-mono">{fmtVal(it.value)}</span>
          <span className="text-muted">{t('wb.review.expected')}</span><span className="font-mono">{fmtVal(it.expected)}</span>
          <span className="text-muted">{t('wb.review.reason')}</span><span>{it.reason || '—'}</span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-[11.5px]">
          <span className="text-muted">{t('wb.review.finding')}: {it.finding_title}</span>
          <Link className="flex items-center gap-1 text-cyan hover:underline" to={`/knowledge/${it.document_id}${it.region?.page ? `?page=${it.region.page}` : ''}`}><ScanLine size={11} />{t('wb.review.openScan')}</Link>
        </div>
        {editing && (
          <div className="mt-2 flex gap-1.5">
            <input autoFocus className="input !py-0.5 font-mono text-[12px]" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('wb.review.correctPh')} />
            <button className="btn btn-sm btn-primary" disabled={!value.trim() || act.isPending} onClick={() => act.mutate({ resolution: 'correct', value: value.trim() })}><Check size={12} />{t('btn.save')}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>{t('btn.cancel')}</button>
          </div>
        )}
      </div>
      <div className="flex items-start gap-2">
        {it.region && <EvidenceRegion region={it.region} />}
        <div className="flex flex-col gap-1">
          <button className="btn btn-sm btn-cyan" disabled={act.isPending} onClick={() => act.mutate({ resolution: 'confirm' })}><CheckCircle2 size={12} />{t('wb.review.confirm')}</button>
          <button className="btn btn-sm" disabled={act.isPending} onClick={() => setEditing(true)}><Pencil size={12} />{t('wb.review.correct')}</button>
          <button className="btn btn-sm btn-ghost text-muted" disabled={act.isPending} onClick={() => act.mutate({ resolution: 'dismiss' })}><X size={12} />{t('wb.review.dismiss')}</button>
          {act.isPending && <Spinner />}
        </div>
      </div>
    </div>
  );
}

export function useReviewItems(enabled: boolean) {
  return useQuery({ queryKey: ['review-items'], queryFn: () => api.get<ReviewItem[]>('/api/review-items'), enabled });
}

export function ScanReviewTab({ q }: { q: ReturnType<typeof useReviewItems> }) {
  const t = useT();
  const rows = q.data ?? [];
  return (
    <div className="space-y-3">
      <div className="text-[12.5px] text-muted">{t('wb.review.intro')}</div>
      <QueryState q={q} empty={rows.length === 0} emptyTitle={t('wb.review.empty')} emptyHint={t('wb.review.emptyHint')}>
        <div className="divide-y divide-border rounded-md border border-border bg-surface">
          {rows.map((it) => <ReviewRow key={it.id} it={it} />)}
        </div>
      </QueryState>
    </div>
  );
}
