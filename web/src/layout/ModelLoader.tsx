import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, ChevronDown, ChevronRight, Cpu, Eye, HardDrive, Power, Search, Zap } from 'lucide-react';
import { Modal } from '../components/Modal';
import { ParamForm, diffFromDefaults } from '../components/ParamForm';
import { Badge, Dot, ErrorBox, Spinner, Toggle } from '../components/ui';
import { toast } from '../components/Toast';
import { api, errMsg } from '../lib/api';
import { cx, fmtBytes } from '../lib/format';
import { qk, uiStore, useEngines, useLoaded, useModels, useSchema, useUI } from '../lib/queries';
import type { LoadedModel, Model } from '../lib/types';
import { useAuth } from '../lib/auth';

export const ENGINE_LABEL: Record<string, string> = { llamacpp: 'llama.cpp', bionic: 'Bionic', vllm: 'vLLM', remote: 'Remote' };
const SOURCE_LABEL: Record<string, string> = { yukti: 'Yukti models folder', lmstudio: 'Bionic / LM Studio library', engine: 'Reported by engines' };

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

  useEffect(() => {
    if (!loaderOpen) return;
    setErr(null);
    setQ('');
    const cur = loaded.data;
    setSelected(loaderModelId ?? cur?.model_id ?? null);
    if (loaderModelId) setShowCfg(true);
    if (cur?.engine) setEngine(cur.engine);
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
    if (selectedModel.source === 'lmstudio' && engine === 'llamacpp') return;
    if (selectedModel.source === 'engine') {
      const guess = engines.data?.find((e) => e.available && e.id !== 'llamacpp');
      if (guess) setEngine(guess.id);
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

  const doLoad = async () => {
    if (!selected) return;
    setBusy(true); setErr(null);
    try {
      const payload = { engine, model_id: selected, load_config: diffFromDefaults(schema.data?.load ?? [], cfg) };
      const r = await api.post<LoadedModel>('/api/models/load', payload);
      qc.setQueryData(qk.loaded, r);
      // poll until ready / error
      const t0 = Date.now();
      for (;;) {
        await new Promise((res) => setTimeout(res, 1000));
        const s = await api.get<LoadedModel>('/api/models/loaded');
        qc.setQueryData(qk.loaded, s);
        if (s.status === 'ready') { toast.success('Model loaded', `${s.model_name ?? selected} on ${ENGINE_LABEL[s.engine ?? ''] ?? s.engine}`); uiStore.closeLoader(); break; }
        if (s.status === 'error') { setErr(new Error(s.error || 'Model failed to load')); break; }
        if (s.status === 'idle' && Date.now() - t0 > 5000) { setErr(new Error('Load was cancelled')); break; }
        if (Date.now() - t0 > 10 * 60_000) { setErr(new Error('Timed out waiting for model to load')); break; }
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
      toast('Model unloaded');
      await qc.invalidateQueries({ queryKey: qk.loaded });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <Modal open={loaderOpen} onClose={() => uiStore.closeLoader()} width={860}
      title={<span className="flex items-center gap-2"><Box size={15} className="text-cyan" /> Select a model to load <span className="ml-1 font-normal text-faint"><kbd className="font-mono text-[10.5px]">Ctrl+L</kbd></span></span>}
      footer={<>
        {st && st.status !== 'idle' && (
          <div className="mr-auto flex min-w-0 items-center gap-2 text-[12px] text-muted">
            <Dot tone={st.status === 'ready' ? 'ok' : st.status === 'loading' ? 'cyan' : 'danger'} pulse={st.status === 'loading'} />
            <span className="truncate">{st.status === 'loading' ? 'Loading' : st.status === 'ready' ? 'Loaded' : 'Error'}: <span className="text-text">{st.model_name ?? st.model_id}</span></span>
            {st.engine && <Badge tone="cyan" mono>{ENGINE_LABEL[st.engine] ?? st.engine}</Badge>}
          </div>
        )}
        <button className="btn" onClick={() => uiStore.closeLoader()}>Close</button>
        {st && st.status !== 'idle' && (
          <button className="btn btn-danger" disabled={busy || !canManage} onClick={doUnload}><Power size={13} /> Unload</button>
        )}
        <button className="btn btn-primary" disabled={!selected || isLoading || !canManage} onClick={doLoad}
          title={!canManage ? 'You lack the models.manage permission' : undefined}>
          {isLoading ? <Spinner className="!text-[#1a1204]" /> : <Zap size={13} />} {isLoading ? 'Loading…' : 'Load model'}
        </button>
      </>}>
      <div className="space-y-3">
        {!canManage && <div className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-[12px] text-amber">View only — loading models requires the <span className="font-mono">models.manage</span> permission.</div>}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !py-2 !pl-8" autoFocus placeholder="Search local models (name, family, quant)…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="max-h-[300px] overflow-y-auto rounded-md border border-border">
          {models.isLoading && <div className="flex items-center gap-2 p-4 text-muted"><Spinner /> Scanning models…</div>}
          {models.error && <div className="p-3"><ErrorBox error={models.error} onRetry={() => models.refetch()} /></div>}
          {!models.isLoading && !models.error && grouped.length === 0 && <div className="p-6 text-center text-muted">No models found{q ? ` for “${q}”` : ''}. Place GGUF files in the models folder or start Bionic.</div>}
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
                        {active && <Badge tone="ok">loaded</Badge>}
                        {m.vision && <Badge tone="violet"><Eye size={10} /> vision</Badge>}
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
          <div className="mb-1.5 flex items-center gap-2"><span className="label">Engine</span></div>
          {engines.error && <ErrorBox error={engines.error} />}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(engines.data ?? []).map((e) => (
              <button key={e.id} onClick={() => setEngine(e.id)} title={e.description}
                className={cx('rounded-md border p-2 text-left transition-colors',
                  engine === e.id ? 'border-cyan bg-cyan/10' : 'border-border bg-surface-2 hover:border-border-strong')}>
                <div className="flex items-center gap-1.5">
                  <Dot tone={e.available ? 'ok' : 'muted'} />
                  <span className="font-medium">{ENGINE_LABEL[e.id] ?? e.name}</span>
                  {e.version && <span className="ml-auto font-mono text-[10px] text-faint">{e.version}</span>}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{e.base_url || (e.id === 'llamacpp' ? 'managed llama-server' : '—')}</div>
                <div className={cx('mt-0.5 text-[10.5px]', e.available ? 'text-green-300' : 'text-faint')}>{e.available ? 'available' : 'unavailable'}</div>
              </button>
            ))}
            {engines.isLoading && <div className="flex items-center gap-2 text-muted"><Spinner /> engines…</div>}
          </div>
        </div>

        <div className="rounded-md border border-border">
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setShowCfg((s) => !s)}>
            {showCfg ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Cpu size={14} className="text-cyan" />
            <span className="font-medium">Load configuration</span>
            <span className="text-[11.5px] text-muted">{selectedModel ? selectedModel.name : 'no model selected'} · {ENGINE_LABEL[engine] ?? engine}</span>
            <span className="ml-auto font-mono text-[10.5px] text-faint">{Object.keys(diffFromDefaults(schema.data?.load ?? [], cfg)).length} changed</span>
          </button>
          {showCfg && (
            <div className="border-t border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <Toggle size="sm" checked={showAdv} onChange={setShowAdv} label={<span className="text-[12px] text-muted">Show advanced settings</span>} />
                <button className="btn btn-ghost btn-sm" onClick={() => setCfg({})}>Reset all to defaults</button>
              </div>
              {schema.isLoading && <div className="flex items-center gap-2 text-muted"><Spinner /> Loading schema…</div>}
              {schema.error && <ErrorBox error={schema.error} onRetry={() => schema.refetch()} />}
              {schema.data && (
                <div className="grid gap-2 md:grid-cols-2 [&>div]:contents">
                  <ParamForm fields={loadFields} values={cfg} engine={engine} showAdvanced={showAdv}
                    collapsedGroups={['CPU', 'Batching', 'RoPE', 'Memory', 'Speculative Decoding', 'MoE', 'Parallelism', 'vLLM', 'Advanced']}
                    onChange={(k, v) => setCfg((c) => { const n = { ...c }; if (v === undefined) delete n[k]; else n[k] = v; return n; })} />
                </div>
              )}
              {schema.data && selected && <CommandPreview modelId={selected} cfg={diffFromDefaults(schema.data.load, cfg)} />}
            </div>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 rounded-md border border-cyan/40 bg-cyan/10 px-3 py-2 text-cyan">
            <Spinner /> Loading {st?.model_name ?? selectedModel?.name ?? 'model'} into {ENGINE_LABEL[st?.engine ?? engine] ?? engine}… this can take a minute on first load.
            <HardDrive size={13} className="ml-auto animate-pulse" />
          </div>
        )}
        {err ? <ErrorBox error={err} /> : null}
        {st?.status === 'error' && !err && <ErrorBox error={new Error(st.error || 'Model failed to load')} />}
        {err && errMsg(err).includes('insufficient') ? <div className="text-[12px] text-muted">Tip: reduce GPU offload layers or context length.</div> : null}
      </div>
    </Modal>
  );
}

/** Shows the exact engine command the current configuration produces (llama.cpp here, vLLM for the plant GPU server). */
function CommandPreview({ modelId, cfg }: { modelId: string; cfg: Record<string, unknown> }) {
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
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span className="font-medium">Command preview</span>
        <span className="text-muted">exact engine command for this configuration</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-3">
          {error ? <ErrorBox error={error} /> : !data ? <div className="flex items-center gap-2 text-muted"><Spinner /> Building…</div> : (
            <>
              <div className="label">llama.cpp (this server)</div>
              <pre className="max-h-[140px] overflow-auto whitespace-pre-wrap break-all rounded bg-bg p-2 font-mono text-[11px] text-text/90">{data.llamacpp}</pre>
              <div className="label">vLLM equivalent (plant GPU server)</div>
              <pre className="max-h-[140px] overflow-auto whitespace-pre-wrap break-all rounded bg-bg p-2 font-mono text-[11px] text-text/90">{data.vllm}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
