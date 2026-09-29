import { useEffect, useMemo, useState } from 'react';
import { Check, KeyRound, Search, ShieldAlert, UserCheck } from 'lucide-react';
import { Modal } from '../Modal';
import { Field, Spinner } from '../ui';
import { api, errMsg } from '../../lib/api';
import { toast } from '../Toast';
import { cx } from '../../lib/format';
import { useDepartments, type Department } from '../../lib/queries';
import type { AccessRequest } from '../../lib/types';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

function DeptRow({ d, selected, pinned, onPick }: { d: Department; selected: boolean; pinned?: boolean; onPick: (n: string) => void }) {
  return (
    <button type="button" onClick={() => onPick(d.name)}
      className={cx('flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] hover:bg-surface-3', selected && 'bg-cyan/10')}>
      <span className={cx('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border', selected ? 'border-cyan bg-cyan text-bg' : 'border-border-strong')}>
        {selected && <Check size={9} strokeWidth={4} />}
      </span>
      <span className={cx('min-w-0 flex-1 truncate', selected ? 'text-cyan' : pinned && 'text-amber')}>{d.name}</span>
      {d.code && <span className="shrink-0 font-mono text-[10.5px] text-faint">{d.code}</span>}
    </button>
  );
}

function DepartmentPicker({ value, onChange, all, withheld, loading }: {
  value: string; onChange: (name: string) => void; all: Department[]; withheld: Department[]; loading: boolean;
}) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const withheldNames = new Set(withheld.map((d) => norm(d.name)));
    const m = new Map<string, Department[]>();
    all.filter((d) => !withheldNames.has(norm(d.name))).forEach((d) => {
      const g = d.group?.trim() || 'Other';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(d);
    });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([g, ds]) => [g, [...ds].sort((a, b) => a.name.localeCompare(b.name))] as const);
  }, [all, withheld]);

  const s = norm(q);
  const match = (d: Department) => !s || [d.name, d.code, d.group, d.description, d.manager_name].some((x) => norm(x).includes(s));
  const pinned = withheld.filter(match);
  const shownGroups = groups.map(([g, ds]) => [g, ds.filter(match)] as const).filter(([, ds]) => ds.length > 0);
  const sel = norm(value);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-bg">
      <div className="flex items-center gap-2 border-b border-border px-2.5">
        <Search size={13} className="shrink-0 text-faint" />
        <input className="w-full bg-transparent py-1.5 text-[12.5px] outline-none placeholder:text-faint" value={q}
          onChange={(e) => setQ(e.target.value)} placeholder={`Search ${all.length ? `${all.length} ` : ''}departments, codes, approvers…`} />
        {loading && <Spinner size={12} />}
      </div>
      <div className="max-h-[220px] overflow-y-auto py-1">
        {pinned.length > 0 && (
          <div className="border-b border-border/60 pb-1">
            <div className="flex items-center gap-1.5 px-2.5 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-amber">
              <ShieldAlert size={11} /> Withheld in this answer
            </div>
            {pinned.map((d) => <DeptRow key={`w-${d.name}`} d={d} pinned selected={sel === norm(d.name)} onPick={onChange} />)}
          </div>
        )}
        {shownGroups.map(([g, ds]) => (
          <div key={g}>
            <div className="px-2.5 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
              {g} <span className="font-mono text-faint">{ds.length}</span>
            </div>
            {ds.map((d) => <DeptRow key={d.name} d={d} selected={sel === norm(d.name)} onPick={onChange} />)}
          </div>
        ))}
        {pinned.length === 0 && shownGroups.length === 0 && (
          <div className="px-3 py-4 text-center text-[12px] text-muted">{loading ? 'Loading departments…' : 'No department matches'}</div>
        )}
      </div>
    </div>
  );
}

export function AccessRequestDialog({ open, onClose, departments, context, suggest }: {
  open: boolean; onClose: () => void; departments: string[]; context?: string;
  /** department the question is about (Laya's route), used to preselect the right withheld department */
  suggest?: string;
}) {
  const deptQ = useDepartments();
  const all = useMemo(() => deptQ.data ?? [], [deptQ.data]);
  // Resolve withheld department labels (name or code) against the directory; unknown ones stay as plain entries.
  const withheld = useMemo<Department[]>(() => {
    const out: Department[] = [];
    const seen = new Set<string>();
    (departments ?? []).forEach((raw) => {
      const k = norm(raw);
      if (!k) return;
      const hit = all.find((d) => norm(d.name) === k || norm(d.code) === k);
      const d: Department = hit ?? { code: '', name: String(raw).trim(), group: '', description: '', manager_name: null };
      if (seen.has(norm(d.name))) return;
      seen.add(norm(d.name));
      out.push(d);
    });
    return out;
  }, [departments, all]);

  const [dept, setDept] = useState('');
  const [just, setJust] = useState('');
  const [hours, setHours] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // preselect only when it is clear which department holds what the user needs; otherwise make them choose
  const pickDefault = () => {
    const s = norm(suggest);
    const bySuggest = s ? withheld.find((d) => norm(d.name).includes(s) || s.includes(norm(d.name)) || norm(d.code) === s) : undefined;
    return bySuggest?.name ?? (withheld.length === 1 ? withheld[0].name : '');
  };
  useEffect(() => {
    if (open) {
      setDept(pickDefault());
      setJust(context ? `Needed to answer: "${context.slice(0, 160)}"` : '');
      setHours(2);
      setErr('');
    }
  }, [open, context]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the directory resolves after opening, upgrade the preselected label (e.g. a code) to its canonical name.
  useEffect(() => {
    if (!open) return;
    if (!dept) { const d = pickDefault(); if (d) { setDept(d); return; } }
    const hit = all.find((d) => norm(d.code) === norm(dept) && norm(d.name) !== norm(dept));
    if (hit) setDept(hit.name);
  }, [open, all, withheld]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = all.find((d) => norm(d.name) === norm(dept)) ?? withheld.find((d) => norm(d.name) === norm(dept));
  const usePicker = deptQ.isLoading || all.length > 0 || withheld.length > 0;

  const submit = async () => {
    const name = dept.trim();
    if (!name || just.trim().length < 5) { setErr('Pick a department and give a short justification.'); return; }
    setBusy(true); setErr('');
    try {
      await api.post<AccessRequest>('/api/access-requests', { department: name, justification: just.trim(), hours });
      toast.success('Access request sent', `${name} · ${hours}h — you will be notified when an approver decides.`);
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
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[12px] font-medium text-muted">
            <span>Department</span>
            {dept && <span className="truncate pl-2 text-[11.5px] text-cyan">{dept}</span>}
          </div>
          {usePicker ? (
            <DepartmentPicker value={dept} onChange={setDept} all={all} withheld={withheld} loading={deptQ.isLoading} />
          ) : (
            <input className="input" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="e.g. Maintenance" />
          )}
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <UserCheck size={12} className="shrink-0 text-faint" />
            <span>Approver:</span>
            <span className="truncate text-text">{selected?.manager_name || (dept ? 'Department head (per access policy)' : '—')}</span>
            {selected?.group && <span className="shrink-0 text-faint">· {selected.group}</span>}
          </div>
        </div>
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
