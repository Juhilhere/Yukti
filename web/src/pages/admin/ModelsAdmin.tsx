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
import { useT } from '../../lib/i18n';
import { rich } from './AdminLayout';

function LoadedCard() {
  const t = useT();
  const q = useLoaded();
  const qc = useQueryClient();
  const unload = useMutation({
    mutationFn: () => api.post('/api/models/unload'),
    onSuccess: () => { toast.success(t('admin.models.unloaded')); qc.invalidateQueries({ queryKey: qk.loaded }); qc.invalidateQueries({ queryKey: ['features'] }); },
    onError: (e) => toast.error(t('admin.models.unloadFailed'), String((e as Error).message)),
  });
  const l = q.data;
  const active = l && l.status !== 'idle' && l.model_name;
  return (
    <Card title={t('admin.models.loadedTitle')} icon={<Power size={14} className="text-cyan" />}
      actions={active ? <>
        <StatusChip status={l.status} />
        <button className="btn btn-danger btn-sm" disabled={unload.isPending} onClick={() => unload.mutate()}>
          {unload.isPending ? <Spinner size={12} /> : <Power size={12} />}{t('admin.models.unload')}
        </button>
      </> : <button className="btn btn-primary btn-sm" onClick={() => uiStore.openLoader()}>{t('admin.models.loadOne')}</button>}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !active ? (
        <EmptyState icon={<Boxes size={26} />} title={t('admin.models.noneLoaded')} hint={t('admin.models.noneLoadedHint')} />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><div className="label">{t('admin.models.model')}</div><div className="mt-0.5 truncate font-medium">{l.model_name}</div></div>
            <div><div className="label">{t('admin.models.engine')}</div><div className="mt-0.5 font-mono text-[12.5px]">{l.engine ?? '—'}</div></div>
            <div><div className="label">{t('admin.models.port')}</div><div className="mt-0.5 font-mono text-[12.5px]">{l.port ?? '—'}</div></div>
            <div><div className="label">{t('admin.models.started')}</div><div className="mt-0.5 font-mono text-[12.5px]">{fmtTime(l.started_at)}</div></div>
          </div>
          {l.error && <ErrorBox error={new Error(l.error)} />}
          <div>
            <div className="label mb-1">{t('admin.models.loadConfig')}</div>
            <JsonView value={l.load_config ?? {}} className="max-h-[260px]" />
          </div>
        </div>
      )}
    </Card>
  );
}

function EngineRow({ e, editable }: { e: Engine; editable: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [url, setUrl] = useState(e.base_url ?? '');
  const [key, setKey] = useState('');
  useEffect(() => { setUrl(e.base_url ?? ''); }, [e.base_url]);
  const save = useMutation({
    mutationFn: () => api.put<Engine>(`/api/engines/${e.id}`, key ? { base_url: url, api_key: key } : { base_url: url }),
    onSuccess: (r) => { if (r.available) toast.success(t('admin.models.engConnected', { name: e.name }), t('admin.models.engModels', { n: r.models?.length ?? 0 })); else toast.error(t('admin.models.engUnreachable', { name: e.name }), r.error ?? ''); setKey(''); qc.invalidateQueries({ queryKey: qk.engines }); qc.invalidateQueries({ queryKey: qk.models }); },
    onError: (err) => toast.error(t('admin.models.engUpdateFailed'), (err as Error).message),
  });
  const urlEditable = editable && e.id !== 'llamacpp';
  return (
    <div className="rounded-md border border-border bg-surface-2/40 p-3">
      <div className="flex items-center gap-2">
        <Dot tone={e.available ? 'ok' : 'muted'} pulse={e.available} />
        <span className="font-semibold">{e.name}</span>
        <Badge mono tone="muted">{e.id}</Badge>
        {e.version && <Badge mono tone="cyan">{e.version}</Badge>}
        <span className="ml-auto text-[11.5px] text-muted">{e.available ? t('admin.models.available') : t('admin.models.unreachable')}</span>
      </div>
      <div className="mt-1 text-[12px] text-muted">{e.description}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input className="input flex-1 font-mono text-[12px] !py-1" style={{ minWidth: 220 }} value={url} disabled={!urlEditable}
          onChange={(ev) => setUrl(ev.target.value)} placeholder={e.id === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234/v1'} />
        {urlEditable && e.id !== 'ollama' && (
          <input className="input !w-44 font-mono text-[12px] !py-1" type="password" placeholder={t('admin.models.apiKey')} value={key} onChange={(ev) => setKey(ev.target.value)} />
        )}
        {urlEditable && (
          <button className="btn btn-cyan btn-sm" disabled={save.isPending || (url === e.base_url && !key)} onClick={() => save.mutate()}>
            {save.isPending && <Spinner size={12} />}{t('btn.save')}
          </button>
        )}
      </div>
      {!e.available && e.error && <div className="mt-2 text-[12px] text-amber">{e.error}</div>}
      {e.available && !!e.models?.length && <div className="mt-2 truncate text-[11.5px] text-muted">{rich(t('admin.models.engModelList'), { list: <span className="font-mono">{e.models.join(', ')}</span> })}</div>}
    </div>
  );
}

/** Folder path with a trailing separator, ready for the file name to be typed. */
function joinDir(d: string) {
  const sep = d.includes('\\') ? '\\' : '/';
  return d.endsWith(sep) ? d : d + sep;
}

function ImportCard() {
  const t = useT();
  const qc = useQueryClient();
  const dirs = useQuery({ queryKey: ['admin', 'import-dirs'], queryFn: () => api.get<{ dirs: string[] }>('/api/admin/models/import-dirs'), retry: false });
  const [path, setPath] = useState('');
  const imp = useMutation({
    mutationFn: () => api.post<Model>('/api/admin/models/import', { path: path.trim() }),
    onSuccess: (m) => { toast.success(t('admin.models.imported'), m?.name ?? path); setPath(''); qc.invalidateQueries({ queryKey: qk.models }); },
  });
  const valid = /\.gguf$/i.test(path.trim());
  return (
    <Card title={t('admin.models.importTitle')} icon={<HardDriveDownload size={14} className="text-amber" />}>
      <div className="space-y-2">
        <div className="text-[12px] text-muted">{rich(t('admin.models.importAbout'), { ext: <span className="font-mono">.gguf</span> })}</div>
        <Field label={t('admin.models.pathLabel')}>
          <div className="flex gap-2">
            <input className="input flex-1 font-mono text-[12px]" value={path} onChange={(e) => setPath(e.target.value)} placeholder="E:\models\model-Q4_K_M.gguf" />
            <button className="btn btn-primary" disabled={!valid || imp.isPending} onClick={() => imp.mutate()}>
              {imp.isPending ? <Spinner className="!text-[#1a1204]" /> : <FolderInput size={13} />}{t('admin.models.import')}
            </button>
          </div>
        </Field>
        {path.trim() && !valid && <div className="text-[11.5px] text-amber">{t('admin.models.pathInvalid')}</div>}
        {(dirs.data?.dirs ?? []).length > 0 && (
          <div className="text-[11.5px] text-muted">{t('admin.models.allowedDirs')}{' '}
            {dirs.data!.dirs.map((d) => <button key={d} type="button" className="mr-1 rounded border border-border px-1.5 font-mono text-[11px] hover:border-cyan hover:text-cyan" onClick={() => setPath(joinDir(d))}>{d}</button>)}
          </div>
        )}
        {imp.isPending && <div className="text-[11.5px] text-cyan">{t('admin.models.copying')}</div>}
        {imp.error ? <ErrorBox error={imp.error} /> : null}
      </div>
    </Card>
  );
}

function DeleteModelButton({ m }: { m: Model }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: () => api.del(`/api/admin/models/${encodeURIComponent(m.id)}`),
    onSuccess: () => { toast.success(t('admin.models.deleted'), m.name); setOpen(false); qc.invalidateQueries({ queryKey: qk.models }); },
    onError: (e) => toast.error(t('admin.models.deleteFailed'), errMsg(e)),
  });
  return (
    <>
      <button className="btn btn-sm btn-danger btn-icon" title={t('admin.models.deleteTip')} onClick={(e) => { e.stopPropagation(); setOpen(true); }}><Trash2 size={12} /></button>
      <Modal open={open} onClose={() => setOpen(false)} width={420} title={t('admin.models.deleteTitle')}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>{t('btn.cancel')}</button>
          <button className="btn btn-danger" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? <Spinner size={12} /> : <Trash2 size={12} />}{t('btn.delete')}</button>
        </>}>
        <div className="text-[12.5px]">{rich(t('admin.models.deleteBody'), { file: <span className="font-mono text-amber">{m.file_name || m.name}</span> })}</div>
      </Modal>
    </>
  );
}

export default function ModelsAdmin() {
  const t = useT();
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
    { key: 'name', header: t('admin.models.col.name'), render: (m) => (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium">
          {m.name}
          {loaded.data?.model_id === m.id && loaded.data.status === 'ready' && <Badge tone="ok">{t('admin.models.loadedBadge')}</Badge>}
        </div>
        <div className="truncate font-mono text-[11px] text-faint">{m.file_name}</div>
      </div>
    ) },
    { key: 'family', header: t('admin.models.col.family'), render: (m) => <span className="text-muted">{m.family || '—'}</span> },
    { key: 'params_b', header: t('admin.models.col.params'), mono: true, render: (m) => (m.params_b ? `${m.params_b}B` : '—') },
    { key: 'quant', header: t('admin.models.col.quant'), render: (m) => (m.quant ? <Badge mono tone="muted">{m.quant}</Badge> : '—') },
    { key: 'size_bytes', header: t('admin.models.col.size'), mono: true, render: (m) => fmtBytes(m.size_bytes) },
    { key: 'source', header: t('admin.models.col.source'), render: (m) => <Badge tone={m.source === 'yukti' ? 'amber' : m.source === 'lmstudio' ? 'cyan' : 'violet'}>{m.source}</Badge> },
    { key: 'vision', header: t('admin.models.col.vision'), render: (m) => (m.vision ? <Eye size={13} className="text-cyan" /> : <span className="text-faint">—</span>) },
    { key: 'actions', header: '', render: (m) => (
      <div className="flex justify-end gap-1">
        <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); uiStore.openLoader(m.id); }}><Upload size={12} />{t('admin.models.load')}</button>
        {m.source === 'yukti' && <DeleteModelButton m={m} />}
      </div>
    ) },
  ];

  return (
    <div>
      <div className="space-y-4 p-5">
        <div className="flex justify-end">
          <button className="btn btn-primary" onClick={() => uiStore.openLoader()}><Cpu size={13} />{t('admin.models.loader')} <span className="font-mono text-[10.5px] opacity-70">Ctrl+L</span></button>
        </div>
        <LoadedCard />
        <ImportCard />
        <Card title={models.data ? t('admin.models.localN', { n: models.data.length }) : t('admin.models.local')} icon={<Boxes size={14} className="text-cyan" />} bodyClass="p-0"
          actions={<div className="relative"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input !w-56 !py-0.5 !pl-6 text-[12px]" placeholder={t('admin.models.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
          <QueryState q={models} empty={(models.data ?? []).length === 0} emptyTitle={t('admin.models.empty')}
            emptyHint={t('admin.models.emptyHint')}>
            <DataTable rows={rows} columns={cols} rowKey={(m) => m.id}
              empty={<EmptyState title={t('admin.models.noMatch')} />} />
          </QueryState>
        </Card>
        <Card title={t('admin.models.engines')} icon={<Server size={14} className="text-cyan" />}
          actions={!manage && <span className="text-[11.5px] text-muted">{t('admin.models.readOnly')}</span>}>
          <QueryState q={engines} empty={(engines.data ?? []).length === 0} emptyTitle={t('admin.models.noEngines')}>
            <div className="grid gap-3 lg:grid-cols-2">
              {(engines.data ?? []).map((e) => <EngineRow key={e.id} e={e} editable={manage} />)}
            </div>
          </QueryState>
        </Card>
      </div>
    </div>
  );
}
