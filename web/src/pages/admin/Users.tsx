import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban, CheckCircle2, FileSpreadsheet, FileUp, KeyRound, Lock, LogOut, MoreHorizontal, Pencil, Search, ShieldCheck, Unlock, UserPlus, Users,
} from 'lucide-react';
import { api, errMsg } from '../../lib/api';
import type { AdminUser, ImportResult, Role } from '../../lib/types';
import { useDepartments } from '../../lib/queries';
import { useAuth } from '../../lib/auth';
import { fmtTime, roleLabel, timeAgo } from '../../lib/format';
import { Badge, Card, EmptyState, ErrorBox, Field, MenuItem, Popover, QueryState, Spinner, StatusChip } from '../../components/ui';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { toast } from '../../components/Toast';
import { CopyButton } from '../../components/pages2/CopyButton';

const isLocked = (u: AdminUser) => !!u.locked_until && new Date(u.locked_until).getTime() > Date.now();

type FormState = {
  username: string; display_name: string; post: string; department: string; clearance: number; roles: string[]; asset_scopes: string[];
};
const EMPTY: FormState = { username: '', display_name: '', post: '', department: '', clearance: 0, roles: [], asset_scopes: [] };

function TagsInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setText('');
  };
  return (
    <div className="flex min-h-[32px] flex-wrap items-center gap-1 rounded-md border border-border bg-bg px-1.5 py-1 focus-within:border-cyan">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded bg-cyan/10 px-1.5 font-mono text-[11.5px] text-cyan">
          {t}<button type="button" className="text-cyan/70 hover:text-text" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>×</button>
        </span>
      ))}
      <input className="min-w-[120px] flex-1 bg-transparent px-1 text-[12.5px] outline-none placeholder:text-faint" value={text} placeholder={placeholder}
        onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() && add(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); }
          else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }} />
    </div>
  );
}

function UserDialog({ user, roles, clearanceLabels, onClose }: {
  user: AdminUser | null; roles: Role[]; clearanceLabels: Record<number, string>; onClose: () => void;
}) {
  const qc = useQueryClient();
  const deps = useDepartments();
  const creating = !user;
  const [f, setF] = useState<FormState>(() => user ? {
    username: user.username, display_name: user.display_name ?? '', post: user.post ?? '', department: user.department ?? '',
    clearance: user.clearance ?? 0, roles: [...(user.roles ?? [])], asset_scopes: [...(user.asset_scopes ?? [])],
  } : EMPTY);
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const body = { display_name: f.display_name.trim(), post: f.post.trim(), department: f.department, clearance: f.clearance, roles: f.roles, asset_scopes: f.asset_scopes };
      if (creating) return api.post<{ user: AdminUser; temp_password: string }>('/api/admin/users', { username: f.username.trim(), ...body });
      return api.patch<AdminUser>(`/api/admin/users/${encodeURIComponent(user!.id)}`, body);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      if (creating) {
        const rr = r as { user: AdminUser; temp_password: string };
        toast.success('User created', rr.user?.username ?? f.username);
        setTemp({ username: rr.user?.username ?? f.username, password: rr.temp_password });
      } else {
        toast.success('User updated', f.username);
        onClose();
      }
    },
  });

  if (temp) return <TempPasswordDialog username={temp.username} password={temp.password} onClose={onClose} />;

  const depList = deps.data ?? [];
  const valid = (!creating || /^[a-zA-Z0-9._-]{3,}$/.test(f.username.trim())) && f.display_name.trim() && f.department;
  return (
    <Modal open onClose={onClose} width={620} title={creating ? 'Create user' : `Edit ${user!.username}`} icon={creating ? <UserPlus size={15} className="text-amber" /> : <Pencil size={15} className="text-amber" />}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Spinner className="!text-[#1a1204]" /> : creating ? <UserPlus size={13} /> : <CheckCircle2 size={13} />}{creating ? 'Create user' : 'Save changes'}
        </button>
      </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username" hint={creating ? 'Letters, digits, . _ - (min 3)' : 'Cannot be changed'}>
            <input className="input font-mono" autoFocus={creating} disabled={!creating} value={f.username} onChange={(e) => set('username', e.target.value)} />
          </Field>
          <Field label="Display name"><input className="input" autoFocus={!creating} value={f.display_name} onChange={(e) => set('display_name', e.target.value)} /></Field>
          <Field label="Post / designation"><input className="input" value={f.post} onChange={(e) => set('post', e.target.value)} /></Field>
          <Field label="Department">
            <select className="input" value={f.department} onChange={(e) => set('department', e.target.value)} disabled={deps.isLoading}>
              <option value="">{deps.isLoading ? 'Loading…' : '— Select department —'}</option>
              {f.department && !depList.some((d) => d.name === f.department) && <option value={f.department}>{f.department}</option>}
              {depList.map((d) => <option key={d.code || d.name} value={d.name}>{d.name}{d.code ? ` (${d.code})` : ''}</option>)}
            </select>
            {deps.error ? <div className="mt-1 text-[11px] text-danger">Could not load departments: {errMsg(deps.error)}</div> : null}
          </Field>
        </div>
        <Field label="Clearance level">
          <div className="flex flex-wrap gap-1.5">
            {[0, 1, 2, 3, 4].map((c) => (
              <button key={c} type="button" onClick={() => set('clearance', c)}
                className={`rounded-md border px-2.5 py-1 font-mono text-[12px] ${f.clearance === c ? 'border-amber bg-amber/10 text-amber' : 'border-border text-muted hover:text-text'}`}>
                L{c}{clearanceLabels[c] ? ` · ${clearanceLabels[c]}` : ''}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Roles">
          {roles.length === 0 ? <div className="text-[12px] text-faint">No roles available</div> : (
            <div className="max-h-[200px] divide-y divide-border overflow-y-auto rounded-md border border-border">
              {roles.map((r) => {
                const on = f.roles.includes(r.role);
                return (
                  <label key={r.role} className="flex cursor-pointer items-start gap-2 px-2.5 py-1.5 hover:bg-surface-2">
                    <input type="checkbox" className="mt-0.5 accent-amber" checked={on}
                      onChange={() => set('roles', on ? f.roles.filter((x) => x !== r.role) : [...f.roles, r.role])} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px]"><span className="font-medium">{roleLabel(r.role)}</span>{roleLabel(r.role) !== r.role && <span className="ml-1.5 font-mono text-[11px] text-faint">{r.role}</span>}</div>
                      {r.description && <div className="text-[11.5px] text-muted">{r.description}</div>}
                      {r.permissions?.length > 0 && <div className="mt-0.5 truncate font-mono text-[10.5px] text-faint" title={r.permissions.join(', ')}>{r.permissions.join(', ')}</div>}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </Field>
        <Field label="Asset scopes" hint="Units / areas this user may see assets for. Press Enter or comma to add.">
          <TagsInput value={f.asset_scopes} onChange={(v) => set('asset_scopes', v)} placeholder="e.g. CDU-1" />
        </Field>
        {save.error ? <ErrorBox error={save.error} /> : null}
      </div>
    </Modal>
  );
}

function TempPasswordDialog({ username, password, onClose }: { username: string; password: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} width={440} title="Temporary password" icon={<KeyRound size={15} className="text-amber" />}
      footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div className="space-y-3">
        <div className="text-[12.5px] text-muted">Give this password to <span className="font-mono text-text">{username}</span> through a secure channel. It is shown <b className="text-amber">only once</b>; the user must change it at first sign-in.</div>
        <div className="flex items-center gap-2 rounded-md border border-amber/40 bg-amber/5 px-3 py-2">
          <code className="flex-1 break-all font-mono text-[16px] text-amber">{password}</code>
          <CopyButton text={password} label="Copy" />
        </div>
      </div>
    </Modal>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const imp = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append('file', file as File); return api.upload<ImportResult>('/api/admin/users/import', fd); },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success('Import finished', `${r.created?.length ?? 0} created · ${r.errors?.length ?? 0} errors`);
    },
  });
  const r = imp.data;
  const allCreds = (r?.created ?? []).map((c) => `${c.username},${c.temp_password}`).join('\n');
  return (
    <Modal open onClose={onClose} width={640} title="Import users from CSV" icon={<FileSpreadsheet size={15} className="text-amber" />}
      footer={r ? <button className="btn btn-primary" onClick={onClose}>Done</button> : <>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!file || imp.isPending} onClick={() => imp.mutate()}>
          {imp.isPending ? <Spinner className="!text-[#1a1204]" /> : <FileUp size={13} />}Import
        </button>
      </>}>
      {!r ? (
        <div className="space-y-3">
          <div className="text-[12.5px] text-muted">
            Columns: <code className="font-mono text-text">username, display_name, post, department, clearance, roles, asset_scopes</code> — separate multiple roles / scopes with <code className="font-mono">;</code>.
          </div>
          <a className="btn btn-sm btn-cyan" href="/api/admin/users/template.csv" download><FileSpreadsheet size={12} />Download template</a>
          <div onClick={() => ref.current?.click()}
            className="flex cursor-pointer flex-col items-center gap-1 rounded-md border-2 border-dashed border-border px-4 py-6 text-center hover:border-border-strong">
            <FileUp size={22} className={file ? 'text-cyan' : 'text-faint'} />
            <div className="font-medium">{file ? file.name : 'Choose a CSV file'}</div>
            <input ref={ref} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          {imp.error ? <ErrorBox error={imp.error} /> : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2"><Badge tone="ok" mono>{r.created?.length ?? 0} created</Badge><Badge tone={r.errors?.length ? 'danger' : 'muted'} mono>{r.errors?.length ?? 0} errors</Badge></div>
          {(r.created ?? []).length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="label">Temporary passwords (shown once)</span>
                <CopyButton text={allCreds} label="Copy all" />
              </div>
              <div className="max-h-[220px] overflow-y-auto rounded-md border border-border">
                {r.created.map((c) => (
                  <div key={c.username} className="flex items-center gap-2 border-b border-border/60 px-3 py-1 last:border-0">
                    <span className="flex-1 font-mono text-[12px]">{c.username}</span>
                    <code className="font-mono text-[12px] text-amber">{c.temp_password}</code>
                    <CopyButton text={c.temp_password} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {(r.errors ?? []).length > 0 && (
            <div>
              <div className="label mb-1">Errors</div>
              <div className="max-h-[180px] overflow-y-auto rounded-md border border-danger/40">
                {r.errors.map((e, i) => (
                  <div key={i} className="flex gap-2 border-b border-border/60 px-3 py-1 text-[12px] last:border-0">
                    <span className="font-mono text-muted">row {e.row}</span><span className="text-red-300">{e.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function RowActions({ u, onEdit, onTemp }: { u: AdminUser; onEdit: () => void; onTemp: (pw: string) => void }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const self = me?.user.id === u.id || me?.user.username === u.username;
  const done = (msg: string) => { toast.success(msg, u.username); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); };
  const fail = (e: unknown) => toast.error('Action failed', errMsg(e));
  const status = useMutation({
    mutationFn: (st: 'active' | 'disabled') => api.patch<AdminUser>(`/api/admin/users/${encodeURIComponent(u.id)}`, { status: st }),
    onSuccess: (_r, st) => done(st === 'disabled' ? 'User disabled' : 'User enabled'), onError: fail,
  });
  const reset = useMutation({
    mutationFn: () => api.post<{ temp_password: string }>(`/api/admin/users/${encodeURIComponent(u.id)}/reset-password`, {}),
    onSuccess: (r) => { done('Password reset'); onTemp(r.temp_password); }, onError: fail,
  });
  const unlock = useMutation({
    mutationFn: () => api.post(`/api/admin/users/${encodeURIComponent(u.id)}/unlock`, {}),
    onSuccess: () => done('Account unlocked'), onError: fail,
  });
  const revoke = useMutation({
    mutationFn: () => api.post<{ revoked: number }>(`/api/admin/users/${encodeURIComponent(u.id)}/revoke-sessions`, {}),
    onSuccess: (r) => { toast.success('Sessions revoked', `${u.username} · ${r?.revoked ?? 0} session(s)`); }, onError: fail,
  });
  const busy = status.isPending || reset.isPending || unlock.isPending || revoke.isPending;
  const disabled = u.status === 'disabled';
  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <button className="btn btn-sm btn-ghost" onClick={onEdit}><Pencil size={12} />Edit</button>
      <Popover align="right" className="w-52"
        trigger={(_o, toggle) => <button className="btn btn-sm btn-ghost btn-icon" onClick={toggle} aria-label="More actions" disabled={busy}>{busy ? <Spinner size={12} /> : <MoreHorizontal size={14} />}</button>}>
        {(close) => (
          <div className="py-1">
            <MenuItem icon={<KeyRound size={13} />} onClick={() => { close(); reset.mutate(); }}>Reset password</MenuItem>
            {isLocked(u) && <MenuItem icon={<Unlock size={13} />} onClick={() => { close(); unlock.mutate(); }}>Unlock account</MenuItem>}
            <MenuItem icon={<LogOut size={13} />} onClick={() => { close(); revoke.mutate(); }}>Revoke sessions</MenuItem>
            {!self && (disabled
              ? <MenuItem icon={<CheckCircle2 size={13} />} onClick={() => { close(); status.mutate('active'); }}>Enable user</MenuItem>
              : <MenuItem danger icon={<Ban size={13} />} onClick={() => { close(); status.mutate('disabled'); }}>Disable user</MenuItem>)}
          </div>
        )}
      </Popover>
    </div>
  );
}

export default function AdminUsers() {
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.get<AdminUser[]>('/api/admin/users') });
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => api.get<Role[]>('/api/admin/roles'), staleTime: 60_000 });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<AdminUser | null | 'new'>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);

  const rows = useMemo(() => {
    const f = q.trim().toLowerCase();
    const list = users.data ?? [];
    return f ? list.filter((u) => `${u.username} ${u.display_name} ${u.post} ${u.department} ${(u.roles ?? []).join(' ')}`.toLowerCase().includes(f)) : list;
  }, [users.data, q]);
  const clearanceLabels = useMemo(() => {
    const m: Record<number, string> = {};
    (users.data ?? []).forEach((u) => { if (u.clearance_label && m[u.clearance] === undefined) m[u.clearance] = u.clearance_label; });
    return m;
  }, [users.data]);

  const cols: Column<AdminUser>[] = [
    { key: 'username', header: 'User', sortValue: (u) => u.username, render: (u) => (
      <div><div className="font-medium">{u.display_name || u.username}</div><div className="font-mono text-[11px] text-faint">{u.username}{u.post ? ` · ${u.post}` : ''}</div></div>
    ) },
    { key: 'status', header: 'Status', render: (u) => (
      <div className="flex flex-wrap gap-1">
        <StatusChip status={u.status} />
        {u.must_change_password && <Badge tone="amber" title="Must change password at next sign-in">temp pw</Badge>}
      </div>
    ) },
    { key: 'department', header: 'Dept', render: (u) => u.department || '—' },
    { key: 'clearance', header: 'Clearance', sortValue: (u) => u.clearance, render: (u) => <Badge mono tone={u.clearance >= 3 ? 'amber' : 'cyan'}>L{u.clearance}{u.clearance_label ? ` ${u.clearance_label}` : ''}</Badge> },
    { key: 'roles', header: 'Roles', sortValue: (u) => (u.roles ?? []).join(','), render: (u) => <div className="flex max-w-[200px] flex-wrap gap-1">{(u.roles ?? []).map((r) => <Badge key={r} tone="amber" mono title={r}>{roleLabel(r)}</Badge>)}{!(u.roles ?? []).length && '—'}</div> },
    { key: 'asset_scopes', header: 'Scopes', sortValue: (u) => (u.asset_scopes ?? []).join(','), render: (u) => <div className="flex max-w-[180px] flex-wrap gap-1">{(u.asset_scopes ?? []).map((r) => <Badge key={r} tone="cyan" mono>{r}</Badge>)}{!(u.asset_scopes ?? []).length && '—'}</div> },
    { key: 'mfa_enabled', header: 'MFA', sortValue: (u) => (u.mfa_enabled ? 1 : 0), render: (u) => (u.mfa_enabled ? <Badge tone="ok"><ShieldCheck size={10} />on</Badge> : <span className="text-faint">off</span>) },
    { key: 'last_login_at', header: 'Last login', sortValue: (u) => u.last_login_at ?? '', render: (u) => u.last_login_at ? <span title={fmtTime(u.last_login_at)} className="text-[12px]">{timeAgo(u.last_login_at)}</span> : <span className="text-faint">never</span> },
    { key: 'locked', header: 'Locked', sortValue: (u) => (isLocked(u) ? 1 : 0), render: (u) => isLocked(u) ? <Badge tone="danger" title={`until ${fmtTime(u.locked_until)}`}><Lock size={10} />until {fmtTime(u.locked_until)}</Badge> : <span className="text-faint">—</span> },
    { key: 'actions', header: '', render: (u) => <RowActions u={u} onEdit={() => setEditing(u)} onTemp={(pw) => setTemp({ username: u.username, password: pw })} /> },
  ];

  return (
    <div className="p-5">
      <Card title={<span>Users <span className="font-mono text-muted">{users.data?.length ?? ''}</span></span>} icon={<Users size={14} className="text-cyan" />} bodyClass="p-0"
        actions={<>
          <div className="relative"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input !w-56 !py-0.5 !pl-6 text-[12px]" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <button className="btn btn-sm" onClick={() => setImportOpen(true)}><FileSpreadsheet size={12} />Import CSV</button>
          <button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}><UserPlus size={12} />Create user</button>
        </>}>
        <QueryState q={users} empty={(users.data ?? []).length === 0} emptyTitle="No users">
          <DataTable rows={rows} columns={cols} rowKey={(u) => u.id || u.username} empty={<EmptyState title="No users match" />} />
        </QueryState>
      </Card>
      {roles.error ? <ErrorBox className="mt-3" error={roles.error} onRetry={() => roles.refetch()} /> : null}
      {editing && <UserDialog user={editing === 'new' ? null : editing} roles={roles.data ?? []} clearanceLabels={clearanceLabels} onClose={() => setEditing(null)} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      {temp && <TempPasswordDialog username={temp.username} password={temp.password} onClose={() => setTemp(null)} />}
    </div>
  );
}
