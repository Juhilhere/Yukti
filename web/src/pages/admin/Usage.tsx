import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, BookOpen, Cpu, Gauge, HardDrive, MemoryStick, ScrollText, ShieldAlert, ThumbsDown, ThumbsUp, Users, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import type { DayCount, Usage } from '../../lib/types';
import { cx, fmtDuration, fmtMB, num } from '../../lib/format';
import { AMBER, AXIS, CYAN, GRID, axisProps, tooltipStyle } from '../../lib/chartTheme';
import { Card, Dot, EmptyState, ErrorBox, Loading, Meter, StatusChip } from '../../components/ui';
import { useT } from '../../lib/i18n';

const v = (x: unknown, d = 0) => (typeof x === 'number' && isFinite(x) ? num(x, d) : '—');

function Tile({ icon, label, value, unit, sub, tone }: { icon: ReactNode; label: string; value: string; unit?: string; sub?: ReactNode; tone?: 'amber' | 'cyan' | 'danger' | 'ok' }) {
  const c = tone === 'amber' ? 'text-amber' : tone === 'cyan' ? 'text-cyan' : tone === 'danger' ? 'text-red-300' : tone === 'ok' ? 'text-green-300' : 'text-text';
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted">{icon}{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5"><span className={cx('font-mono text-[22px] font-semibold', value !== '—' && c)}>{value}</span>{unit && value !== '—' && <span className="text-[11.5px] text-muted">{unit}</span>}</div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

function DayChart({ data, color, name }: { data: DayCount[]; color: string; name: string }) {
  const t = useT();
  if (!data?.length) return <EmptyState title={t('admin.usage.noDataPeriod')} />;
  const total = data.reduce((a, b) => a + (b.count ?? 0), 0);
  return (
    <div>
      <div className="mb-1 font-mono text-[11px] text-muted">{t('admin.usage.total', { n: num(total, 0) })}</div>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => String(d).slice(5)} />
            <YAxis {...axisProps} axisLine={false} width={36} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: AXIS }} formatter={(x: unknown) => [num(x, 0), name]} />
            <Area type="monotone" dataKey="count" name={name} stroke={color} strokeWidth={2} fill={color} fillOpacity={0.12} isAnimationActive={false} dot={{ r: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Bars({ data }: { data: Record<string, number> }) {
  const t = useT();
  const rows = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return <div className="py-4 text-center text-[12px] text-faint">{t('admin.usage.noData')}</div>;
  const max = Math.max(1, ...rows.map(([, x]) => x));
  return (
    <div className="space-y-1.5">
      {rows.map(([k, x]) => (
        <div key={k} className="grid grid-cols-[150px_1fr_48px] items-center gap-2">
          <span className="truncate text-[12px] text-muted" title={k}>{k}</span>
          <Meter pct={(x / max) * 100} />
          <span className="text-right font-mono text-[11.5px]">{num(x, 0)}</span>
        </div>
      ))}
    </div>
  );
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="space-y-1.5 text-[12px]">
      {rows.map(([k, x]) => <div key={k} className="flex items-center justify-between gap-3"><span className="text-muted">{k}</span><span className="truncate text-right font-mono">{x}</span></div>)}
    </div>
  );
}

export default function UsageHealth() {
  const t = useT();
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ['admin', 'usage', days], queryFn: () => api.get<Usage>(`/api/admin/usage?days=${days}`), refetchInterval: 15_000 });
  const u = q.data;
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-muted">{t('admin.usage.period')}</span>
        {[7, 14, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={cx('rounded border px-2 py-0.5 text-[11.5px]', days === d ? 'border-cyan bg-cyan/10 text-cyan' : 'border-border text-muted hover:text-text')}>{t('admin.usage.days', { n: d })}</button>
        ))}
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted"><Dot tone={q.isFetching ? 'cyan' : 'ok'} pulse={q.isFetching} />{t('admin.usage.autoRefresh')}</span>
      </div>
      {q.isLoading && <Loading />}
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : null}
      {u && <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Tile icon={<Users size={13} />} label={t('admin.usage.users')} value={v(u.users?.total)} sub={t('admin.usage.usersSub', { active: v(u.users?.active_7d), disabled: v(u.users?.disabled), locked: v(u.users?.locked) })} />
          <Tile icon={<Activity size={13} />} label={t('admin.usage.sessions')} value={v(u.sessions_active)} tone="cyan" />
          <Tile icon={<Zap size={13} />} label={t('admin.usage.answers')} value={v(u.perf?.answers)} />
          <Tile icon={<ShieldAlert size={13} />} label={t('admin.usage.errors24')} value={v(u.errors_24h)} tone={(u.errors_24h ?? 0) > 0 ? 'danger' : 'ok'} />
          <Tile icon={<ThumbsUp size={13} />} label={t('admin.usage.ratedUp')} value={v(u.feedback?.up)} tone="ok" />
          <Tile icon={<ThumbsDown size={13} />} label={t('admin.usage.ratedDown')} value={v(u.feedback?.down)} tone="amber" />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card title={t('admin.usage.queriesPerDay')}><DayChart data={u.queries_per_day} color={CYAN} name={t('admin.usage.queries')} /></Card>
          <Card title={t('admin.usage.denialsPerDay')}><DayChart data={u.denials_per_day} color={AMBER} name={t('admin.usage.denials')} /></Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card title={t('admin.usage.byIntent')}><Bars data={u.by_intent} /></Card>
          <Card title={t('admin.usage.byDept')}><Bars data={u.by_department} /></Card>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile icon={<Gauge size={13} />} label={t('admin.usage.avgSpeed')} value={v(u.perf?.avg_tok_per_s, 1)} unit={t('admin.usage.tokPerS')} tone="cyan" />
          <Tile icon={<Gauge size={13} />} label={t('admin.usage.avgTtft')} value={v(u.perf?.avg_ttft_ms)} unit={t('admin.usage.ms')} />
          <Tile icon={<Gauge size={13} />} label={t('admin.usage.p95Ttft')} value={v(u.perf?.p95_ttft_ms)} unit={t('admin.usage.ms')} />
          <Tile icon={<Gauge size={13} />} label={t('admin.usage.avgTotal')} value={typeof u.perf?.avg_total_ms === 'number' ? num(u.perf.avg_total_ms / 1000, 2) : '—'} unit={t('admin.usage.sec')} />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card title={t('admin.usage.knowledge')} icon={<BookOpen size={13} className="text-cyan" />}>
            <KV rows={[
              [t('admin.usage.documents'), v(u.knowledge?.documents)], [t('admin.usage.pages'), v(u.knowledge?.pages)], [t('admin.usage.scanned'), v(u.knowledge?.scanned_pages)],
              [t('admin.usage.chunks'), v(u.knowledge?.chunks)], [t('admin.usage.examples'), v(u.knowledge?.examples)],
            ]} />
          </Card>
          <Card title={t('admin.usage.engineCard')} icon={<Cpu size={13} className="text-cyan" />}>
            <KV rows={[
              [t('admin.usage.status'), u.engine?.status ? <StatusChip status={u.engine.status} /> : '—'], [t('admin.usage.engine'), u.engine?.engine ?? '—'],
              [t('admin.usage.model'), u.engine?.model_name ?? '—'], [t('admin.usage.uptime'), typeof u.engine?.uptime_s === 'number' ? fmtDuration(u.engine.uptime_s) : '—'],
              [t('admin.usage.requests'), v(u.engine?.requests)],
            ]} />
          </Card>
          <Card title={t('admin.usage.hardware')} icon={<MemoryStick size={13} className="text-cyan" />}>
            <KV rows={[
              ['GPU', u.gpu?.name ?? t('admin.usage.noGpu')],
              ['VRAM', u.gpu ? `${fmtMB(u.gpu.vram_used_mb)} / ${fmtMB(u.gpu.vram_total_mb)}` : '—'],
              [t('admin.usage.gpuUtil'), typeof u.gpu?.util_pct === 'number' ? `${num(u.gpu.util_pct, 0)}%` : '—'],
              ['RAM', u.ram ? `${fmtMB(u.ram.used_mb)} / ${fmtMB(u.ram.total_mb)}` : '—'],
            ]} />
          </Card>
          <Card title={t('admin.usage.storage')} icon={<HardDrive size={13} className="text-cyan" />}>
            <KV rows={[
              [t('admin.usage.diskFree'), typeof u.disk?.free_gb === 'number' ? `${num(u.disk.free_gb, 1)} GB` : '—'],
              [t('admin.usage.diskTotal'), typeof u.disk?.total_gb === 'number' ? `${num(u.disk.total_gb, 1)} GB` : '—'],
              [t('admin.usage.auditRecords'), v(u.audit?.records)],
              [t('admin.usage.auditHead'), u.audit?.head ? <span title={u.audit.head}><ScrollText size={11} className="mr-1 inline" />{u.audit.head.slice(0, 12)}</span> : '—'],
            ]} />
          </Card>
        </div>
        <RecentProblems />
      </>}
    </div>
  );
}

type Problem = { at: string; level: string; area: string; message: string; ref: string | null };

/** The newest warnings and errors from the server's local journal (logs\errors.log), with the reference users see. */
function RecentProblems() {
  const t = useT();
  const [onlyErrors, setOnlyErrors] = useState(false);
  const q = useQuery({
    queryKey: ['admin', 'problems', onlyErrors],
    queryFn: () => api.get<{ items: Problem[]; folder: string }>(`/api/admin/problems?level=${onlyErrors ? 'ERROR' : 'WARNING'}`),
    refetchInterval: 15_000,
  });
  const items = q.data?.items ?? [];
  return (
    <Card title={t('admin.problems.title')} icon={<ShieldAlert size={13} className="text-amber" />}
      actions={<label className="flex items-center gap-1.5 text-[11.5px] text-muted"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />{t('admin.problems.onlyErrors')}</label>}>
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : items.length === 0 ? (
        <EmptyState title={t('admin.problems.none')} />
      ) : (
        <div className="max-h-[340px] overflow-auto font-mono text-[11.5px]">
          {items.map((p, i) => (
            <div key={i} className="flex gap-2 border-t border-border py-1 first:border-t-0">
              <span className="shrink-0 text-faint">{p.at}</span>
              <span className={cx('shrink-0 font-semibold', p.level === 'ERROR' ? 'text-danger' : 'text-amber')}>{p.ref ?? p.level}</span>
              <span className="shrink-0 text-cyan">{p.area}</span>
              <span className="min-w-0 break-words">{p.message.split('\n')[0]}</span>
            </div>
          ))}
        </div>
      )}
      {q.data?.folder && <div className="mt-2 text-[11px] text-faint">{t('admin.problems.folder', { folder: q.data.folder })}</div>}
    </Card>
  );
}
