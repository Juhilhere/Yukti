import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Boxes, Cpu, Eye, FolderInput, HardDriveDownload, Power, Search, Server, Trash2, Upload } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../../components/Modal';
import { api, errMsg } from '../../lib/api';
import type { Engine, Model } from '../../lib/types';
import { fmtBytes, fmtTime } from '../../lib/format';
import { qk, uiStore, useEngines, useLoaded, useModels } from '../../lib/queries';
import { useAuth } from '../../lib/auth';
import { Badge, Card, Dot, EmptyState, ErrorBox, Field, JsonView, Loading, QueryState, Spinner, StatusChip } from '../../components/ui';
import { DataTable, type Column } from '../../components/DataTable';
import { toast } from '../../components/Toast';

function LoadedCard() {
  const q = useLoaded();
  const qc = useQueryClient();
  const unload = useMutation({
    mutationFn: () => api.post('/api/models/unload'),
    onSuccess: () => { toast.success('Model unloaded'); qc.invalidateQueries({ queryKey: qk.loaded }); },
    onError: (e) => toast.error('Unload failed', String((e as Error).message)),
  });
  const l = q.data;
  const active = l && l.status !== 'idle' && l.model_name;
  return (
    <Card title="Loaded model" icon={<Power size={14} className="text-cyan" />}
      actions={active ? <>
        <StatusChip status={l.status} />
        <button className="btn btn-danger btn-sm" disabled={unload.isPending} onClick={() => unload.mutate()}>
          {unload.isPending ? <Spinner size={12} /> : <Power size={12} />}Unload
        </button>
      </> : <button className="btn btn-primary btn-sm" onClick={() => uiStore.openLoader()}>Load a model</button>}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !active ? (
        <EmptyState icon={<Boxes size={26} />} title="No model loaded" hint="Pick a local GGUF or an engine-served model to start chatting." />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><div className="label">Model</div><div className="mt-0.5 truncate font-medium">{l.model_name}</div></div>
            <div><div className="label">Engine</div><div className="mt-0.5 font-mono text-[12.5px]">{l.engine ?? '—'}</div></div>
            <div><div className="label">Port</div><div className="mt-0.5 font-mono text-[12.5px]">{l.port ?? '—'}</div></div>
            <div><div className="label">Started</div><div className="mt-0.5 font-mono text-[12.5px]">{fmtTime(l.started_at)}</div></div>
          </div>
          {l.error && <ErrorBox error={new Error(l.error)} />}
          <div>
            <div className="label mb-1">Load configuration</div>
            <JsonView value={l.load_config ?? {}} className="max-h-[260px]" />
          </div>
        </div>
      )}
    </Card>
  );
}

function EngineRow({ e, editable }: { e: Engine; editable: boolean }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState(e.base_url ?? '');
  const [key, setKey] = useState('');
  useEffect(() => { setUrl(e.base_url ?? ''); }, [e.base_url]);
  const save = useMutation({
    mutationFn: () => api.put<Engine>(`/api/engines/${e.id}`, key ? { base_url: url, api_key: key } : { base_url: url }),
    onSuccess: () => { toast.success(`${e.name} updated`); setKey(''); qc.invalidateQueries({ queryKey: qk.engines }); },
    onError: (err) => toast.error('Could not update engine', (err as Error).message),
  });
  const urlEditable = editable && e.id !== 'llamacpp';
  return (
    <div className="rounded-md border border-border bg-surface-2/40 p-3">
      <div className="flex items-center gap-2">
        <Dot tone={e.available ? 'ok' : 'muted'} pulse={e.available} />
        <span className="font-semibold">{e.name}</span>
        <Badge mono tone="muted">{e.id}</Badge>
        {e.version && <Badge mono tone="cyan">{e.version}</Badge>}
        <span className="ml-auto text-[11.5px] text-muted">{e.available ? 'available' : 'unreachable'}</span>
      </div>
      <div className="mt-1 text-[12px] text-muted">{e.description}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input className="input flex-1 font-mono text-[12px] !py-1" style={{ minWidth: 220 }} value={url} disabled={!urlEditable}
          onChange={(ev) => setUrl(ev.target.value)} placeholder="http://127.0.0.1:1234/v1" />
        {urlEditable && (e.id === 'remote' || e.id === 'vllm') && (
          <input className="input !w-44 font-mono text-[12px] !py-1" type="password" placeholder="API key (optional)" value={key} onChange={(ev) => setKey(ev.target.value)} />
        )}
        {urlEditable && (
          <button className="btn btn-cyan btn-sm" disabled={save.isPending || (url === e.base_url && !key)} onClick={() => save.mutate()}>
            {save.isPending && <Spinner size={12} />}Save
          </button>
        )}
      </div>
    </div>
  );
}

/** Folder path with a trailing separator, ready for the file name to be typed. */
function joinDir(d: string) {
  const sep = d.includes('\\') ? '\\' : '/';
  return d.endsWith(sep) ? d : d + sep;
}

function ImportCard() {
  const qc = useQueryClient();
  const dirs = useQuery({ queryKey: ['admin', 'import-dirs'], queryFn: () => api.get<{ dirs: string[] }>('/api/admin/models/import-dirs'), retry: false });
  const [path, setPath] = useState('');
  const imp = useMutation({
    mutationFn: () => api.post<Model>('/api/admin/models/import', { path: path.trim() }),
    onSuccess: (m) => { toast.success('Model imported', m?.name ?? path); setPath(''); qc.invalidateQueries({ queryKey: qk.models }); },
  });
  const valid = /\.gguf$/i.test(path.trim());
  return (
    <Card title="Import model from path" icon={<HardDriveDownload size={14} className="text-amber" />}>
      <div className="space-y-2">
        <div className="text-[12px] text-muted">Yukti is air-gapped: bring a <span className="font-mono">.gguf</span> file on approved media (e.g. USB drive) and give its absolute path on the server. It is copied into the Yukti models folder and its SHA-256 is recorded in the audit log.</div>
        <Field label="Absolute path on the server">
          <div className="flex gap-2">
            <input className="input flex-1 font-mono text-[12px]" value={path} onChange={(e) => setPath(e.target.value)} placeholder="E:\models\model-Q4_K_M.gguf" />
            <button className="btn btn-primary" disabled={!valid || imp.isPending} onClick={() => imp.mutate()}>
              {imp.isPending ? <Spinner className="!text-[#1a1204]" /> : <FolderInput size={13} />}Import
            </button>
          </div>
        </Field>
        {path.trim() && !valid && <div className="text-[11.5px] text-amber">Path must point to a .gguf file.</div>}
        {(dirs.data?.dirs ?? []).length > 0 && (
          <div className="text-[11.5px] text-muted">Allowed source folders:{' '}
            {dirs.data!.dirs.map((d) => <button key={d} type="button" className="mr-1 rounded border border-border px-1.5 font-mono text-[11px] hover:border-cyan hover:text-cyan" onClick={() => setPath(joinDir(d))}>{d}</button>)}
          </div>
        )}
        {imp.isPending && <div className="text-[11.5px] text-cyan">Copying and hashing the file — large models can take several minutes…</div>}
        {imp.error ? <ErrorBox error={imp.error} /> : null}
      </div>
    </Card>
  );
}

function DeleteModelButton({ m }: { m: Model }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: () => api.del(`/api/admin/models/${encodeURIComponent(m.id)}`),
    onSuccess: () => { toast.success('Model deleted', m.name); setOpen(false); qc.invalidateQueries({ queryKey: qk.models }); },
    onError: (e) => toast.error('Delete failed', errMsg(e)),
  });
  return (
    <>
      <button className="btn btn-sm btn-danger btn-icon" title="Delete imported model file" onClick={(e) => { e.stopPropagation(); setOpen(true); }}><Trash2 size={12} /></button>
      <Modal open={open} onClose={() => setOpen(false)} width={420} title="Delete model file?"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn-danger" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? <Spinner size={12} /> : <Trash2 size={12} />}Delete</button>
        </>}>
        <div className="text-[12.5px]">Permanently remove <span className="font-mono text-amber">{m.file_name || m.name}</span> from the Yukti models folder?</div>
      </Modal>
    </>
  );
}

export default function ModelsAdmin() {
  const models = useModels();
  const engines = useEngines();
  const loaded = useLoaded();
  const { can } = useAuth();
  const manage = can('models.manage');
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const f = q.trim().toLowerCase();
    const list = models.data ?? [];
    return f ? list.filter((m) => `${m.name} ${m.family} ${m.quant} ${m.file_name}`.toLowerCase().includes(f)) : list;
  }, [models.data, q]);

  const cols: Column<Model>[] = [
    { key: 'name', header: 'Name', render: (m) => (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium">
          {m.name}
          {loaded.data?.model_id === m.id && loaded.data.status === 'ready' && <Badge tone="ok">loaded</Badge>}
        </div>
        <div className="truncate font-mono text-[11px] text-faint">{m.file_name}</div>
      </div>
    ) },
    { key: 'family', header: 'Family', render: (m) => <span className="text-muted">{m.family || '—'}</span> },
    { key: 'params_b', header: 'Params', mono: true, render: (m) => (m.params_b ? `${m.params_b}B` : '—') },
    { key: 'quant', header: 'Quant', render: (m) => (m.quant ? <Badge mono tone="muted">{m.quant}</Badge> : '—') },
    { key: 'size_bytes', header: 'Size', mono: true, render: (m) => fmtBytes(m.size_bytes) },
    { key: 'source', header: 'Source', render: (m) => <Badge tone={m.source === 'yukti' ? 'amber' : m.source === 'lmstudio' ? 'cyan' : 'violet'}>{m.source}</Badge> },
    { key: 'vision', header: 'Vision', render: (m) => (m.vision ? <Eye size={13} className="text-cyan" /> : <span className="text-faint">—</span>) },
    { key: 'actions', header: '', render: (m) => (
      <div className="flex justify-end gap-1">
        <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); uiStore.openLoader(m.id); }}><Upload size={12} />Load</button>
        {m.source === 'yukti' && <DeleteModelButton m={m} />}
      </div>
    ) },
  ];

  return (
    <div>
      <div className="space-y-4 p-5">
        <div className="flex justify-end">
          <button className="btn btn-primary" onClick={() => uiStore.openLoader()}><Cpu size={13} />Model loader <span className="font-mono text-[10.5px] opacity-70">Ctrl+L</span></button>
        </div>
        <LoadedCard />
        <ImportCard />
        <Card title={`Local models${models.data ? ` (${models.data.length})` : ''}`} icon={<Boxes size={14} className="text-cyan" />} bodyClass="p-0"
          actions={<div className="relative"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input !w-56 !py-0.5 !pl-6 text-[12px]" placeholder="Search models…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
          <QueryState q={models} empty={(models.data ?? []).length === 0} emptyTitle="No models found"
            emptyHint="Place GGUF files in the models folder or connect Bionic / vLLM below.">
            <DataTable rows={rows} columns={cols} rowKey={(m) => m.id}
              empty={<EmptyState title="No models match" />} />
          </QueryState>
        </Card>
        <Card title="Engines" icon={<Server size={14} className="text-cyan" />}
          actions={!manage && <span className="text-[11.5px] text-muted">Read-only (requires models.manage)</span>}>
          <QueryState q={engines} empty={(engines.data ?? []).length === 0} emptyTitle="No engines configured">
            <div className="grid gap-3 lg:grid-cols-2">
              {(engines.data ?? []).map((e) => <EngineRow key={e.id} e={e} editable={manage} />)}
            </div>
          </QueryState>
        </Card>
      </div>
    </div>
  );
}
