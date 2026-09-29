import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Activity, FileCode2, Gauge, ShieldQuestion, Sparkles, Timer } from 'lucide-react';
import { api } from '../../lib/api';
import type { LayaBenchmark, LayaStats, PolicyDoc, RouteDecision } from '../../lib/types';
import { fmtTime, num } from '../../lib/format';
import { Badge, Card, ErrorBox, JsonView, Loading, Meter, QueryState, Spinner } from '../../components/ui';
import { CopyButton } from '../../components/pages2/CopyButton';
import { toast } from '../../components/Toast';

function yamlLineClass(l: string) {
  const t = l.trimStart();
  if (t.startsWith('#')) return 'text-faint';
  if (/^[\w.-]+:/.test(t)) return 'text-cyan';
  return 'text-text/85';
}

function PolicyCard() {
  const pol = useQuery({ queryKey: ['admin', 'policies'], queryFn: () => api.get<PolicyDoc>('/api/admin/policies') });
  const lines = (pol.data?.yaml ?? '').split('\n');
  return (
    <Card title="ABAC policy in force" icon={<FileCode2 size={14} className="text-amber" />} bodyClass="p-0"
      actions={pol.data && <><Badge mono tone="amber">v{pol.data.version}</Badge><CopyButton text={pol.data.yaml} /></>}>
      <QueryState q={pol} empty={!pol.data?.yaml} emptyTitle="No policy loaded">
        <div className="max-h-[560px] overflow-auto bg-bg py-2 font-mono text-[12px] leading-[1.6]">
          {lines.map((l, i) => (
            <div key={i} className="flex">
              <span className="w-12 shrink-0 select-none pr-3 text-right text-faint">{i + 1}</span>
              <span className={`whitespace-pre ${yamlLineClass(l)}`}>{l || ' '}</span>
            </div>
          ))}
        </div>
      </QueryState>
    </Card>
  );
}

function LayaCard() {
  const [text, setText] = useState('');
  const stats = useQuery({ queryKey: ['laya', 'stats'], queryFn: () => api.get<LayaStats>('/api/laya/stats'), refetchInterval: 10_000, retry: false });
  const classify = useMutation({ mutationFn: (t: string) => api.post<RouteDecision>('/api/laya/classify', { text: t }), onSuccess: () => stats.refetch() });
  const bench = useMutation({
    mutationFn: () => api.post<LayaBenchmark>('/api/admin/laya/benchmark', {}),
    onSuccess: (r) => { toast.success('Baseline measured', `${r.n} logged queries`); stats.refetch(); },
    onError: (e) => toast.error('Benchmark failed', (e as Error).message),
  });
  const s = stats.data;
  const intents = Object.entries(s?.by_intent ?? {}).sort((a, b) => b[1] - a[1]);
  const maxI = Math.max(1, ...intents.map(([, v]) => v));
  const b = bench.data ?? s?.benchmark ?? null;
  const measuredAt = !bench.data && s?.benchmark?.measured_at ? s.benchmark.measured_at : null;
  const speedup = b && typeof b.llm_router_avg_ms === 'number' && typeof b.laya_avg_ms === 'number' && b.laya_avg_ms > 0 ? b.llm_router_avg_ms / b.laya_avg_ms : null;
  return (
    <Card title="Laya intent router" icon={<Sparkles size={14} className="text-amber" />} actions={s?.model_version && <Badge mono tone="muted">{s.model_version}</Badge>}>
      {stats.isLoading ? <Loading /> : stats.error ? <ErrorBox error={stats.error} onRetry={() => stats.refetch()} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-amber/40 bg-amber/5 p-3">
                <div className="label !text-amber">LLM calls saved</div>
                <div className="mt-1 font-mono text-[24px] font-semibold text-amber">{num(s?.llm_calls_saved, 0)}</div>
                <div className="text-[11px] text-muted">of {num(s?.total, 0)} routed{s && s.total > 0 ? ` · ${num((s.llm_calls_saved / s.total) * 100, 0)}%` : ''}</div>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="label">Laya avg latency</div>
                <div className="mt-1 font-mono text-[24px] font-semibold text-cyan">{num(s?.avg_latency_ms, 2)}<span className="ml-1 text-[11px] text-muted">ms</span></div>
                <div className="text-[11px] text-muted">LLM-router baseline: {typeof s?.baseline_llm_router_ms === 'number' ? `${num(s.baseline_llm_router_ms, 0)} ms` : 'not measured'}</div>
              </div>
            </div>
            <div>
              <div className="label mb-1.5">By intent</div>
              {intents.length === 0 ? <div className="text-[12px] text-faint">No traffic yet.</div> : (
                <div className="space-y-1.5">
                  {intents.map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[130px_1fr_40px] items-center gap-2">
                      <span className="truncate font-mono text-[11.5px] text-muted">{k}</span><Meter pct={(v / maxI) * 100} /><span className="text-right font-mono text-[11.5px]">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <Timer size={14} className="text-cyan" /><span className="font-medium">LLM-router baseline</span>
                <button className="btn btn-sm btn-cyan ml-auto" disabled={bench.isPending} onClick={() => bench.mutate()}>
                  {bench.isPending ? <Spinner size={12} /> : <Gauge size={12} />}Measure LLM-router baseline
                </button>
              </div>
              <div className="mt-1 text-[11.5px] text-muted">Runs the currently loaded LLM as a router on logged queries and compares latency and agreement with Laya. Requires a loaded model; may take a minute.</div>
              {bench.error ? <ErrorBox className="mt-2" error={bench.error} /> : null}
              {measuredAt && <div className="mt-2 text-[11px] text-faint">Last measured {fmtTime(measuredAt)}{s?.benchmark?.model ? ` with ${s.benchmark.model}` : ''}</div>}
              {b && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] md:grid-cols-4">
                  <div><div className="label">Queries</div><div className="font-mono">{num(b.n, 0)}</div></div>
                  <div><div className="label">LLM router</div><div className="font-mono">{typeof b.llm_router_avg_ms === 'number' ? `${num(b.llm_router_avg_ms, 0)} ms` : '—'}</div></div>
                  <div><div className="label">Laya</div><div className="font-mono">{typeof b.laya_avg_ms === 'number' ? `${num(b.laya_avg_ms, 2)} ms` : '—'}</div></div>
                  <div><div className="label">Agreement</div><div className="font-mono">{typeof b.agreement_pct === 'number' ? `${num(b.agreement_pct, 1)}%` : '—'}</div></div>
                  {speedup !== null && <div className="col-span-full text-green-300">Laya is {num(speedup, 0)}× faster than LLM routing on these queries.</div>}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="label">Try the classifier</div>
              <textarea className="input min-h-[70px]" value={text} placeholder="Type an employee question…" onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) classify.mutate(text); }} />
              <button className="btn btn-sm" disabled={!text.trim() || classify.isPending} onClick={() => classify.mutate(text)}>
                {classify.isPending ? <Spinner size={12} /> : <Activity size={12} />}Classify
              </button>
              {classify.error ? <ErrorBox error={classify.error} /> : null}
              {classify.data && <JsonView value={classify.data} className="max-h-[220px]" />}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

type SimUser = { username: string; display_name: string; department: string; clearance_label: string };
type SimDoc = { id: string; title: string; doc_number: string | null; department: string; classification: string };
type SimResult = { effect: string; matched: string[]; reason: string };

/** "Could user X do action Y on document Z?" — runs the real policy engine without granting anything. */
function SimulateCard() {
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.get<SimUser[]>('/api/admin/users') });
  const docs = useQuery({ queryKey: ['admin', 'policy-docs'], queryFn: () => api.get<SimDoc[]>('/api/admin/policies/documents') });
  const [username, setUsername] = useState('');
  const [docId, setDocId] = useState('');
  const [action, setAction] = useState('read');
  const sim = useMutation({ mutationFn: () => api.post<SimResult>('/api/admin/policies/simulate', { username, document_id: docId, action }) });
  const ok = sim.data?.effect === 'allow';
  return (
    <Card title="Simulate an access decision" icon={<ShieldQuestion size={14} className="text-cyan" />}>
      <div className="space-y-3">
        <div className="text-[12px] text-muted">Checks what the policy engine would decide for a user, document and action. Nothing is granted and nothing changes; the check is audited.</div>
        <div className="grid gap-2 md:grid-cols-[1fr_1.4fr_140px_auto]">
          <select className="input" value={username} onChange={(e) => { setUsername(e.target.value); sim.reset(); }}>
            <option value="">Select employee…</option>
            {(users.data ?? []).map((u) => <option key={u.username} value={u.username}>{u.display_name} · {u.department} · {u.clearance_label}</option>)}
          </select>
          <select className="input" value={docId} onChange={(e) => { setDocId(e.target.value); sim.reset(); }}>
            <option value="">Select document…</option>
            {(docs.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.doc_number ? `${d.doc_number} · ` : ''}{d.title} ({d.department}, {d.classification})</option>)}
          </select>
          <select className="input" value={action} onChange={(e) => { setAction(e.target.value); sim.reset(); }}>
            {['read', 'search', 'cite', 'download'].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="btn btn-sm btn-cyan" disabled={!username || !docId || sim.isPending} onClick={() => sim.mutate()}>
            {sim.isPending ? <Spinner size={12} /> : <ShieldQuestion size={12} />}Simulate
          </button>
        </div>
        {sim.error ? <ErrorBox error={sim.error} /> : null}
        {sim.data && (
          <div className={`rounded-md border px-3 py-2 text-[12.5px] ${ok ? 'border-green-400/40 bg-green-400/10 text-green-300' : 'border-danger/50 bg-danger/10 text-red-300'}`}>
            <b className="uppercase">{sim.data.effect}</b> — {sim.data.reason}
            <div className="mt-1 font-mono text-[11px] text-muted">rules: {sim.data.matched.join(', ') || '—'}</div>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function PoliciesLaya() {
  return (
    <div className="space-y-4 p-5">
      <LayaCard />
      <SimulateCard />
      <PolicyCard />
    </div>
  );
}
