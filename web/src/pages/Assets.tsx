import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Boxes, FileDown, FileText, Search, Wrench } from 'lucide-react';
import { api, downloadFile, qs } from '../lib/api';
import type { Asset, AssetDetail, AssetItem, Report } from '../lib/types';
import { Badge, Card, EmptyState, ErrorBox, Loading, PageHeader, ProvenanceBadges, QueryState, Spinner, StatusChip, type Tone } from '../components/ui';
import { useT } from '../lib/i18n';
import { DataTable, type Column } from '../components/DataTable';
import { Drawer } from '../components/Modal';
import { toast } from '../components/Toast';
import { fmtDate } from '../lib/format';

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
  if (days === null) return <span className="text-faint">—</span>;
  const text = days < 0 ? `expired ${Math.abs(days)}d` : days === 0 ? 'expires today' : `${days}d`;
  return <Badge tone={expiryTone(days)} mono>{label ? `${label} · ` : ''}{text}</Badge>;
}

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function Assets() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [sel, setSel] = useState<string | null>(null);
  const t = useT();
  const assets = useQuery({ queryKey: ['assets', dq], queryFn: () => api.get<Asset[]>(`/api/assets${qs({ q: dq })}`) });
  const rows = Array.isArray(assets.data) ? assets.data : [];
  const expired = rows.filter((a) => { const n = nearest(a.items); return n && n.days < 0; }).length;
  const due30 = rows.filter((a) => { const n = nearest(a.items); return n && n.days >= 0 && n.days <= 30; }).length;

  const columns: Column<Asset>[] = [
    { key: 'tag', header: 'Tag', mono: true, render: (a) => <span className="font-medium text-cyan">{a.tag}</span> },
    { key: 'name', header: 'Name', render: (a) => <span className="inline-flex flex-wrap items-center gap-1.5 font-medium">{a.name || '—'}<ProvenanceBadges isExample={a.is_example} /></span> },
    { key: 'unit', header: 'Unit', render: (a) => a.unit || '—' },
    { key: 'class', header: 'Class', render: (a) => a.class || '—' },
    { key: 'vendor', header: 'Vendor', render: (a) => a.vendor || '—' },
    { key: 'serial', header: 'Serial', mono: true, render: (a) => <span className="text-muted">{a.serial || '—'}</span> },
    { key: 'location', header: 'Location', render: (a) => a.location || '—' },
    { key: 'owner_department', header: 'Owner', render: (a) => a.owner_department || '—' },
    { key: 'criticality', header: 'Criticality', render: (a) => <StatusChip status={a.criticality} /> },
    {
      key: 'expiry', header: 'Nearest expiry', sortValue: (a) => nearest(a.items)?.days ?? 99999,
      render: (a) => { const n = nearest(a.items); return n ? <ExpiryBadge days={n.days} label={n.item.type} /> : <span className="text-faint">—</span>; },
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={<Boxes size={18} />} title={t('page.assets')} subtitle="Equipment ledger — certificates, calibrations and statutory items with expiry tracking"
        actions={<>
          {rows.length > 0 && <div className="flex items-center gap-1.5 text-[12px]">
            <Badge tone="danger" mono>{expired} expired</Badge><Badge tone="amber" mono>{due30} ≤30d</Badge><Badge mono>{rows.length} assets</Badge>
          </div>}
          <div className="relative w-[260px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input !pl-8" placeholder="Search tag, name, vendor, serial…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </>} />
      <div className="min-h-0 flex-1 overflow-hidden p-4">
        <div className="h-full overflow-hidden rounded-md border border-border bg-surface">
          <QueryState q={assets} empty={rows.length === 0} emptyTitle={dq ? 'No assets match your search' : 'No assets in your scope'}>
            <DataTable rows={rows} columns={columns} rowKey={(a) => a.tag} onRowClick={(a) => setSel(a.tag)} selectedKey={sel} maxHeight="100%" />
          </QueryState>
        </div>
      </div>
      {sel && <AssetDrawer tag={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function AssetDrawer({ tag, onClose }: { tag: string; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['asset', tag], queryFn: () => api.get<AssetDetail>(`/api/assets/${encodeURIComponent(tag)}`) });
  const dossier = useMutation({
    mutationFn: async () => {
      const r = await api.post<Report>('/api/reports/dossier', { tag });
      const url = r.url || `/api/reports/${r.id}/file`;
      await downloadFile(url, r.file_name || `dossier-${tag}.pdf`);
      return r;
    },
    onSuccess: (r) => toast.success('Dossier generated', r.file_name),
    onError: (e) => toast.error('Dossier failed', (e as Error).message),
  });
  const a = detail.data;
  const items = a?.items ?? [];
  const wos = a?.work_orders ?? [];
  const docs = a?.documents ?? [];
  const woKeys = wos.length ? Object.keys(wos[0]).filter((k) => typeof wos[0][k] !== 'object').slice(0, 6) : [];

  return (
    <Drawer open onClose={onClose} width={680}
      title={<div className="flex items-center gap-2"><span className="font-mono text-cyan">{tag}</span><span className="truncate text-muted font-normal">{a?.name}</span><ProvenanceBadges isExample={a?.is_example} /></div>}
      footer={<>
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn btn-primary" disabled={dossier.isPending || !a} onClick={() => dossier.mutate()}>
          {dossier.isPending ? <Spinner /> : <FileDown size={14} />} Generate dossier (PDF)
        </button>
      </>}>
      {detail.isLoading && <Loading />}
      {detail.error && <ErrorBox error={detail.error} onRetry={() => detail.refetch()} />}
      {a && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-[12px]">
            {([['Unit', a.unit], ['Class', a.class], ['Vendor', a.vendor], ['Serial', a.serial], ['Location', a.location], ['Owner', a.owner_department]] as const).map(([k, v]) => (
              <div key={k}><div className="text-muted text-[11px]">{k}</div><div className={k === 'Serial' ? 'font-mono' : ''}>{v || '—'}</div></div>
            ))}
            <div><div className="text-muted text-[11px]">Criticality</div><StatusChip status={a.criticality} /></div>
          </div>

          <Card title={`Certificates & statutory items (${items.length})`} bodyClass="p-0">
            {items.length === 0 ? <EmptyState title="No tracked items" /> : (
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-1.5">Type</th><th className="px-3 py-1.5">Ref no</th><th className="px-3 py-1.5">Expires</th><th className="px-3 py-1.5">Left</th><th className="px-3 py-1.5">Status</th>
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

          <Card title={`Work orders (${wos.length})`} icon={<Wrench size={13} className="text-muted" />} bodyClass="p-0">
            {wos.length === 0 ? <EmptyState title="No work orders" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">{woKeys.map((k) => <th key={k} className="px-3 py-1.5">{k.replace(/_/g, ' ')}</th>)}</tr></thead>
                  <tbody>
                    {wos.map((w, i) => (
                      <tr key={i} className="border-t border-border/60">
                        {woKeys.map((k) => {
                          const v = w[k];
                          const s = v === null || v === undefined ? '—' : String(v);
                          return <td key={k} className="px-3 py-1.5">{/status|state|priority/i.test(k) ? <StatusChip status={s} /> : /no|id|ref/i.test(k) ? <span className="font-mono">{s}</span> : s}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={`Documents (${docs.length})`} icon={<FileText size={13} className="text-muted" />} bodyClass="p-0">
            {docs.length === 0 ? <EmptyState title="No linked documents" /> : (
              <div className="divide-y divide-border/60">
                {docs.map((d, i) => (
                  <Link key={d.id ?? i} to={d.id ? `/knowledge/${d.id}` : '/knowledge'} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2">
                    <FileText size={13} className="text-cyan" />
                    <span className="min-w-0 flex-1 truncate">{d.title || '(untitled)'}</span>
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
