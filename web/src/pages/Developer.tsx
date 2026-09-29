import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Activity, Pause, Play, Search, Server, Sparkles, Terminal, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type { LayaStats, RouteDecision, ServerStatus } from '../lib/types';
import { cx, fmtDuration, num } from '../lib/format';
import { Badge, Card, Dot, ErrorBox, JsonView, Loading, Meter, PageHeader, Spinner, Toggle } from '../components/ui';
import { CopyButton } from '../components/pages2/CopyButton';

const ENDPOINTS = [
  { method: 'POST', path: '/v1/chat/completions', desc: 'OpenAI-compatible chat (streaming supported)' },
  { method: 'POST', path: '/v1/completions', desc: 'Text completion' },
  { method: 'POST', path: '/v1/embeddings', desc: 'Embeddings for RAG' },
  { method: 'GET', path: '/v1/models', desc: 'List loaded models' },
];

function statusTone(s?: string): 'ok' | 'amber' | 'danger' | 'muted' {
  if (!s) return 'muted';
  const l = s.toLowerCase();
  if (['ready', 'running', 'ok', 'up'].includes(l)) return 'ok';
  if (['loading', 'starting'].includes(l)) return 'amber';
  if (['error', 'down', 'failed'].includes(l)) return 'danger';
  return 'muted';
}

function ServerCard() {
  const q = useQuery({ queryKey: ['server', 'status'], queryFn: () => api.get<ServerStatus>('/api/server/status'), refetchInterval: 3000, retry: false });
  const s = q.data;
  const base = s?.openai_base_url || `${window.location.origin}/v1`;
  const curl = `curl ${base.replace(/\/$/, '')}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${s?.model_name || 'local-model'}", "messages": [{"role": "user", "content": "Hello"}], "stream": false}'`;
  return (
    <Card title="Local server" icon={<Server size={14} className="text-cyan" />}
      actions={s && <Badge tone={statusTone(s.status) === 'ok' ? 'ok' : statusTone(s.status) === 'danger' ? 'danger' : 'muted'} mono>
        <Dot tone={statusTone(s.status)} pulse={statusTone(s.status) === 'ok'} />{s.status}</Badge>}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
            {[
              ['Engine', s?.engine],
              ['Model', s?.model_name || '—'],
              ['Port', s?.port],
              ['Uptime', s ? fmtDuration(s.uptime_s) : '—'],
              ['Requests', s ? num(s.requests, 0) : '—'],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <div className="label">{k}</div>
                <div className="mt-0.5 truncate font-mono text-[12.5px]">{String(v ?? '—')}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="label mb-1">OpenAI base URL</div>
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1">
              <code className="flex-1 truncate font-mono text-[12px] text-cyan">{base}</code>
              <CopyButton text={base} />
            </div>
          </div>
          <div>
            <div className="label mb-1">Endpoints</div>
            <div className="divide-y divide-border rounded-md border border-border">
              {ENDPOINTS.map((e) => (
                <div key={e.path} className="flex items-center gap-2 px-2 py-1.5">
                  <Badge tone={e.method === 'GET' ? 'ok' : 'cyan'} mono className="w-11 justify-center">{e.method}</Badge>
                  <code className="font-mono text-[12px]">{e.path}</code>
                  <span className="ml-2 truncate text-[12px] text-muted">{e.desc}</span>
                  <span className="ml-auto"><CopyButton text={`${base.replace(/\/v1\/?$/, '')}${e.path}`} /></span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between"><span className="label">curl example</span><CopyButton text={curl} /></div>
            <pre className="overflow-x-auto rounded-md border border-border bg-bg p-2.5 font-mono text-[11.5px] text-muted">{curl}</pre>
          </div>
        </div>
      )}
    </Card>
  );
}

function lineTone(l: string) {
  const u = l.toUpperCase();
  if (u.includes('ERROR') || u.includes('FATAL')) return 'text-red-300';
  if (u.includes('WARN')) return 'text-amber';
  if (u.includes('DEBUG')) return 'text-faint';
  return 'text-text/85';
}

function LogsConsole() {
  const [paused, setPaused] = useState(false);
  const [auto, setAuto] = useState(true);
  const [filter, setFilter] = useState('');
  const [clearedAt, setClearedAt] = useState(0);
  const q = useQuery({
    queryKey: ['server', 'logs'], queryFn: () => api.get<{ lines: string[] }>('/api/server/logs?tail=300'),
    refetchInterval: paused ? false : 2000, retry: false,
  });
  const all = q.data?.lines ?? [];
  const lines = useMemo(() => {
    const base = all.slice(Math.min(clearedAt, all.length));
    const f = filter.trim().toLowerCase();
    return f ? base.filter((l) => l.toLowerCase().includes(f)) : base;
  }, [all, filter, clearedAt]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (auto && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, auto]);
  return (
    <Card title="Server logs" icon={<Terminal size={14} className="text-cyan" />} bodyClass="p-0"
      actions={<>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !w-44 !py-0.5 !pl-6 text-[12px]" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <Toggle size="sm" checked={auto} onChange={setAuto} label={<span className="text-[11.5px] text-muted">Autoscroll</span>} />
        <button className="btn btn-sm" onClick={() => setPaused((p) => !p)}>{paused ? <Play size={12} /> : <Pause size={12} />}{paused ? 'Resume' : 'Pause'}</button>
        <button className="btn btn-sm btn-ghost" title="Clear view" onClick={() => setClearedAt(all.length)}><Trash2 size={12} /></button>
      </>}>
      {q.error && <div className="p-2"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>}
      <div ref={ref} className="h-[360px] overflow-auto bg-bg px-3 py-2 font-mono text-[11.5px] leading-[1.55]">
        {q.isLoading ? <div className="flex items-center gap-2 text-muted"><Spinner size={12} /> Connecting…</div>
          : lines.length === 0 ? <div className="text-faint">No log lines{filter ? ' match the filter' : ''}.</div>
            : lines.map((l, i) => <div key={i} className={cx('whitespace-pre-wrap break-all', lineTone(l))}>{l}</div>)}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3 py-1 text-[11px] text-muted">
        <Dot tone={paused ? 'amber' : 'ok'} pulse={!paused} />{paused ? 'Paused' : 'Live · polling every 2 s'}
        <span className="ml-auto font-mono">{lines.length} / {all.length} lines</span>
      </div>
    </Card>
  );
}

function LayaPanel() {
  const [text, setText] = useState('A2 tripped at 02:15 — give me the isolation and restart dossier');
  const stats = useQuery({ queryKey: ['laya', 'stats'], queryFn: () => api.get<LayaStats>('/api/laya/stats'), refetchInterval: 10000, retry: false });
  const m = useMutation({ mutationFn: (t: string) => api.post<RouteDecision>('/api/laya/classify', { text: t }), onSuccess: () => stats.refetch() });
  const s = stats.data;
  const intents = Object.entries(s?.by_intent ?? {}).sort((a, b) => b[1] - a[1]);
  const maxI = Math.max(1, ...intents.map(([, v]) => v));
  return (
    <Card title="Laya router" icon={<Sparkles size={14} className="text-amber" />}
      actions={s?.model_version && <Badge mono tone="muted">{s.model_version}</Badge>}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="label">Classify text</div>
          <textarea className="input min-h-[84px]" value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) m.mutate(text); }} />
          <div className="flex items-center gap-2">
            <button className="btn btn-cyan btn-sm" disabled={!text.trim() || m.isPending} onClick={() => m.mutate(text)}>
              {m.isPending ? <Spinner size={12} /> : <Activity size={12} />}Classify
            </button>
            <span className="text-[11px] text-faint">Ctrl+Enter</span>
            {m.data && <span className="ml-auto font-mono text-[11.5px] text-muted">{num(m.data.latency_ms, 1)} ms</span>}
          </div>
          {m.error && <ErrorBox error={m.error} />}
          {m.data && <JsonView value={m.data} className="max-h-[240px]" />}
        </div>
        <div className="space-y-3">
          {stats.isLoading ? <Loading /> : stats.error ? <ErrorBox error={stats.error} onRetry={() => stats.refetch()} /> : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-3 rounded-md border border-amber/40 bg-amber/5 p-3">
                  <div className="label !text-amber">LLM calls saved</div>
                  <div className="mt-1 font-mono text-[28px] font-semibold leading-none text-amber">{num(s?.llm_calls_saved, 0)}</div>
                  <div className="mt-1 text-[11.5px] text-muted">
                    of {num(s?.total, 0)} requests routed deterministically
                    {s && s.total > 0 && <> · <span className="font-mono">{num((s.llm_calls_saved / s.total) * 100, 0)}%</span></>}
                  </div>
                </div>
                <div className="rounded-md border border-border p-2">
                  <div className="label">Total</div><div className="font-mono text-[16px]">{num(s?.total, 0)}</div>
                </div>
                <div className="col-span-2 rounded-md border border-border p-2">
                  <div className="label">Avg latency</div><div className="font-mono text-[16px] text-cyan">{num(s?.avg_latency_ms, 2)} <span className="text-[11px] text-muted">ms</span></div>
                </div>
              </div>
              <div>
                <div className="label mb-1.5">By intent</div>
                {intents.length === 0 ? <div className="text-[12px] text-faint">No traffic yet.</div> : (
                  <div className="space-y-1.5">
                    {intents.map(([k, v]) => (
                      <div key={k} className="grid grid-cols-[130px_1fr_40px] items-center gap-2">
                        <span className="truncate font-mono text-[11.5px] text-muted">{k}</span>
                        <Meter pct={(v / maxI) * 100} />
                        <span className="text-right font-mono text-[11.5px]">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function Developer() {
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Developer" subtitle="Local OpenAI-compatible server, logs and the Laya intent router" icon={<Terminal size={18} />} />
      <div className="grid gap-4 p-5 xl:grid-cols-2">
        <ServerCard />
        <LogsConsole />
        <div className="xl:col-span-2"><LayaPanel /></div>
      </div>
    </div>
  );
}
