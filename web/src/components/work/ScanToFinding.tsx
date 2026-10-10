import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ScanSearch } from 'lucide-react';
import { api, errMsg } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { isFinal, useTask, type TaskOut } from '../../lib/work';
import { Modal } from '../Modal';
import { ErrorBox, Spinner, StatusChip } from '../ui';
import { toast } from '../Toast';
import { ScanResultView, TaskFiles, TaskSteps, WorkerBadge } from './TaskParts';

/** "Extract findings from scan": OCR + vision model, verification against the asset master, human review, finding. */
export function ScanToFindingButton({ documentId }: { documentId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const task = useTask(taskId);
  const start = useMutation({
    mutationFn: () => api.post<TaskOut>(`/api/documents/${encodeURIComponent(documentId)}/scan-findings`),
    onSuccess: (r) => { qc.setQueryData(['task', r.id], r); setTaskId(r.id); setOpen(true); },
    onError: (e) => toast.error(t('wb.scan.failed'), errMsg(e)),
  });
  const d = task.data;
  const busy = start.isPending || (!!d && !isFinal(d.status));
  return (
    <>
      <button className="btn btn-sm" disabled={busy} onClick={() => (d ? setOpen(true) : start.mutate())} title={t('wb.scan.tip')}>
        {busy ? <Spinner size={12} /> : <ScanSearch size={13} />}{t('wb.scan.button')}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} width={760} icon={<ScanSearch size={14} className="text-amber" />}
        title={<span className="flex items-center gap-2">{t('wb.scan.title')} {d && <StatusChip status={d.status} />}</span>}
        footer={<>
          {d && isFinal(d.status) && <button className="btn btn-ghost" onClick={() => { setTaskId(null); start.mutate(); }}>{t('wb.scan.again')}</button>}
          <button className="btn" onClick={() => setOpen(false)}>{t('btn.close')}</button>
        </>}>
        {!d ? <Spinner /> : (
          <div className="space-y-3">
            <div className="flex items-center gap-2"><WorkerBadge worker={d.worker} label={d.worker_label} /></div>
            <TaskSteps steps={d.steps} />
            {d.error && <ErrorBox error={new Error(d.error)} />}
            {d.status === 'waiting_review' && <div className="rounded-md border border-amber/40 bg-amber/10 px-3 py-2 text-[12px] text-amber">{t('wb.scan.waiting')}</div>}
            {isFinal(d.status) && d.result && <ScanResultView r={d.result} />}
            <TaskFiles files={d.files} />
          </div>
        )}
      </Modal>
    </>
  );
}
