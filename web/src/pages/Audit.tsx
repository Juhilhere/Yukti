import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronRight, Download, RefreshCw, ScrollText, Search, ShieldCheck, XCircle } from 'lucide-react';
import { api, downloadFile, errMsg, qs } from '../lib/api';
import { useT } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { toast } from '../components/Toast';
import type { AuditRecord, AuditVerify } from '../lib/types';
import { fmtTime, num } from '../lib/format';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, QueryState, Spinner } from '../components/ui';

function detailStr(d: unknown): string {
  if (d === null || d === undefined) return '';
  if (typeof d === 'string') return d;
  try { return JSON.stringify(d); } catch { return String(d); }
}

function Row({ r }: { r: AuditRecord }) {
  const [open, setOpen] = useState(false);
  const s = detailStr(r.detail);
  let pretty = s;
  try { pretty = JSON.stringify(typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail, null, 2); } catch { /* keep */ }
  const tone = r.event.includes('deny') || r.event.includes('fail') ? 'danger' : r.event.startsWith('auth') ? 'cyan' : r.event.includes('access') || r.event.includes('grant') ? 'amber' : 'muted';
  return (
    <>
      <tr className="cursor-pointer border-b border-border/60 hover:bg-surface-2" onClick={() => setOpen((o) => !o)}>
        <td className="px-3 py-1.5 font-mono text-[12px] text-muted">
          <span className="inline-flex items-center gap-1">{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}{r.seq}</span>
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[12px]">{fmtTime(r.at)}</td>
        <td className="px-3 py-1.5">{r.actor || '—'}</td>
        <td className="px-3 py-1.5"><Badge mono tone={tone}>{r.event}</Badge></td>
        <td className="px-3 py-1.5 font-mono text-[12px] text-muted">{r.entity || '—'}</td>
        <td className="max-w-[360px] truncate px-3 py-1.5 font-mono text-[11.5px] text-muted">{s}</td>
        <td className="px-3 py-1.5 font-mono text-[11.5px] text-cyan" title={r.hash}>{(r.hash || '').slice(0, 10)}</td>
      </tr>
      {open && (
        <tr className="border-b border-border/60 bg-bg">
          <td colSpan={7} className="px-4 py-2">
            <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-all font-mono text-[11.5px] text-text/85">{pretty || '—'}</pre>
            <div className="mt-2 grid gap-1 font-mono text-[11px] text-faint">
              <div>hash&nbsp;&nbsp;&nbsp;&nbsp; {r.hash}</div>
              <div>prev_hash {r.prev_hash}</div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Audit() {
  const { can, me } = useAuth();
  const orgWide = can('audit.export');
  const [event, setEvent] = useState('');
  const [text, setText] = useState('');
  const q = useQuery({ queryKey: ['audit', event], queryFn: () => api.get<AuditRecord[]>(`/api/audit${qs({ limit: 200, event })}`) });
  const all = useQuery({ queryKey: ['audit', ''], queryFn: () => api.get<AuditRecord[]>(`/api/audit${qs({ limit: 200 })}`), enabled: event !== '' });
  const verify = useMutation({ mutationFn: () => api.get<AuditVerify>('/api/audit/verify') });

  const events = useMemo(() => {
    const src = (event ? all.data : q.data) ?? [];
    return [...new Set(src.map((r) => r.event))].sort();
  }, [q.data, all.data, event]);
  const rows = useMemo(() => {
    const f = text.trim().toLowerCase();
    const list = q.data ?? [];
    return f ? list.filter((r) => `${r.actor} ${r.event} ${r.entity} ${detailStr(r.detail)}`.toLowerCase().includes(f)) : list;
  }, [q.data, text]);
  const v = verify.data;
  const t = useT();
  const exp = async (fmt: 'csv' | 'jsonl') => {
    try { await downloadFile(`/api/audit/export?format=${fmt}`, `yukti-audit.${fmt}`); } catch (e) { toast.error('Export failed', errMsg(e)); }
  };

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={t('page.audit')} icon={<ScrollText size={18} />} subtitle="Hash-chained, tamper-evident record of every decision"
        actions={<>
          <button className="btn btn-sm" onClick={() => q.refetch()}><RefreshCw size={12} className={q.isFetching ? 'animate-spin' : ''} />{t('btn.refresh')}</button>
          {orgWide && <button className="btn btn-sm" onClick={() => void exp('csv')}><Download size={12} />CSV</button>}
          {orgWide && <button className="btn btn-sm" onClick={() => void exp('jsonl')}><Download size={12} />JSONL</button>}
          <button className="btn btn-cyan btn-sm" disabled={verify.isPending} onClick={() => verify.mutate()}>
            {verify.isPending ? <Spinner size={12} /> : <ShieldCheck size={12} />}Verify chain
          </button>
        </>} />
      <div className="space-y-3 p-5">
        {!orgWide && (
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-[12px] text-muted">
            Showing activity of people in your department ({me?.user.department}). The plant-wide trail and exports are available to Internal Audit and refinery management.
          </div>
        )}
        {verify.error && <ErrorBox error={verify.error} />}
        {v && (v.ok ? (
          <div className="flex items-center gap-2 rounded-md border border-ok/40 bg-ok/10 px-3 py-2">
            <CheckCircle2 size={16} className="text-ok" />
            <span className="font-medium text-green-200">✓ Chain intact — {num(v.count, 0)} records verified</span>
            <span className="ml-auto truncate font-mono text-[11px] text-muted" title={v.head}>head {v.head?.slice(0, 16)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            <XCircle size={16} className="text-danger" />
            <span className="font-medium text-red-200">✗ Chain broken at seq <span className="font-mono">{v.broken_at ?? '?'}</span> ({num(v.count, 0)} records checked)</span>
            <span className="ml-auto truncate font-mono text-[11px] text-muted" title={v.head}>head {v.head?.slice(0, 16)}</span>
          </div>
        ))}
        <Card bodyClass="p-0" title={<span>Records <span className="font-mono text-muted">{rows.length}</span></span>}
          actions={<>
            <select className="input !w-48 !py-0.5 text-[12px]" value={event} onChange={(e) => setEvent(e.target.value)}>
              <option value="">All events</option>
              {events.map((e) => <option key={e} value={e}>{e}</option>)}
              {event && !events.includes(event) && <option value={event}>{event}</option>}
            </select>
            <div className="relative"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
              <input className="input !w-52 !py-0.5 !pl-6 text-[12px]" placeholder="Filter actor, entity, detail…" value={text} onChange={(e) => setText(e.target.value)} /></div>
          </>}>
          <QueryState q={q} empty={(q.data ?? []).length === 0} emptyTitle="No audit records">
            {rows.length === 0 ? <EmptyState title="No records match the filter" /> : (
              <div className="overflow-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead className="sticky top-0 bg-surface">
                    <tr>{['Seq', 'Time', 'Actor', 'Event', 'Entity', 'Detail', 'Hash'].map((h) => (
                      <th key={h} className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>{rows.map((r) => <Row key={r.seq} r={r} />)}</tbody>
                </table>
              </div>
            )}
          </QueryState>
        </Card>
      </div>
    </div>
  );
}
