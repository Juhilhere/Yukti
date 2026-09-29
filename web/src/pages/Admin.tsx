import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileCode2, Search, ShieldCheck, Users } from 'lucide-react';
import { api } from '../lib/api';
import type { AdminUser, PolicyDoc } from '../lib/types';
import { Badge, Card, EmptyState, PageHeader, QueryState } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { CopyButton } from '../components/pages2/CopyButton';

const s = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',').map((x) => x.trim()) : []);

function yamlLineClass(l: string) {
  const t = l.trimStart();
  if (t.startsWith('#')) return 'text-faint';
  if (/^-\s/.test(t)) return 'text-text/85';
  if (/^[\w.-]+:/.test(t)) return 'text-cyan';
  return 'text-text/85';
}

export default function Admin() {
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.get<AdminUser[]>('/api/admin/users') });
  const pol = useQuery({ queryKey: ['admin', 'policies'], queryFn: () => api.get<PolicyDoc>('/api/admin/policies') });
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const f = q.trim().toLowerCase();
    const list = users.data ?? [];
    return f ? list.filter((u) => JSON.stringify(u).toLowerCase().includes(f)) : list;
  }, [users.data, q]);

  const cols: Column<AdminUser>[] = [
    { key: 'username', header: 'User', render: (u) => (
      <div><div className="font-medium">{s(u.display_name ?? u.username)}</div><div className="font-mono text-[11px] text-faint">{u.username}</div></div>
    ) },
    { key: 'post', header: 'Post', render: (u) => s(u.post) },
    { key: 'department', header: 'Dept', render: (u) => <Badge tone="muted">{s(u.department)}</Badge> },
    { key: 'clearance', header: 'Clearance', sortValue: (u) => Number(u.clearance ?? 0), render: (u) => (
      <span className="inline-flex items-center gap-1.5"><span className="font-mono">L{s(u.clearance)}</span>
        {u.clearance_label ? <Badge tone={Number(u.clearance) >= 3 ? 'danger' : Number(u.clearance) >= 2 ? 'amber' : 'cyan'}>{String(u.clearance_label)}</Badge> : null}</span>
    ) },
    { key: 'roles', header: 'Roles', render: (u) => <div className="flex flex-wrap gap-1">{arr(u.roles).map((r) => <Badge key={r} tone="amber" mono>{r}</Badge>)}{arr(u.roles).length === 0 && '—'}</div> },
    { key: 'asset_scopes', header: 'Asset scopes', render: (u) => <div className="flex flex-wrap gap-1">{arr(u.asset_scopes).map((r) => <Badge key={r} tone="cyan" mono>{r}</Badge>)}{arr(u.asset_scopes).length === 0 && '—'}</div> },
    { key: 'status', header: 'Status', render: (u) => (u.locked ? <Badge tone="danger">locked</Badge> : u.active === false ? <Badge tone="muted">inactive</Badge> : <Badge tone="ok">active</Badge>) },
  ];

  const lines = (pol.data?.yaml ?? '').split('\n');

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Administration" icon={<ShieldCheck size={18} />} subtitle="Users, attributes and the ABAC policy in force" />
      <div className="space-y-4 p-5">
        <Card title={<span>Users <span className="font-mono text-muted">{users.data?.length ?? ''}</span></span>} icon={<Users size={14} className="text-cyan" />} bodyClass="p-0"
          actions={<div className="relative"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input !w-56 !py-0.5 !pl-6 text-[12px]" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
          <QueryState q={users} empty={(users.data ?? []).length === 0} emptyTitle="No users">
            <DataTable rows={rows} columns={cols} rowKey={(u) => String(u.id ?? u.username)} empty={<EmptyState title="No users match" />} />
          </QueryState>
        </Card>
        <Card title="Policy" icon={<FileCode2 size={14} className="text-amber" />} bodyClass="p-0"
          actions={pol.data && <><Badge mono tone="amber">v{pol.data.version}</Badge><CopyButton text={pol.data.yaml} /></>}>
          <QueryState q={pol} empty={!pol.data?.yaml} emptyTitle="No policy loaded">
            <div className="max-h-[560px] overflow-auto bg-bg py-2 font-mono text-[12px] leading-[1.6]">
              {lines.map((l, i) => (
                <div key={i} className="flex">
                  <span className="w-12 shrink-0 select-none pr-3 text-right text-faint">{i + 1}</span>
                  <span className={`whitespace-pre ${yamlLineClass(l)}`}>{l || ' '}</span>
                </div>
              ))}
            </div>
          </QueryState>
        </Card>
      </div>
    </div>
  );
}
