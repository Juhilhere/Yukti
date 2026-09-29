import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, BarChart3, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, ExternalLink, Factory, Gauge, IndianRupee, Info, Play, Save,
  ShieldAlert, TrendingDown, TrendingUp, Undo2, Wrench,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { ProdProduct, ProdUnit, ProductionModel, ProductionOverview, PublicProductionRow, ScenarioInput, ScenarioResult } from '../lib/types';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { AMBER, AXIS, CYAN, GRID, OTHER, SERIES, SURFACE, axisProps, tooltipStyle } from '../lib/chartTheme';
import { Badge, Card, EmptyState, ErrorBox, Field, Loading, PageHeader, Slider, Spinner, Tabs } from '../components/ui';
import { toast } from '../components/Toast';
import { cx, num } from '../lib/format';

/* ----------------------------- helpers ----------------------------- */
const isUrl = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);
const toNum = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)) ? Number(v) : null);
function fyKey(s: string): number {
  const m = /(\d{4})\s*[-–/]\s*(\d{2,4})/.exec(s);
  if (m) return Number(m[1]);
  const y = /(\d{4})/.exec(s);
  return y ? Number(y[1]) : 0;
}
function host(u: string) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }
function SrcLink({ url, label }: { url?: string | null; label?: string }) {
  if (!isUrl(url)) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={url} className="inline-flex items-center gap-1 text-[11px] text-faint hover:text-cyan">
      <ExternalLink size={11} />{label ?? host(url)}
    </a>
  );
}
const FIN_LABELS: Record<string, string> = {
  revenue_cr: 'Revenue (₹ Cr)', sales_net_excise_cr: 'Sales net of excise (₹ Cr)', ebitda_cr: 'EBITDA (₹ Cr)', pat_cr: 'PAT (₹ Cr)',
  grm_usd_bbl: 'GRM (US$/bbl)', throughput_mmt: 'Throughput (MMT)', borrowings_cr: 'Borrowings (₹ Cr)', net_worth_cr: 'Net worth (₹ Cr)',
  eps_inr: 'EPS (₹)', dps_inr: 'DPS (₹)',
};
const finLabel = (k: string) => FIN_LABELS[k] ?? k.replace(/_/g, ' ');

function Kpi({ icon, label, value, unit, foot }: { icon: ReactNode; label: string; value: string; unit?: string; foot?: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted">{icon}{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5"><span className="font-mono text-[22px] font-semibold">{value}</span>{unit && value !== '—' && <span className="text-[11.5px] text-muted">{unit}</span>}</div>
      {foot && <div className="mt-0.5">{foot}</div>}
    </div>
  );
}

/* ----------------------------- overview (public data) ----------------------------- */
function ProductionByFy({ rows }: { rows: PublicProductionRow[] }) {
  const [metric, setMetric] = useState<'production_kt' | 'sales_kt' | 'export_kt'>('production_kt');
  const chart = useMemo(() => {
    const totals = new Map<string, number>();
    rows.forEach((r) => { const v = toNum(r[metric]); if (v !== null) totals.set(r.product, (totals.get(r.product) ?? 0) + v); });
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
    const keys = ranked.slice(0, SERIES.length);
    const hasOther = ranked.length > keys.length;
    const byFy = new Map<string, Record<string, number | string>>();
    rows.forEach((r) => {
      const v = toNum(r[metric]); if (v === null) return;
      const o = byFy.get(r.fy) ?? { fy: r.fy };
      const k = keys.includes(r.product) ? r.product : 'Other';
      o[k] = (Number(o[k]) || 0) + v;
      byFy.set(r.fy, o);
    });
    return { data: [...byFy.values()].sort((a, b) => fyKey(String(a.fy)) - fyKey(String(b.fy))), keys: hasOther ? [...keys, 'Other'] : keys };
  }, [rows, metric]);
  const sources = useMemo(() => {
    const m = new Map<string, Set<string>>();
    rows.forEach((r) => { if (isUrl(r.source_url)) { if (!m.has(r.source_url)) m.set(r.source_url, new Set()); m.get(r.source_url)!.add(r.fy); } });
    return [...m.entries()].map(([u, fys]) => ({ url: u, fys: [...fys].sort((a, b) => fyKey(a) - fyKey(b)) }));
  }, [rows]);
  return (
    <Card title="Production & sales by financial year (published)" icon={<BarChart3 size={14} className="text-cyan" />}
      actions={<div className="flex gap-1">{([['production_kt', 'Production'], ['sales_kt', 'Sales'], ['export_kt', 'Exports']] as const).map(([k, l]) => (
        <button key={k} onClick={() => setMetric(k)} className={cx('rounded border px-2 py-0.5 text-[11.5px]', metric === k ? 'border-cyan bg-cyan/10 text-cyan' : 'border-border text-muted hover:text-text')}>{l}</button>
      ))}</div>}>
      {chart.data.length === 0 ? <EmptyState title="No published values for this measure" /> : (
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="fy" {...axisProps} />
              <YAxis {...axisProps} axisLine={false} width={56} unit=" kt" />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v: unknown, n: unknown) => [`${num(v, 0)} kt`, String(n)]} />
              <Legend wrapperStyle={{ fontSize: 11, color: AXIS }} iconType="square" iconSize={9} />
              {chart.keys.map((k, i) => (
                <Bar key={k} dataKey={k} stackId="a" fill={k === 'Other' ? OTHER : SERIES[i % SERIES.length]} stroke={SURFACE} strokeWidth={1} maxBarSize={48}
                  radius={i === chart.keys.length - 1 ? [4, 4, 0, 0] : undefined} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {sources.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2">
          <span className="text-[11px] text-muted">Sources:</span>
          {sources.map((s) => <SrcLink key={s.url} url={s.url} label={`${host(s.url)} (${s.fys.join(', ')})`} />)}
        </div>
      )}
    </Card>
  );
}

function Financials({ rows }: { rows: Record<string, unknown>[] }) {
  const keys = useMemo(() => {
    const k = new Set<string>();
    rows.forEach((r) => Object.entries(r).forEach(([kk, v]) => { if (kk !== 'fy' && toNum(v) !== null && typeof v === 'number') k.add(kk); }));
    const pref = Object.keys(FIN_LABELS);
    return [...k].sort((a, b) => (pref.indexOf(a) === -1 ? 99 : pref.indexOf(a)) - (pref.indexOf(b) === -1 ? 99 : pref.indexOf(b)));
  }, [rows]);
  const [metric, setMetric] = useState<string>('');
  const sel = metric && keys.includes(metric) ? metric : keys.includes('pat_cr') ? 'pat_cr' : keys[0] ?? '';
  const data = useMemo(() => rows.map((r) => ({ fy: String(r.fy ?? ''), value: toNum(r[sel]), src: r.source_url as string | undefined }))
    .filter((d) => d.value !== null).sort((a, b) => fyKey(a.fy) - fyKey(b.fy)), [rows, sel]);
  if (!rows.length) return null;
  return (
    <Card title="Financials (published)" icon={<IndianRupee size={14} className="text-amber" />}
      actions={<select className="input !w-auto !py-0.5 text-[12px]" value={sel} onChange={(e) => setMetric(e.target.value)}>
        {keys.map((k) => <option key={k} value={k}>{finLabel(k)}</option>)}
      </select>}>
      {data.length === 0 ? <EmptyState title="No values for this measure" /> : (
        <>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="fy" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} width={60} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v: unknown) => [num(v, 2), finLabel(sel)]} />
                <ReferenceLine y={0} stroke={AXIS} />
                <Bar dataKey="value" name={finLabel(sel)} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                  {data.map((d) => <Cell key={d.fy} fill={(d.value ?? 0) < 0 ? AMBER : CYAN} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2">
            {data.map((d) => <SrcLink key={d.fy} url={d.src} label={d.fy} />)}
          </div>
        </>
      )}
    </Card>
  );
}

/* ----------------------------- model editor ----------------------------- */
function NumIn({ value, onChange, disabled, placeholder, className }: { value: number | null | undefined; onChange: (v: number | null) => void; disabled?: boolean; placeholder?: string; className?: string }) {
  return (
    <input type="number" min={0} step="any" className={cx('input !py-0.5 font-mono text-[12px]', className, value !== null && value !== undefined && value < 0 && '!border-danger')}
      disabled={disabled} placeholder={placeholder} title={value !== null && value !== undefined && value < 0 ? 'Must be 0 or more' : undefined}
      value={value === null || value === undefined ? '' : value}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  );
}

function Missing({ items, title = 'Still needed before the optimizer can run' }: { items: string[]; title?: string }) {
  if (!items.length) return (
    <div className="flex items-center gap-2 rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-[12.5px] text-green-300"><CheckCircle2 size={14} />Plant model complete — scenarios can be run.</div>
  );
  return (
    <div className="rounded-md border border-amber/40 bg-amber/[0.06] px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-medium text-amber"><AlertTriangle size={13} />{title} ({items.length})</div>
      <ul className="max-h-[220px] space-y-0.5 overflow-y-auto text-[12px] text-muted">
        {items.map((m, i) => <li key={i} className="flex items-start gap-1.5"><CircleDashed size={11} className="mt-0.5 shrink-0 text-faint" />{m}</li>)}
      </ul>
    </div>
  );
}

function UnitRow({ u, products, canEdit, onChange }: { u: ProdUnit; products: ProdProduct[]; canEdit: boolean; onChange: (u: ProdUnit) => void }) {
  const [open, setOpen] = useState(false);
  const ysum = Object.values(u.yields ?? {}).reduce<number>((a, v) => a + (typeof v === 'number' ? v : 0), 0);
  const setYield = (p: string, v: number | null) => {
    const y = { ...(u.yields ?? {}) };
    if (v === null) delete y[p]; else y[p] = v;
    onChange({ ...u, yields: y });
  };
  return (
    <>
      <tr className={cx('border-t border-border/60', !u.enabled && 'text-muted')}>
        <td className="px-2 py-1.5"><input type="checkbox" className="accent-amber" disabled={!canEdit} checked={!!u.enabled} onChange={(e) => onChange({ ...u, enabled: e.target.checked })} /></td>
        <td className="px-2 py-1.5">
          <button className="flex items-center gap-1 text-left" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="font-mono text-[12px] text-cyan">{u.code}</span>
          </button>
          <div className="pl-4 text-[11.5px] text-muted">{u.name}</div>
        </td>
        <td className="px-2 py-1.5 text-[12px]">
          <div className="font-mono">{u.capacity ?? '—'} {u.unit}</div>
          <SrcLink url={u.source_url} label="source" />
        </td>
        <td className="px-2 py-1.5"><NumIn className="!w-24" value={u.capacity_kt_month} disabled={!canEdit} onChange={(v) => onChange({ ...u, capacity_kt_month: v })} /></td>
        <td className="px-2 py-1.5">
          <select className="input !w-36 !py-0.5 text-[12px]" disabled={!canEdit} value={u.feed ?? ''} onChange={(e) => onChange({ ...u, feed: e.target.value })}>
            <option value="">— feed —</option>
            <option value="crude">crude</option>
            {products.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </td>
        <td className="px-2 py-1.5">
          <button className="text-[12px] text-cyan hover:underline" onClick={() => setOpen((o) => !o)}>
            {Object.keys(u.yields ?? {}).length} set · Σ <span className={cx('font-mono', ysum > 1.0001 ? 'text-danger' : '')}>{num(ysum, 3)}</span>
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-bg">
          <td />
          <td colSpan={5} className="px-2 py-2">
            <div className="mb-1 text-[11px] text-muted">Product yields as a fraction of unit feed (0–1). Sum must not exceed 1.</div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
              {products.map((p) => (
                <label key={p.name} className="block">
                  <span className="text-[11px] text-muted">{p.name}</span>
                  <NumIn value={u.yields?.[p.name] ?? null} disabled={!canEdit} placeholder="—" onChange={(v) => setYield(p.name, v)} />
                </label>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ModelEditor({ q }: { q: ReturnType<typeof useModelQuery> }) {
  const { can } = useAuth();
  const canEdit = can('production.edit');
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ProductionModel | null>(null);
  const [filter, setFilter] = useState('');
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  useEffect(() => { if (q.data && !draft) setDraft(structuredClone(q.data)); }, [q.data, draft]);
  const save = useMutation({
    mutationFn: (m: ProductionModel) => {
      const { units, products, crude_cost_usd_t, notes } = m;
      return api.put<ProductionModel>('/api/production/model', { units, products, crude_cost_usd_t, notes });
    },
    onSuccess: (r) => {
      toast.success('Plant model saved', r?.complete ? 'Model complete' : `${r?.missing?.length ?? 0} item(s) still missing`);
      qc.setQueryData(['production', 'model'], r);
      qc.invalidateQueries({ queryKey: ['production', 'overview'] });
      setDraft(structuredClone(r));
    },
    onError: (e) => toast.error('Could not save model', (e as Error).message),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!draft) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(q.data);
  const units = draft.units.filter((u) => (!onlyEnabled || u.enabled) && (!filter || `${u.code} ${u.name}`.toLowerCase().includes(filter.toLowerCase())));
  const setUnit = (code: string, nu: ProdUnit) => setDraft((d) => d && ({ ...d, units: d.units.map((x) => (x.code === code ? nu : x)) }));
  const setProd = (name: string, patch: Partial<ProdProduct>) => setDraft((d) => d && ({ ...d, products: d.products.map((x) => (x.name === name ? { ...x, ...patch } : x)) }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[12.5px] text-muted">
          {canEdit ? 'Enter the plant’s linear model: enable units, set capacity, feed and yields, and product net-back prices. Published capacities are pre-filled with source links.'
            : 'Read-only — editing the plant model requires the production.edit permission (planner).'}
        </div>
        {canEdit && <div className="ml-auto flex gap-2">
          <button className="btn btn-sm btn-ghost" disabled={!dirty || save.isPending} onClick={() => setDraft(q.data ? structuredClone(q.data) : null)}><Undo2 size={12} />Discard</button>
          <button className="btn btn-sm btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
            {save.isPending ? <Spinner size={12} className="!text-[#1a1204]" /> : <Save size={12} />}Save model
          </button>
        </div>}
      </div>
      <Missing items={(q.data?.missing ?? [])} />
      {dirty && <div className="text-[11.5px] text-amber">Unsaved changes — the checklist updates after saving.</div>}
      <div className="grid gap-4 2xl:grid-cols-[1fr_420px]">
        <Card title={`Process units (${draft.units.filter((u) => u.enabled).length} enabled / ${draft.units.length})`} icon={<Wrench size={14} className="text-cyan" />} bodyClass="p-0"
          actions={<>
            <label className="flex items-center gap-1 text-[11.5px] text-muted"><input type="checkbox" className="accent-amber" checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)} />enabled only</label>
            <input className="input !w-40 !py-0.5 text-[12px]" placeholder="Filter units…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </>}>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 z-10 bg-surface"><tr className="text-left text-[10.5px] uppercase tracking-wide text-muted">
                <th className="px-2 py-1.5">On</th><th className="px-2 py-1.5">Unit</th><th className="px-2 py-1.5">Published capacity</th>
                <th className="px-2 py-1.5">Capacity kt/month</th><th className="px-2 py-1.5">Feed</th><th className="px-2 py-1.5">Yields</th>
              </tr></thead>
              <tbody>{units.map((u) => <UnitRow key={u.code} u={u} products={draft.products} canEdit={canEdit} onChange={(nu) => setUnit(u.code, nu)} />)}</tbody>
            </table>
            {units.length === 0 && <EmptyState title="No units match" />}
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Crude & notes">
            <div className="space-y-3">
              <Field label="Crude cost (US$/t)"><NumIn value={draft.crude_cost_usd_t} disabled={!canEdit} onChange={(v) => setDraft((d) => d && ({ ...d, crude_cost_usd_t: v }))} /></Field>
              <Field label="Notes / assumptions"><textarea className="input min-h-[60px] text-[12px]" disabled={!canEdit} value={draft.notes ?? ''} onChange={(e) => setDraft((d) => d && ({ ...d, notes: e.target.value }))} /></Field>
            </div>
          </Card>
          <Card title="Products" bodyClass="p-0">
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-surface"><tr className="text-left text-[10.5px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-1.5">Product</th><th className="px-2 py-1.5">Price US$/t</th><th className="px-2 py-1.5">Min kt</th><th className="px-2 py-1.5">Max kt</th>
                </tr></thead>
                <tbody>{draft.products.map((p) => (
                  <tr key={p.name} className="border-t border-border/60">
                    <td className="px-2 py-1">{p.name}</td>
                    <td className="px-2 py-1"><NumIn value={p.price_usd_t} disabled={!canEdit} onChange={(v) => setProd(p.name, { price_usd_t: v })} /></td>
                    <td className="px-2 py-1"><NumIn value={p.min_kt} disabled={!canEdit} onChange={(v) => setProd(p.name, { min_kt: v })} /></td>
                    <td className="px-2 py-1"><NumIn value={p.max_kt} disabled={!canEdit} onChange={(v) => setProd(p.name, { max_kt: v })} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- scenario ----------------------------- */
const DEFAULT_SCN = { hcu_down_days: 0, petchem_margin_delta: 0, crude_cost_delta_usd_t: 0 };

function Scenario({ model }: { model: ProductionModel | undefined }) {
  const [scn, setScn] = useState(DEFAULT_SCN);
  const [priceProd, setPriceProd] = useState('');
  const [priceDelta, setPriceDelta] = useState(0);
  const run = useMutation({
    mutationFn: () => {
      const body: ScenarioInput = { ...scn };
      if (priceProd && priceDelta) body.price_delta_usd_t = { [priceProd]: priceDelta };
      return api.post<ScenarioResult>('/api/production/scenario', body);
    },
  });
  const complete = !!model?.complete;
  const err = run.error;
  const missing422 = err instanceof ApiError && err.status === 422 && Array.isArray(err.detail?.missing) ? (err.detail!.missing as string[]) : null;
  const producedProducts = (model?.products ?? []).map((p) => p.name);
  return (
    <div className="grid gap-4 xl:grid-cols-[330px_1fr]">
      <Card title="Scenario" icon={<Play size={13} className="text-amber" />}>
        {!complete && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-amber/40 bg-amber/10 px-2.5 py-2 text-[12px] text-amber">
            <Info size={13} className="mt-0.5 shrink-0" />
            <span>Scenarios are disabled until a planner completes the plant model (see the <b>Plant model</b> tab). Yukti does not invent yields or prices.</span>
          </div>
        )}
        <fieldset disabled={!complete || run.isPending} className="space-y-3 disabled:opacity-50">
          <Field label="Hydrocracker downtime" hint="Days of outage in the planning month (applies to HCU units)">
            <Slider value={scn.hcu_down_days} min={0} max={30} step={1} unit="days" onChange={(v) => setScn((s) => ({ ...s, hcu_down_days: v }))} disabled={!complete} />
          </Field>
          <Field label="Petrochemical price Δ" hint="Change in polypropylene / paraxylene / aromatics net-back">
            <Slider value={scn.petchem_margin_delta} min={-200} max={200} step={5} unit="US$/t" onChange={(v) => setScn((s) => ({ ...s, petchem_margin_delta: v }))} disabled={!complete} />
          </Field>
          <Field label="Crude cost Δ" hint="Change in delivered crude cost">
            <Slider value={scn.crude_cost_delta_usd_t} min={-150} max={150} step={5} unit="US$/t" onChange={(v) => setScn((s) => ({ ...s, crude_cost_delta_usd_t: v }))} disabled={!complete} />
          </Field>
          <Field label="Single product price Δ (optional)">
            <div className="flex gap-2">
              <select className="input !w-40" value={priceProd} onChange={(e) => setPriceProd(e.target.value)}>
                <option value="">— product —</option>
                {producedProducts.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input type="number" className="input font-mono" value={priceDelta} step={5} onChange={(e) => setPriceDelta(Number(e.target.value) || 0)} placeholder="US$/t" />
            </div>
          </Field>
          <div className="flex gap-2 pt-1">
            <button type="button" className="btn btn-sm btn-ghost text-muted" onClick={() => { setScn(DEFAULT_SCN); setPriceProd(''); setPriceDelta(0); }}>Reset</button>
            <button type="button" className="btn btn-primary flex-1 justify-center" onClick={() => run.mutate()}>
              {run.isPending ? <Spinner className="!text-[#1a1204]" /> : <Play size={14} />} Run optimizer
            </button>
          </div>
        </fieldset>
      </Card>
      <div className="min-w-0 space-y-3">
        {missing422 ? <Missing items={missing422} title="The optimizer needs a complete plant model" /> : err ? <ErrorBox error={err} /> : null}
        {!run.data && !run.isPending && !err && (
          <Card><EmptyState icon={<Info size={26} />} title="Run a scenario" hint="Adjust downtime and price deltas, then run the LP optimizer. Results show product-mix shift, margin impact, binding constraints and a plain-language explanation." /></Card>
        )}
        {run.isPending && <Card><Loading label="Solving linear program…" /></Card>}
        {run.data && <ScenarioView r={run.data} />}
      </div>
    </div>
  );
}

function ScenarioView({ r }: { r: ScenarioResult }) {
  const names = [...new Set([...Object.keys(r.baseline ?? {}), ...Object.keys(r.scenario ?? {})])];
  const deltas = names.map((n) => {
    const b = r.baseline?.[n] ?? 0; const s = r.scenario?.[n] ?? 0;
    const pct = r.delta_pct?.[n] ?? (b ? ((s - b) / b) * 100 : 0);
    return { name: n, baseline: b, scenario: s, pct: Number(pct.toFixed(2)) };
  }).filter((d) => d.baseline || d.scenario);
  const mb = r.margin_usd?.baseline; const ms = r.margin_usd?.scenario;
  const md = typeof mb === 'number' && typeof ms === 'number' ? ms - mb : null;
  const usd = (x: number | null | undefined) => (typeof x === 'number' ? `$${num(x / 1e6, 2)}` : '—');
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Kpi icon={<Gauge size={14} />} label="Baseline margin / month" value={usd(mb)} unit="M US$" />
        <Kpi icon={<Gauge size={14} />} label="Scenario margin / month" value={usd(ms)} unit="M US$" />
        <div className="rounded-md border border-border bg-surface px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted">{(md ?? 0) >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}Margin impact</div>
          <div className={cx('mt-1 font-mono text-[22px] font-semibold', md === null ? '' : md >= 0 ? 'text-ok' : 'text-danger')}>{md === null ? '—' : `${md >= 0 ? '+' : '−'}${usd(Math.abs(md))}`} <span className="text-[11.5px] font-normal text-muted">M US$</span></div>
        </div>
      </div>
      <div className="grid gap-4 2xl:grid-cols-2">
        <Card title="Product-mix change (Δ %)">
          {deltas.length === 0 ? <EmptyState title="No product volumes in the solution" /> : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deltas} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" {...axisProps} interval={0} />
                  <YAxis {...axisProps} axisLine={false} unit="%" width={44} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v: unknown) => [`${num(v, 2)}%`, 'Δ']} />
                  <ReferenceLine y={0} stroke={AXIS} />
                  <Bar dataKey="pct" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {deltas.map((d) => <Cell key={d.name} fill={d.pct >= 0 ? CYAN : AMBER} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="Baseline vs scenario (kt / month)" bodyClass="p-0">
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-3 py-1.5">Product</th><th className="px-3 py-1.5 text-right">Baseline</th><th className="px-3 py-1.5 text-right">Scenario</th><th className="px-3 py-1.5 text-right">Δ %</th>
            </tr></thead>
            <tbody>
              {deltas.map((d) => (
                <tr key={d.name} className="border-t border-border/60">
                  <td className="px-3 py-1.5">{d.name}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{num(d.baseline, 1)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{num(d.scenario, 1)}</td>
                  <td className={cx('px-3 py-1.5 text-right font-mono', d.pct > 0 ? 'text-cyan' : d.pct < 0 ? 'text-amber' : 'text-muted')}>{d.pct > 0 ? '+' : ''}{num(d.pct, 2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Binding constraints">
          {(r.binding ?? []).length === 0 ? <div className="text-[12px] text-muted">None</div> : <div className="flex flex-wrap gap-1.5">{r.binding.map((b) => <Badge key={b} tone="amber" mono>{b}</Badge>)}</div>}
        </Card>
        <Card title="Shadow prices (US$)" bodyClass="p-0">
          {(r.shadow_prices ?? []).length === 0 ? <div className="p-3 text-[12px] text-muted">None</div> : (
            <table className="w-full text-[12px]"><tbody>
              {r.shadow_prices.map((s) => (
                <tr key={s.constraint} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-1.5 font-mono text-[11.5px]">{s.constraint}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-cyan">{num(s.value, 1)}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </Card>
        <Card title="Assumptions">
          {(r.assumptions ?? []).length === 0 ? <div className="text-[12px] text-muted">None stated</div> : <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted">{r.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        </Card>
      </div>
      {r.explanation && (
        <Card title={<span className="flex items-center gap-2">Explanation <Badge tone="cyan">AI · advisory</Badge></span>}>
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{r.explanation}</div>
        </Card>
      )}
    </div>
  );
}

/* ----------------------------- page ----------------------------- */
function useModelQuery() {
  return useQuery({ queryKey: ['production', 'model'], queryFn: () => api.get<ProductionModel>('/api/production/model') });
}

type Tab = 'overview' | 'model' | 'scenario';

export default function Production() {
  const t = useT();
  const ov = useQuery({ queryKey: ['production', 'overview'], queryFn: () => api.get<ProductionOverview>('/api/production/overview') });
  const model = useModelQuery();
  const [tab, setTab] = useState<Tab>('overview');
  const d = ov.data;
  const complete = model.data?.complete ?? d?.model_complete ?? false;
  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={<Factory size={18} />} title={t('page.production')} subtitle="Published MRPL production data and planner-maintained LP scenario planning" />
      <Tabs className="px-4" value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview (published data)' },
        { id: 'model', label: <span className="flex items-center gap-1.5">Plant model {complete ? <CheckCircle2 size={12} className="text-ok" /> : <AlertTriangle size={12} className="text-amber" />}</span> },
        { id: 'scenario', label: 'Scenario planning' },
      ]} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex items-start gap-2.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-2.5 text-[12.5px]">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber" />
          <div><span className="font-semibold text-amber">Optimizer calculates · LLM explains · Planners decide</span>
            <span className="text-muted"> — advisory only, never writes DCS/SCADA. Figures shown are published data with source links or values entered by planners; nothing is synthesised.</span></div>
        </div>
        {tab === 'overview' && <>
          {ov.isLoading && <Loading />}
          {ov.error ? <ErrorBox error={ov.error} onRetry={() => ov.refetch()} /> : null}
          {d && <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi icon={<Factory size={14} />} label="Refining capacity" value={num(d.capacity_mmtpa, 1)} unit="MMTPA" foot={<SrcLink url={d.capacity_source} />} />
              <Kpi icon={<Gauge size={14} />} label="Nelson Complexity Index" value={num(d.nci, 2)} unit="NCI"
                foot={(d.nci_sources ?? []).length > 0 ? <span className="flex flex-wrap gap-x-2">{(d.nci_sources ?? []).map((s, i) => <SrcLink key={i} url={s.source_url} label={`${num(s.value, 2)} · ${s.period ?? host(s.source_url ?? '')}`} />)}</span> : undefined} />
              <Kpi icon={<BarChart3 size={14} />} label="Products with published data" value={String(new Set((d.public?.production_by_fy ?? []).map((r) => r.product)).size || '—')} />
              <Kpi icon={<Wrench size={14} />} label="Plant model" value={complete ? 'Complete' : 'Incomplete'}
                foot={!complete ? <button className="text-[11px] text-cyan hover:underline" onClick={() => setTab('model')}>{model.data?.missing?.length ?? ''} item(s) missing →</button> : undefined} />
            </div>
            {d.note && <div className="text-[11.5px] text-faint">{d.note}</div>}
            <ProductionByFy rows={d.public?.production_by_fy ?? []} />
            <Financials rows={d.public?.financials ?? []} />
          </>}
        </>}
        {tab === 'model' && <ModelEditor q={model} />}
        {tab === 'scenario' && <Scenario model={model.data} />}
      </div>
    </div>
  );
}
