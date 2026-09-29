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

export default function AiSettings() {
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
      toast.success('Organisation AI settings saved', 'System prompt and sampling apply to new answers now. The default model is loaded at the next server start (use the model loader to switch now).');
      const next = r && typeof r === 'object' && 'prediction' in r ? r : draft;
      qc.setQueryData(['admin', 'ai-settings'], next);
      setDraft(next ? structuredClone(next) : null);
    },
    onError: (e) => toast.error('Could not save AI settings', (e as Error).message),
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
        <span className="flex-1">These are the <b>organisation-wide defaults</b> used for every employee chat. Employees cannot change sampling, model or system prompt.</span>
        <button className="btn btn-sm btn-ghost" disabled={!dirty || save.isPending} onClick={() => setDraft(q.data ? structuredClone(q.data) : null)}><Undo2 size={12} />Discard changes</button>
        <button className="btn btn-sm" disabled={save.isPending}
          onClick={() => { set({ prediction: withDefaults(predFields, {}), default_load_config: {} }); toast('Parameters reset to schema defaults', { body: 'Click Save to apply.' }); }}>
          <RotateCcw size={12} />Reset to defaults
        </button>
        <button className="btn btn-sm btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
          {save.isPending ? <Spinner size={12} className="!text-[#1a1204]" /> : <Save size={12} />}Save
        </button>
      </div>
      {schema.error ? <ErrorBox error={schema.error} onRetry={() => schema.refetch()} /> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card title="System prompt" icon={<Sparkles size={14} className="text-amber" />}>
            <textarea className="input min-h-[220px] font-mono text-[12px] leading-relaxed" value={draft.system_prompt ?? ''}
              onChange={(e) => set({ system_prompt: e.target.value })} />
            <div className="mt-1 text-[11px] text-faint">{(draft.system_prompt ?? '').length} chars · applies to all employee chats</div>
          </Card>
          <Card title="Default model" icon={<Cpu size={14} className="text-cyan" />}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Model">
                  <select className="input" value={draft.default_model_id ?? ''} onChange={(e) => {
                    const m = (models.data ?? []).find((x) => x.id === e.target.value);
                    // the engine follows the model: model files run on built-in llama.cpp, Ollama names on Ollama, server models on their server
                    const eng = !m ? draft.default_engine : m.source === 'ollama' ? 'ollama' : m.source === 'engine' ? (m.engine ?? draft.default_engine) : 'llamacpp';
                    set({ default_model_id: e.target.value || null, default_engine: eng });
                  }}>
                    <option value="">{models.isLoading ? 'Loading…' : '— None —'}</option>
                    {draft.default_model_id && !(models.data ?? []).some((m) => m.id === draft.default_model_id) && <option value={draft.default_model_id}>{draft.default_model_id} (not found)</option>}
                    {(models.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}{m.quant ? ` · ${m.quant}` : ''}</option>)}
                  </select>
                </Field>
                <Field label="Engine">
                  <select className="input" value={draft.default_engine ?? ''} onChange={(e) => set({ default_engine: e.target.value })}>
                    {!(engines.data ?? []).some((x) => x.id === draft.default_engine) && <option value={draft.default_engine}>{draft.default_engine || '—'}</option>}
                    {(engines.data ?? []).map((x) => <option key={x.id} value={x.id}>{ENGINE_LABEL[x.id] ?? x.name}{x.available ? '' : ' (unavailable)'}</option>)}
                  </select>
                </Field>
              </div>
              {(() => {
                const m = (models.data ?? []).find((x) => x.id === draft.default_model_id);
                const need = !m ? null : m.source === 'ollama' ? 'ollama' : m.source === 'engine' ? m.engine : 'llamacpp';
                return need && need !== draft.default_engine
                  ? <div className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-[12px] text-amber">This model is served by {ENGINE_LABEL[need] ?? need}, not {ENGINE_LABEL[draft.default_engine] ?? draft.default_engine}; it would fail to load at start-up.</div>
                  : null;
              })()}
              <Toggle checked={!!draft.autoload} onChange={(v) => set({ autoload: v })}
                label={<span>Load a model automatically when the server starts: the default model above, otherwise the model loaded last, otherwise the bundled model</span>} />
              {models.error ? <ErrorBox error={models.error} /> : null}
              <div>
                <div className="label mb-1.5">Load configuration</div>
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
        </div>
        <Card title="Sampling & output (prediction)" icon={<SlidersHorizontal size={14} className="text-cyan" />}>
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
