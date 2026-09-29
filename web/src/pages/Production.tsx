import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Factory, Gauge, Info, Play, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import type { ProductionOverview, ScenarioInput, ScenarioResult } from '../lib/types';
import { Badge, Card, EmptyState, ErrorBox, Field, Loading, PageHeader, Slider, Spinner } from '../components/ui';
import { cx, num } from '../lib/format';

const AMBER = '#F5A524';
const CYAN = '#22D3EE';
const GRID = '#26324A';
const AXIS = '#8A98B3';
const tooltipStyle = { background: '#182338', border: '1px solid #26324A', borderRadius: 6, fontSize: 12, color: '#E6EDF7' };

const DEFAULT_SCN: ScenarioInput = { hcu_down_days: 0, diesel_crack_delta: 0, petchem_margin_delta: 0, crude_price_delta: 0 };
const SCN_FIELDS: { key: keyof ScenarioInput; label: string; min: number; max: number; step: number; unit: string; hint: string }[] = [
  { key: 'hcu_down_days', label: 'HCU downtime', min: 0, max: 30, step: 1, unit: 'days', hint: 'Hydrocracker unplanned/planned outage in the planning month' },
  { key: 'diesel_crack_delta', label: 'Diesel crack Δ', min: -10, max: 10, step: 0.5, unit: '$/bbl', hint: 'Change vs. baseline gasoil crack spread' },
  { key: 'petchem_margin_delta', label: 'Petchem margin Δ', min: -100, max: 100, step: 5, unit: '$/t', hint: 'Change in polymer / aromatics margin' },
  { key: 'crude_price_delta', label: 'Crude price Δ', min: -20, max: 20, step: 0.5, unit: '$/bbl', hint: 'Change in delivered crude cost' },
];

export default function Production() {
  const ov = useQuery({ queryKey: ['production', 'overview'], queryFn: () => api.get<ProductionOverview>('/api/production/overview') });
  const products = useMemo(() => {
    const s = new Set<string>();
    (ov.data?.history ?? []).forEach((h) => h?.product && s.add(h.product));
    if (s.size === 0) (ov.data?.products ?? []).forEach((p) => s.add(p.name));
    return [...s];
  }, [ov.data]);
  const [product, setProduct] = useState<string>('');
  const selProduct = product || products[0] || '';
  const series = useMemo(() => (ov.data?.history ?? [])
    .filter((h) => h.product === selProduct)
    .map((h) => ({
      month: h.month,
      demand: h.demand_kt ?? null,
      forecast: h.forecast_kt ?? null,
      band: typeof h.lo === 'number' && typeof h.hi === 'number' ? [h.lo, h.hi] : null,
    })), [ov.data, selProduct]);
  const firstForecast = series.find((s) => s.forecast !== null && (s.demand === null || s.demand === undefined))?.month;

  const [scn, setScn] = useState<ScenarioInput>(DEFAULT_SCN);
  const run = useMutation({ mutationFn: (b: ScenarioInput) => api.post<ScenarioResult>('/api/production/scenario', b) });

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader icon={<Factory size={18} />} title="Production intelligence" subtitle="Demand forecasting & product-mix scenario planning (LP optimizer + LLM explanation)" />
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-2.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-2.5 text-[12.5px]">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber" />
          <div><span className="font-semibold text-amber">Optimizer calculates · LLM explains · Planners decide</span>
            <span className="text-muted"> — advisory only, never writes DCS/SCADA. All scenario runs are recorded in the audit log.</span></div>
        </div>

        {ov.isLoading && <Loading />}
        {ov.error && <ErrorBox error={ov.error} onRetry={() => ov.refetch()} />}
        {ov.data && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi icon={<Factory size={14} />} label="Refining capacity" value={`${num(ov.data.capacity_mmtpa ?? 15, 1)}`} unit="MMTPA" />
              <Kpi icon={<Gauge size={14} />} label="Nelson Complexity Index" value={num(ov.data.nci ?? 11.67, 2)} unit="NCI" />
              <Kpi icon={<TrendingUp size={14} />} label="Products tracked" value={String((ov.data.products ?? []).length)} unit="streams" />
              <Kpi icon={<TrendingUp size={14} />} label="Best margin"
                value={(() => { const b = [...(ov.data.products ?? [])].sort((a, b) => (b.margin_usd_bbl ?? 0) - (a.margin_usd_bbl ?? 0))[0]; return b ? `${b.name}` : '—'; })()}
                unit={(() => { const b = [...(ov.data.products ?? [])].sort((a, b) => (b.margin_usd_bbl ?? 0) - (a.margin_usd_bbl ?? 0))[0]; return b ? `$${num(b.margin_usd_bbl, 1)}/bbl` : ''; })()} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
              <Card title="Demand history & forecast" actions={
                <div className="flex flex-wrap gap-1">
                  {products.map((p) => (
                    <button key={p} onClick={() => setProduct(p)}
                      className={cx('rounded border px-2 py-0.5 text-[11.5px]', p === selProduct ? 'border-cyan bg-cyan/10 text-cyan' : 'border-border text-muted hover:text-text')}>{p}</button>
                  ))}
                </div>}>
                {series.length === 0 ? <EmptyState title="No history for this product" /> : (
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="month" stroke={AXIS} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} />
                        <YAxis stroke={AXIS} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={48} unit=" kt" />
                        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: AXIS }}
                          formatter={(v: unknown, name: unknown) => {
                            if (Array.isArray(v)) return [`${num(v[0], 0)} – ${num(v[1], 0)} kt`, String(name)];
                            return [typeof v === 'number' ? `${num(v, 0)} kt` : '—', String(name)];
                          }} />
                        <Legend wrapperStyle={{ fontSize: 11, color: AXIS }} />
                        {firstForecast && <ReferenceLine x={firstForecast} stroke={AXIS} strokeDasharray="4 4" label={{ value: 'forecast →', fill: AXIS, fontSize: 10, position: 'insideTopLeft' }} />}
                        <Area type="monotone" dataKey="band" name="80% interval" stroke="none" fill={CYAN} fillOpacity={0.14} connectNulls isAnimationActive={false} />
                        <Line type="monotone" dataKey="demand" name="Actual demand" stroke={AMBER} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                        <Line type="monotone" dataKey="forecast" name="Forecast" stroke={CYAN} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2 }} connectNulls isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
              <Card title="Product slate" bodyClass="p-0">
                {(ov.data.products ?? []).length === 0 ? <EmptyState title="No products" /> : (
                  <table className="w-full text-[12px]">
                    <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted"><th className="px-3 py-1.5">Product</th><th className="px-3 py-1.5 text-right">Share</th><th className="px-3 py-1.5 text-right">$/bbl</th></tr></thead>
                    <tbody>
                      {(ov.data.products ?? []).map((p) => (
                        <tr key={p.name} className="border-t border-border/60">
                          <td className="px-3 py-1.5">
                            <div>{p.name}</div>
                            <div className="mt-1 h-1 w-full overflow-hidden rounded bg-surface-3"><div className="h-full bg-cyan/70" style={{ width: `${Math.min(100, p.share_pct ?? 0)}%` }} /></div>
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono">{num(p.share_pct, 1)}%</td>
                          <td className={cx('px-3 py-1.5 text-right font-mono', (p.margin_usd_bbl ?? 0) < 0 ? 'text-danger' : 'text-ok')}>{num(p.margin_usd_bbl, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>
          </>
        )}

        <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
          <Card title="Scenario" icon={<Play size={13} className="text-amber" />}>
            <div className="space-y-3">
              {SCN_FIELDS.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint}>
                  <Slider value={scn[f.key]} min={f.min} max={f.max} step={f.step} unit={f.unit} onChange={(v) => setScn((s) => ({ ...s, [f.key]: v }))} />
                </Field>
              ))}
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button className="btn btn-sm btn-ghost text-muted" onClick={() => setScn({ hcu_down_days: 10, diesel_crack_delta: 4, petchem_margin_delta: 0, crude_price_delta: 0 })}>Preset: HCU outage + diesel spike</button>
                <button className="btn btn-sm btn-ghost text-muted" onClick={() => setScn(DEFAULT_SCN)}>Reset</button>
              </div>
              <button className="btn btn-primary w-full justify-center" disabled={run.isPending} onClick={() => run.mutate(scn)}>
                {run.isPending ? <Spinner /> : <Play size={14} />} Run optimizer
              </button>
            </div>
          </Card>
          <div className="min-w-0">
            {run.error && <ErrorBox error={run.error} className="mb-3" />}
            {!run.data && !run.isPending && !run.error && (
              <Card><EmptyState icon={<Info size={26} />} title="Run a scenario" hint="Adjust downtime and market deltas, then run the LP optimizer. Yukti will show the product-mix shift, margin impact, binding constraints and a plain-language explanation." /></Card>
            )}
            {run.isPending && <Card><Loading label="Solving linear program…" /></Card>}
            {run.data && <ScenarioView r={run.data} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, unit }: { icon: React.ReactNode; label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted">{icon}{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5"><span className="font-mono text-[22px] font-semibold">{value}</span>{unit && <span className="text-[11.5px] text-muted">{unit}</span>}</div>
    </div>
  );
}

function ScenarioView({ r }: { r: ScenarioResult }) {
  const names = [...new Set([...Object.keys(r.baseline ?? {}), ...Object.keys(r.scenario ?? {})])];
  const deltas = names.map((n) => {
    const b = r.baseline?.[n] ?? 0; const s = r.scenario?.[n] ?? 0;
    const pct = r.delta_pct?.[n] ?? (b ? ((s - b) / b) * 100 : 0);
    return { name: n, baseline: b, scenario: s, pct: Number(pct.toFixed(2)) };
  });
  const mb = r.margin_cr?.baseline ?? 0; const ms = r.margin_cr?.scenario ?? 0; const md = ms - mb;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Kpi icon={<Gauge size={14} />} label="Baseline margin" value={`₹${num(mb, 1)}`} unit="Cr" />
        <Kpi icon={<Gauge size={14} />} label="Scenario margin" value={`₹${num(ms, 1)}`} unit="Cr" />
        <div className="rounded-md border border-border bg-surface px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted">{md >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}Margin impact</div>
          <div className={cx('mt-1 font-mono text-[22px] font-semibold', md >= 0 ? 'text-ok' : 'text-danger')}>{md >= 0 ? '+' : ''}₹{num(md, 1)} <span className="text-[11.5px] font-normal text-muted">Cr</span></div>
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        <Card title="Product-mix change (Δ %)">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deltas} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" stroke={AXIS} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} interval={0} />
                <YAxis stroke={AXIS} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} unit="%" width={44} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v: unknown) => [`${num(v, 2)}%`, 'Δ']} />
                <ReferenceLine y={0} stroke={AXIS} />
                <Bar dataKey="pct" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {deltas.map((d) => <Cell key={d.name} fill={d.pct >= 0 ? CYAN : AMBER} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Baseline vs scenario (kt)" bodyClass="p-0">
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
          {(r.binding ?? []).length === 0 ? <div className="text-muted text-[12px]">None</div> : (
            <div className="flex flex-wrap gap-1.5">{r.binding.map((b) => <Badge key={b} tone="amber" mono>{b}</Badge>)}</div>
          )}
        </Card>
        <Card title="Shadow prices" bodyClass="p-0">
          {(r.shadow_prices ?? []).length === 0 ? <div className="p-3 text-muted text-[12px]">None</div> : (
            <table className="w-full text-[12px]"><tbody>
              {r.shadow_prices.map((s) => (
                <tr key={s.constraint} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-1.5 font-mono text-[11.5px]">{s.constraint}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-cyan">{num(s.value, 3)}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </Card>
        <Card title="Assumptions">
          {(r.assumptions ?? []).length === 0 ? <div className="text-muted text-[12px]">None stated</div> : (
            <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted">{r.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          )}
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
