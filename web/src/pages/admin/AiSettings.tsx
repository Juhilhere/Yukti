import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, RotateCcw, Save, SlidersHorizontal, Sparkles, Undo2 } from 'lucide-react';
import { api } from '../../lib/api';
import type { AiSettings as AiSettingsT } from '../../lib/types';
import { useEngines, useModels, useSchema } from '../../lib/queries';
import { ParamForm, withDefaults } from '../../components/ParamForm';
import { Card, ErrorBox, Field, Loading, Toggle, Spinner } from '../../components/ui';
import { toast } from '../../components/Toast';
import { ENGINE_LABEL } from '../../layout/ModelLoader';
import { useT } from '../../lib/i18n';
import { rich } from './AdminLayout';
import { WORKERS, WORKER_KEY } from '../../lib/work';
import { useProfiles } from './PerfEngine';
import { Layers } from 'lucide-react';

export default function AiSettings() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'ai-settings'], queryFn: () => api.get<AiSettingsT>('/api/admin/ai-settings') });
  const schema = useSchema();
  const models = useModels();
  const engines = useEngines();
  const [draft, setDraft] = useState<AiSettingsT | null>(null);

  useEffect(() => { if (q.data && !draft) setDraft(structuredClone(q.data)); }, [q.data, draft]);
  const dirty = useMemo(() => !!draft && !!q.data && JSON.stringify(draft) !== JSON.stringify(q.data), [draft, q.data]);

  const save = useMutation({
    mutationFn: (d: AiSettingsT) => api.put<AiSettingsT>('/api/admin/ai-settings', d),
    onSuccess: (r) => {
      toast.success(t('admin.ai.saved'), t('admin.ai.savedBody'));
      const next = r && typeof r === 'object' && 'prediction' in r ? r : draft;
      qc.setQueryData(['admin', 'ai-settings'], next);
      setDraft(next ? structuredClone(next) : null);
    },
    onError: (e) => toast.error(t('admin.ai.saveFailed'), (e as Error).message),
  });

  if (q.isLoading || schema.isLoading) return <Loading />;
  if (q.error) return <div className="p-5"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>;
  if (!draft) return <Loading />;

  const predFields = schema.data?.prediction ?? [];
  const loadFields = (schema.data?.load ?? []).filter((f) => !f.engines?.length || f.engines.includes(draft.default_engine));
  const set = (patch: Partial<AiSettingsT>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-cyan/30 bg-cyan/5 px-3 py-2 text-[12.5px]">
        <Sparkles size={14} className="text-cyan" />
        <span className="flex-1">{rich(t('admin.ai.banner'))}</span>
        <button className="btn btn-sm btn-ghost" disabled={!dirty || save.isPending} onClick={() => setDraft(q.data ? structuredClone(q.data) : null)}><Undo2 size={12} />{t('admin.ai.discard')}</button>
        <button className="btn btn-sm" disabled={save.isPending}
          onClick={() => { set({ prediction: withDefaults(predFields, {}), default_load_config: {} }); toast(t('admin.ai.resetToast'), { body: t('admin.ai.resetToastBody') }); }}>
          <RotateCcw size={12} />{t('admin.ai.resetDefaults')}
        </button>
        <button className="btn btn-sm btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
          {save.isPending ? <Spinner size={12} className="!text-[#1a1204]" /> : <Save size={12} />}{t('btn.save')}
        </button>
      </div>
      {schema.error ? <ErrorBox error={schema.error} onRetry={() => schema.refetch()} /> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card title={t('admin.ai.systemPrompt')} icon={<Sparkles size={14} className="text-amber" />}>
            <textarea className="input min-h-[220px] font-mono text-[12px] leading-relaxed" value={draft.system_prompt ?? ''}
              onChange={(e) => set({ system_prompt: e.target.value })} />
            <div className="mt-1 text-[11px] text-faint">{t('admin.ai.promptChars', { n: (draft.system_prompt ?? '').length })}</div>
          </Card>
          <Card title={t('admin.ai.defaultModel')} icon={<Cpu size={14} className="text-cyan" />}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('admin.ai.model')}>
                  <select className="input" value={draft.default_model_id ?? ''} onChange={(e) => {
                    const m = (models.data ?? []).find((x) => x.id === e.target.value);
                    // the engine follows the model: model files run on built-in llama.cpp, Ollama names on Ollama, server models on their server
                    const eng = !m ? draft.default_engine : m.source === 'ollama' ? 'ollama' : m.source === 'engine' ? (m.engine ?? draft.default_engine) : 'llamacpp';
                    set({ default_model_id: e.target.value || null, default_engine: eng });
                  }}>
                    <option value="">{models.isLoading ? t('admin.ai.loading') : t('admin.ai.none')}</option>
                    {draft.default_model_id && !(models.data ?? []).some((m) => m.id === draft.default_model_id) && <option value={draft.default_model_id}>{t('admin.ai.notFound', { id: draft.default_model_id })}</option>}
                    {(models.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}{m.quant ? ` · ${m.quant}` : ''}</option>)}
                  </select>
                </Field>
                <Field label={t('admin.ai.engine')} hint={t('admin.ai.engineHint')}>
                  <select className="input" value={draft.default_engine ?? ''} onChange={(e) => set({ default_engine: e.target.value })}>
                    {!(engines.data ?? []).some((x) => x.id === draft.default_engine) && <option value={draft.default_engine}>{draft.default_engine || '—'}</option>}
                    {(engines.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.available ? (ENGINE_LABEL[x.id] ?? x.name) : t('admin.ai.unavailable', { name: ENGINE_LABEL[x.id] ?? x.name })}</option>)}
                  </select>
                </Field>
              </div>
              {(() => {
                const m = (models.data ?? []).find((x) => x.id === draft.default_model_id);
                const need = !m ? null : m.source === 'ollama' ? 'ollama' : m.source === 'engine' ? m.engine : 'llamacpp';
                return need && need !== draft.default_engine
                  ? <div className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-[12px] text-amber">{t('admin.ai.engineMismatch', { need: ENGINE_LABEL[need] ?? need, current: ENGINE_LABEL[draft.default_engine] ?? draft.default_engine })}</div>
                  : null;
              })()}
              <Toggle checked={!!draft.autoload} onChange={(v) => set({ autoload: v })}
                label={<span>{t('admin.ai.autoload')}</span>} />
              {models.error ? <ErrorBox error={models.error} /> : null}
              <div>
                <div className="label mb-1.5">{t('admin.ai.loadConfig')}</div>
                <ParamForm fields={loadFields} values={draft.default_load_config ?? {}} engine={draft.default_engine}
                  collapsedGroups={['CPU', 'Batching', 'RoPE', 'Memory', 'Speculative Decoding', 'MoE', 'Parallelism', 'vLLM', 'Advanced']}
                  onChange={(k, v) => {
                    const n = { ...(draft.default_load_config ?? {}) };
                    if (v === undefined) delete n[k]; else n[k] = v;
                    set({ default_load_config: n });
                  }} />
              </div>
            </div>
          </Card>
          <WorkersCard draft={draft} set={set} />
        </div>
        <Card title={t('admin.ai.sampling')} icon={<SlidersHorizontal size={14} className="text-cyan" />}>
          <ParamForm fields={predFields} values={draft.prediction ?? {}} engine={draft.default_engine}
            onChange={(k, v) => {
              const n = { ...(draft.prediction ?? {}) };
              if (v === undefined) { const f = predFields.find((x) => x.key === k); n[k] = f?.default; } else n[k] = v;
              set({ prediction: n });
            }} />
        </Card>
      </div>
    </div>
  );
}

/** Which model serves each worker of the queue, the Performance Engine default and the hot KV cache. */
function WorkersCard({ draft, set }: { draft: AiSettingsT; set: (p: Partial<AiSettingsT>) => void }) {
  const t = useT();
  const models = useModels();
  const profiles = useProfiles(null);
  const wm = draft.worker_models ?? {};
  const setWorker = (w: string, modelId: string) => {
    const n = { ...wm };
    if (modelId) n[w] = { ...(n[w] ?? {}), model_id: modelId }; else delete n[w];
    set({ worker_models: n });
  };
  const modelWorkers = WORKERS.filter((w) => !['policy', 'analytics', 'workflow'].includes(w));
  return (
    <Card title={t('wq.aiTitle')} icon={<Layers size={14} className="text-cyan" />}>
      <div className="space-y-3">
        <div className="text-[12px] text-muted">{t('wq.aiIntro')}</div>
        <div className="grid gap-2 md:grid-cols-2">
          {modelWorkers.map((w) => (
            <Field key={w} label={t(WORKER_KEY[w])}>
              <select className="input" value={wm[w]?.model_id ?? ''} onChange={(e) => setWorker(w, e.target.value)}>
                <option value="">{t('wq.loadedModel')}</option>
                {wm[w]?.model_id && !(models.data ?? []).some((m) => m.id === wm[w]?.model_id) && <option value={wm[w]!.model_id}>{wm[w]!.model_id}</option>}
                {(models.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}{m.quant ? ` · ${m.quant}` : ''}</option>)}
              </select>
            </Field>
          ))}
        </div>
        <Field label={t('perf.defaultProfile')} hint={t('perf.defaultProfileHint')}>
          <select className="input" value={draft.performance_profile ?? 'auto'} onChange={(e) => set({ performance_profile: e.target.value })}>
            <option value="auto">{t('perf.auto')}</option>
            <option value="off">{t('perf.off')}</option>
            {(profiles.data?.profiles ?? []).map((p) => <option key={p.id} value={p.id}>{p.label} · {t(`perf.status.${p.status}`, p.status)}</option>)}
          </select>
        </Field>
        <div className="label">{t('perf.kv.title')}</div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('perf.kv.ttl')} hint={t('perf.kv.ttlHint')}>
            <input type="number" min={60} max={86400} className="input font-mono" value={draft.kv_ttl_s ?? 1800}
              onChange={(e) => set({ kv_ttl_s: Number(e.target.value) || 0 })} />
          </Field>
          <Field label={t('perf.kv.spillMax')} hint={t('perf.kv.spillMaxHint')}>
            <input type="number" min={256} className="input font-mono" value={draft.kv_spill_max_mb ?? 4096} disabled={!draft.kv_spill}
              onChange={(e) => set({ kv_spill_max_mb: Number(e.target.value) || 0 })} />
          </Field>
        </div>
        <Toggle checked={!!draft.kv_spill} onChange={(v) => set({ kv_spill: v })} label={t('perf.kv.spill')} />
      </div>
    </Card>
  );
}
