import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Modal } from '../Modal';
import { Field } from '../ui';
import { api, errMsg } from '../../lib/api';
import { toast } from '../Toast';
import { cx } from '../../lib/format';
import type { AccessRequest } from '../../lib/types';

export function AccessRequestDialog({ open, onClose, departments, context }: {
  open: boolean; onClose: () => void; departments: string[]; context?: string;
}) {
  const [dept, setDept] = useState(departments[0] ?? '');
  const [just, setJust] = useState('');
  const [hours, setHours] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) {
      setDept(departments[0] ?? '');
      setJust(context ? `Needed to answer: "${context.slice(0, 160)}"` : '');
      setHours(2);
      setErr('');
    }
  }, [open, departments, context]);

  const submit = async () => {
    if (!dept || just.trim().length < 5) { setErr('Pick a department and give a short justification.'); return; }
    setBusy(true); setErr('');
    try {
      await api.post<AccessRequest>('/api/access-requests', { department: dept, justification: just.trim(), hours });
      toast.success('Access request sent', `${dept} · ${hours}h — you will be notified when an approver decides.`);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Request time-bound access" icon={<KeyRound size={15} className="text-amber" />}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Send request'}</button>
      </>}>
      <div className="space-y-3">
        <p className="text-[12px] text-muted">An approver for the owning department reviews this request. Grants expire automatically and every use is audited.</p>
        <Field label="Department">
          {departments.length > 0 ? (
            <select className="input" value={dept} onChange={(e) => setDept(e.target.value)}>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          ) : (
            <input className="input" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="e.g. Maintenance" />
          )}
        </Field>
        <Field label="Justification">
          <textarea className="input min-h-[80px]" value={just} onChange={(e) => setJust(e.target.value)} placeholder="Why do you need these documents?" />
        </Field>
        <Field label="Duration">
          <div className="flex gap-2">
            {[1, 2, 8].map((h) => (
              <button key={h} type="button" onClick={() => setHours(h)}
                className={cx('btn btn-sm font-mono', hours === h && '!border-amber !text-amber !bg-amber/10')}>{h}h</button>
            ))}
          </div>
        </Field>
        {err && <div className="text-[12px] text-red-300">{err}</div>}
      </div>
    </Modal>
  );
}
