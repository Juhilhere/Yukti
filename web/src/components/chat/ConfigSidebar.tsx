import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Cpu, FlaskConical, PanelRightClose, Save, Trash2, Upload } from 'lucide-react';
import { api, errMsg } from '../../lib/api';
import { qk, uiStore, useLoaded, usePresets, useSchema } from '../../lib/queries';
import type { Preset } from '../../lib/types';
import { ParamForm, diffFromDefaults } from '../ParamForm';
import { Badge, Dot, ErrorBox, Field, Loading, Tabs, Toggle } from '../ui';
import { Modal } from '../Modal';
import { toast } from '../Toast';
import { useT } from '../../lib/i18n';

type Tab = 'context' | 'sampling' | 'model';

export function ConfigSidebar({ systemPrompt, setSystemPrompt, prediction, setPrediction, useKnowledge, setUseKnowledge, onClose }: {
  systemPrompt: string; setSystemPrompt: (s: string) => void;
  prediction: Record<string, unknown>; setPrediction: (p: Record<string, unknown>) => void;
  useKnowledge: boolean; setUseKnowledge: (v: boolean) => void; onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('context');
  const schema = useSchema();
  const loaded = useLoaded();
  const engine = loaded.data?.engine ?? null;
  const changedCount = Object.keys(prediction).filter((k) => prediction[k] !== undefined).length;

  return (
    <aside className="flex w-[330px] shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="label">{t('chat.cfg.title')}</span>
        <button className="btn btn-ghost btn-icon text-muted" title={t('chat.cfg.hide')} onClick={onClose}><PanelRightClose size={15} /></button>
      </div>
      <Tabs<Tab> className="px-1.5" value={tab} onChange={setTab} tabs={[
        { id: 'context', label: t('chat.cfg.tab.context') },
        { id: 'sampling', label: t('chat.cfg.tab.sampling'), count: changedCount },
        { id: 'model', label: t('chat.cfg.tab.model') },
      ]} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber/30 bg-amber/5 px-2.5 py-2 text-[11.5px]">
          <FlaskConical size={13} className="mt-0.5 shrink-0 text-amber" />
          <div className="text-muted">
            <span className="font-medium text-amber">{t('chat.cfg.adminTesting')}</span> {t('chat.cfg.appliesPre')} <b className="text-text">{t('chat.cfg.thisChatOnly')}</b>.
            {t('chat.cfg.orgDefaults')} <Link to="/admin/ai" className="text-cyan hover:underline">{t('chat.cfg.adminAi')}</Link>.
          </div>
        </div>
        {tab === 'context' && (
          <ContextTab systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} prediction={prediction}
            setPrediction={setPrediction} useKnowledge={useKnowledge} setUseKnowledge={setUseKnowledge} />
        )}
        {tab === 'sampling' && (
          schema.isLoading ? <Loading /> : schema.error ? <ErrorBox error={schema.error} onRetry={() => schema.refetch()} /> : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11.5px] text-muted">
                <span>{t(changedCount === 1 ? 'chat.cfg.overrideOne' : 'chat.cfg.overrideMany', { n: changedCount })}</span>
                {changedCount > 0 && <button className="text-amber hover:underline" onClick={() => setPrediction({})}>{t('chat.cfg.resetAll')}</button>}
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
  const t = useT();
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
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: qk.presets }); setPresetId(p?.id ?? ''); setSaveOpen(false); toast.success(t('chat.cfg.presetSaved')); },
    onError: (e) => toast.error(t('chat.cfg.presetSaveFailed'), errMsg(e)),
  });
  const update = useMutation({
    mutationFn: () => api.put<Preset>(`/api/presets/${presetId}`, { ...current, system_prompt: systemPrompt, prediction: compactPred() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.presets }); toast.success(t('chat.cfg.presetUpdated')); },
    onError: (e) => toast.error(t('chat.cfg.presetUpdateFailed'), errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/presets/${presetId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.presets }); setPresetId(''); toast.success(t('chat.cfg.presetDeleted')); },
    onError: (e) => toast.error(t('chat.cfg.presetDeleteFailed'), errMsg(e)),
  });

  const apply = (id: string) => {
    setPresetId(id);
    const p = presets.data?.find((x) => x.id === id);
    if (!p) return;
    setSystemPrompt(p.system_prompt ?? '');
    setPrediction({ ...(p.prediction ?? {}) });
    toast(t('chat.cfg.presetApplied', { name: p.name }));
  };

  return (
    <div className="space-y-4">
      <Field label={t('chat.cfg.preset')}>
        <div className="space-y-1.5">
          <select className="input" value={presetId} onChange={(e) => apply(e.target.value)}>
            <option value="">{presets.isLoading ? t('chat.cfg.loading') : t('chat.cfg.noPreset')}</option>
            {(presets.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.builtin ? t('chat.cfg.builtinName', { name: p.name }) : p.name}</option>)}
          </select>
          {current?.description && <div className="text-[11px] text-faint">{current.description}</div>}
          {presets.error ? <ErrorBox error={presets.error} /> : null}
          <div className="flex gap-1.5">
            <button className="btn btn-sm" onClick={() => { setName(''); setDesc(''); setSaveOpen(true); }}><Save size={12} />{t('chat.cfg.saveAsPreset')}</button>
            <button className="btn btn-sm" disabled={!current || current.builtin || update.isPending} onClick={() => update.mutate()} title={current?.builtin ? t('chat.cfg.builtinRO') : ''}><Upload size={12} />{t('chat.cfg.update')}</button>
            <button className="btn btn-sm btn-danger" disabled={!current || current.builtin || remove.isPending} onClick={() => { if (current && window.confirm(t('chat.cfg.deletePresetQ', { name: current.name }))) remove.mutate(); }} title={t('chat.cfg.deletePreset')}><Trash2 size={12} /></button>
          </div>
        </div>
      </Field>
      <Field label={t('chat.cfg.systemPrompt')} hint={t('chat.cfg.systemPromptHint', { n: systemPrompt.length })}>
        <textarea className="input min-h-[180px] font-mono text-[12px] leading-relaxed" value={systemPrompt}
          placeholder={t('chat.cfg.systemPromptPh')}
          onChange={(e) => setSystemPrompt(e.target.value)} />
      </Field>
      <div className="rounded-md border border-border bg-surface-2 p-2.5">
        <Toggle checked={useKnowledge} onChange={setUseKnowledge} label={<span className="font-medium">{t('chat.cfg.useKnowledge')}</span>} />
        <div className="mt-1 text-[11.5px] text-muted">{t('chat.cfg.useKnowledgeHint')}</div>
      </div>

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title={t('chat.cfg.saveAsPreset')} width={420}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setSaveOpen(false)}>{t('btn.cancel')}</button>
          <button className="btn btn-primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>{t('btn.save')}</button>
        </>}>
        <div className="space-y-3">
          <Field label={t('chat.cfg.name')}><input autoFocus className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('chat.cfg.namePh')} /></Field>
          <Field label={t('chat.cfg.description')}><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          <div className="text-[11.5px] text-muted">{t('chat.cfg.saveNote', { n: Object.keys(compactPred()).length })}</div>
        </div>
      </Modal>
    </div>
  );
}

function ModelTab() {
  const t = useT();
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
          <span className="min-w-0 flex-1 truncate font-medium">{d?.model_name || t('chat.cfg.noModel')}</span>
          {d?.engine && <Badge mono tone="cyan">{d.engine}</Badge>}
        </div>
        <div className="mt-1 font-mono text-[11px] text-muted">
          {t('chat.cfg.status', { s: status })}{d?.port ? ` · ${t('chat.cfg.port', { p: d.port })}` : ''}{typeof d?.ctx_used_pct === 'number' ? ` · ${t('chat.cfg.ctx', { p: d.ctx_used_pct.toFixed(0) })}` : ''}
        </div>
        {d?.error && <div className="mt-1 text-[11.5px] text-red-300">{d.error}</div>}
        <button className="btn btn-cyan btn-sm mt-2.5 w-full justify-center" onClick={() => uiStore.openLoader(d?.model_id ?? null)}>
          <Cpu size={12} />{status === 'ready' ? t('chat.cfg.changeModel') : t('chat.cfg.openLoader')}
        </button>
      </div>
      <div>
        <div className="label mb-1.5">{t('chat.cfg.loadConfig')}</div>
        {cfg.length === 0 ? <div className="text-[12px] text-faint">{t('chat.cfg.noLoadConfig')}</div> : (
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
