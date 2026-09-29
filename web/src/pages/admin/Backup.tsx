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

function BackupsCard() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin', 'backups'], queryFn: () => api.get<Backup[]>('/api/admin/backups') });
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [restartNeeded, setRestartNeeded] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<Backup>('/api/admin/backups', {}),
    onSuccess: (b) => { toast.success('Backup created', `${b.name} · ${fmtBytes(b.size_bytes)}`); qc.invalidateQueries({ queryKey: ['admin', 'backups'] }); },
    onError: (e) => toast.error('Backup failed', errMsg(e)),
  });
  const restore = useMutation({
    mutationFn: (name: string) => api.post<{ ok: boolean; restart_required: boolean }>(`/api/admin/backups/${encodeURIComponent(name)}/restore`, {}),
    onSuccess: (r, name) => { setRestoring(null); if (r?.restart_required !== false) setRestartNeeded(name); toast.success('Backup restored', name); },
  });
  const [dl, setDl] = useState<string | null>(null);
  const download = async (b: Backup) => {
    setDl(b.name);
    try { await downloadFile(`/api/admin/backups/${encodeURIComponent(b.name)}/file`, b.name); } catch (e) { toast.error('Download failed', errMsg(e)); } finally { setDl(null); }
  };
  const cols: Column<Backup>[] = [
    { key: 'name', header: 'Name', mono: true },
    { key: 'created_at', header: 'Created', sortValue: (b) => b.created_at, render: (b) => fmtTime(b.created_at) },
    { key: 'size_bytes', header: 'Size', mono: true, sortValue: (b) => b.size_bytes, render: (b) => fmtBytes(b.size_bytes) },
    { key: 'sha256', header: 'SHA-256', render: (b) => b.sha256 ? <span className="font-mono text-[11px] text-muted" title={b.sha256}>{b.sha256.slice(0, 16)}…</span> : <span className="text-faint">—</span> },
    { key: 'actions', header: '', render: (b) => (
      <div className="flex justify-end gap-1">
        <button className="btn btn-sm" disabled={dl === b.name} onClick={() => void download(b)}>{dl === b.name ? <Spinner size={12} /> : <Download size={12} />}Download</button>
        <button className="btn btn-sm btn-danger" onClick={() => { restore.reset(); setRestoring(b); }}><ArchiveRestore size={12} />Restore</button>
      </div>
    ) },
  ];
  return (
    <Card title="Backups" icon={<DatabaseBackup size={14} className="text-cyan" />} bodyClass="p-0"
      actions={<button className="btn btn-sm btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
        {create.isPending ? <Spinner size={12} className="!text-[#1a1204]" /> : <DatabaseBackup size={12} />}Create backup
      </button>}>
      {restartNeeded && (
        <div className="m-3 flex items-start gap-2 rounded-md border border-amber/50 bg-amber/10 px-3 py-2 text-[12.5px] text-amber">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div><b>Restart required.</b> Backup <span className="font-mono">{restartNeeded}</span> was restored. Restart the Yukti server (ops/stop.ps1 then ops/start.ps1) so every component reloads the restored database and document store.</div>
        </div>
      )}
      <div className="px-3 pt-2 text-[11.5px] text-muted">A backup is a zip of the database and the document store, with a SHA-256 checksum.</div>
      <QueryState q={list} empty={(list.data ?? []).length === 0} emptyTitle="No backups yet" emptyHint="Create the first backup now; store copies off the server.">
        <DataTable rows={list.data ?? []} columns={cols} rowKey={(b) => b.name} />
      </QueryState>
      <Modal open={!!restoring} onClose={() => setRestoring(null)} width={460} title="Restore backup?" icon={<AlertTriangle size={15} className="text-danger" />}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setRestoring(null)}>Cancel</button>
          <button className="btn btn-danger" disabled={restore.isPending} onClick={() => restoring && restore.mutate(restoring.name)}>
            {restore.isPending ? <Spinner size={12} /> : <ArchiveRestore size={12} />}Restore
          </button>
        </>}>
        <div className="space-y-2 text-[12.5px]">
          <p>This replaces the current database and document store with <span className="font-mono text-amber">{restoring?.name}</span> ({restoring && fmtTime(restoring.created_at)}).</p>
          <p className="text-muted">Changes made after that backup will be lost. A server restart is required afterwards.</p>
          {restore.error ? <ErrorBox error={restore.error} /> : null}
        </div>
      </Modal>
    </Card>
  );
}

function AuditExportCard() {
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (fmt: 'csv' | 'jsonl') => {
    setBusy(fmt);
    try { await downloadFile(`/api/audit/export?format=${fmt}`, `yukti-audit.${fmt}`); toast.success('Audit log exported', fmt.toUpperCase()); }
    catch (e) { toast.error('Export failed', errMsg(e)); } finally { setBusy(null); }
  };
  return (
    <Card title="Audit export" icon={<ScrollText size={14} className="text-amber" />}>
      <div className="space-y-2">
        <div className="text-[12.5px] text-muted">Download the full hash-chained audit log for regulators, internal audit or SIEM ingestion.</div>
        <div className="flex gap-2">
          <button className="btn btn-sm" disabled={!!busy} onClick={() => void go('csv')}>{busy === 'csv' ? <Spinner size={12} /> : <FileSpreadsheet size={12} />}Export CSV</button>
          <button className="btn btn-sm" disabled={!!busy} onClick={() => void go('jsonl')}>{busy === 'jsonl' ? <Spinner size={12} /> : <FileJson size={12} />}Export JSONL</button>
        </div>
      </div>
    </Card>
  );
}

function MaintenanceCard({ demo }: { demo: boolean }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const reload = useMutation({
    mutationFn: () => api.post<{ documents_reingested: number; departments: number }>('/api/admin/mrpl/reload', {}),
    onSuccess: (r) => toast.success('MRPL public information reloaded', `${r.documents_reingested} briefing(s) re-indexed · ${r.departments} departments`),
    onError: (e) => toast.error('Reload failed', errMsg(e)),
  });
  const reset = useMutation({
    mutationFn: () => api.post<{ grants_revoked: number; requests_cleared: number }>('/api/admin/demo/reset', {}),
    onSuccess: (r) => { setConfirmReset(false); toast.success('Demonstration state reset', `${r.grants_revoked} grant(s) revoked · ${r.requests_cleared} request(s) cleared · findings reopened`); },
    onError: (e) => toast.error('Reset failed', errMsg(e)),
  });
  return (
    <Card title="Maintenance" icon={<Wrench size={14} className="text-amber" />}>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <div className="font-medium">MRPL public information</div>
          <div className="mt-1 text-[12px] text-muted">Re-index the public briefings and department list after the files in data\mrpl are updated.</div>
          <button className="btn btn-sm mt-2" disabled={reload.isPending} onClick={() => reload.mutate()}>
            {reload.isPending ? <Spinner size={12} /> : <RefreshCw size={12} />}Reload public data
          </button>
        </div>
        {demo && <div className="rounded-md border border-border p-3">
          <div className="font-medium">Reset demonstration state</div>
          <div className="mt-1 text-[12px] text-muted">Revokes all time-bound grants, clears access requests and reopens findings — for rehearsals and training sessions.</div>
          <button className="btn btn-sm btn-danger mt-2" onClick={() => setConfirmReset(true)}><RotateCcw size={12} />Reset…</button>
        </div>}
      </div>
      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} width={440} title="Reset demonstration state?" icon={<AlertTriangle size={15} className="text-danger" />}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
          <button className="btn btn-danger" disabled={reset.isPending} onClick={() => reset.mutate()}>{reset.isPending ? <Spinner size={12} /> : <RotateCcw size={12} />}Reset</button>
        </>}>
        <p className="text-[12.5px]">All active grants are revoked, all access requests are deleted and every finding returns to PENDING. Users, documents and the audit log are kept (the reset itself is audited).</p>
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
