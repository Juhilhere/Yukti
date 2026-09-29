import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Cpu, PanelRightClose, Save, Trash2, Upload } from 'lucide-react';
import { api, errMsg } from '../../lib/api';
import { qk, uiStore, useLoaded, usePresets, useSchema } from '../../lib/queries';
import type { Preset } from '../../lib/types';
import { ParamForm, diffFromDefaults } from '../ParamForm';
import { Badge, Dot, ErrorBox, Field, Loading, Tabs, Toggle } from '../ui';
import { Modal } from '../Modal';
import { toast } from '../Toast';

type Tab = 'context' | 'sampling' | 'model';

export function ConfigSidebar({ systemPrompt, setSystemPrompt, prediction, setPrediction, useKnowledge, setUseKnowledge, onClose }: {
  systemPrompt: string; setSystemPrompt: (s: string) => void;
  prediction: Record<string, unknown>; setPrediction: (p: Record<string, unknown>) => void;
  useKnowledge: boolean; setUseKnowledge: (v: boolean) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('context');
  const schema = useSchema();
  const loaded = useLoaded();
  const engine = loaded.data?.engine ?? null;
  const changedCount = Object.keys(prediction).filter((k) => prediction[k] !== undefined).length;

  return (
    <aside className="flex w-[330px] shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="label">Configuration</span>
        <button className="btn btn-ghost btn-icon text-muted" title="Hide sidebar" onClick={onClose}><PanelRightClose size={15} /></button>
      </div>
      <Tabs<Tab> className="px-1.5" value={tab} onChange={setTab} tabs={[
        { id: 'context', label: 'Context' },
        { id: 'sampling', label: 'Sampling & Output', count: changedCount },
        { id: 'model', label: 'Model' },
      ]} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'context' && (
          <ContextTab systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} prediction={prediction}
            setPrediction={setPrediction} useKnowledge={useKnowledge} setUseKnowledge={setUseKnowledge} />
        )}
        {tab === 'sampling' && (
          schema.isLoading ? <Loading /> : schema.error ? <ErrorBox error={schema.error} onRetry={() => schema.refetch()} /> : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11.5px] text-muted">
                <span>Stored per chat · {changedCount} override{changedCount === 1 ? '' : 's'}</span>
                {changedCount > 0 && <button className="text-amber hover:underline" onClick={() => setPrediction({})}>Reset all</button>}
              </div>
              <ParamForm fields={schema.data?.prediction ?? []} values={prediction} engine={engine}
                onChange={(k, v) => {
                  const next = { ...prediction };
                  if (v === undefined) delete next[k]; else next[k] = v;
                  setPrediction(next);
                }} />
            </div>
          )
        )}
        {tab === 'model' && <ModelTab />}
      </div>
    </aside>
  );
}

function ContextTab({ systemPrompt, setSystemPrompt, prediction, setPrediction, useKnowledge, setUseKnowledge }: {
  systemPrompt: string; setSystemPrompt: (s: string) => void; prediction: Record<string, unknown>;
  setPrediction: (p: Record<string, unknown>) => void; useKnowledge: boolean; setUseKnowledge: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const presets = usePresets();
  const schema = useSchema();
  const [presetId, setPresetId] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const current = presets.data?.find((p) => p.id === presetId) ?? null;
  const compactPred = () => diffFromDefaults(schema.data?.prediction ?? [], prediction);

  const create = useMutation({
    mutationFn: () => api.post<Preset>('/api/presets', { name: name.trim(), description: desc.trim(), system_prompt: systemPrompt, prediction: compactPred(), load: {} }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: qk.presets }); setPresetId(p?.id ?? ''); setSaveOpen(false); toast.success('Preset saved'); },
    onError: (e) => toast.error('Could not save preset', errMsg(e)),
  });
  const update = useMutation({
    mutationFn: () => api.put<Preset>(`/api/presets/${presetId}`, { ...current, system_prompt: systemPrompt, prediction: compactPred() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.presets }); toast.success('Preset updated'); },
    onError: (e) => toast.error('Could not update preset', errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/presets/${presetId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.presets }); setPresetId(''); toast.success('Preset deleted'); },
    onError: (e) => toast.error('Could not delete preset', errMsg(e)),
  });

  const apply = (id: string) => {
    setPresetId(id);
    const p = presets.data?.find((x) => x.id === id);
    if (!p) return;
    setSystemPrompt(p.system_prompt ?? '');
    setPrediction({ ...(p.prediction ?? {}) });
    toast(`Preset “${p.name}” applied`);
  };

  return (
    <div className="space-y-4">
      <Field label="Preset">
        <div className="space-y-1.5">
          <select className="input" value={presetId} onChange={(e) => apply(e.target.value)}>
            <option value="">{presets.isLoading ? 'Loading…' : '— No preset —'}</option>
            {(presets.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.builtin ? ' (built-in)' : ''}</option>)}
          </select>
          {current?.description && <div className="text-[11px] text-faint">{current.description}</div>}
          {presets.error ? <ErrorBox error={presets.error} /> : null}
          <div className="flex gap-1.5">
            <button className="btn btn-sm" onClick={() => { setName(''); setDesc(''); setSaveOpen(true); }}><Save size={12} />Save as preset</button>
            <button className="btn btn-sm" disabled={!current || current.builtin || update.isPending} onClick={() => update.mutate()} title={current?.builtin ? 'Built-in presets are read-only' : ''}><Upload size={12} />Update</button>
            <button className="btn btn-sm btn-danger" disabled={!current || current.builtin || remove.isPending} onClick={() => remove.mutate()}><Trash2 size={12} /></button>
          </div>
        </div>
      </Field>
      <Field label="System prompt" hint={`${systemPrompt.length} chars · applies to this chat`}>
        <textarea className="input min-h-[180px] font-mono text-[12px] leading-relaxed" value={systemPrompt}
          placeholder="You are Yukti, a plant knowledge assistant. Cite sources as [S1]… Never guess safety-critical values."
          onChange={(e) => setSystemPrompt(e.target.value)} />
      </Field>
      <div className="rounded-md border border-border bg-surface-2 p-2.5">
        <Toggle checked={useKnowledge} onChange={setUseKnowledge} label={<span className="font-medium">Use Knowledge (RAG)</span>} />
        <div className="mt-1 text-[11.5px] text-muted">Retrieve from plant documents you are cleared to read, with citations, fact extraction and conflict detection.</div>
      </div>

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save as preset" width={420}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setSaveOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Save</button>
        </>}>
        <div className="space-y-3">
          <Field label="Name"><input autoFocus className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shift engineer — precise" /></Field>
          <Field label="Description"><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          <div className="text-[11.5px] text-muted">Saves the system prompt and {Object.keys(compactPred()).length} sampling override(s).</div>
        </div>
      </Modal>
    </div>
  );
}

function ModelTab() {
  const loaded = useLoaded();
  const d = loaded.data;
  if (loaded.isLoading) return <Loading />;
  const status = d?.status ?? 'idle';
  const cfg = Object.entries(d?.load_config ?? {});
  return (
    <div className="space-y-3">
      {loaded.error ? <ErrorBox error={loaded.error} onRetry={() => loaded.refetch()} /> : null}
      <div className="rounded-md border border-border bg-surface-2 p-3">
        <div className="flex items-center gap-2">
          <Dot tone={status === 'ready' ? 'ok' : status === 'loading' ? 'cyan' : status === 'error' ? 'danger' : 'muted'} pulse={status === 'loading'} />
          <span className="min-w-0 flex-1 truncate font-medium">{d?.model_name || 'No model loaded'}</span>
          {d?.engine && <Badge mono tone="cyan">{d.engine}</Badge>}
        </div>
        <div className="mt-1 font-mono text-[11px] text-muted">
          status: {status}{d?.port ? ` · port ${d.port}` : ''}{typeof d?.ctx_used_pct === 'number' ? ` · ctx ${d.ctx_used_pct.toFixed(0)}%` : ''}
        </div>
        {d?.error && <div className="mt-1 text-[11.5px] text-red-300">{d.error}</div>}
        <button className="btn btn-cyan btn-sm mt-2.5 w-full justify-center" onClick={() => uiStore.openLoader(d?.model_id ?? null)}>
          <Cpu size={12} />{status === 'ready' ? 'Change model / load config' : 'Open Model Loader'}
        </button>
      </div>
      <div>
        <div className="label mb-1.5">Load configuration</div>
        {cfg.length === 0 ? <div className="text-[12px] text-faint">No load configuration.</div> : (
          <div className="overflow-hidden rounded-md border border-border">
            {cfg.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1 text-[12px] last:border-0">
                <span className="truncate font-mono text-[11px] text-muted">{k}</span>
                <span className="truncate font-mono text-[11.5px]">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
