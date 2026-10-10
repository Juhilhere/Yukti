// Performance Engine (validated load profiles), hot KV cache statistics and the retrieval channels (Admin → Models).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, Layers, Network, RefreshCw } from 'lucide-react';
import { api, errMsg } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { fmtMB, fmtTime, num } from '../../lib/format';
import type { KVStats, PerfProfile, ProfilesOut, RetrievalStatus } from '../../lib/work';
import { Badge, Card, ErrorBox, JsonView, Loading, Spinner, StatusChip, Tip, type Tone } from '../../components/ui';
import { toast } from '../../components/Toast';

const PROFILE_TONE: Record<string, Tone> = { validated: 'ok', measured: 'cyan', reference: 'amber' };

export function ProfileStatus({ status }: { status: string }) {
  const t = useT();
  return <Badge tone={PROFILE_TONE[status] ?? 'muted'}>{t(`perf.status.${status}`, status)}</Badge>;
}

export function useProfiles(modelId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['admin', 'profiles', modelId ?? ''],
    queryFn: () => api.get<ProfilesOut>(`/api/admin/profiles${modelId ? `?model_id=${encodeURIComponent(modelId)}` : ''}`, { silent: true }),
    enabled, retry: false, staleTime: 30_000,
  });
}

/** Profile choice for the model loader: "auto" (from the model's size and free VRAM) or one profile. */
export function ProfileSelect({ modelId, value, onChange }: { modelId: string | null; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const q = useProfiles(modelId);
  if (q.error) return null;
  const profiles = q.data?.profiles ?? [];
  const rec = q.data?.recommended;
  const sel = profiles.find((p) => p.id === value);
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Gauge size={14} className="text-cyan" />
        <span className="font-medium">{t('perf.profile')}</span>
        <select className="input !w-auto !py-0.5 text-[12px]" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="auto">{rec ? t('perf.autoRec', { id: profiles.find((p) => p.id === rec)?.label ?? rec }) : t('perf.auto')}</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.label} · {t(`perf.status.${p.status}`, p.status)}</option>)}
          <option value="">{t('perf.none')}</option>
        </select>
        {sel && <ProfileStatus status={sel.status} />}
        {q.data?.free_vram_mb != null && <span className="ml-auto font-mono text-[11px] text-faint">{t('perf.freeVram', { v: fmtMB(q.data.free_vram_mb) })}</span>}
      </div>
      <div className="mt-1 text-[11px] text-muted">{t('perf.loaderHint')}</div>
    </div>
  );
}

function ProfileRow({ p, recommended, active, canValidate }: { p: PerfProfile; recommended: boolean; active: boolean; canValidate: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const v = useMutation({
    mutationFn: () => api.post(`/api/admin/profiles/${encodeURIComponent(p.id)}/validate`),
    onSuccess: () => { toast.success(t('perf.validated'), p.label); qc.invalidateQueries({ queryKey: ['admin', 'profiles'] }); },
    onError: (e) => toast.error(t('perf.validateFailed'), errMsg(e)),
  });
  const val = p.validation;
  return (
    <div className="rounded-md border border-border bg-surface-2/40 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{p.label}</span>
        <ProfileStatus status={p.status} />
        {recommended && <Badge tone="cyan">{t('perf.recommended')}</Badge>}
        {active && <Badge tone="ok">{t('perf.active')}</Badge>}
        <span className="ml-auto font-mono text-[10.5px] text-faint">{p.id}</span>
      </div>
      <div className="mt-1 text-[11.5px] text-muted">
        {t('perf.fits', { b: `${p.params_b?.[0] ?? 0}–${p.params_b?.[1] ?? '?'}B`, v: fmtMB(p.min_vram_mb) })}
      </div>
      {p.measured && <div className="mt-1 text-[11.5px] text-cyan/90">{p.measured}</div>}
      {p.note && <div className="mt-1 text-[11.5px] text-muted">{p.note}</div>}
      {val && (
        <div className="mt-1.5 rounded border border-ok/30 bg-ok/5 px-2 py-1 text-[11.5px]">
          {t('perf.valLine', { tps: num(val.tok_per_s_median, 1), lo: num(val.tok_per_s_range?.[0], 1), hi: num(val.tok_per_s_range?.[1], 1), ttft: num(val.ttft_ms_median, 0), model: val.model, at: fmtTime(val.at) })}
          {val.vram && <span className="text-muted"> · VRAM {fmtMB(val.vram.used_mb)} / {fmtMB(val.vram.total_mb)}</span>}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <Tip side="top" text={<JsonView value={p.load} className="max-h-[240px]" />}><span className="cursor-help text-[11px] text-faint underline decoration-dotted">{t('perf.loadSettings')}</span></Tip>
        {canValidate && (
          <button className="btn btn-sm ml-auto" disabled={v.isPending} onClick={() => v.mutate()} title={t('perf.validateTip')}>
            {v.isPending ? <Spinner size={12} /> : <Gauge size={12} />}{t('perf.validate')}
          </button>
        )}
      </div>
    </div>
  );
}

export function ProfilesCard({ modelLoaded }: { modelLoaded: boolean }) {
  const t = useT();
  const q = useProfiles(null);
  return (
    <Card title={t('perf.title')} icon={<Gauge size={14} className="text-cyan" />}
      actions={q.data?.free_vram_mb != null ? <span className="font-mono text-[11px] text-faint">{t('perf.freeVram', { v: fmtMB(q.data.free_vram_mb) })}</span> : undefined}>
      <div className="mb-2 text-[12px] text-muted">{t('perf.intro')}</div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="grid gap-2 lg:grid-cols-2">
          {(q.data?.profiles ?? []).map((p) => (
            <ProfileRow key={p.id} p={p} recommended={q.data?.recommended === p.id} active={q.data?.active === p.id} canValidate={modelLoaded} />
          ))}
        </div>
      )}
      {!modelLoaded && <div className="mt-2 text-[11.5px] text-faint">{t('perf.loadFirst')}</div>}
    </Card>
  );
}

export function KvStatsView({ kv }: { kv: KVStats }) {
  const t = useT();
  const total = (kv.hits ?? 0) + (kv.misses ?? 0);
  const items: [string, string][] = [
    [t('perf.kv.slots'), String(kv.slots ?? '—')],
    [t('perf.kv.hot'), String(kv.hot_chats ?? 0)],
    [t('perf.kv.busy'), String((kv.busy ?? []).length)],
    [t('perf.kv.hitRate'), total ? `${Math.round(((kv.hits ?? 0) / total) * 100)}% (${kv.hits}/${total})` : '—'],
    [t('perf.kv.evictions'), String(kv.evictions ?? 0)],
    [t('perf.kv.restores'), String(kv.restores ?? 0)],
    [t('perf.kv.spilled'), `${kv.spilled_files ?? 0} · ${num(kv.spilled_mb ?? 0, 1)} MB`],
  ];
  if (kv.kv_type !== undefined) items.push([t('perf.kv.type'), kv.kv_type || 'f16']);
  if (kv.ctx_per_slot !== undefined) items.push([t('perf.kv.ctx'), kv.ctx_per_slot ? String(kv.ctx_per_slot) : '—']);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] md:grid-cols-3 xl:grid-cols-5">
      {items.map(([k, v]) => <div key={k}><div className="text-[11px] text-muted">{k}</div><div className="font-mono">{v}</div></div>)}
      {kv.settings && <div className="col-span-full text-[11px] text-faint">{t('perf.kv.settings', { ttl: kv.settings.kv_ttl_s, spill: kv.settings.kv_spill ? t('perf.kv.on') : t('perf.kv.off'), mb: kv.settings.kv_spill_max_mb })}</div>}
    </div>
  );
}

export function KvCard() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'kv'], queryFn: () => api.get<KVStats>('/api/admin/kv'), refetchInterval: 5000 });
  return (
    <Card title={t('perf.kv.title')} icon={<Layers size={14} className="text-cyan" />}>
      <div className="mb-2 text-[12px] text-muted">{t('perf.kv.intro')}</div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : q.data ? <KvStatsView kv={q.data} /> : null}
    </Card>
  );
}

export function RetrievalCard() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'retrieval'], queryFn: () => api.get<RetrievalStatus>('/api/admin/retrieval') });
  const rebuild = useMutation({
    mutationFn: () => api.post<{ edges: number }>('/api/admin/graph/rebuild'),
    onSuccess: (r) => { toast.success(t('ret.rebuilt'), t('ret.edges', { n: r?.edges ?? 0 })); qc.invalidateQueries({ queryKey: ['admin', 'retrieval'] }); },
    onError: (e) => toast.error(t('ret.rebuildFailed'), errMsg(e)),
  });
  const d = q.data;
  return (
    <Card title={t('ret.title')} icon={<Network size={14} className="text-cyan" />}
      actions={<button className="btn btn-sm" disabled={rebuild.isPending} onClick={() => rebuild.mutate()}>{rebuild.isPending ? <Spinner size={12} /> : <RefreshCw size={12} />}{t('ret.rebuild')}</button>}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : d ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="label mb-1">{t('ret.channels')}</div>
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-muted">{d.channels.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
          <div>
            <div className="label mb-1">{t('ret.graph')}</div>
            <div className="font-mono text-[18px]">{d.graph.edges}</div>
            <div className="mt-1 flex flex-wrap gap-1">{Object.entries(d.graph.by_relation ?? {}).map(([k, v]) => <Badge key={k} mono tone="muted">{k} {v}</Badge>)}</div>
          </div>
          <div>
            <div className="label mb-1">{t('ret.vectors')}</div>
            <div className="flex items-center gap-1.5"><StatusChip status={d.vectors.status} />{d.vectors.model && <Badge mono tone="muted">{d.vectors.model}</Badge>}</div>
            <div className="mt-1 text-[12px] text-muted">{t('ret.vecCount', { v: d.vectors.vectors, c: d.vectors.chunks })}</div>
            {d.vectors.error && <div className="mt-1 text-[11.5px] text-amber">{d.vectors.error}</div>}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
