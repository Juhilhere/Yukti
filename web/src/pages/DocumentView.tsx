import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { ArrowLeft, ExternalLink, FileText, ScanLine, Search, Trash2 } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import type { DocPage, DocumentDetail } from '../lib/types';
import { Badge, EmptyState, ErrorBox, Loading, PageHeader, ProvenanceBadges, Spinner, StatusChip } from '../components/ui';
import { useT } from '../lib/i18n';
import { cx, fmtBytes, fmtDate } from '../lib/format';

function confTone(c?: number) {
  if (c === undefined || c === null) return 'muted' as const;
  const p = c <= 1 ? c * 100 : c;
  return p >= 90 ? ('ok' as const) : p >= 75 ? ('amber' as const) : ('danger' as const);
}
function confPct(c?: number) {
  if (c === undefined || c === null || !isFinite(c)) return null;
  return Math.round(c <= 1 ? c * 100 : c);
}

export default function DocumentView() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const pageParam = Number(sp.get('page') || '') || null;
  const [filter, setFilter] = useState('');
  const doc = useQuery({ queryKey: ['document', id], queryFn: () => api.get<DocumentDetail>(`/api/documents/${encodeURIComponent(id)}`), enabled: !!id });
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const t = useT();
  const { me } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [confirmDel, setConfirmDel] = useState(false);
  const del = useMutation({
    mutationFn: () => api.del(`/api/documents/${encodeURIComponent(id)}`),
    onSuccess: () => { toast.success('Document deleted'); qc.invalidateQueries({ queryKey: ['documents'] }); nav('/knowledge', { replace: true }); },
    onError: (e) => toast.error('Delete failed', errMsg(e)),
  });

  const pages: DocPage[] = useMemo(() => (Array.isArray(doc.data?.pages) ? (doc.data!.pages as DocPage[]) : []), [doc.data]);
  const visible = useMemo(() => {
    if (!filter.trim()) return pages;
    const f = filter.toLowerCase();
    return pages.filter((p) => (p.text || '').toLowerCase().includes(f));
  }, [pages, filter]);

  useEffect(() => {
    if (!pageParam || pages.length === 0) return;
    const el = pageRefs.current[pageParam];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.remove('hl-flash');
      void el.offsetWidth;
      el.classList.add('hl-flash');
    }
  }, [pageParam, pages.length]);

  if (doc.isLoading) return <Loading label="Loading document…" />;
  if (doc.error) return <div className="p-5"><Link to="/knowledge" className="btn btn-sm btn-ghost mb-3"><ArrowLeft size={13} /> Knowledge</Link><ErrorBox error={doc.error} onRetry={() => doc.refetch()} /></div>;
  const d = doc.data;
  if (!d) return <EmptyState title="Document not found" />;

  // HODs (documents.upload) may delete only documents of their own department.
  const canDelete = !!me?.permissions?.includes('documents.upload') && !!d.department && d.department === me?.user.department;
  const digital = pages.filter((p) => p.mode === 'digital').length;
  const scanned = pages.length - digital;
  const avgConf = (() => {
    const cs = pages.map((p) => confPct(p.ocr_conf)).filter((x): x is number => x !== null);
    return cs.length ? Math.round(cs.reduce((a, b) => a + b, 0) / cs.length) : null;
  })();

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={<FileText size={18} />}
        title={<span className="flex flex-wrap items-center gap-2">{d.title || '(untitled)'} <StatusChip status={d.status} /><ProvenanceBadges isExample={d.is_example} isPublic={d.is_public} /></span>}
        subtitle={<span className="font-mono">{d.doc_number || '—'} · Rev {d.revision || '—'}</span>}
        actions={<>
          <Link to="/knowledge" className="btn btn-sm"><ArrowLeft size={13} /> {t('btn.back')}</Link>
          <a className="btn btn-sm btn-cyan" href={`/api/documents/${encodeURIComponent(d.id)}/file`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open original</a>
          {canDelete && <button className="btn btn-sm btn-danger" onClick={() => setConfirmDel(true)}><Trash2 size={13} /> {t('btn.delete')}</button>}
        </>} />
      <Modal open={confirmDel} onClose={() => setConfirmDel(false)} width={440} title="Delete document?" icon={<Trash2 size={14} className="text-danger" />}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setConfirmDel(false)}>{t('btn.cancel')}</button>
          <button className="btn btn-danger" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? <Spinner size={12} /> : <Trash2 size={12} />}{t('btn.delete')}</button>
        </>}>
        <div className="text-[12.5px]">Remove <span className="font-medium">{d.title}</span> ({d.doc_number || '—'}) from the knowledge base? It will no longer be retrieved in answers. The deletion is recorded in the audit log.</div>
      </Modal>
      <div className="flex min-h-0 flex-1">
        <aside className="w-[260px] shrink-0 space-y-3 overflow-y-auto border-r border-border p-4">
          <div className="space-y-2 text-[12px]">
            {[
              ['Type', <Badge mono key="t">{d.doc_type || '—'}</Badge>],
              ['Department', d.department || '—'],
              ['Classification', <StatusChip key="c" status={d.classification} />],
              ['Created', fmtDate(d.created_at)],
              ['Size', <span key="s" className="font-mono">{fmtBytes(d.size_bytes)}</span>],
              ['Pages', <span key="p" className="font-mono">{pages.length} <span className="text-cyan">{digital}d</span>/<span className="text-amber">{scanned}s</span></span>],
              ['Avg OCR conf', avgConf !== null ? <span key="o" className="font-mono">{avgConf}%</span> : '—'],
            ].map(([k, v], i) => (
              <div key={i} className="flex items-center justify-between gap-2"><span className="text-muted">{k}</span><span className="text-right">{v}</span></div>
            ))}
          </div>
          {(d.asset_tags ?? []).length > 0 && (
            <div>
              <div className="label mb-1.5">Asset tags</div>
              <div className="flex flex-wrap gap-1">{d.asset_tags.map((t) => <Badge key={t} mono tone="cyan">{t}</Badge>)}</div>
            </div>
          )}
          <div>
            <div className="label mb-1.5">Pages</div>
            <div className="grid grid-cols-5 gap-1">
              {pages.map((p) => (
                <button key={p.page_no} onClick={() => setSp({ page: String(p.page_no) }, { replace: true })}
                  title={`${p.mode}${confPct(p.ocr_conf) !== null ? ` · OCR ${confPct(p.ocr_conf)}%` : ''}`}
                  className={cx('rounded border py-1 font-mono text-[11px] hover:border-cyan',
                    pageParam === p.page_no ? 'border-cyan bg-cyan/10 text-cyan' : 'border-border',
                    p.mode !== 'digital' && pageParam !== p.page_no && 'text-amber')}>
                  {p.page_no}
                </button>
              ))}
            </div>
          </div>
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          <div className="relative mb-3 max-w-sm">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input !pl-8" placeholder="Find in extracted text…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {pages.length === 0 && <EmptyState title="No extracted pages" hint="The document may still be processing." />}
          {pages.length > 0 && visible.length === 0 && <EmptyState title="No page contains that text" />}
          <div className="space-y-3">
            {visible.map((p) => {
              const cp = confPct(p.ocr_conf);
              return (
                <div key={p.page_no} ref={(el) => { pageRefs.current[p.page_no] = el; }}
                  className={cx('scroll-mt-3 rounded-md border bg-surface', pageParam === p.page_no ? 'border-cyan' : 'border-border')}>
                  <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                    <span className="font-mono text-[12px] font-medium">Page {p.page_no}</span>
                    <Badge tone={p.mode === 'digital' ? 'cyan' : p.mode === 'scanned' ? 'amber' : 'violet'} mono>
                      {p.mode === 'digital' ? <FileText size={10} /> : <ScanLine size={10} />}{p.mode}
                    </Badge>
                    {cp !== null && <Badge tone={confTone(p.ocr_conf)} mono>OCR {cp}%</Badge>}
                    {pageParam === p.page_no && <Badge tone="cyan" className="ml-auto">cited page</Badge>}
                  </div>
                  <pre className="whitespace-pre-wrap break-words px-3 py-2.5 font-sans text-[12.5px] leading-relaxed text-text/90">
                    {highlight(p.text || '(no text extracted)', filter)}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function highlight(text: string, q: string) {
  if (!q.trim()) return text;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${esc})`, 'ig'));
  return parts.map((s, i) => (i % 2 === 1 ? <mark key={i} className="rounded bg-amber/30 px-0.5 text-text">{s}</mark> : s));
}
