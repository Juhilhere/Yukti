import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArchiveRestore, DatabaseBackup, Download, FileJson, FileSpreadsheet, RefreshCw, RotateCcw, ScrollText, Wrench } from 'lucide-react';
import { api, downloadFile, errMsg } from '../../lib/api';
import type { Backup } from '../../lib/types';
import { useAuth } from '../../lib/auth';
import { fmtBytes, fmtTime } from '../../lib/format';
import { Card, ErrorBox, QueryState, Spinner } from '../../components/ui';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { toast } from '../../components/Toast';
import { useT } from '../../lib/i18n';
import { rich } from './AdminLayout';

function BackupsCard() {
  const t = useT();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin', 'backups'], queryFn: () => api.get<Backup[]>('/api/admin/backups') });
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const pending = useQuery({ queryKey: ['admin', 'restore-pending'], queryFn: () => api.get<{ pending: string | null }>('/api/admin/backups/restore-pending') });
  const [restarting, setRestarting] = useState(false);
  const cancel = useMutation({
    mutationFn: () => api.del('/api/admin/backups/restore-pending'),
    onSuccess: () => { toast.success(t('admin.backup.cancelled'), t('admin.backup.cancelledBody')); void pending.refetch(); },
    onError: (e) => toast.error(t('admin.backup.cancelFailed'), errMsg(e)),
  });
  const restartNow = async () => {
    setRestarting(true);
    try {
      await api.post('/api/admin/server/restart', {});
      const t0 = Date.now();
      await new Promise((r) => setTimeout(r, 3000));
      for (;;) {  // wait for the server to come back, then reload so every component sees the restored data
        try { const h = await fetch('/api/health', { cache: 'no-store' }); if (h.ok && (await h.json()).knowledge_ready) break; } catch { /* restarting */ }
        if (Date.now() - t0 > 180_000) throw new Error(t('admin.backup.noComeback'));
        await new Promise((r) => setTimeout(r, 1500));
      }
      window.location.href = '/login';
    } catch (e) { toast.error(t('admin.backup.restartFailed'), errMsg(e)); setRestarting(false); }
  };
  const create = useMutation({
    mutationFn: () => api.post<Backup>('/api/admin/backups', {}),
    onSuccess: (b) => { toast.success(t('admin.backup.created'), `${b.name} · ${fmtBytes(b.size_bytes)}`); qc.invalidateQueries({ queryKey: ['admin', 'backups'] }); },
    onError: (e) => toast.error(t('admin.backup.failed'), errMsg(e)),
  });
  const restore = useMutation({
    mutationFn: (name: string) => api.post<{ ok: boolean; restart_required: boolean }>(`/api/admin/backups/${encodeURIComponent(name)}/restore`, {}),
    onSuccess: (_r, name) => { setRestoring(null); void pending.refetch(); toast.success(t('admin.backup.staged'), t('admin.backup.stagedBody', { name })); },
  });
  const [dl, setDl] = useState<string | null>(null);
  const download = async (b: Backup) => {
    setDl(b.name);
    try { await downloadFile(`/api/admin/backups/${encodeURIComponent(b.name)}/file`, b.name); } catch (e) { toast.error(t('admin.backup.dlFailed'), errMsg(e)); } finally { setDl(null); }
  };
  const cols: Column<Backup>[] = [
    { key: 'name', header: t('admin.backup.col.name'), mono: true },
    { key: 'created_at', header: t('admin.backup.col.created'), sortValue: (b) => b.created_at, render: (b) => fmtTime(b.created_at) },
    { key: 'size_bytes', header: t('admin.backup.col.size'), mono: true, sortValue: (b) => b.size_bytes, render: (b) => fmtBytes(b.size_bytes) },
    { key: 'sha256', header: 'SHA-256', render: (b) => b.sha256 ? <span className="font-mono text-[11px] text-muted" title={b.sha256}>{b.sha256.slice(0, 16)}…</span> : <span className="text-faint">—</span> },
    { key: 'actions', header: '', render: (b) => (
      <div className="flex justify-end gap-1">
        <button className="btn btn-sm" disabled={dl === b.name} onClick={() => void download(b)}>{dl === b.name ? <Spinner size={12} /> : <Download size={12} />}{t('btn.download')}</button>
        <button className="btn btn-sm btn-danger" onClick={() => { restore.reset(); setRestoring(b); }}><ArchiveRestore size={12} />{t('admin.backup.restore')}</button>
      </div>
    ) },
  ];
  return (
    <Card title={t('admin.backup.title')} icon={<DatabaseBackup size={14} className="text-cyan" />} bodyClass="p-0"
      actions={<button className="btn btn-sm btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
        {create.isPending ? <Spinner size={12} className="!text-[#1a1204]" /> : <DatabaseBackup size={12} />}{t('admin.backup.create')}
      </button>}>
      {pending.data?.pending && (
        <div className="m-3 flex flex-wrap items-center gap-2 rounded-md border border-amber/50 bg-amber/10 px-3 py-2 text-[12.5px] text-amber">
          <AlertTriangle size={15} className="shrink-0" />
          <div className="min-w-0 flex-1">{rich(t('admin.backup.pending'), { name: <span className="font-mono">{pending.data.pending}</span> })}</div>
          <button className="btn btn-sm" disabled={cancel.isPending || restarting} onClick={() => cancel.mutate()}>{t('admin.backup.cancelRestore')}</button>
          <button className="btn btn-sm btn-danger" disabled={restarting} onClick={() => void restartNow()}>
            {restarting ? <Spinner size={12} /> : <RotateCcw size={12} />}{restarting ? t('admin.backup.restarting') : t('admin.backup.restartNow')}
          </button>
        </div>
      )}
      <div className="px-3 pt-2 text-[11.5px] text-muted">{t('admin.backup.about')}</div>
      <QueryState q={list} empty={(list.data ?? []).length === 0} emptyTitle={t('admin.backup.empty')} emptyHint={t('admin.backup.emptyHint')}>
        <DataTable rows={list.data ?? []} columns={cols} rowKey={(b) => b.name} />
      </QueryState>
      <Modal open={!!restoring} onClose={() => setRestoring(null)} width={460} title={t('admin.backup.confirmTitle')} icon={<AlertTriangle size={15} className="text-danger" />}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setRestoring(null)}>{t('btn.cancel')}</button>
          <button className="btn btn-danger" disabled={restore.isPending} onClick={() => restoring && restore.mutate(restoring.name)}>
            {restore.isPending ? <Spinner size={12} /> : <ArchiveRestore size={12} />}{t('admin.backup.stage')}
          </button>
        </>}>
        <div className="space-y-2 text-[12.5px]">
          <p>{rich(t('admin.backup.confirmBody'), { name: <span className="font-mono text-amber">{restoring?.name}</span>, time: restoring ? fmtTime(restoring.created_at) : '' })}</p>
          <p className="text-muted">{t('admin.backup.confirmNote')}</p>
          {restore.error ? <ErrorBox error={restore.error} /> : null}
        </div>
      </Modal>
    </Card>
  );
}

function AuditExportCard() {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (fmt: 'csv' | 'jsonl') => {
    setBusy(fmt);
    try { await downloadFile(`/api/audit/export?format=${fmt}`, `yukti-audit.${fmt}`); toast.success(t('admin.backup.exported'), fmt.toUpperCase()); }
    catch (e) { toast.error(t('admin.backup.exportFailed'), errMsg(e)); } finally { setBusy(null); }
  };
  return (
    <Card title={t('admin.backup.auditTitle')} icon={<ScrollText size={14} className="text-amber" />}>
      <div className="space-y-2">
        <div className="text-[12.5px] text-muted">{t('admin.backup.auditAbout')}</div>
        <div className="flex gap-2">
          <button className="btn btn-sm" disabled={!!busy} onClick={() => void go('csv')}>{busy === 'csv' ? <Spinner size={12} /> : <FileSpreadsheet size={12} />}{t('admin.backup.exportCsv')}</button>
          <button className="btn btn-sm" disabled={!!busy} onClick={() => void go('jsonl')}>{busy === 'jsonl' ? <Spinner size={12} /> : <FileJson size={12} />}{t('admin.backup.exportJsonl')}</button>
        </div>
      </div>
    </Card>
  );
}

function MaintenanceCard({ demo }: { demo: boolean }) {
  const t = useT();
  const [confirmReset, setConfirmReset] = useState(false);
  const reload = useMutation({
    mutationFn: () => api.post<{ documents_reingested: number; departments: number }>('/api/admin/mrpl/reload', {}),
    onSuccess: (r) => toast.success(t('admin.maint.reloaded'), r.documents_reingested
      ? t('admin.maint.reloadedChanged', { n: r.documents_reingested, d: r.departments })
      : t('admin.maint.reloadedSame', { d: r.departments })),
    onError: (e) => toast.error(t('admin.maint.reloadFailed'), errMsg(e)),
  });
  const reset = useMutation({
    mutationFn: () => api.post<{ grants_revoked: number; requests_cleared: number }>('/api/admin/demo/reset', {}),
    onSuccess: (r) => { setConfirmReset(false); toast.success(t('admin.maint.resetDone'), t('admin.maint.resetDoneBody', { g: r.grants_revoked, r: r.requests_cleared })); },
    onError: (e) => toast.error(t('admin.maint.resetFailed'), errMsg(e)),
  });
  return (
    <Card title={t('admin.maint.title')} icon={<Wrench size={14} className="text-amber" />}>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <div className="font-medium">{t('admin.maint.mrpl')}</div>
          <div className="mt-1 text-[12px] text-muted">{t('admin.maint.mrplAbout')}</div>
          <button className="btn btn-sm mt-2" disabled={reload.isPending} onClick={() => reload.mutate()}>
            {reload.isPending ? <Spinner size={12} /> : <RefreshCw size={12} />}{t('admin.maint.reload')}
          </button>
        </div>
        {demo && <div className="rounded-md border border-border p-3">
          <div className="font-medium">{t('admin.maint.reset')}</div>
          <div className="mt-1 text-[12px] text-muted">{t('admin.maint.resetAbout')}</div>
          <button className="btn btn-sm btn-danger mt-2" onClick={() => setConfirmReset(true)}><RotateCcw size={12} />{t('admin.maint.resetBtn')}</button>
        </div>}
      </div>
      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} width={440} title={t('admin.maint.confirmTitle')} icon={<AlertTriangle size={15} className="text-danger" />}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>{t('btn.cancel')}</button>
          <button className="btn btn-danger" disabled={reset.isPending} onClick={() => reset.mutate()}>{reset.isPending ? <Spinner size={12} /> : <RotateCcw size={12} />}{t('admin.maint.resetConfirm')}</button>
        </>}>
        <p className="text-[12.5px]">{t('admin.maint.confirmBody')}</p>
      </Modal>
    </Card>
  );
}

export default function BackupExport() {
  const { can, me } = useAuth();
  return (
    <div className="space-y-4 p-5">
      {can('backup.manage') && <BackupsCard />}
      {can('audit.export') && <AuditExportCard />}
      {can('admin') && <MaintenanceCard demo={!!me?.demo_mode} />}
    </div>
  );
}
