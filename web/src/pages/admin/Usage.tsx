import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, BookOpen, Cpu, Gauge, HardDrive, MemoryStick, ScrollText, ShieldAlert, ThumbsDown, ThumbsUp, Users, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import type { DayCount, Usage } from '../../lib/types';
import { cx, fmtDuration, fmtMB, num } from '../../lib/format';
import { AMBER, AXIS, CYAN, GRID, axisProps, tooltipStyle } from '../../lib/chartTheme';
import { Card, Dot, EmptyState, ErrorBox, Loading, Meter, StatusChip } from '../../components/ui';

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
  if (!data?.length) return <EmptyState title="No data recorded in this period" />;
  const total = data.reduce((a, b) => a + (b.count ?? 0), 0);
  return (
    <div>
      <div className="mb-1 font-mono text-[11px] text-muted">total {num(total, 0)}</div>
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
  const rows = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return <div className="py-4 text-center text-[12px] text-faint">No data recorded</div>;
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
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ['admin', 'usage', days], queryFn: () => api.get<Usage>(`/api/admin/usage?days=${days}`), refetchInterval: 15_000 });
  const u = q.data;
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-muted">Period</span>
        {[7, 14, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={cx('rounded border px-2 py-0.5 text-[11.5px]', days === d ? 'border-cyan bg-cyan/10 text-cyan' : 'border-border text-muted hover:text-text')}>{d} days</button>
        ))}
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted"><Dot tone={q.isFetching ? 'cyan' : 'ok'} pulse={q.isFetching} />Auto-refresh every 15 s · only measured values shown (— = not measured)</span>
      </div>
      {q.isLoading && <Loading />}
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : null}
      {u && <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Tile icon={<Users size={13} />} label="Users" value={v(u.users?.total)} sub={<>active 7d {v(u.users?.active_7d)} · disabled {v(u.users?.disabled)} · locked {v(u.users?.locked)}</>} />
          <Tile icon={<Activity size={13} />} label="Active sessions" value={v(u.sessions_active)} tone="cyan" />
          <Tile icon={<Zap size={13} />} label="Answers" value={v(u.perf?.answers)} />
          <Tile icon={<ShieldAlert size={13} />} label="Errors (24 h)" value={v(u.errors_24h)} tone={(u.errors_24h ?? 0) > 0 ? 'danger' : 'ok'} />
          <Tile icon={<ThumbsUp size={13} />} label="Rated helpful" value={v(u.feedback?.up)} tone="ok" />
          <Tile icon={<ThumbsDown size={13} />} label="Rated not helpful" value={v(u.feedback?.down)} tone="amber" />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Queries per day"><DayChart data={u.queries_per_day} color={CYAN} name="Queries" /></Card>
          <Card title="Policy denials per day"><DayChart data={u.denials_per_day} color={AMBER} name="Denials" /></Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="By intent (Laya)"><Bars data={u.by_intent} /></Card>
          <Card title="By department"><Bars data={u.by_department} /></Card>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile icon={<Gauge size={13} />} label="Avg speed" value={v(u.perf?.avg_tok_per_s, 1)} unit="tok/s" tone="cyan" />
          <Tile icon={<Gauge size={13} />} label="Avg TTFT" value={v(u.perf?.avg_ttft_ms)} unit="ms" />
          <Tile icon={<Gauge size={13} />} label="p95 TTFT" value={v(u.perf?.p95_ttft_ms)} unit="ms" />
          <Tile icon={<Gauge size={13} />} label="Avg total time" value={typeof u.perf?.avg_total_ms === 'number' ? num(u.perf.avg_total_ms / 1000, 2) : '—'} unit="s" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card title="Knowledge" icon={<BookOpen size={13} className="text-cyan" />}>
            <KV rows={[
              ['Documents', v(u.knowledge?.documents)], ['Pages', v(u.knowledge?.pages)], ['Scanned pages', v(u.knowledge?.scanned_pages)],
              ['Chunks', v(u.knowledge?.chunks)], ['Example documents', v(u.knowledge?.examples)],
            ]} />
          </Card>
          <Card title="Inference engine" icon={<Cpu size={13} className="text-cyan" />}>
            <KV rows={[
              ['Status', u.engine?.status ? <StatusChip status={u.engine.status} /> : '—'], ['Engine', u.engine?.engine ?? '—'],
              ['Model', u.engine?.model_name ?? '—'], ['Uptime', typeof u.engine?.uptime_s === 'number' ? fmtDuration(u.engine.uptime_s) : '—'],
              ['Requests', v(u.engine?.requests)],
            ]} />
          </Card>
          <Card title="Hardware" icon={<MemoryStick size={13} className="text-cyan" />}>
            <KV rows={[
              ['GPU', u.gpu?.name ?? 'none detected'],
              ['VRAM', u.gpu ? `${fmtMB(u.gpu.vram_used_mb)} / ${fmtMB(u.gpu.vram_total_mb)}` : '—'],
              ['GPU util', typeof u.gpu?.util_pct === 'number' ? `${num(u.gpu.util_pct, 0)}%` : '—'],
              ['RAM', u.ram ? `${fmtMB(u.ram.used_mb)} / ${fmtMB(u.ram.total_mb)}` : '—'],
            ]} />
          </Card>
          <Card title="Storage & audit" icon={<HardDrive size={13} className="text-cyan" />}>
            <KV rows={[
              ['Disk free', typeof u.disk?.free_gb === 'number' ? `${num(u.disk.free_gb, 1)} GB` : '—'],
              ['Disk total', typeof u.disk?.total_gb === 'number' ? `${num(u.disk.total_gb, 1)} GB` : '—'],
              ['Audit records', v(u.audit?.records)],
              ['Audit head', u.audit?.head ? <span title={u.audit.head}><ScrollText size={11} className="mr-1 inline" />{u.audit.head.slice(0, 12)}</span> : '—'],
            ]} />
          </Card>
        </div>
      </>}
    </div>
  );
}
