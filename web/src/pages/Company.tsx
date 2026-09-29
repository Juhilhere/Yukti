import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Award, BarChart3, Building2, CalendarClock, Cpu, Database, ExternalLink, Factory, FlaskConical, Gauge, Globe2, IndianRupee,
  Info, Landmark, Leaf, Layers, Network, Newspaper, Package, Search, ShieldCheck, Store, TrendingUp, Users, Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import { AMBER, AXIS, CYAN, GRID, OTHER, SERIES, SURFACE, axisProps, tooltipStyle } from '../lib/chartTheme';
import { useDepartments } from '../lib/queries';
import { cx } from '../lib/format';
import { Badge, Card, ErrorBox, Tabs, Tip } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { locale, tr, useLang, useT } from '../lib/i18n';

/* ============================== types ============================== */
type Num = number | string | null | undefined;
type Fact = { key?: string; label?: string; value?: Num; unit?: string | null; period?: string | null; source_url?: string | null; source_title?: string | null; confidence?: string | null };
type Src = { source_url?: string | null };
type CompanyPayload = {
  retrieved_on?: string; source_count?: Num;
  corporate?: {
    facts?: Fact[];
    timeline?: ({ year?: Num; event?: string } & Src)[];
    leadership?: ({ name?: string; role?: string; since?: Num } & Src)[];
    departments?: ({ code?: string; name?: string; group?: string; description?: string; evidence_url?: string | null })[];
    subsidiaries_jvs?: ({ name?: string; relation?: string } & Src)[];
    awards?: ({ year?: Num; award?: string } & Src)[];
  };
  refinery?: {
    facts?: Fact[];
    units?: ({ code?: string; name?: string; phase?: string; capacity?: Num; unit?: string; licensor?: string; purpose?: string } & Src)[];
    infrastructure?: ({ name?: string; detail?: string } & Src)[];
    throughput?: ({ fy?: string; crude_mmt?: Num; utilisation_pct?: Num } & Src)[];
    crude_basket?: ({ item?: string; value?: Num } & Src)[];
  };
  products?: {
    facts?: Fact[];
    products?: ({ name?: string; category?: string; spec_standard?: string; uses?: string; markets?: string; brand_or_grades?: string } & Src)[];
    pp_grades?: ({ grade?: string; mfi?: Num; process?: string; applications?: string } & Src)[];
    production_sales?: ({ fy?: string; product?: string; production_kt?: Num; sales_kt?: Num; export_kt?: Num } & Src)[];
    marketing?: ({ item?: string; value?: Num } & Src)[];
    launches?: ({ date?: string; product?: string; detail?: string } & Src)[];
  };
  finance_esg?: {
    facts?: Fact[];
    financials?: ({ fy?: string; revenue_cr?: Num; ebitda_cr?: Num; pat_cr?: Num; grm_usd_bbl?: Num; throughput_mmt?: Num } & Src)[];
    quarters?: ({ quarter?: string; revenue_cr?: Num; pat_cr?: Num; grm_usd_bbl?: Num } & Src)[];
    ratings?: ({ agency?: string; rating?: string; date?: string } & Src)[];
    esg?: ({ metric?: string; value?: Num; unit?: string; period?: string } & Src)[];
    digital?: ({ initiative?: string; detail?: string } & Src)[];
    news?: ({ date?: string; headline?: string; summary?: string } & Src)[];
  };
};

/* ============================== helpers ============================== */
function arr<T>(x: T[] | null | undefined): T[] { return Array.isArray(x) ? x.filter((v) => v !== null && v !== undefined) : []; }
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/[,₹$\s]/g, '').replace(/%$/, '');
  const m = /^[-+]?\d*\.?\d+(e[-+]?\d+)?/i.exec(s);
  if (!m) return null;
  const n = Number(m[0]);
  return isFinite(n) ? n : null;
}
function txt(v: unknown): string { return v === null || v === undefined ? '' : String(v).trim(); }
function fmtN(v: unknown, digits?: number): string {
  const n = toNum(v);
  if (n === null) return txt(v) || '—';
  const d = digits ?? (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2);
  return n.toLocaleString(locale(), { maximumFractionDigits: d, minimumFractionDigits: 0 });
}
/** Chronological key for "FY2023-24", "2023-24", "FY24", "2024", "Q1 FY25". */
function fyKey(s: unknown): number {
  const t = txt(s);
  const q = /Q([1-4])/i.exec(t);
  const qn = q ? Number(q[1]) / 10 : 0;
  let m = /(\d{4})\s*[-–/]\s*(\d{2,4})/.exec(t);
  if (m) { const b = m[2]; return (b.length === 2 ? Number(m[1].slice(0, 2) + b) : Number(b)) + qn; }
  m = /(\d{4})/.exec(t);
  if (m) return Number(m[1]) + qn;
  m = /FY\s*'?(\d{2})\b/i.exec(t);
  if (m) return 2000 + Number(m[1]) + qn;
  return 0;
}
function dateKey(s: unknown): number {
  const t = Date.parse(txt(s));
  if (!isNaN(t)) return t;
  const y = /(\d{4})/.exec(txt(s));
  return y ? Date.UTC(Number(y[1]), 0, 1) : 0;
}
function isUrl(u: unknown): u is string { return typeof u === 'string' && /^https?:\/\//i.test(u.trim()); }
function host(u: string): string { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return tr('company.other'); } }
/** Date in the chosen language (falls back to the raw text when it is not a date). */
function fmtDateL(s: string): string {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' });
}
/** Fill {name} placeholders of a translated sentence with React nodes (keeps styled values inside one translated string). */
function fillNodes(str: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return str.split(/(\{\w+\})/).map((part, i) => { const m = /^\{(\w+)\}$/.exec(part); return m && m[1] in nodes ? <span key={i}>{nodes[m[1]]}</span> : part; });
}
function groupBy<T>(xs: T[], key: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  xs.forEach((x) => { const k = key(x) || tr('company.other'); if (!m.has(k)) m.set(k, []); m.get(k)!.push(x); });
  return [...m.entries()];
}

/* chart styling — matches Production page tokens; categorical order validated for the dark surface */

/* ============================== atoms ============================== */
function SrcLink({ url, title, className }: { url?: string | null; title?: string | null; className?: string }) {
  if (!isUrl(url)) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={title ? `${title} — ${url}` : url} onClick={(e) => e.stopPropagation()}
      className={cx('inline-flex shrink-0 items-center text-faint transition-colors hover:text-cyan', className)}>
      <ExternalLink size={11} />
    </a>
  );
}
function ConfDot({ c }: { c?: string | null }) {
  const t = useT();
  const k = txt(c).toLowerCase();
  const cls = k === 'high' ? 'bg-ok' : k === 'medium' ? 'bg-amber' : k === 'low' ? 'bg-faint' : 'bg-border-strong';
  const level = k === 'high' ? t('company.conf.high') : k === 'medium' ? t('company.conf.medium') : k === 'low' ? t('company.conf.low') : k || t('company.conf.unrated');
  return <Tip side="top" text={t('company.confidence', { level })}><span className={cx('inline-block h-1.5 w-1.5 rounded-full', cls)} /></Tip>;
}
function NoData({ text }: { text?: string }) {
  const t = useT();
  return (
    <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-6 text-[12px] text-faint">
      <Info size={13} /> {text ?? t('company.noData')}
    </div>
  );
}
function Sec({ title, icon, count, children, actions, className, bodyClass }: {
  title: string; icon?: ReactNode; count?: number; children: ReactNode; actions?: ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <Card className={className} bodyClass={bodyClass} icon={<span className="text-cyan">{icon}</span>}
      title={<span className="flex items-center gap-2">{title}{count !== undefined && <span className="rounded bg-surface-3 px-1.5 font-mono text-[10.5px] font-normal text-muted">{count}</span>}</span>}
      actions={actions}>
      {children}
    </Card>
  );
}
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-bg px-2">
      <Search size={12} className="text-faint" />
      <input className="w-44 bg-transparent text-[12px] outline-none placeholder:text-faint" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
function ChartBox({ children, h = 220 }: { children: ReactNode; h?: number }) {
  return <div style={{ height: h }} className="w-full"><ResponsiveContainer width="100%" height="100%">{children as never}</ResponsiveContainer></div>;
}
function Skeleton() {
  const b = 'animate-pulse rounded-md bg-surface-2';
  return (
    <div className="space-y-4 p-4">
      <div className={cx(b, 'h-14 w-2/3')} />
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <div key={i} className={cx(b, 'h-[92px]')} />)}</div>
      <div className={cx(b, 'h-9')} />
      <div className="grid gap-3 md:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className={cx(b, 'h-28')} />)}</div>
    </div>
  );
}

/* ============================== KPI strip ============================== */
type Kpi = { id: string; label: string; icon: ReactNode; value: string; unit: string; period: string; url?: string | null; srcTitle?: string | null };

function factLabel(f: Fact) { return `${txt(f.key)} ${txt(f.label)}`.toLowerCase(); }
function buildKpis(d: CompanyPayload, facts: Fact[]): Kpi[] {
  const used = new Set<Fact>();
  const find = (res: RegExp[], not?: RegExp): Fact | undefined => {
    for (const re of res) {
      const f = facts.find((x) => !used.has(x) && re.test(factLabel(x)) && !(not && not.test(factLabel(x))) && txt(x.value) !== '');
      if (f) { used.add(f); return f; }
    }
    return undefined;
  };
  const fromFact = (id: string, label: string, icon: ReactNode, f?: Fact, defUnit = ''): Kpi | null =>
    f ? { id, label, icon, value: fmtN(f.value), unit: txt(f.unit) || defUnit, period: txt(f.period), url: f.source_url, srcTitle: f.source_title } : null;
  const latest = <T extends { fy?: string }>(rows: T[], pick: (r: T) => Num): T | undefined =>
    [...rows].filter((r) => toNum(pick(r)) !== null).sort((a, b) => fyKey(b.fy) - fyKey(a.fy))[0];

  const fin = arr(d.finance_esg?.financials);
  const thr = arr(d.refinery?.throughput);
  const out: (Kpi | null)[] = [];

  out.push(fromFact('cap', tr('company.kpi.capacity'), <Factory size={14} />,
    find([/refin\w*[ _]capacity|capacity[ _]\w*refin|nameplate|crude[ _]capacity|mmtpa/, /(^|\W)capacity/], /polyprop|pp\b|power|storage|tank|berth|sulphur/), 'MMTPA'));
  out.push(fromFact('nci', tr('company.kpi.nci'), <Gauge size={14} />, find([/nelson|\bnci\b|complexity/]), 'NCI'));

  const lt = latest(thr, (r) => r.crude_mmt);
  const ltFact = find([/throughput|crude[ _]process|crude[ _]run/]);
  out.push(lt ? { id: 'thr', label: tr('company.kpi.throughput'), icon: <Zap size={14} />, value: fmtN(lt.crude_mmt), unit: 'MMT', period: txt(lt.fy), url: lt.source_url }
    : fromFact('thr', tr('company.kpi.throughput'), <Zap size={14} />, ltFact, 'MMT'));

  const lg = latest(fin, (r) => r.grm_usd_bbl);
  const grmFact = find([/\bgrm\b|gross[ _]refining[ _]margin/]);
  out.push(lg ? { id: 'grm', label: tr('company.kpi.grm'), icon: <TrendingUp size={14} />, value: fmtN(lg.grm_usd_bbl, 2), unit: 'US$/bbl', period: txt(lg.fy), url: lg.source_url }
    : fromFact('grm', tr('company.kpi.grm'), <TrendingUp size={14} />, grmFact, 'US$/bbl'));

  const lr = latest(fin, (r) => r.revenue_cr);
  const revFact = find([/revenue|turnover|income[ _]from[ _]operations/]);
  out.push(lr ? { id: 'rev', label: tr('company.kpi.revenue'), icon: <IndianRupee size={14} />, value: fmtN(lr.revenue_cr, 0), unit: '₹ cr', period: txt(lr.fy), url: lr.source_url }
    : fromFact('rev', tr('company.kpi.revenue'), <IndianRupee size={14} />, revFact, '₹ cr'));

  const lp = latest(fin, (r) => r.pat_cr);
  const patFact = find([/\bpat\b|profit[ _]after[ _]tax|net[ _]profit/]);
  out.push(lp ? { id: 'pat', label: tr('company.kpi.pat'), icon: <Landmark size={14} />, value: fmtN(lp.pat_cr, 0), unit: '₹ cr', period: txt(lp.fy), url: lp.source_url }
    : fromFact('pat', tr('company.kpi.pat'), <Landmark size={14} />, patFact, '₹ cr'));

  out.push(fromFact('emp', tr('company.kpi.employees'), <Users size={14} />, find([/employee|headcount|manpower|workforce/]), tr('company.unit.people')));
  out.push(fromFact('ret', tr('company.kpi.retail'), <Store size={14} />, find([/retail|outlet|fuel[ _]station/]), tr('company.unit.outlets')));

  const prodFact = find([/(number|no\.?|count)[ _]?(of[ _])?products|products?[ _](count|number)|product[ _]slate/]);
  const prodN = arr(d.products?.products).length;
  out.push(fromFact('prod', tr('company.kpi.products'), <Package size={14} />, prodFact, tr('company.unit.products'))
    ?? (prodN ? { id: 'prod', label: tr('company.kpi.products'), icon: <Package size={14} />, value: String(prodN), unit: tr('company.unit.inCatalog'), period: tr('company.captured') } : null));

  const unitFact = find([/process[ _]units|(number|no\.?|count)[ _]?(of[ _])?units/]);
  const unitN = arr(d.refinery?.units).length;
  out.push(fromFact('units', tr('company.kpi.units'), <Cpu size={14} />, unitFact, tr('company.unit.units'))
    ?? (unitN ? { id: 'units', label: tr('company.kpi.units'), icon: <Cpu size={14} />, value: String(unitN), unit: tr('company.unit.listed'), period: tr('company.captured') } : null));

  return out.filter((k): k is Kpi => !!k);
}

function KpiTile({ k }: { k: Kpi }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-cyan/0 via-cyan/50 to-cyan/0" />
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
        <span className="text-cyan">{k.icon}</span><span className="truncate">{k.label}</span>
        <SrcLink url={k.url} title={k.srcTitle} className="ml-auto" />
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="truncate font-mono text-[22px] font-semibold leading-none tracking-tight">{k.value}</span>
        <span className="truncate text-[11px] text-muted">{k.unit}</span>
      </div>
      <div className="mt-1 truncate font-mono text-[10.5px] text-faint">{k.period || '—'}</div>
    </div>
  );
}

/* ============================== tabs ============================== */
function FactCard({ f }: { f: Fact }) {
  const t = useT();
  return (
    <div className="flex flex-col rounded-md border border-border bg-surface-2/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        <ConfDot c={f.confidence} /><span className="truncate">{txt(f.label) || txt(f.key) || t('company.fact')}</span>
        <SrcLink url={f.source_url} title={f.source_title} className="ml-auto" />
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="break-words font-mono text-[15px] font-semibold">{toNum(f.value) !== null && /^[-+\d.,\s₹$%]+$/.test(txt(f.value)) ? fmtN(f.value) : txt(f.value) || '—'}</span>
        {txt(f.unit) && <span className="text-[11px] text-muted">{txt(f.unit)}</span>}
      </div>
      {txt(f.period) && <div className="mt-auto pt-0.5 font-mono text-[10.5px] text-faint">{txt(f.period)}</div>}
    </div>
  );
}

function Leadership({ d }: { d: CompanyPayload }) {
  const t = useT();
  const rows = arr(d.corporate?.leadership);
  return (
    <Sec title={t('company.leadership')} icon={<Users size={14} />} count={rows.length}>
      {rows.length === 0 ? <NoData /> : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((l, i) => {
            const initials = txt(l.name).replace(/^(shri|smt|dr|mr|ms)\.?\s+/i, '').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
            return (
              <div key={i} className="flex items-center gap-2.5 rounded-md border border-border bg-surface-2/40 p-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan/40 bg-cyan/10 text-[12px] font-semibold text-cyan">{initials || '?'}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{txt(l.name) || '—'}</div>
                  <div className="truncate text-[11.5px] text-muted">{txt(l.role)}</div>
                  {txt(l.since) && <div className="font-mono text-[10.5px] text-faint">{t('company.since', { year: txt(l.since) })}</div>}
                </div>
                <SrcLink url={l.source_url} />
              </div>
            );
          })}
        </div>
      )}
    </Sec>
  );
}

function OverviewTab({ d }: { d: CompanyPayload }) {
  const facts = [...arr(d.corporate?.facts), ...arr(d.refinery?.facts)];
  const subs = arr(d.corporate?.subsidiaries_jvs);
  const awards = [...arr(d.corporate?.awards)].sort((a, b) => fyKey(b.year) - fyKey(a.year));
  const t = useT();
  return (
    <div className="space-y-4">
      <Sec title={t('company.keyFacts')} icon={<Database size={14} />} count={facts.length}
        actions={<span className="flex items-center gap-2 text-[10.5px] text-faint"><span className="flex items-center gap-1"><ConfDot c="high" />{t('company.conf.high')}</span><span className="flex items-center gap-1"><ConfDot c="medium" />{t('company.conf.medium')}</span><span className="flex items-center gap-1"><ConfDot c="low" />{t('company.conf.low')}</span></span>}>
        {facts.length === 0 ? <NoData /> : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{facts.map((f, i) => <FactCard key={i} f={f} />)}</div>
        )}
      </Sec>
      <div className="grid gap-4 xl:grid-cols-2">
        <Sec title={t('company.subsidiaries')} icon={<Network size={14} />} count={subs.length}>
          {subs.length === 0 ? <NoData /> : (
            <ul className="divide-y divide-border/60">
              {subs.map((s, i) => (
                <li key={i} className="flex items-center gap-2 py-1.5">
                  <Building2 size={13} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate">{txt(s.name) || '—'}</span>
                  {txt(s.relation) && <Badge tone="cyan">{txt(s.relation)}</Badge>}
                  <SrcLink url={s.source_url} />
                </li>
              ))}
            </ul>
          )}
        </Sec>
        <Sec title={t('company.awards')} icon={<Award size={14} />} count={awards.length}>
          {awards.length === 0 ? <NoData /> : (
            <ul className="max-h-[260px] divide-y divide-border/60 overflow-y-auto">
              {awards.map((a, i) => (
                <li key={i} className="flex items-start gap-2 py-1.5">
                  <span className="w-11 shrink-0 font-mono text-[11px] text-amber">{txt(a.year) || '—'}</span>
                  <span className="min-w-0 flex-1 text-[12.5px]">{txt(a.award)}</span>
                  <SrcLink url={a.source_url} className="mt-1" />
                </li>
              ))}
            </ul>
          )}
        </Sec>
      </div>
      <Leadership d={d} />
    </div>
  );
}

type UnitRow = NonNullable<NonNullable<CompanyPayload['refinery']>['units']>[number];
function RefineryTab({ d }: { d: CompanyPayload }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [byPhase, setByPhase] = useState(true);
  const units = arr(d.refinery?.units);
  const s = q.trim().toLowerCase();
  const filtered = units.filter((u) => !s || [u.code, u.name, u.phase, u.licensor, u.purpose].some((x) => txt(x).toLowerCase().includes(s)));
  const cols: Column<UnitRow>[] = [
    { key: 'code', header: t('company.col.code'), mono: true, width: 90, render: (u) => <span className="text-cyan">{txt(u.code) || '—'}</span>, sortValue: (u) => txt(u.code) },
    { key: 'name', header: t('company.col.unit'), render: (u) => <span className="font-medium">{txt(u.name) || '—'}</span>, sortValue: (u) => txt(u.name) },
    { key: 'phase', header: t('company.col.phase'), width: 90, render: (u) => txt(u.phase) || '—', sortValue: (u) => txt(u.phase) },
    { key: 'capacity', header: t('company.col.capacity'), width: 130, mono: true, render: (u) => toNum(u.capacity) !== null ? <>{fmtN(u.capacity)} <span className="text-faint">{txt(u.unit)}</span></> : (txt(u.capacity) || '—'), sortValue: (u) => toNum(u.capacity) },
    { key: 'licensor', header: t('company.col.licensor'), width: 140, render: (u) => txt(u.licensor) || '—', sortValue: (u) => txt(u.licensor) },
    { key: 'purpose', header: t('company.col.purpose'), render: (u) => <span className="text-[12px] text-muted">{txt(u.purpose)}</span> },
    { key: 'src', header: '', width: 28, render: (u) => <SrcLink url={u.source_url} /> },
  ];
  const groups = byPhase ? groupBy(filtered, (u) => txt(u.phase) || t('company.unspecified')).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })) : [[t('company.allUnits'), filtered] as [string, UnitRow[]]];
  const thr = [...arr(d.refinery?.throughput)].sort((a, b) => fyKey(a.fy) - fyKey(b.fy))
    .map((r) => ({ fy: txt(r.fy), crude: toNum(r.crude_mmt), util: toNum(r.utilisation_pct) })).filter((r) => r.fy);
  const hasCrude = thr.some((r) => r.crude !== null);
  const hasUtil = thr.some((r) => r.util !== null);
  const infra = arr(d.refinery?.infrastructure);
  const basket = arr(d.refinery?.crude_basket);
  return (
    <div className="space-y-4">
      <Sec title={t('company.kpi.units')} icon={<Cpu size={14} />} count={units.length}
        actions={<>
          <SearchBox value={q} onChange={setQ} placeholder={t('company.searchUnits')} />
          <button className={cx('btn btn-sm', byPhase && '!border-cyan/50 !text-cyan')} onClick={() => setByPhase((v) => !v)}><Layers size={12} /> {t('company.groupByPhase')}</button>
        </>} bodyClass="p-0">
        {units.length === 0 ? <div className="p-3"><NoData /></div> : filtered.length === 0 ? <div className="p-6 text-center text-muted">{t('company.noUnitMatch', { q })}</div> : (
          <div>
            {groups.map(([g, rows]) => (
              <div key={g}>
                {byPhase && <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber">{g}<span className="font-mono text-faint">{rows.length}</span></div>}
                <DataTable rows={rows} columns={cols} rowKey={(u) => `${txt(u.code)}-${txt(u.name)}-${rows.indexOf(u)}`} />
              </div>
            ))}
          </div>
        )}
      </Sec>
      <div className="grid gap-4 xl:grid-cols-2">
        <Sec title={t('company.kpi.throughput')} icon={<BarChart3 size={14} />} count={thr.length}>
          {!hasCrude ? <NoData /> : (
            <ChartBox>
              <BarChart data={thr} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="fy" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} width={40} unit="" />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v: unknown) => [`${fmtN(v)} MMT`, t('company.crudeProcessed')]} />
                <Bar dataKey="crude" name={t('company.crudeProcessedMmt')} fill={CYAN} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ChartBox>
          )}
        </Sec>
        <Sec title={t('company.utilisationTitle')} icon={<Gauge size={14} />} count={thr.filter((r) => r.util !== null).length}>
          {!hasUtil ? <NoData /> : (
            <ChartBox>
              <LineChart data={thr} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="fy" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} width={44} unit="%" domain={['auto', 'auto']} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => [`${fmtN(v, 1)}%`, t('company.utilisation')]} />
                <Line dataKey="util" name={t('company.utilisationPct')} stroke={AMBER} strokeWidth={2} dot={{ r: 4, fill: AMBER, stroke: SURFACE, strokeWidth: 2 }} connectNulls />
              </LineChart>
            </ChartBox>
          )}
        </Sec>
      </div>
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Sec title={t('company.infra')} icon={<Globe2 size={14} />} count={infra.length}>
          {infra.length === 0 ? <NoData /> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {infra.map((x, i) => (
                <div key={i} className="rounded-md border border-border bg-surface-2/40 px-3 py-2">
                  <div className="flex items-center gap-1.5 font-medium"><span className="truncate">{txt(x.name) || '—'}</span><SrcLink url={x.source_url} className="ml-auto" /></div>
                  {txt(x.detail) && <div className="mt-0.5 text-[12px] text-muted">{txt(x.detail)}</div>}
                </div>
              ))}
            </div>
          )}
        </Sec>
        <Sec title={t('company.crudeBasket')} icon={<FlaskConical size={14} />} count={basket.length}>
          {basket.length === 0 ? <NoData /> : (
            <ul className="divide-y divide-border/60">
              {basket.map((b, i) => (
                <li key={i} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 text-[12.5px]">{txt(b.item) || '—'}</span>
                  <span className="font-mono text-[12px] text-cyan">{txt(b.value)}</span>
                  <SrcLink url={b.source_url} />
                </li>
              ))}
            </ul>
          )}
        </Sec>
      </div>
    </div>
  );
}

type GradeRow = NonNullable<NonNullable<CompanyPayload['products']>['pp_grades']>[number];
function ProductsTab({ d }: { d: CompanyPayload }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [metric, setMetric] = useState<'production_kt' | 'sales_kt' | 'export_kt'>('production_kt');
  const products = arr(d.products?.products);
  const s = q.trim().toLowerCase();
  const shown = products.filter((p) => !s || [p.name, p.category, p.spec_standard, p.uses, p.markets, p.brand_or_grades].some((x) => txt(x).toLowerCase().includes(s)));
  const cats = groupBy(shown, (p) => txt(p.category) || t('company.other')).sort((a, b) => b[1].length - a[1].length);
  const grades = arr(d.products?.pp_grades);
  const gradeCols: Column<GradeRow>[] = [
    { key: 'grade', header: t('company.col.grade'), mono: true, width: 120, render: (g) => <span className="text-cyan">{txt(g.grade) || '—'}</span>, sortValue: (g) => txt(g.grade) },
    { key: 'mfi', header: t('company.col.mfi'), mono: true, width: 110, render: (g) => fmtN(g.mfi), sortValue: (g) => toNum(g.mfi) },
    { key: 'process', header: t('company.col.process'), width: 150, render: (g) => txt(g.process) || '—', sortValue: (g) => txt(g.process) },
    { key: 'applications', header: t('company.col.applications'), render: (g) => <span className="text-[12px] text-muted">{txt(g.applications)}</span> },
    { key: 'src', header: '', width: 28, render: (g) => <SrcLink url={g.source_url} /> },
  ];

  const ps = arr(d.products?.production_sales);
  const chart = useMemo(() => {
    const totals = new Map<string, number>();
    ps.forEach((r) => { const p = txt(r.product); const v = toNum(r[metric]); if (p && v !== null) totals.set(p, (totals.get(p) ?? 0) + v); });
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
    const top = ranked.slice(0, 5);
    const hasOther = ranked.length > 5;
    const byFy = new Map<string, Record<string, number | string>>();
    ps.forEach((r) => {
      const fy = txt(r.fy); const p = txt(r.product); const v = toNum(r[metric]);
      if (!fy || !p || v === null) return;
      const k = top.includes(p) ? p : 'Other';
      const row = byFy.get(fy) ?? { fy };
      row[k] = (Number(row[k]) || 0) + v;
      byFy.set(fy, row);
    });
    const data = [...byFy.values()].sort((a, b) => fyKey(a.fy) - fyKey(b.fy));
    return { data, keys: hasOther ? [...top, 'Other'] : top };
  }, [ps, metric]);

  const mkt = arr(d.products?.marketing);
  const launches = [...arr(d.products?.launches)].sort((a, b) => dateKey(b.date) - dateKey(a.date));
  return (
    <div className="space-y-4">
      <Sec title={t('company.catalog')} icon={<Package size={14} />} count={products.length}
        actions={<SearchBox value={q} onChange={setQ} placeholder={t('company.searchProducts')} />}>
        {products.length === 0 ? <NoData /> : shown.length === 0 ? <div className="py-6 text-center text-muted">{t('company.noProductMatch', { q })}</div> : (
          <div className="space-y-4">
            {cats.map(([cat, ps2]) => (
              <div key={cat}>
                <div className="mb-1.5 flex items-center gap-2"><span className="label !text-amber">{cat}</span><span className="font-mono text-[10.5px] text-faint">{ps2.length}</span><div className="h-px flex-1 bg-border" /></div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {ps2.map((p, i) => (
                    <div key={i} className="rounded-md border border-border bg-surface-2/40 px-3 py-2 transition-colors hover:border-cyan/40">
                      <div className="flex items-center gap-1.5"><span className="font-semibold">{txt(p.name) || '—'}</span><SrcLink url={p.source_url} className="ml-auto" /></div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {txt(p.spec_standard) && <Badge tone="cyan" mono>{txt(p.spec_standard)}</Badge>}
                        {txt(p.brand_or_grades) && <Badge tone="amber">{txt(p.brand_or_grades)}</Badge>}
                      </div>
                      {txt(p.uses) && <div className="mt-1.5 text-[12px] text-muted"><span className="text-faint">{t('company.uses')} · </span>{txt(p.uses)}</div>}
                      {txt(p.markets) && <div className="mt-0.5 text-[12px] text-muted"><span className="text-faint">{t('company.markets')} · </span>{txt(p.markets)}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Sec>
      <Sec title={t('company.prodSales')} icon={<BarChart3 size={14} />} count={ps.length}
        actions={<div className="flex gap-1">{([['production_kt', t('company.m.production')], ['sales_kt', t('company.m.sales')], ['export_kt', t('company.m.exports')]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setMetric(k)} className={cx('rounded border px-2 py-0.5 text-[11.5px]', metric === k ? 'border-cyan bg-cyan/10 text-cyan' : 'border-border text-muted hover:text-text')}>{l}</button>
        ))}</div>}>
        {chart.data.length === 0 ? <NoData text={ps.length ? t('company.noValues') : undefined} /> : (
          <ChartBox h={260}>
            <BarChart data={chart.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="fy" {...axisProps} />
              <YAxis {...axisProps} axisLine={false} width={52} unit=" kt" />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v: unknown, n: unknown) => [`${fmtN(v, 0)} kt`, String(n)]} />
              <Legend wrapperStyle={{ fontSize: 11, color: AXIS }} iconType="square" iconSize={9} />
              {chart.keys.map((k, i) => (
                <Bar key={k} dataKey={k} name={k === 'Other' ? t('company.other') : k} stackId="a" fill={k === 'Other' ? OTHER : SERIES[i % SERIES.length]} stroke={SURFACE} strokeWidth={1}
                  radius={i === chart.keys.length - 1 ? [4, 4, 0, 0] : undefined} maxBarSize={44} />
              ))}
            </BarChart>
          </ChartBox>
        )}
      </Sec>
      <Sec title={t('company.ppGrades')} icon={<FlaskConical size={14} />} count={grades.length} bodyClass="p-0">
        {grades.length === 0 ? <div className="p-3"><NoData /></div> : <DataTable rows={grades} columns={gradeCols} rowKey={(g) => `${txt(g.grade)}-${grades.indexOf(g)}`} maxHeight="360px" />}
      </Sec>
      <div className="grid gap-4 xl:grid-cols-2">
        <Sec title={t('company.marketing')} icon={<Store size={14} />} count={mkt.length}>
          {mkt.length === 0 ? <NoData /> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {mkt.map((m, i) => (
                <div key={i} className="rounded-md border border-border bg-surface-2/40 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted"><span className="truncate">{txt(m.item)}</span><SrcLink url={m.source_url} className="ml-auto" /></div>
                  <div className="mt-0.5 font-mono text-[14px] font-semibold">{txt(m.value) || '—'}</div>
                </div>
              ))}
            </div>
          )}
        </Sec>
        <Sec title={t('company.launches')} icon={<Zap size={14} />} count={launches.length}>
          {launches.length === 0 ? <NoData /> : (
            <ul className="max-h-[300px] divide-y divide-border/60 overflow-y-auto">
              {launches.map((l, i) => (
                <li key={i} className="flex items-start gap-2 py-1.5">
                  <span className="w-20 shrink-0 font-mono text-[11px] text-amber">{txt(l.date) || '—'}</span>
                  <div className="min-w-0 flex-1"><div className="font-medium">{txt(l.product)}</div>{txt(l.detail) && <div className="text-[12px] text-muted">{txt(l.detail)}</div>}</div>
                  <SrcLink url={l.source_url} className="mt-1" />
                </li>
              ))}
            </ul>
          )}
        </Sec>
      </div>
    </div>
  );
}

type FinRow = NonNullable<NonNullable<CompanyPayload['finance_esg']>['financials']>[number];
type QRow = NonNullable<NonNullable<CompanyPayload['finance_esg']>['quarters']>[number];
function FinancialsTab({ d }: { d: CompanyPayload }) {
  const fin = [...arr(d.finance_esg?.financials)].sort((a, b) => fyKey(a.fy) - fyKey(b.fy));
  const data = fin.map((r) => ({ fy: txt(r.fy), revenue: toNum(r.revenue_cr), ebitda: toNum(r.ebitda_cr), pat: toNum(r.pat_cr), grm: toNum(r.grm_usd_bbl) })).filter((r) => r.fy);
  const has = (k: 'revenue' | 'ebitda' | 'pat' | 'grm') => data.some((r) => r[k] !== null);
  const quarters = [...arr(d.finance_esg?.quarters)].sort((a, b) => fyKey(b.quarter) - fyKey(a.quarter));
  const ratings = [...arr(d.finance_esg?.ratings)].sort((a, b) => dateKey(b.date) - dateKey(a.date));
  const t = useT();
  const finCols: Column<FinRow>[] = [
    { key: 'fy', header: t('company.col.year'), mono: true, width: 100, render: (r) => <span className="text-cyan">{txt(r.fy)}</span>, sortValue: (r) => fyKey(r.fy) },
    { key: 'revenue_cr', header: t('company.col.revenue'), mono: true, className: 'text-right', render: (r) => fmtN(r.revenue_cr, 0), sortValue: (r) => toNum(r.revenue_cr) },
    { key: 'ebitda_cr', header: t('company.col.ebitda'), mono: true, className: 'text-right', render: (r) => fmtN(r.ebitda_cr, 0), sortValue: (r) => toNum(r.ebitda_cr) },
    { key: 'pat_cr', header: t('company.col.pat'), mono: true, className: 'text-right', render: (r) => <span className={cx((toNum(r.pat_cr) ?? 0) < 0 && 'text-red-300')}>{fmtN(r.pat_cr, 0)}</span>, sortValue: (r) => toNum(r.pat_cr) },
    { key: 'grm_usd_bbl', header: t('company.col.grm'), mono: true, className: 'text-right', render: (r) => fmtN(r.grm_usd_bbl, 2), sortValue: (r) => toNum(r.grm_usd_bbl) },
    { key: 'throughput_mmt', header: t('company.col.throughput'), mono: true, className: 'text-right', render: (r) => fmtN(r.throughput_mmt), sortValue: (r) => toNum(r.throughput_mmt) },
    { key: 'src', header: '', width: 28, render: (r) => <SrcLink url={r.source_url} /> },
  ];
  const qCols: Column<QRow>[] = [
    { key: 'quarter', header: t('company.col.quarter'), mono: true, render: (r) => <span className="text-cyan">{txt(r.quarter)}</span>, sortValue: (r) => fyKey(r.quarter) },
    { key: 'revenue_cr', header: t('company.col.revenue'), mono: true, className: 'text-right', render: (r) => fmtN(r.revenue_cr, 0), sortValue: (r) => toNum(r.revenue_cr) },
    { key: 'pat_cr', header: t('company.col.pat'), mono: true, className: 'text-right', render: (r) => <span className={cx((toNum(r.pat_cr) ?? 0) < 0 && 'text-red-300')}>{fmtN(r.pat_cr, 0)}</span>, sortValue: (r) => toNum(r.pat_cr) },
    { key: 'grm_usd_bbl', header: t('company.col.grm'), mono: true, className: 'text-right', render: (r) => fmtN(r.grm_usd_bbl, 2), sortValue: (r) => toNum(r.grm_usd_bbl) },
    { key: 'src', header: '', width: 28, render: (r) => <SrcLink url={r.source_url} /> },
  ];
  const crFmt = (v: unknown) => { const n = toNum(v); return n === null ? '' : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n); };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Sec title={t('company.revenueOps')} icon={<IndianRupee size={14} />}>
          {!has('revenue') ? <NoData /> : (
            <ChartBox>
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="fy" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={crFmt} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v: unknown) => [t('company.rsCr', { v: fmtN(v, 0) }), t('company.kpi.revenue')]} />
                <Bar dataKey="revenue" fill={CYAN} radius={[4, 4, 0, 0]} maxBarSize={34} />
              </BarChart>
            </ChartBox>
          )}
        </Sec>
        <Sec title={t('company.ebitdaPat')} icon={<Landmark size={14} />}>
          {!has('pat') && !has('ebitda') ? <NoData /> : (
            <ChartBox>
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="fy" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={crFmt} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v: unknown, n: unknown) => [t('company.rsCr', { v: fmtN(v, 0) }), String(n)]} />
                <Legend wrapperStyle={{ fontSize: 11, color: AXIS }} iconType="square" iconSize={9} />
                {has('ebitda') && <Bar dataKey="ebitda" name="EBITDA" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} />}
                {has('pat') && <Bar dataKey="pat" name={t('company.patLegend')} fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={22} />}
              </BarChart>
            </ChartBox>
          )}
        </Sec>
        <Sec title={t('company.kpi.grm')} icon={<TrendingUp size={14} />}>
          {!has('grm') ? <NoData /> : (
            <ChartBox>
              <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="fy" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} width={40} unit="$" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => [`US$ ${fmtN(v, 2)}/bbl`, 'GRM']} />
                <Line dataKey="grm" stroke={AMBER} strokeWidth={2} dot={{ r: 4, fill: AMBER, stroke: SURFACE, strokeWidth: 2 }} connectNulls />
              </LineChart>
            </ChartBox>
          )}
        </Sec>
      </div>
      <Sec title={t('company.annualFin')} icon={<BarChart3 size={14} />} count={fin.length} bodyClass="p-0">
        {fin.length === 0 ? <div className="p-3"><NoData /></div> : <DataTable rows={[...fin].reverse()} columns={finCols} rowKey={(r) => `${txt(r.fy)}-${fin.indexOf(r)}`} />}
      </Sec>
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Sec title={t('company.quarterly')} icon={<CalendarClock size={14} />} count={quarters.length} bodyClass="p-0">
          {quarters.length === 0 ? <div className="p-3"><NoData /></div> : <DataTable rows={quarters} columns={qCols} rowKey={(r) => `${txt(r.quarter)}-${quarters.indexOf(r)}`} maxHeight="340px" />}
        </Sec>
        <Sec title={t('company.ratings')} icon={<ShieldCheck size={14} />} count={ratings.length}>
          {ratings.length === 0 ? <NoData /> : (
            <ul className="space-y-2">
              {ratings.map((r, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md border border-border bg-surface-2/40 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{txt(r.agency) || '—'}</div>
                    <div className="font-mono text-[10.5px] text-faint">{txt(r.date)}</div>
                  </div>
                  <Badge tone="ok" mono>{txt(r.rating) || '—'}</Badge>
                  <SrcLink url={r.source_url} />
                </li>
              ))}
            </ul>
          )}
        </Sec>
      </div>
    </div>
  );
}

function SustainTab({ d }: { d: CompanyPayload }) {
  const esg = arr(d.finance_esg?.esg);
  const dig = arr(d.finance_esg?.digital);
  const t = useT();
  return (
    <div className="space-y-4">
      <Sec title={t('company.esg')} icon={<Leaf size={14} />} count={esg.length}>
        {esg.length === 0 ? <NoData /> : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {esg.map((m, i) => (
              <div key={i} className="rounded-md border border-border bg-surface-2/40 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] text-muted"><Leaf size={11} className="shrink-0 text-ok" /><span className="truncate">{txt(m.metric) || '—'}</span><SrcLink url={m.source_url} className="ml-auto" /></div>
                <div className="mt-0.5 flex items-baseline gap-1">
                  <span className="font-mono text-[17px] font-semibold">{toNum(m.value) !== null && /^[-+\d.,\s%]+$/.test(txt(m.value)) ? fmtN(m.value) : txt(m.value) || '—'}</span>
                  {txt(m.unit) && <span className="text-[11px] text-muted">{txt(m.unit)}</span>}
                </div>
                {txt(m.period) && <div className="font-mono text-[10.5px] text-faint">{txt(m.period)}</div>}
              </div>
            ))}
          </div>
        )}
      </Sec>
      <Sec title={t('company.digital')} icon={<Cpu size={14} />} count={dig.length}>
        {dig.length === 0 ? <NoData /> : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {dig.map((x, i) => (
              <div key={i} className="rounded-md border border-border bg-surface-2/40 px-3 py-2.5 transition-colors hover:border-cyan/40">
                <div className="flex items-center gap-1.5 font-semibold"><Zap size={12} className="shrink-0 text-amber" /><span>{txt(x.initiative) || '—'}</span><SrcLink url={x.source_url} className="ml-auto" /></div>
                {txt(x.detail) && <div className="mt-1 text-[12px] text-muted">{txt(x.detail)}</div>}
              </div>
            ))}
          </div>
        )}
      </Sec>
    </div>
  );
}

function OrgTab({ d }: { d: CompanyPayload }) {
  const dirQ = useDepartments();
  const t = useT();
  const [q, setQ] = useState('');
  const managers = new Map((dirQ.data ?? []).map((x) => [x.name.trim().toLowerCase(), x.manager_name] as const));
  const corp = arr(d.corporate?.departments).filter((x) => txt(x.name));
  // Fall back to the in-app department directory when the public capture has none.
  const depts = corp.length ? corp : (dirQ.data ?? []).map((x) => ({ code: x.code, name: x.name, group: x.group, description: x.description, evidence_url: null }));
  const s = q.trim().toLowerCase();
  const shown = depts.filter((x) => !s || [x.code, x.name, x.group, x.description].some((v) => txt(v).toLowerCase().includes(s)));
  const groups = groupBy(shown, (x) => txt(x.group) || t('company.other')).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div className="space-y-4">
      <Sec title={t('company.departments')} icon={<Network size={14} />} count={depts.length}
        actions={<><span className="text-[11px] text-faint">{t('company.groups', { n: groups.length })}</span><SearchBox value={q} onChange={setQ} placeholder={t('company.searchDepts')} /></>}>
        {depts.length === 0 ? <NoData /> : shown.length === 0 ? <div className="py-6 text-center text-muted">{t('company.noDeptMatch', { q })}</div> : (
          <div className="space-y-4">
            {groups.map(([g, ds]) => (
              <div key={g}>
                <div className="mb-1.5 flex items-center gap-2"><span className="label !text-amber">{g}</span><span className="font-mono text-[10.5px] text-faint">{ds.length}</span><div className="h-px flex-1 bg-border" /></div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {ds.map((x, i) => {
                    const mgr = managers.get(txt(x.name).toLowerCase());
                    return (
                      <div key={i} className="rounded-md border border-border bg-surface-2/40 px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {txt(x.code) && <span className="rounded bg-cyan/10 px-1 font-mono text-[10px] text-cyan">{txt(x.code)}</span>}
                          <span className="truncate font-medium">{txt(x.name)}</span>
                          <SrcLink url={x.evidence_url} className="ml-auto" />
                        </div>
                        {txt(x.description) && <div className="mt-1 line-clamp-3 text-[12px] text-muted">{txt(x.description)}</div>}
                        {mgr && <div className="mt-1 text-[11px] text-faint">{t('company.approver')} · <span className="text-muted">{mgr}</span></div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Sec>
      <Leadership d={d} />
    </div>
  );
}

function TimelineTab({ d }: { d: CompanyPayload }) {
  const tl = [...arr(d.corporate?.timeline)].sort((a, b) => fyKey(a.year) - fyKey(b.year));
  const news = [...arr(d.finance_esg?.news)].sort((a, b) => dateKey(b.date) - dateKey(a.date));
  const t = useT();
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Sec title={t('company.timeline')} icon={<CalendarClock size={14} />} count={tl.length}>
        {tl.length === 0 ? <NoData /> : (
          <ol className="relative ml-2 border-l border-border-strong">
            {tl.map((t, i) => (
              <li key={i} className="relative pb-3 pl-5 last:pb-0">
                <span className={cx('absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface', i === tl.length - 1 ? 'bg-amber' : 'bg-cyan')} />
                <div className="flex items-start gap-2">
                  <span className="w-12 shrink-0 font-mono text-[12px] font-semibold text-amber">{txt(t.year) || '—'}</span>
                  <span className="min-w-0 flex-1 text-[12.5px]">{txt(t.event)}</span>
                  <SrcLink url={t.source_url} className="mt-1" />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Sec>
      <Sec title={t('company.news')} icon={<Newspaper size={14} />} count={news.length}>
        {news.length === 0 ? <NoData /> : (
          <ul className="max-h-[640px] space-y-2 overflow-y-auto pr-1">
            {news.map((n, i) => (
              <li key={i} className="rounded-md border border-border bg-surface-2/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10.5px] text-faint">{txt(n.date) ? (isNaN(Date.parse(txt(n.date))) ? txt(n.date) : fmtDateL(txt(n.date))) : '—'}</span>
                  <SrcLink url={n.source_url} className="ml-auto" />
                </div>
                <div className="mt-0.5 font-medium">{txt(n.headline) || '—'}</div>
                {txt(n.summary) && <div className="mt-0.5 text-[12px] text-muted">{txt(n.summary)}</div>}
              </li>
            ))}
          </ul>
        )}
      </Sec>
    </div>
  );
}

type SrcEntry = { url: string; title: string; refs: number; sections: Set<string> };
function collectSources(d: CompanyPayload): SrcEntry[] {
  const m = new Map<string, SrcEntry>();
  const walk = (v: unknown, section: string) => {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, section)); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    for (const k of ['source_url', 'evidence_url']) {
      const u = o[k];
      if (isUrl(u)) {
        const key = u.trim();
        const e = m.get(key) ?? { url: key, title: '', refs: 0, sections: new Set<string>() };
        e.refs += 1; e.sections.add(section);
        if (!e.title && txt(o.source_title)) e.title = txt(o.source_title);
        m.set(key, e);
      }
    }
    Object.entries(o).forEach(([k, x]) => { if (x && typeof x === 'object') walk(x, section === 'root' ? k : section); });
  };
  walk(d, 'root');
  return [...m.values()];
}
function SourcesTab({ sources }: { sources: SrcEntry[] }) {
  const t = useT();
  const SECTION_LABEL: Record<string, string> = { corporate: t('company.sec.corporate'), refinery: t('company.sec.refinery'), products: t('company.sec.products'), finance_esg: t('company.sec.finance') };
  const groups = groupBy(sources, (s) => host(s.url)).sort((a, b) => b[1].length - a[1].length);
  return (
    <Sec title={t('company.sources.title')} icon={<Globe2 size={14} />} count={sources.length}
      actions={<span className="text-[11px] text-faint">{t('company.sources.domains', { n: groups.length })}</span>}>
      {sources.length === 0 ? <NoData /> : (
        <div className="grid gap-3 xl:grid-cols-2">
          {groups.map(([h, ss]) => (
            <div key={h} className="rounded-md border border-border">
              <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-3 py-1.5">
                <Globe2 size={12} className="text-cyan" /><span className="font-mono text-[12px] font-semibold">{h}</span>
                <span className="ml-auto font-mono text-[10.5px] text-muted">{ss.length === 1 ? t('company.sources.linksOne', { refs: ss.reduce((n, s) => n + s.refs, 0) }) : t('company.sources.links', { n: ss.length, refs: ss.reduce((n, s) => n + s.refs, 0) })}</span>
              </div>
              <ul className="max-h-[300px] divide-y divide-border/50 overflow-y-auto">
                {[...ss].sort((a, b) => b.refs - a.refs).map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-2 px-3 py-1.5 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] group-hover:text-cyan">{s.title || s.url.replace(/^https?:\/\/(www\.)?/, '')}</div>
                        {s.title && <div className="truncate font-mono text-[10.5px] text-faint">{s.url}</div>}
                        <div className="mt-0.5 flex flex-wrap gap-1">{[...s.sections].map((x) => <span key={x} className="rounded bg-surface-3 px-1 text-[10px] text-muted">{SECTION_LABEL[x] ?? x}</span>)}</div>
                      </div>
                      <span className="shrink-0 font-mono text-[10.5px] text-muted">×{s.refs}</span>
                      <ExternalLink size={11} className="mt-1 shrink-0 text-faint group-hover:text-cyan" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Sec>
  );
}

/* ============================== page ============================== */
type TabId = 'overview' | 'refinery' | 'products' | 'financials' | 'esg' | 'org' | 'timeline' | 'sources';

export default function Company() {
  const q = useQuery({ queryKey: ['company'], queryFn: () => api.get<CompanyPayload>('/api/company'), staleTime: 10 * 60_000, retry: 1 });
  const [tab, setTab] = useState<TabId>('overview');
  const t = useT();
  const lang = useLang();
  const d: CompanyPayload = q.data && typeof q.data === 'object' ? q.data : {};
  const facts = useMemo(() => [...arr(d.corporate?.facts), ...arr(d.refinery?.facts), ...arr(d.products?.facts), ...arr(d.finance_esg?.facts)], [d]);
  // KPI labels come from tr(), so rebuild them when the language changes
  const kpis = useMemo(() => buildKpis(d, facts), [d, facts, lang]);
  const sources = useMemo(() => collectSources(d), [d]);
  const srcCount = toNum(d.source_count) ?? sources.length;
  const retrieved = txt(d.retrieved_on);
  const retrievedLabel = retrieved ? (isNaN(Date.parse(retrieved)) ? retrieved : fmtDateL(retrieved)) : '—';

  const tabs: { id: TabId; label: ReactNode; count?: number }[] = [
    { id: 'overview', label: t('company.tab.overview'), count: arr(d.corporate?.facts).length + arr(d.refinery?.facts).length },
    { id: 'refinery', label: t('company.tab.refinery'), count: arr(d.refinery?.units).length },
    { id: 'products', label: t('company.tab.products'), count: arr(d.products?.products).length },
    { id: 'financials', label: t('company.tab.financials'), count: arr(d.finance_esg?.financials).length },
    { id: 'esg', label: t('company.tab.esg'), count: arr(d.finance_esg?.esg).length + arr(d.finance_esg?.digital).length },
    { id: 'org', label: t('company.tab.org'), count: arr(d.corporate?.departments).length },
    { id: 'timeline', label: t('company.tab.timeline'), count: arr(d.corporate?.timeline).length + arr(d.finance_esg?.news).length },
    { id: 'sources', label: t('company.tab.sources'), count: sources.length },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="relative border-b border-border bg-gradient-to-b from-surface-2/70 to-transparent px-5 py-4">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'linear-gradient(#22D3EE 1px, transparent 1px), linear-gradient(90deg, #22D3EE 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-amber/40 bg-amber/10 text-amber"><Building2 size={20} /></div>
            <div className="min-w-0">
              <div className="label !text-[10px] !text-cyan">{t('nav.company')}</div>
              <h1 className="text-[17px] font-semibold leading-tight">{t('company.title')}</h1>
              <div className="mt-1 max-w-4xl text-[12px] text-muted">
                {fillNodes(t('company.subtitle'), { date: <span className="font-mono text-text">{retrievedLabel}</span>, n: <span className="font-mono text-text">{srcCount}</span> })}
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber/40 bg-amber/10 px-2.5 py-0.5 text-[11px] font-medium text-amber">
            <Info size={12} /> {t('company.disclaimer')}
          </span>
        </div>
      </div>

      {q.isLoading ? <Skeleton /> : q.error ? (
        <div className="p-4"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>
      ) : (
        <div className="space-y-4 p-4">
          {kpis.length > 0 ? (
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-5">{kpis.map((k) => <KpiTile key={k.id} k={k} />)}</div>
          ) : <NoData text={t('company.noKpis')} />}
          <Tabs tabs={tabs} value={tab} onChange={setTab} className="sticky top-0 z-10 -mx-4 overflow-x-auto bg-bg/95 px-4 backdrop-blur" />
          {tab === 'overview' && <OverviewTab d={d} />}
          {tab === 'refinery' && <RefineryTab d={d} />}
          {tab === 'products' && <ProductsTab d={d} />}
          {tab === 'financials' && <FinancialsTab d={d} />}
          {tab === 'esg' && <SustainTab d={d} />}
          {tab === 'org' && <OrgTab d={d} />}
          {tab === 'timeline' && <TimelineTab d={d} />}
          {tab === 'sources' && <SourcesTab sources={sources} />}
        </div>
      )}
    </div>
  );
}
