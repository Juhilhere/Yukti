import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, ChevronDown, ChevronRight, Cpu, Eye, HardDrive, Plug, Power, Search, Zap } from 'lucide-react';
import { Modal } from '../components/Modal';
import { ParamForm, diffFromDefaults } from '../components/ParamForm';
import { Badge, Dot, ErrorBox, Spinner, Toggle } from '../components/ui';
import { toast } from '../components/Toast';
import { api, errMsg } from '../lib/api';
import { cx, fmtBytes } from '../lib/format';
import { qk, uiStore, useEngines, useLoaded, useModels, useSchema, useSystem, useUI } from '../lib/queries';
import { tr, useT } from '../lib/i18n';
import type { Engine, LoadedModel, Model } from '../lib/types';
import { useAuth } from '../lib/auth';

// getters so the labels follow the chosen language
export const ENGINE_LABEL: Record<string, string> = {
  get llamacpp() { return tr('loader.engine.llamacpp'); }, ollama: 'Ollama', bionic: 'Bionic / LM Studio', vllm: 'vLLM',
  get remote() { return tr('loader.engine.remote'); },
};
const SOURCE_LABEL: Record<string, string> = {
  get yukti() { return tr('loader.source.yukti'); },
  get lmstudio() { return tr('loader.source.lmstudio'); },
  get ollama() { return tr('loader.source.ollama'); },
  get 'ollama-library'() { return tr('loader.source.ollamaLib'); },
  get engine() { return tr('loader.source.engine'); },
};
const URL_HINT: Record<string, string> = {
  ollama: 'http://127.0.0.1:11434', bionic: 'http://127.0.0.1:1234/v1', vllm: 'http://gpu-server:8000/v1', remote: 'http://127.0.0.1:8080/v1',
};

export function ModelLoader() {
  const { loaderOpen, loaderModelId } = useUI();
  const models = useModels();
  const engines = useEngines();
  const schema = useSchema();
  const loaded = useLoaded(loaderOpen);
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can('models.manage');

  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [engine, setEngine] = useState<string>('llamacpp');
  const [cfg, setCfg] = useState<Record<string, unknown>>({});
  const [showCfg, setShowCfg] = useState(false);
  const [showAdv, setShowAdv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  // simple view (default) for everyone; the full engine/parameter view is for IT staff
  const [advanced, setAdvancedRaw] = useState(() => { try { return localStorage.getItem('yukti.loader.advanced') === '1'; } catch { return false; } });
  const setAdvanced = (v: boolean) => { setAdvancedRaw(v); try { localStorage.setItem('yukti.loader.advanced', v ? '1' : '0'); } catch { /* ignore */ } };
  const t = useT();

  useEffect(() => {
    if (!loaderOpen) return;
    setErr(null);
    setQ('');
    const cur = loaded.data;
    setSelected(loaderModelId ?? cur?.model_id ?? null);
    if (loaderModelId) setShowCfg(true);
    if (cur?.engine && cur.status !== 'idle') setEngine(cur.engine);
    else {
      const firstAvail = engines.data?.find((e) => e.available);
      if (firstAvail) setEngine(firstAvail.id);
    }
    if (cur?.load_config && cur.status !== 'idle') setCfg({ ...cur.load_config });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderOpen, loaderModelId]);

  // pick engine automatically when a model from an engine is selected
  const selectedModel = models.data?.find((m) => m.id === selected) ?? null;
  useEffect(() => {
    if (!selectedModel) return;
    if (selectedModel.source === 'ollama') { setEngine('ollama'); return; }
    if (['yukti', 'lmstudio', 'ollama-library'].includes(selectedModel.source)) { setEngine('llamacpp'); return; }
    if (selectedModel.source === 'engine') {
      const guess = selectedModel.engine ?? engines.data?.find((e) => e.available && e.id !== 'llamacpp')?.id;
      if (guess) setEngine(guess);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const grouped = useMemo(() => {
    const list = (models.data ?? []).filter((m) => {
      if (!q) return true;
      const s = `${m.name} ${m.family} ${m.quant} ${m.file_name} ${m.arch ?? ''}`.toLowerCase();
      return q.toLowerCase().split(/\s+/).every((t) => s.includes(t));
    });
    const g = new Map<string, Model[]>();
    for (const m of list) { const k = m.source || 'other'; if (!g.has(k)) g.set(k, []); g.get(k)!.push(m); }
    return [...g.entries()];
  }, [models.data, q]);

  const st = loaded.data;
  const isLoading = st?.status === 'loading' || busy;
  const loadFields = (schema.data?.load ?? []).filter((f) => !f.engines?.length || f.engines.includes(engine));
  const engineInfo = engines.data?.find((e) => e.id === engine);
  // a model file can only be served by the engine that owns it: files -> built-in llama.cpp, Ollama names -> Ollama, etc.
  const mismatch = selectedModel && (
    (['yukti', 'lmstudio', 'ollama-library'].includes(selectedModel.source) && engine !== 'llamacpp') ||
    (selectedModel.source === 'ollama' && engine !== 'ollama') ||
    (selectedModel.source === 'engine' && !!selectedModel.engine && engine !== selectedModel.engine));

  const doLoad = async (over?: { engine: string; model: string; cfg: Record<string, unknown> }) => {
    if (!over && !selected) return;
    setBusy(true); setErr(null);
    try {
      const payload = over
        ? { engine: over.engine, model_id: over.model, load_config: over.cfg }
        : { engine, model_id: selected, load_config: diffFromDefaults(schema.data?.load ?? [], cfg) };
      const r = await api.post<LoadedModel>('/api/models/load', payload);
      qc.setQueryData(qk.loaded, r);
      // poll until ready / error
      const t0 = Date.now();
      for (;;) {
        await new Promise((res) => setTimeout(res, 1000));
        const s = await api.get<LoadedModel>('/api/models/loaded');
        qc.setQueryData(qk.loaded, s);
        if (s.status === 'ready') { toast.success(t('loader.loaded', 'The AI model is ready'), `${s.model_name ?? selected ?? ''}`); uiStore.closeLoader(); break; }
        if (s.status === 'error') { setErr(new Error(s.error || t('loader.err.failed'))); break; }
        if (s.status === 'idle' && Date.now() - t0 > 5000) { setErr(new Error(t('loader.err.cancelled'))); break; }
        if (Date.now() - t0 > 10 * 60_000) { setErr(new Error(t('loader.err.timeout'))); break; }
      }
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: qk.loaded });
    }
  };

  const doUnload = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post('/api/models/unload', {});
      toast(t('loader.unloaded'));
      await qc.invalidateQueries({ queryKey: qk.loaded });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <Modal open={loaderOpen} onClose={() => uiStore.closeLoader()} width={860}
      title={<span className="flex items-center gap-2"><Box size={15} className="text-cyan" /> {t('shell.model.select')} <span className="ml-1 font-normal text-faint"><kbd className="font-mono text-[10.5px]">Ctrl+L</kbd></span></span>}
      footer={<>
        {st && st.status !== 'idle' && (
          <div className="mr-auto flex min-w-0 items-center gap-2 text-[12px] text-muted">
            <Dot tone={st.status === 'ready' ? 'ok' : st.status === 'loading' ? 'cyan' : 'danger'} pulse={st.status === 'loading'} />
            <span className="truncate">{st.status === 'loading' ? t('loader.st.loading') : st.status === 'ready' ? t('loader.st.loaded') : t('loader.st.error')}: <span className="text-text">{st.model_name ?? st.model_id}</span></span>
            {st.engine && <Badge tone="cyan" mono>{ENGINE_LABEL[st.engine] ?? st.engine}</Badge>}
          </div>
        )}
        <button className="btn btn-ghost" onClick={() => setAdvanced(!advanced)}>{advanced ? t('loader.simpleView', 'Simple view') : t('loader.advancedView', 'Advanced settings (IT staff)')}</button>
        <button className="btn" onClick={() => uiStore.closeLoader()}>{t('btn.close', 'Close')}</button>
        {st && st.status !== 'idle' && (
          <button className="btn btn-danger" disabled={busy || !canManage} onClick={doUnload}><Power size={13} /> {t('loader.unload')}</button>
        )}
        {advanced && <button className="btn btn-primary" disabled={!selected || isLoading || !canManage || !!mismatch} onClick={() => void doLoad()}
          title={!canManage ? t('loader.noPermission') : undefined}>
          {isLoading ? <Spinner className="!text-[#1a1204]" /> : <Zap size={13} />} {isLoading ? t('common.loading') : t('loader.load')}
        </button>}
      </>}>
      <div className="space-y-3">
        {!canManage && <div className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-[12px] text-amber">{t('loader.viewOnly')}</div>}
        {!advanced && <SimplePicker models={models.data ?? []} engines={engines.data ?? []} loaded={st ?? null} busy={isLoading} canManage={canManage}
          onUse={(m, eng, c) => { setSelected(m); setEngine(eng); void doLoad({ engine: eng, model: m, cfg: c }); }}
          onAdvanced={() => setAdvanced(true)} />}
        {advanced && <>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !py-2 !pl-8" autoFocus placeholder={t('loader.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="max-h-[300px] overflow-y-auto rounded-md border border-border">
          {models.isLoading && <div className="flex items-center gap-2 p-4 text-muted"><Spinner /> {t('loader.scanning')}</div>}
          {models.error && <div className="p-3"><ErrorBox error={models.error} onRetry={() => models.refetch()} /></div>}
          {!models.isLoading && !models.error && grouped.length === 0 && <div className="p-6 text-center text-muted">{q ? t('loader.noModelsFor', { q }) : t('loader.noModels')}</div>}
          {grouped.map(([src, list]) => (
            <div key={src}>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-1">
                <span className="label">{SOURCE_LABEL[src] ?? src}</span><span className="font-mono text-[10.5px] text-faint">{list.length}</span>
              </div>
              {list.map((m) => {
                const active = st?.model_id === m.id && st.status === 'ready';
                return (
                  <button key={m.id} onClick={() => setSelected(m.id)} onDoubleClick={() => { setSelected(m.id); setShowCfg(true); }}
                    className={cx('flex w-full items-center gap-3 border-b border-border/50 px-3 py-2 text-left transition-colors',
                      selected === m.id ? 'bg-cyan/10' : 'hover:bg-surface-2')}>
                    <div className={cx('h-7 w-1 rounded-full', selected === m.id ? 'bg-cyan' : 'bg-transparent')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{m.name}</span>
                        {active && <Badge tone="ok">{t('loader.badge.loaded')}</Badge>}
                        {m.vision && <Badge tone="violet"><Eye size={10} /> {t('loader.badge.vision')}</Badge>}
                      </div>
                      <div className="truncate font-mono text-[11px] text-faint">{m.file_name || m.path}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {m.family && <Badge mono>{m.family}</Badge>}
                      {m.params_b !== undefined && m.params_b !== null && <Badge mono>{m.params_b}B</Badge>}
                      {m.quant && <Badge tone="cyan" mono>{m.quant}</Badge>}
                      <span className="w-[64px] text-right font-mono text-[11.5px] text-muted">{m.size_bytes ? fmtBytes(m.size_bytes) : '—'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-2"><span className="label">{t('loader.engine')}</span></div>
          {engines.error && <ErrorBox error={engines.error} />}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {(engines.data ?? []).map((e) => (
              <button key={e.id} onClick={() => setEngine(e.id)} title={e.description}
                className={cx('rounded-md border p-2 text-left transition-colors',
                  engine === e.id ? 'border-cyan bg-cyan/10' : 'border-border bg-surface-2 hover:border-border-strong')}>
                <div className="flex items-center gap-1.5">
                  <Dot tone={e.available ? 'ok' : 'muted'} />
                  <span className="font-medium">{ENGINE_LABEL[e.id] ?? e.name}</span>
                  {e.version && <span className="ml-auto font-mono text-[10px] text-faint">{e.version}</span>}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{e.base_url || (e.id === 'llamacpp' ? t('loader.managedServer') : '—')}</div>
                <div className={cx('mt-0.5 text-[10.5px]', e.available ? 'text-green-300' : 'text-faint')}>{e.available ? (e.models?.length ? t('loader.availableN', { n: e.models.length }) : t('loader.available')) : t('loader.notConnected')}</div>
              </button>
            ))}
            {engines.isLoading && <div className="flex items-center gap-2 text-muted"><Spinner /> {t('loader.enginesLoading')}</div>}
          </div>
        </div>

        {engine !== 'llamacpp' && engineInfo && <ConnectionPanel e={engineInfo} canManage={canManage} />}
        {mismatch && (
          <div className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-[12px] text-amber">
            {t('loader.mismatch', { model: selectedModel?.name, owner: ENGINE_LABEL[selectedModel?.source === 'ollama' ? 'ollama' : selectedModel?.engine ?? 'llamacpp'], engine: ENGINE_LABEL[engine] ?? engine })}
          </div>
        )}

        <div className="rounded-md border border-border">
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setShowCfg((s) => !s)}>
            {showCfg ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Cpu size={14} className="text-cyan" />
            <span className="font-medium">{t('loader.cfg')}</span>
            <span className="text-[11.5px] text-muted">{selectedModel ? selectedModel.name : t('loader.noSelection')} · {ENGINE_LABEL[engine] ?? engine}</span>
            <span className="ml-auto font-mono text-[10.5px] text-faint">{t('loader.changedN', { n: Object.keys(diffFromDefaults(schema.data?.load ?? [], cfg)).length })}</span>
          </button>
          {showCfg && (
            <div className="border-t border-border p-3">
              {loadFields.length > 0 && (
                <div className="mb-2 flex items-center justify-between">
                  <Toggle size="sm" checked={showAdv} onChange={setShowAdv} label={<span className="text-[12px] text-muted">{t('loader.showAdvanced')}</span>} />
                  <button className="btn btn-ghost btn-sm" onClick={() => setCfg({})}>{t('loader.resetAll')}</button>
                </div>
              )}
              {schema.isLoading && <div className="flex items-center gap-2 text-muted"><Spinner /> {t('loader.loadingSettings')}</div>}
              {schema.error && <ErrorBox error={schema.error} onRetry={() => schema.refetch()} />}
              {schema.data && loadFields.length === 0 && (
                <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[12px] text-muted">
                  {t('loader.noLoadSettings', { engine: ENGINE_LABEL[engine] ?? engine })}
                </div>
              )}
              {schema.data && engine === 'vllm' && loadFields.length > 0 && (
                <div className="mb-2 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[12px] text-muted">
                  {t('loader.vllmNote')}
                </div>
              )}
              {schema.data && loadFields.length > 0 && (
                <div className="grid gap-2 md:grid-cols-2 [&>div]:contents">
                  <ParamForm fields={loadFields} values={cfg} engine={engine} showAdvanced={showAdv}
                    collapsedGroups={['CPU', 'Batching', 'RoPE', 'Memory', 'Speculative Decoding', 'MoE', 'Parallelism', 'vLLM', 'Advanced']}
                    onChange={(k, v) => setCfg((c) => { const n = { ...c }; if (v === undefined) delete n[k]; else n[k] = v; return n; })} />
                </div>
              )}
              {schema.data && selected && (engine === 'llamacpp' || engine === 'vllm') && <CommandPreview modelId={selected} cfg={diffFromDefaults(schema.data.load, cfg)} />}
            </div>
          )}
        </div>

        </>}
        {isLoading && (
          <div className="flex items-center gap-2 rounded-md border border-cyan/40 bg-cyan/10 px-3 py-2 text-cyan">
            <Spinner /> {t('loader.loading', 'Getting {name} ready… this usually takes under a minute.', { name: st?.model_name ?? selectedModel?.name ?? '' })}
            <HardDrive size={13} className="ml-auto animate-pulse" />
          </div>
        )}
        {err ? <ErrorBox error={err} /> : null}
        {st?.status === 'error' && !err && <ErrorBox error={new Error(st.error || t('loader.err.failed'))} />}
        {err && errMsg(err).includes('insufficient') ? <div className="text-[12px] text-muted">{t('loader.memTip')}</div> : null}
      </div>
    </Modal>
  );
}

type Fit = 'fast' | 'slow' | 'toobig' | 'server';

/** Plain-language model chooser: what fits this PC, one button, settings chosen automatically. */
function SimplePicker({ models, engines, loaded, busy, canManage, onUse, onAdvanced }: {
  models: Model[]; engines: Engine[]; loaded: LoadedModel | null; busy: boolean; canManage: boolean;
  onUse: (modelId: string, engine: string, cfg: Record<string, unknown>) => void; onAdvanced: () => void;
}) {
  const t = useT();
  const sys = useSystem();
  const vram = sys.data?.gpu?.vram_total_mb ?? 0;
  const ram = sys.data?.ram?.total_mb ?? 0;
  const fit = (m: Model): Fit => {
    if (m.source === 'engine') return 'server';
    const need = (m.size_bytes / 2 ** 20) * 1.15 + 700;  // weights + working memory for an 8K context
    if (vram && need <= vram) return 'fast';
    if (!ram || need <= ram * 0.6) return 'slow';
    return 'toobig';
  };
  // one card per model: prefer the running Ollama over its on-disk copy, the Yukti folder over an identical LM Studio file
  const cards = useMemo(() => {
    const running = new Set(models.filter((m) => m.source === 'ollama').map((m) => m.id));
    const yuktiFiles = new Set(models.filter((m) => m.source === 'yukti').map((m) => m.file_name));
    return models.filter((m) => !(m.source === 'ollama-library' && running.has(m.file_name)) && !(m.source === 'lmstudio' && yuktiFiles.has(m.file_name)));
  }, [models]);
  const order: Record<Fit, number> = { fast: 0, server: 1, slow: 2, toobig: 3 };
  const sorted = [...cards].sort((a, b) => order[fit(a)] - order[fit(b)] || b.size_bytes - a.size_bytes);
  const recommended = sorted.find((m) => fit(m) === 'fast' && m.source !== 'ollama-library')?.id;
  const where = (m: Model) => m.source === 'yukti' ? t('loader.src.yukti', 'Included with Yukti') : m.source === 'ollama' ? t('loader.src.ollama', 'From Ollama on this PC')
    : m.source === 'ollama-library' ? t('loader.src.ollamaLib', 'Ollama download (Ollama not running)') : m.source === 'lmstudio' ? t('loader.src.lmstudio', 'From LM Studio')
      : t('loader.src.server', 'From a connected model server');
  const engineFor = (m: Model) => m.source === 'ollama' ? 'ollama' : m.source === 'engine' ? (m.engine ?? 'remote') : 'llamacpp';
  const autoCfg = (m: Model): Record<string, unknown> => {
    const eng = engineFor(m);
    if (eng === 'llamacpp') return { ctx_size: vram >= 8000 ? 16384 : 8192, parallel: vram >= 8000 ? 2 : 1 };
    if (eng === 'ollama') return { ctx_size: 8192 };
    return {};
  };
  const badge: Record<Fit, { tone: 'ok' | 'amber' | 'danger' | 'cyan'; text: string }> = {
    fast: { tone: 'ok', text: t('loader.fit.fast', 'Fast on this PC') },
    slow: { tone: 'amber', text: t('loader.fit.slow', 'Works, but slower') },
    toobig: { tone: 'danger', text: t('loader.fit.toobig', 'Too big for this PC') },
    server: { tone: 'cyan', text: t('loader.fit.server', 'Runs on the server') },
  };
  const ollama = engines.find((e) => e.id === 'ollama');
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[12.5px] text-muted">
        {t('loader.simple.intro', 'Choose the AI that answers questions in Yukti. Bigger models give better answers but need a stronger computer.')}
        {sys.data?.ram && (
          <div className="mt-1 text-[12px]">{t('loader.thisPc', 'This PC:')} <span className="text-text">{sys.data.gpu ? t('loader.gpuInfo', { gpu: sys.data.gpu.name, gb: (vram / 1024).toFixed(0) }) : t('loader.noGpu', 'no graphics card (runs on the processor)')}</span> · <span className="text-text">{(ram / 1024).toFixed(0)} GB RAM</span></div>
        )}
      </div>
      <div className="grid max-h-[380px] gap-2 overflow-y-auto pr-1 md:grid-cols-2">
        {sorted.map((m) => {
          const f = fit(m);
          const active = loaded?.model_id === m.id && loaded.status === 'ready';
          return (
            <div key={m.id} className={cx('flex flex-col rounded-md border p-3', active ? 'border-green-400/50 bg-green-400/5' : 'border-border bg-surface-2/30')}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold" title={m.name}>{prettyName(m)}</div>
                  <div className="text-[11.5px] text-muted">{where(m)}{m.size_bytes ? ` · ${fmtBytes(m.size_bytes)}` : ''}</div>
                </div>
                {m.id === recommended && !active && <Badge tone="amber">{t('loader.recommended', 'Recommended')}</Badge>}
                {active && <Badge tone="ok">{t('loader.inUse', 'In use')}</Badge>}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Badge tone={badge[f].tone}>{badge[f].text}</Badge>
                <button className="btn btn-sm btn-primary ml-auto" disabled={busy || !canManage || active || f === 'toobig'}
                  title={f === 'toobig' ? t('loader.tooBigHint', 'This model needs more memory than this PC has.') : undefined}
                  onClick={() => onUse(m.id, engineFor(m), autoCfg(m))}>
                  <Zap size={12} />{active ? t('loader.inUse', 'In use') : t('loader.use', 'Use this model')}
                </button>
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && <div className="col-span-full p-6 text-center text-muted">{t('loader.none', 'No AI models found on this PC. Ask your IT team to add one, or open Advanced settings to connect a model server.')}</div>}
      </div>
      <div className="text-[11.5px] text-faint">
        {ollama?.available
          ? t('loader.ollamaOn', 'Ollama is running on this PC: its models are listed above.')
          : t('loader.ollamaOff', 'Have models in Ollama or another model server? Start it, or connect it under')}{' '}
        {!ollama?.available && <button className="text-cyan hover:underline" onClick={onAdvanced}>{t('loader.advancedView', 'Advanced settings (IT staff)')}</button>}
      </div>
    </div>
  );
}

/** "gemma-2-2b-it-Q8_0" -> "Gemma 2 2B it · Q8_0"; "gemma3:4b" -> "Gemma3 4B". */
function prettyName(m: Model): string {
  const base = (m.source === 'ollama-library' ? m.file_name : m.name).replace(/\.gguf$/i, '')
    // the quantisation suffix (Q8_0, Q4_K_M, IQ3_XS, F16 …) is technical detail, not part of a friendly name
    .replace(/[-_.](?:I?Q\d(?:_[A-Z0-9]+)*|F16|BF16|F32)$/i, '');
  const [name, tag] = base.split(':');
  const words = name.replace(/[-_]+/g, ' ').replace(/\b(\d+(?:\.\d+)?)b\b/gi, (_x, n: string) => `${n}B`).trim();
  const nice = words.charAt(0).toUpperCase() + words.slice(1);
  return tag ? `${nice} ${tag.replace(/(\d+(?:\.\d+)?)b$/i, '$1B')}` : nice;
}

/** Server address (and API key) of an external engine, with a live connection test. */
function ConnectionPanel({ e, canManage }: { e: Engine; canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [url, setUrl] = useState(e.base_url ?? '');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Engine | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { setUrl(e.base_url ?? ''); setResult(null); setError(null); setKey(''); }, [e.id, e.base_url]);
  const shown = result ?? e;
  const test = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.put<Engine>(`/api/engines/${e.id}`, key ? { base_url: url.trim(), api_key: key } : { base_url: url.trim() });
      setResult(r); setKey('');
      await Promise.all([qc.invalidateQueries({ queryKey: qk.engines }), qc.invalidateQueries({ queryKey: qk.models })]);
      if (r.available) toast.success(t('loader.conn.connectedTo', { engine: ENGINE_LABEL[e.id] ?? e.name }), t('loader.conn.modelsAvailable', { n: r.models?.length ?? 0 }));
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Plug size={14} className="text-cyan" /><span className="font-medium">{t('loader.conn.title')}</span>
        <span className="text-[11.5px] text-muted">{t('loader.conn.where', { engine: ENGINE_LABEL[e.id] ?? e.name })}</span>
        <span className={cx('ml-auto text-[11.5px]', shown.available ? 'text-green-300' : 'text-faint')}>{shown.available ? `${t('loader.conn.connected')}${shown.version ? ` · v${shown.version}` : ''}` : t('loader.notConnected')}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input flex-1 font-mono text-[12px] !py-1.5" style={{ minWidth: 240 }} value={url} disabled={!canManage}
          onChange={(ev) => setUrl(ev.target.value)} placeholder={URL_HINT[e.id] ?? 'http://host:port/v1'}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && url.trim()) void test(); }} />
        {e.id !== 'ollama' && (
          <input className="input !w-44 font-mono text-[12px] !py-1.5" type="password" disabled={!canManage} placeholder={t('loader.conn.apiKey')}
            value={key} onChange={(ev) => setKey(ev.target.value)} />
        )}
        <button className="btn btn-cyan btn-sm" disabled={!canManage || busy || !url.trim()} onClick={() => void test()}>
          {busy ? <Spinner size={12} /> : <Plug size={12} />}{t('loader.conn.test')}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={!canManage || busy} title={t('loader.conn.resetTip')}
          onClick={() => void (async () => {
            setBusy(true); setError(null);
            try {
              const r = await api.del<Engine>(`/api/engines/${e.id}`);
              setResult(r); setUrl(r.base_url ?? '');
              await Promise.all([qc.invalidateQueries({ queryKey: qk.engines }), qc.invalidateQueries({ queryKey: qk.models })]);
            } catch (err) { setError(err); } finally { setBusy(false); }
          })()}>{t('loader.conn.reset')}</button>
      </div>
      {error ? <ErrorBox className="mt-2" error={error} /> : null}
      {!error && shown.error && <div className="mt-2 rounded border border-amber/40 bg-amber/10 px-2 py-1 text-[12px] text-amber">{shown.error}</div>}
      {!error && shown.available && !!shown.models?.length && (
        <div className="mt-2 text-[11.5px] text-muted">{t('loader.conn.models', { list: `${shown.models.slice(0, 12).join(', ')}${shown.models.length > 12 ? ' …' : ''}` })}</div>
      )}
      <div className="mt-1.5 text-[11px] text-faint">
        {e.id === 'ollama' ? t('loader.conn.ollamaHint') : t('loader.conn.openaiHint')}
        {' '}{t('loader.conn.guardNote')}
      </div>
    </div>
  );
}

/** Shows the exact engine command the current configuration produces (llama.cpp here, vLLM for the plant GPU server). */
function CommandPreview({ modelId, cfg }: { modelId: string; cfg: Record<string, unknown> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ llamacpp: string; vllm: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.post<{ llamacpp: string; vllm: string }>('/api/models/command-preview', { model_id: modelId, load_config: cfg })
      .then((r) => { if (alive) { setData(r); setError(null); } }, (e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [open, modelId, JSON.stringify(cfg)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mt-3 rounded-md border border-border">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span className="font-medium">{t('loader.cmd.title')}</span>
        <span className="text-muted">{t('loader.cmd.hint')}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-3">
          {error ? <ErrorBox error={error} /> : !data ? <div className="flex items-center gap-2 text-muted"><Spinner /> {t('loader.cmd.building')}</div> : (
            <>
              <div className="label">{t('loader.cmd.llamacpp')}</div>
              <pre className="max-h-[140px] overflow-auto whitespace-pre-wrap break-all rounded bg-bg p-2 font-mono text-[11px] text-text/90">{data.llamacpp}</pre>
              <div className="label">{t('loader.cmd.vllm')}</div>
              <pre className="max-h-[140px] overflow-auto whitespace-pre-wrap break-all rounded bg-bg p-2 font-mono text-[11px] text-text/90">{data.vllm}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
