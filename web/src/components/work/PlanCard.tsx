// Production planning: forecast + constrained optimizer -> scenario card. The optimizer calculates, the LLM explains, planners decide.
import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, ChevronDown, ChevronRight, Plus, Scale, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { cx, num } from '../../lib/format';
import type { ProdProduct, ProductionModel } from '../../lib/types';
import type { PlanResult } from '../../lib/work';
import { Badge, Card, EmptyState, ErrorBox, Field, Loading, Slider, Spinner } from '../ui';

const usdM = (x: number | null | undefined) => (typeof x === 'number' && isFinite(x) ? `$${num(x / 1e6, 2)}M` : '—');
const th = 'px-2 py-1.5';

export function PlanCard({ model }: { model: ProductionModel | undefined }) {
  const t = useT();
  const [hcu, setHcu] = useState(0);
  const [crude, setCrude] = useState(0);
  const plan = useMutation({ mutationFn: () => api.post<PlanResult>('/api/production/plan', { hcu_down_days: hcu, crude_cost_delta_usd_t: crude, petchem_margin_delta: 0 }) });
  const complete = !!model?.complete;
  const err = plan.error;
  const missing = err instanceof ApiError && err.status === 422 && Array.isArray(err.detail?.missing) ? (err.detail!.missing as string[]) : null;
  const r = plan.data;
  return (
    <div className="space-y-4">
      <Card title={t('plan.title')} icon={<CalendarClock size={14} className="text-amber" />}>
        <div className="mb-3 text-[12.5px] text-muted">{t('plan.intro')}</div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <Field label={t('production.scn.hcu')}><Slider value={hcu} min={0} max={30} unit={t('production.scn.days')} onChange={setHcu} disabled={!complete} /></Field>
          <Field label={t('production.scn.crude')}><Slider value={crude} min={-150} max={150} step={5} unit="US$/t" onChange={setCrude} disabled={!complete} /></Field>
          <button className="btn btn-primary" disabled={!complete || plan.isPending} onClick={() => plan.mutate()}>
            {plan.isPending ? <Spinner className="!text-[#1a1204]" /> : <Scale size={13} />}{t('plan.run')}
          </button>
        </div>
        {!complete && <div className="mt-2 text-[12px] text-amber">{t('production.scn.disabled')}</div>}
      </Card>
      {missing ? (
        <Card><div className="text-[12.5px] text-amber">{t('production.scn.needsModel')}</div><ul className="mt-1 list-disc pl-5 text-[12px] text-muted">{missing.map((m, i) => <li key={i}>{m}</li>)}</ul></Card>
      ) : err ? <ErrorBox error={err} /> : null}
      {plan.isPending && <Card><Loading label={t('production.scn.solving')} /></Card>}
      {!r && !plan.isPending && !err && <Card><EmptyState icon={<CalendarClock size={26} />} title={t('plan.emptyTitle')} hint={t('plan.emptyHint')} /></Card>}
      {r && <PlanView r={r} />}
    </div>
  );
}

function PlanView({ r }: { r: PlanResult }) {
  const t = useT();
  const ev = r.expected_value;
  const fc = Object.entries(r.forecast ?? {});
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-cyan/40 bg-cyan/5 px-3 py-2 text-[12.5px] font-medium text-cyan">{r.decision}</div>
      <div className="grid grid-cols-3 gap-3">
        {[[t('plan.expected'), usdM(ev.margin_usd), ''], [t('plan.baseline'), usdM(ev.baseline_margin_usd), ''],
          [t('plan.delta'), `${ev.delta_usd >= 0 ? '+' : '−'}${usdM(Math.abs(ev.delta_usd))}`, ev.delta_usd >= 0 ? 'text-ok' : 'text-danger']].map(([k, v, c]) => (
          <div key={k} className="rounded-md border border-border bg-surface px-3 py-2.5">
            <div className="text-[11.5px] text-muted">{k}</div>
            <div className={cx('mt-1 font-mono text-[20px] font-semibold', c)}>{v}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 2xl:grid-cols-2">
        <Card title={t('plan.proposal')} bodyClass="p-0">
          {r.proposal.length === 0 ? <div className="p-3 text-[12px] text-muted">{t('plan.noChange')}</div> : (
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className={th}>{t('production.col.product')}</th><th className={`${th} text-right`}>{t('plan.baselineKt')}</th><th className={`${th} text-right`}>{t('plan.proposedKt')}</th><th className={`${th} text-right`}>{t('plan.change')}</th>
              </tr></thead>
              <tbody>{r.proposal.map((p) => (
                <tr key={p.product} className="border-t border-border/60">
                  <td className={th}>{p.product}</td>
                  <td className={`${th} text-right font-mono`}>{num(p.baseline_kt, 1)}</td>
                  <td className={`${th} text-right font-mono`}>→ {num(p.proposed_kt, 1)}</td>
                  <td className={cx(th, 'text-right font-mono', p.change_pct > 0 ? 'text-cyan' : 'text-amber')}>{p.change_pct > 0 ? '+' : ''}{num(p.change_pct, 1)}%</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
        <Card title={t('plan.forecast')} bodyClass="p-0">
          {fc.length === 0 ? <div className="p-3 text-[12px] text-muted">{t('plan.noForecast')}</div> : (
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className={th}>{t('production.col.product')}</th><th className={`${th} text-right`}>{t('plan.low')}</th><th className={`${th} text-right`}>{t('plan.expectedKt')}</th>
                <th className={`${th} text-right`}>{t('plan.high')}</th><th className={th}>{t('plan.method')}</th>
              </tr></thead>
              <tbody>{fc.map(([p, f]) => (
                <tr key={p} className="border-t border-border/60">
                  <td className={th}>{p}</td>
                  <td className={`${th} text-right font-mono text-muted`}>{num(f.low, 1)}</td>
                  <td className={`${th} text-right font-mono font-semibold`}>{num(f.expected, 1)}</td>
                  <td className={`${th} text-right font-mono text-muted`}>{num(f.high, 1)}</td>
                  <td className={`${th} text-[11px] text-muted`}>{f.method} · n={f.n}{f.last_month ? ` · ${f.last_month}` : ''}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('plan.alternatives')}>
          {r.alternatives.length === 0 ? <div className="text-[12px] text-muted">{t('production.res.none')}</div> : (
            <div className="space-y-2">{r.alternatives.map((a) => (
              <div key={a.case} className="rounded border border-border px-2 py-1.5 text-[12px]">
                <div className="flex items-center gap-2"><Badge tone={a.case === 'low' ? 'amber' : 'cyan'}>{t(`plan.case.${a.case}`)}</Badge><span className="ml-auto font-mono">{usdM(a.margin_usd)}</span></div>
                <div className="mt-0.5 text-[11px] text-muted">{a.label}</div>
                {a.binding.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{a.binding.map((b) => <Badge key={b} mono tone="muted">{b}</Badge>)}</div>}
              </div>
            ))}</div>
          )}
        </Card>
        <Card title={t('production.res.binding')}>
          {r.binding.length === 0 ? <div className="text-[12px] text-muted">{t('production.res.none')}</div> : <div className="flex flex-wrap gap-1.5">{r.binding.map((b) => <Badge key={b} tone="amber" mono>{b}</Badge>)}</div>}
        </Card>
        <Card title={t('production.res.assumptions')}>
          {r.assumptions.length === 0 ? <div className="text-[12px] text-muted">{t('production.res.noneStated')}</div> : <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted">{r.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        </Card>
      </div>
      {r.explanation && (
        <Card title={<span className="flex items-center gap-2">{t('production.res.explanation')} <Badge tone="cyan">{t('production.res.aiAdvisory')}</Badge></span>}>
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{r.explanation}</div>
        </Card>
      )}
    </div>
  );
}

/* ---------- plant-model editor: optional planning fields of a product ---------- */
function Num({ value, onChange, disabled, placeholder }: { value: number | null | undefined; onChange: (v: number | null) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <input type="number" min={0} step="any" className="input !py-0.5 font-mono text-[12px]" disabled={disabled} placeholder={placeholder}
      value={value === null || value === undefined ? '' : value} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  );
}

export function ProductExtras({ p, canEdit, onChange }: { p: ProdProduct; canEdit: boolean; onChange: (patch: Partial<ProdProduct>) => void }) {
  const t = useT();
  const hist = p.demand_history ?? [];
  const setHist = (h: { month: string; kt: number | null }[]) => onChange({ demand_history: h });
  const nextMonth = () => {
    const last = [...hist].map((h) => h.month).sort().pop();
    const d = last && /^\d{4}-\d{2}$/.test(last) ? new Date(`${last}-01T00:00:00`) : new Date();
    d.setMonth(d.getMonth() + (last ? 1 : -1));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const fields: [keyof ProdProduct, string][] = [
    ['inventory_kt', 'plan.f.inventory'], ['storage_max_kt', 'plan.f.storage'], ['dispatch_max_kt', 'plan.f.dispatch'],
    ['contract_min_kt', 'plan.f.contract'], ['crack_usd_t', 'plan.f.crack'],
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {fields.map(([k, key]) => (
          <label key={k} className="block"><span className="text-[11px] text-muted">{t(key)}</span>
            <Num value={p[k] as number | null | undefined} disabled={!canEdit} onChange={(v) => onChange({ [k]: v } as Partial<ProdProduct>)} /></label>
        ))}
      </div>
      <label className="block"><span className="text-[11px] text-muted">{t('plan.f.spec')}</span>
        <input className="input !py-0.5 text-[12px]" disabled={!canEdit} value={p.spec_note ?? ''} onChange={(e) => onChange({ spec_note: e.target.value || null })} /></label>
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] text-muted">{t('plan.f.history', { n: hist.length })}</span>
          {canEdit && <button type="button" className="btn btn-sm btn-ghost !py-0" onClick={() => setHist([...hist, { month: nextMonth(), kt: null }])}><Plus size={11} />{t('plan.f.addMonth')}</button>}
        </div>
        <div className="grid gap-1 sm:grid-cols-2">
          {hist.map((h, i) => (
            <div key={i} className="flex items-center gap-1">
              <input type="month" className="input !py-0.5 font-mono text-[11.5px]" disabled={!canEdit} value={h.month}
                onChange={(e) => setHist(hist.map((x, j) => (j === i ? { ...x, month: e.target.value } : x)))} />
              <Num value={h.kt} disabled={!canEdit} placeholder="kt" onChange={(v) => setHist(hist.map((x, j) => (j === i ? { ...x, kt: v } : x)))} />
              {canEdit && <button type="button" className="text-faint hover:text-danger" title={t('btn.delete')} onClick={() => setHist(hist.filter((_, j) => j !== i))}><Trash2 size={11} /></button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Product row with an expandable panel for the planning fields. */
export function ProductRow({ p, canEdit, onChange, cells }: { p: ProdProduct; canEdit: boolean; onChange: (patch: Partial<ProdProduct>) => void; cells: ReactNode }) {
  const [open, setOpen] = useState(false);
  const n = (p.demand_history ?? []).length;
  return (
    <>
      <tr className="border-t border-border/60">
        <td className="px-2 py-1">
          <button className="flex items-center gap-1 text-left" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}{p.name}
            {n > 0 && <span className="font-mono text-[10px] text-cyan">·{n}</span>}
          </button>
        </td>
        {cells}
      </tr>
      {open && <tr className="bg-bg"><td colSpan={4} className="px-2 py-2"><ProductExtras p={p} canEdit={canEdit} onChange={onChange} /></td></tr>}
    </>
  );
}
