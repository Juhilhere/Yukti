// Digital asset ledger: register an asset, add a ledger entry, renew one, and the asset's knowledge-graph links.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Network, Plus, RefreshCw, Save } from 'lucide-react';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import type { AssetItem } from '../../lib/types';
import type { GraphLink, LedgerCategory } from '../../lib/work';
import { Modal } from '../Modal';
import { Badge, Card, ErrorBox, Field, Spinner, StatusChip } from '../ui';
import { toast } from '../Toast';

export const useLedgerCategories = () => useQuery({
  queryKey: ['ledger', 'categories'], queryFn: () => api.get<LedgerCategory[]>('/api/ledger/categories'), staleTime: 10 * 60_000,
});

type Form = Record<string, string>;
function TextIn({ f, k, set, mono, type = 'text', placeholder }: { f: Form; k: string; set: (k: string, v: string) => void; mono?: boolean; type?: string; placeholder?: string }) {
  return <input type={type} className={mono ? 'input font-mono' : 'input'} value={f[k] ?? ''} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} />;
}
/** Drop empty fields; numbers for the numeric ones. */
function clean(f: Form, nums: string[] = []) {
  const out: Record<string, unknown> = {};
  Object.entries(f).forEach(([k, v]) => { if (v.trim() !== '') out[k] = nums.includes(k) ? Number(v) : v.trim(); });
  return out;
}

export function RegisterAssetButton() {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Form>({ criticality: 'medium' });
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => api.post<{ tag: string }>('/api/assets', clean(f)),
    onSuccess: (a) => { toast.success(t('wb.asset.registered'), a?.tag); setOpen(false); setF({ criticality: 'medium' }); qc.invalidateQueries({ queryKey: ['assets'] }); },
  });
  return (
    <>
      <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}><Plus size={12} />{t('wb.asset.register')}</button>
      <Modal open={open} onClose={() => setOpen(false)} width={620} title={t('wb.asset.register')}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>{t('btn.cancel')}</button>
          <button className="btn btn-primary" disabled={!f.tag?.trim() || !f.name?.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner className="!text-[#1a1204]" /> : <Save size={12} />}{t('btn.save')}
          </button>
        </>}>
        <div className="space-y-3">
          <div className="text-[12px] text-muted">{t('wb.asset.registerIntro')}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('assets.col.tag')}><TextIn f={f} k="tag" set={(k, v) => set(k, v.toUpperCase())} mono placeholder="P-101A" /></Field>
            <Field label={t('assets.col.name')}><TextIn f={f} k="name" set={set} /></Field>
            <Field label={t('assets.col.unit')}><TextIn f={f} k="unit" set={set} /></Field>
            <Field label={t('assets.col.class')}><TextIn f={f} k="class" set={set} /></Field>
            <Field label={t('assets.col.vendor')}><TextIn f={f} k="vendor" set={set} /></Field>
            <Field label={t('wb.asset.model')}><TextIn f={f} k="model" set={set} /></Field>
            <Field label={t('assets.col.serial')}><TextIn f={f} k="serial" set={set} mono /></Field>
            <Field label={t('assets.col.location')}><TextIn f={f} k="location" set={set} /></Field>
            <Field label={t('assets.col.owner')} hint={t('wb.asset.ownerHint')}><TextIn f={f} k="owner_department" set={set} /></Field>
            <Field label={t('assets.col.criticality')}>
              <select className="input" value={f.criticality} onChange={(e) => set('criticality', e.target.value)}>
                {['critical', 'high', 'medium', 'low'].map((c) => <option key={c} value={c}>{t(`wb.crit.${c}`)}</option>)}
              </select>
            </Field>
          </div>
          {save.error ? <ErrorBox error={save.error} /> : null}
        </div>
      </Modal>
    </>
  );
}

export function AddLedgerButton({ tag }: { tag: string }) {
  const t = useT();
  const qc = useQueryClient();
  const cats = useLedgerCategories();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Form>({});
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const cat = (cats.data ?? []).find((c) => c.id === f.category);
  const save = useMutation({
    mutationFn: () => api.post<AssetItem>(`/api/assets/${encodeURIComponent(tag)}/ledger`, clean(f, ['interval_months', 'alert_days'])),
    onSuccess: () => {
      toast.success(t('wb.ledger.added'), tag); setOpen(false); setF({});
      qc.invalidateQueries({ queryKey: ['asset', tag] }); qc.invalidateQueries({ queryKey: ['assets'] });
    },
  });
  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)}><Plus size={12} />{t('wb.ledger.add')}</button>
      <Modal open={open} onClose={() => setOpen(false)} width={620} title={t('wb.ledger.addTitle', { tag })}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>{t('btn.cancel')}</button>
          <button className="btn btn-primary" disabled={!f.category || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner className="!text-[#1a1204]" /> : <Save size={12} />}{t('btn.save')}
          </button>
        </>}>
        <div className="space-y-3">
          <Field label={t('wb.ledger.category')}>
            <select className="input" value={f.category ?? ''} onChange={(e) => set('category', e.target.value)}>
              <option value="">{t('wb.ledger.pick')}</option>
              {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          {cat && <div className="text-[11.5px] text-muted">{t('wb.ledger.catDefaults', { a: cat.alert_days, i: cat.interval_months ?? '—' })}</div>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('wb.ledger.type')}><TextIn f={f} k="type" set={set} placeholder={cat?.label} /></Field>
            <Field label={t('assets.th.ref')}><TextIn f={f} k="ref_no" set={set} mono /></Field>
            <Field label={t('assets.col.vendor')}><TextIn f={f} k="vendor" set={set} /></Field>
            <Field label={t('assets.col.serial')}><TextIn f={f} k="serial" set={set} mono /></Field>
            <Field label={t('assets.col.location')}><TextIn f={f} k="location" set={set} /></Field>
            <Field label={t('wb.ledger.owner')}><TextIn f={f} k="owner" set={set} /></Field>
            <Field label={t('wb.ledger.certificate')}><TextIn f={f} k="certificate" set={set} mono /></Field>
            <Field label={t('wb.ledger.issued')}><TextIn f={f} k="issued_on" set={set} type="date" /></Field>
            <Field label={t('assets.th.expires')} hint={t('wb.ledger.expiresHint')}><TextIn f={f} k="expires_on" set={set} type="date" /></Field>
            <Field label={t('wb.ledger.interval')}><TextIn f={f} k="interval_months" set={set} type="number" placeholder={cat?.interval_months ? String(cat.interval_months) : ''} /></Field>
            <Field label={t('wb.ledger.warranty')}><TextIn f={f} k="warranty_until" set={set} type="date" /></Field>
            <Field label={t('wb.ledger.alertDays')}><TextIn f={f} k="alert_days" set={set} type="number" placeholder={cat ? String(cat.alert_days) : ''} /></Field>
          </div>
          {save.error ? <ErrorBox error={save.error} /> : null}
        </div>
      </Modal>
    </>
  );
}

export function RenewButton({ item, tag }: { item: AssetItem; tag: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Form>({});
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => api.post<AssetItem>(`/api/ledger/${encodeURIComponent(item.id!)}/renew`, clean(f)),
    onSuccess: (r) => {
      toast.success(t('wb.ledger.renewed'), r?.expires_on ? t('wb.ledger.nextDue', { d: r.expires_on }) : undefined); setOpen(false); setF({});
      qc.invalidateQueries({ queryKey: ['asset', tag] }); qc.invalidateQueries({ queryKey: ['assets'] });
    },
  });
  if (!item.id) return null;
  return (
    <>
      <button className="btn btn-sm btn-ghost !px-1.5" title={t('wb.ledger.renew')} onClick={() => setOpen(true)}><RefreshCw size={12} /></button>
      <Modal open={open} onClose={() => setOpen(false)} width={460} title={t('wb.ledger.renewTitle', { type: item.category_label || item.type })}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>{t('btn.cancel')}</button>
          <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner className="!text-[#1a1204]" /> : <RefreshCw size={12} />}{t('wb.ledger.renew')}
          </button>
        </>}>
        <div className="space-y-3">
          <div className="text-[12px] text-muted">{t('wb.ledger.renewIntro', { m: item.interval_months ?? '—' })}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('wb.ledger.issued')}><TextIn f={f} k="issued_on" set={set} type="date" /></Field>
            <Field label={t('assets.th.expires')}><TextIn f={f} k="expires_on" set={set} type="date" /></Field>
            <Field label={t('assets.th.ref')}><TextIn f={f} k="ref_no" set={set} mono placeholder={item.ref_no} /></Field>
            <Field label={t('wb.ledger.certificate')}><TextIn f={f} k="certificate" set={set} mono placeholder={item.certificate ?? ''} /></Field>
          </div>
          {save.error ? <ErrorBox error={save.error} /> : null}
        </div>
      </Modal>
    </>
  );
}

export function AssetGraph({ tag }: { tag: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ['asset-graph', tag], queryFn: () => api.get<{ tag: string; links: GraphLink[] }>(`/api/assets/${encodeURIComponent(tag)}/graph`, { silent: true }), retry: false });
  const links = q.data?.links ?? [];
  if (q.error || (!q.isLoading && links.length === 0)) return null;
  return (
    <Card title={t('wb.graph.title', { n: links.length })} icon={<Network size={13} className="text-violet-300" />} bodyClass="p-0">
      {q.isLoading ? <div className="p-3"><Spinner /></div> : (
        <div className="divide-y divide-border/60">
          {links.map((l, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
              <Badge mono tone="violet">{l.rel}</Badge>
              <Badge tone="muted">{t(`wb.graph.kind.${l.kind}`, l.kind)}</Badge>
              {l.kind === 'document' && l.id ? (
                <Link to={`/knowledge/${l.id}`} className="flex min-w-0 items-center gap-1 hover:text-cyan"><FileText size={11} /><span className="font-mono">{l.doc_number}</span> <span className="truncate text-muted">{l.title}</span></Link>
              ) : l.kind === 'asset' ? (
                <Link to={`/assets?q=${encodeURIComponent(l.tag ?? '')}`} className="hover:text-cyan"><span className="font-mono text-cyan">{l.tag}</span> <span className="text-muted">{l.title}</span></Link>
              ) : <span className="font-mono text-muted">{l.id}</span>}
              {l.status && <StatusChip status={l.status} />}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
