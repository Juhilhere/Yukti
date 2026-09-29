import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play, Search, Server, Terminal, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type { ServerStatus } from '../lib/types';
import { cx, fmtDuration, num } from '../lib/format';
import { Badge, Card, Dot, ErrorBox, Loading, Spinner, Toggle } from '../components/ui';
import { CopyButton } from '../components/pages2/CopyButton';
import { useT } from '../lib/i18n';

const ENDPOINTS = [
  { method: 'POST', path: '/v1/chat/completions', desc: 'developer.ep.chat' },
  { method: 'POST', path: '/v1/completions', desc: 'developer.ep.completions' },
  { method: 'POST', path: '/v1/embeddings', desc: 'developer.ep.embeddings' },
  { method: 'GET', path: '/v1/models', desc: 'developer.ep.models' },
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
  const t = useT();
  const q = useQuery({ queryKey: ['server', 'status'], queryFn: () => api.get<ServerStatus>('/api/server/status'), refetchInterval: 3000, retry: false });
  const s = q.data;
  const base = s?.openai_base_url || `${window.location.origin}/v1`;
  const curl = `curl ${base.replace(/\/$/, '')}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${s?.model_name || 'local-model'}", "messages": [{"role": "user", "content": "Hello"}], "stream": false}'`;
  return (
    <Card title={t('developer.server.title')} icon={<Server size={14} className="text-cyan" />}
      actions={s && <Badge tone={statusTone(s.status) === 'ok' ? 'ok' : statusTone(s.status) === 'danger' ? 'danger' : 'muted'} mono>
        <Dot tone={statusTone(s.status)} pulse={statusTone(s.status) === 'ok'} />{s.status}</Badge>}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
            {[
              [t('developer.engine'), s?.engine],
              [t('developer.model'), s?.model_name || '—'],
              [t('developer.port'), s?.port],
              [t('developer.uptime'), s ? fmtDuration(s.uptime_s) : '—'],
              [t('developer.requests'), s ? num(s.requests, 0) : '—'],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <div className="label">{k}</div>
                <div className="mt-0.5 truncate font-mono text-[12.5px]">{String(v ?? '—')}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="label mb-1">{t('developer.baseUrl')}</div>
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1">
              <code className="flex-1 truncate font-mono text-[12px] text-cyan">{base}</code>
              <CopyButton text={base} />
            </div>
          </div>
          <div>
            <div className="label mb-1">{t('developer.endpoints')}</div>
            <div className="divide-y divide-border rounded-md border border-border">
              {ENDPOINTS.map((e) => (
                <div key={e.path} className="flex items-center gap-2 px-2 py-1.5">
                  <Badge tone={e.method === 'GET' ? 'ok' : 'cyan'} mono className="w-11 justify-center">{e.method}</Badge>
                  <code className="font-mono text-[12px]">{e.path}</code>
                  <span className="ml-2 truncate text-[12px] text-muted">{t(e.desc)}</span>
                  <span className="ml-auto"><CopyButton text={`${base.replace(/\/v1\/?$/, '')}${e.path}`} /></span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between"><span className="label">{t('developer.curl')}</span><CopyButton text={curl} /></div>
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
  const t = useT();
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
    <Card title={t('developer.logs.title')} icon={<Terminal size={14} className="text-cyan" />} bodyClass="p-0"
      actions={<>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !w-44 !py-0.5 !pl-6 text-[12px]" placeholder={t('developer.logs.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <Toggle size="sm" checked={auto} onChange={setAuto} label={<span className="text-[11.5px] text-muted">{t('developer.logs.autoscroll')}</span>} />
        <button className="btn btn-sm" onClick={() => setPaused((p) => !p)}>{paused ? <Play size={12} /> : <Pause size={12} />}{paused ? t('developer.logs.resume') : t('developer.logs.pause')}</button>
        <button className="btn btn-sm btn-ghost" title={t('developer.logs.clear')} onClick={() => setClearedAt(all.length)}><Trash2 size={12} /></button>
      </>}>
      {q.error && <div className="p-2"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>}
      <div ref={ref} className="h-[360px] overflow-auto bg-bg px-3 py-2 font-mono text-[11.5px] leading-[1.55]">
        {q.isLoading ? <div className="flex items-center gap-2 text-muted"><Spinner size={12} /> {t('developer.logs.connecting')}</div>
          : lines.length === 0 ? <div className="text-faint">{filter ? t('developer.logs.noMatch') : t('developer.logs.empty')}</div>
            : lines.map((l, i) => <div key={i} className={cx('whitespace-pre-wrap break-all', lineTone(l))}>{l}</div>)}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3 py-1 text-[11px] text-muted">
        <Dot tone={paused ? 'amber' : 'ok'} pulse={!paused} />{paused ? t('developer.logs.paused') : t('developer.logs.live')}
        <span className="ml-auto font-mono">{t('developer.logs.count', { n: lines.length, total: all.length })}</span>
      </div>
    </Card>
  );
}

export default function Developer() {
  return (
    <div className="grid gap-4 p-5 xl:grid-cols-2">
      <ServerCard />
      <LogsConsole />
    </div>
  );
}
