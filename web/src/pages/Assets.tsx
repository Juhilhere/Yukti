import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Boxes, FileDown, FileText, Search, Wrench } from 'lucide-react';
import { api, downloadFile, qs } from '../lib/api';
import type { Asset, AssetDetail, AssetItem, Report } from '../lib/types';
import { Badge, Card, EmptyState, ErrorBox, Loading, PageHeader, ProvenanceBadges, QueryState, Spinner, StatusChip, type Tone } from '../components/ui';
import { useT } from '../lib/i18n';
import { DataTable, type Column } from '../components/DataTable';
import { Drawer } from '../components/Modal';
import { toast } from '../components/Toast';
import { fmtDate, fmtTime } from '../lib/format';

function daysLeft(i: AssetItem): number | null {
  if (typeof i.days_left === 'number' && isFinite(i.days_left)) return i.days_left;
  if (i.expires_on) {
    const t = new Date(i.expires_on).getTime();
    if (!isNaN(t)) return Math.floor((t - Date.now()) / 86_400_000);
  }
  return null;
}
function nearest(items: AssetItem[] | undefined): { item: AssetItem; days: number } | null {
  let best: { item: AssetItem; days: number } | null = null;
  for (const it of items ?? []) {
    const d = daysLeft(it);
    if (d === null) continue;
    if (!best || d < best.days) best = { item: it, days: d };
  }
  return best;
}
function expiryTone(days: number): Tone { return days < 0 ? 'danger' : days <= 30 ? 'amber' : 'ok'; }
function ExpiryBadge({ days, label }: { days: number | null; label?: string }) {
  const t = useT();
  if (days === null) return <span className="text-faint">—</span>;
  const text = days < 0 ? t('assets.expiredDays', { n: Math.abs(days) }) : days === 0 ? t('assets.expiresToday') : t('assets.days', { n: days });
  return <Badge tone={expiryTone(days)} mono>{label ? `${label} · ` : ''}{text}</Badge>;
}

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function Assets() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');  // deep links from alerts: /assets?q=TR-03
  useEffect(() => { const v = params.get('q'); if (v !== null) setQ(v); }, [params]);
  const dq = useDebounced(q);
  const [sel, setSel] = useState<string | null>(null);
  const t = useT();
  const assets = useQuery({ queryKey: ['assets', dq], queryFn: () => api.get<Asset[]>(`/api/assets${qs({ q: dq })}`) });
  const rows = Array.isArray(assets.data) ? assets.data : [];
  const expired = rows.filter((a) => { const n = nearest(a.items); return n && n.days < 0; }).length;
  const due30 = rows.filter((a) => { const n = nearest(a.items); return n && n.days >= 0 && n.days <= 30; }).length;

  const columns: Column<Asset>[] = [
    { key: 'tag', header: t('assets.col.tag'), mono: true, render: (a) => <span className="font-medium text-cyan">{a.tag}</span> },
    { key: 'name', header: t('assets.col.name'), render: (a) => <span className="inline-flex flex-wrap items-center gap-1.5 font-medium">{a.name || '—'}<ProvenanceBadges isExample={a.is_example} /></span> },
    { key: 'unit', header: t('assets.col.unit'), render: (a) => a.unit || '—' },
    { key: 'class', header: t('assets.col.class'), render: (a) => a.class || '—' },
    { key: 'vendor', header: t('assets.col.vendor'), render: (a) => a.vendor || '—' },
    { key: 'serial', header: t('assets.col.serial'), mono: true, render: (a) => <span className="text-muted">{a.serial || '—'}</span> },
    { key: 'location', header: t('assets.col.location'), render: (a) => a.location || '—' },
    { key: 'owner_department', header: t('assets.col.owner'), render: (a) => a.owner_department || '—' },
    { key: 'criticality', header: t('assets.col.criticality'), render: (a) => <StatusChip status={a.criticality} /> },
    {
      key: 'expiry', header: t('assets.col.expiry'), sortValue: (a) => nearest(a.items)?.days ?? 99999,
      render: (a) => { const n = nearest(a.items); return n ? <ExpiryBadge days={n.days} label={n.item.type} /> : <span className="text-faint">—</span>; },
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={<Boxes size={18} />} title={t('page.assets')} subtitle={t('assets.sub')}
        actions={<>
          {rows.length > 0 && <div className="flex items-center gap-1.5 text-[12px]">
            <Badge tone="danger" mono>{t('assets.nExpired', { n: expired })}</Badge><Badge tone="amber" mono>{t('assets.nDue30', { n: due30 })}</Badge><Badge mono>{t('assets.nAssets', { n: rows.length })}</Badge>
          </div>}
          <div className="relative w-[260px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input !pl-8" placeholder={t('assets.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </>} />
      <div className="min-h-0 flex-1 overflow-hidden p-4">
        <div className="h-full overflow-hidden rounded-md border border-border bg-surface">
          <QueryState q={assets} empty={rows.length === 0} emptyTitle={dq ? t('assets.noMatch') : t('assets.none')}>
            <DataTable rows={rows} columns={columns} rowKey={(a) => a.tag} onRowClick={(a) => setSel(a.tag)} selectedKey={sel} maxHeight="100%" />
          </QueryState>
        </div>
      </div>
      {sel && <AssetDrawer tag={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function AssetDrawer({ tag, onClose }: { tag: string; onClose: () => void }) {
  const t = useT();
  const detail = useQuery({ queryKey: ['asset', tag], queryFn: () => api.get<AssetDetail>(`/api/assets/${encodeURIComponent(tag)}`) });
  const dossier = useMutation({
    mutationFn: async () => {
      const r = await api.post<Report>('/api/reports/dossier', { tag });
      const url = r.url || `/api/reports/${r.id}/file`;
      await downloadFile(url, r.file_name || `dossier-${tag}.pdf`);
      return r;
    },
    onSuccess: (r) => toast.success(t('assets.dossierDone'), r.file_name),
    onError: (e) => toast.error(t('assets.dossierFailed'), (e as Error).message),
  });
  const a = detail.data;
  const items = a?.items ?? [];
  const wos = a?.work_orders ?? [];
  const docs = a?.documents ?? [];
  // fixed columns (not guessed from the first row, where empty fields would drop a column)
  const woKeys = wos.length ? ['wo_no', 'type', 'opened_at', 'closed_at', 'failure_code', 'status'] : [];

  return (
    <Drawer open onClose={onClose} width={680}
      title={<div className="flex items-center gap-2"><span className="font-mono text-cyan">{tag}</span><span className="truncate text-muted font-normal">{a?.name}</span><ProvenanceBadges isExample={a?.is_example} /></div>}
      footer={<>
        <button className="btn" onClick={onClose}>{t('btn.close')}</button>
        <button className="btn btn-primary" disabled={dossier.isPending || !a} onClick={() => dossier.mutate()}>
          {dossier.isPending ? <Spinner /> : <FileDown size={14} />} {t('assets.dossier')}
        </button>
      </>}>
      {detail.isLoading && <Loading />}
      {detail.error && <ErrorBox error={detail.error} onRetry={() => detail.refetch()} />}
      {a && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-[12px]">
            {([['unit', a.unit], ['class', a.class], ['vendor', a.vendor], ['serial', a.serial], ['location', a.location], ['owner', a.owner_department]] as const).map(([k, v]) => (
              <div key={k}><div className="text-muted text-[11px]">{t(`assets.col.${k}`)}</div><div className={k === 'serial' ? 'font-mono' : ''}>{v || '—'}</div></div>
            ))}
            <div><div className="text-muted text-[11px]">{t('assets.col.criticality')}</div><StatusChip status={a.criticality} /></div>
          </div>

          <Card title={t('assets.items', { n: items.length })} bodyClass="p-0">
            {items.length === 0 ? <EmptyState title={t('assets.noItems')} /> : (
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-1.5">{t('assets.th.type')}</th><th className="px-3 py-1.5">{t('assets.th.ref')}</th><th className="px-3 py-1.5">{t('assets.th.expires')}</th><th className="px-3 py-1.5">{t('assets.th.left')}</th><th className="px-3 py-1.5">{t('assets.th.status')}</th>
                </tr></thead>
                <tbody>
                  {[...items].sort((x, y) => (daysLeft(x) ?? 1e9) - (daysLeft(y) ?? 1e9)).map((i, idx) => (
                    <tr key={`${i.ref_no}-${idx}`} className="border-t border-border/60">
                      <td className="px-3 py-1.5">{i.type}</td>
                      <td className="px-3 py-1.5 font-mono">{i.ref_no || '—'}</td>
                      <td className="px-3 py-1.5">{fmtDate(i.expires_on)}</td>
                      <td className="px-3 py-1.5"><ExpiryBadge days={daysLeft(i)} /></td>
                      <td className="px-3 py-1.5"><StatusChip status={i.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title={t('assets.wos', { n: wos.length })} icon={<Wrench size={13} className="text-muted" />} bodyClass="p-0">
            {wos.length === 0 ? <EmptyState title={t('assets.noWos')} /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">{woKeys.map((k) => <th key={k} className="px-3 py-1.5">{t(`assets.wo.${k}`, k.replace(/_/g, ' '))}</th>)}</tr></thead>
                  <tbody>
                    {wos.map((w, i) => (
                      <tr key={i} className="border-t border-border/60">
                        {woKeys.map((k) => {
                          const v = w[k];
                          const s = v === null || v === undefined || v === '' ? '—' : /_at$/.test(k) ? fmtTime(String(v)) : String(v);
                          return <td key={k} className="px-3 py-1.5">{/status|state|priority/i.test(k) ? <StatusChip status={s} /> : /no|id|ref/i.test(k) ? <span className="font-mono">{s}</span> : s}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={t('assets.docs', { n: docs.length })} icon={<FileText size={13} className="text-muted" />} bodyClass="p-0">
            {docs.length === 0 ? <EmptyState title={t('assets.noDocs')} /> : (
              <div className="divide-y divide-border/60">
                {docs.map((d, i) => (
                  <Link key={d.id ?? i} to={d.id ? `/knowledge/${d.id}` : '/knowledge'} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2">
                    <FileText size={13} className="text-cyan" />
                    <span className="min-w-0 flex-1 truncate">{d.title || t('knowledge.untitled')}</span>
                    {d.doc_number && <span className="font-mono text-[11px] text-muted">{d.doc_number}</span>}
                    {d.revision && <Badge mono>{d.revision}</Badge>}
                    {d.status && <StatusChip status={d.status} />}
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </Drawer>
  );
}
