import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ArrowUpRight, Check, Clock, FileText, Inbox as InboxIcon, KeyRound, ShieldCheck, X, Eye } from 'lucide-react';
import { api } from '../lib/api';
import type { AccessRequest, Finding, Grant } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, QueryState, Spinner, StatusChip, Tabs, toneFor } from '../components/ui';
import { toast } from '../components/Toast';
import { countdown, cx, fmtDate, fmtTime, timeAgo } from '../lib/format';

type Tab = 'findings' | 'requests' | 'grants';
type FindingAction = 'acknowledge' | 'approve' | 'reject' | 'escalate';

export default function Inbox() {
  const [tab, setTab] = useState<Tab>('findings');
  const findings = useQuery({ queryKey: ['findings'], queryFn: () => api.get<Finding[]>('/api/findings') });
  const ars = useQuery({ queryKey: ['access-requests'], queryFn: () => api.get<{ mine: AccessRequest[]; to_approve: AccessRequest[] }>('/api/access-requests') });
  const grants = useQuery({ queryKey: ['grants'], queryFn: () => api.get<Grant[]>('/api/grants') });

  const openFindings = (findings.data ?? []).filter((f) => !['approved', 'rejected', 'closed'].includes((f.state || '').toLowerCase())).length;
  const pendingAr = (ars.data?.to_approve ?? []).filter((a) => (a.state || '').toLowerCase() === 'pending').length;
  const activeGrants = (grants.data ?? []).filter((g) => new Date(g.expires_at).getTime() > Date.now()).length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={<InboxIcon size={18} />} title="Inbox" subtitle="Approvals, findings and time-bound access — human-in-the-loop decisions, all audited" />
      <Tabs className="px-4" value={tab} onChange={setTab} tabs={[
        { id: 'findings', label: 'Approvals & Findings', count: openFindings },
        { id: 'requests', label: 'Access requests', count: pendingAr },
        { id: 'grants', label: 'My grants', count: activeGrants },
      ]} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'findings' && <FindingsTab q={findings} />}
        {tab === 'requests' && <RequestsTab q={ars} />}
        {tab === 'grants' && <GrantsTab q={grants} />}
      </div>
    </div>
  );
}

function FindingsTab({ q }: { q: UseQueryResult<Finding[]> }) {
  const rows = q.data ?? [];
  return (
    <QueryState q={q} empty={rows.length === 0} emptyTitle="No findings awaiting action" emptyHint="Inspection findings and approvals routed to you will appear here.">
      <div className="grid gap-3 xl:grid-cols-2">
        {rows.map((f) => <FindingCard key={f.id} f={f} />)}
      </div>
    </QueryState>
  );
}

function FindingCard({ f }: { f: Finding }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const act = useMutation({
    mutationFn: (action: FindingAction) => api.post<Finding>(`/api/findings/${encodeURIComponent(f.id)}/action`, { action, note: note || undefined }),
    onSuccess: (r, action) => {
      toast.success(`Finding ${action === 'acknowledge' ? 'acknowledged' : action === 'escalate' ? 'escalated' : action + 'd'}`, r?.title || f.title);
      setNote(''); setShowNote(false);
      qc.invalidateQueries({ queryKey: ['findings'] });
    },
    onError: (e) => toast.error('Action failed', (e as Error).message),
  });
  const state = (f.state || '').toLowerCase();
  const closed = ['approved', 'rejected', 'closed'].includes(state);
  const overdue = f.due_date && new Date(f.due_date).getTime() < Date.now() && !closed;
  const sevTone = toneFor(f.severity);
  return (
    <div className={cx('rounded-md border bg-surface p-3', sevTone === 'danger' ? 'border-danger/40' : 'border-border')}>
      <div className="flex items-start gap-2">
        <div className={cx('mt-1 h-8 w-1 shrink-0 rounded-full', sevTone === 'danger' ? 'bg-danger' : sevTone === 'amber' ? 'bg-amber' : 'bg-cyan')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge mono tone="cyan">{f.tag || '—'}</Badge>
            <StatusChip status={f.severity} />
            <StatusChip status={f.state} />
            {f.discipline && <Badge tone="muted">{f.discipline}</Badge>}
            <span className="ml-auto font-mono text-[10.5px] text-faint">{f.id}</span>
          </div>
          <div className="mt-1.5 font-medium">{f.title}</div>
          {f.evidence && <div className="mt-1 line-clamp-3 text-[12px] text-muted">{f.evidence}</div>}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px] text-muted">
            <span className={cx('flex items-center gap-1', overdue && 'text-danger')}><Clock size={11} /> Due {fmtDate(f.due_date)}{overdue && ' (overdue)'}</span>
            {f.approver_name && <span className="flex items-center gap-1"><ShieldCheck size={11} /> {f.approver_name}</span>}
            {f.source_document_id && (
              <Link to={`/knowledge/${f.source_document_id}${f.page ? `?page=${f.page}` : ''}`} className="flex items-center gap-1 text-cyan hover:underline">
                <FileText size={11} /> Evidence{f.page ? ` p.${f.page}` : ''}
              </Link>
            )}
            <span className="text-faint">{timeAgo(f.created_at)}</span>
          </div>
          {!closed && (
            <div className="mt-2.5 space-y-2">
              {showNote && <textarea className="input min-h-[48px] text-[12px]" placeholder="Note (optional, recorded in audit log)" value={note} onChange={(e) => setNote(e.target.value)} />}
              <div className="flex flex-wrap items-center gap-1.5">
                <button className="btn btn-sm" disabled={act.isPending} onClick={() => act.mutate('acknowledge')}><Eye size={12} /> Acknowledge</button>
                <button className="btn btn-sm btn-cyan" disabled={act.isPending} onClick={() => act.mutate('approve')}><Check size={12} /> Approve</button>
                <button className="btn btn-sm btn-danger" disabled={act.isPending} onClick={() => act.mutate('reject')}><X size={12} /> Reject</button>
                <button className="btn btn-sm" disabled={act.isPending} onClick={() => act.mutate('escalate')}><ArrowUpRight size={12} className="text-amber" /> Escalate</button>
                <button className="btn btn-sm btn-ghost text-muted" onClick={() => setShowNote((s) => !s)}>{showNote ? 'Hide note' : 'Add note'}</button>
                {act.isPending && <Spinner />}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const HOURS = [1, 2, 8, 24];

function RequestsTab({ q }: { q: UseQueryResult<{ mine: AccessRequest[]; to_approve: AccessRequest[] }> }) {
  const { can } = useAuth();
  const toApprove = q.data?.to_approve ?? [];
  const mine = q.data?.mine ?? [];
  return (
    <QueryState q={q}>
      <div className="space-y-4">
        {(can('access.approve') || toApprove.length > 0) && (
          <Card title={<>To approve <span className="font-mono text-[11px] text-muted">({toApprove.length})</span></>} icon={<ShieldCheck size={14} className="text-amber" />} bodyClass="p-0">
            {toApprove.length === 0 ? <EmptyState title="No pending requests" /> : (
              <div className="divide-y divide-border">
                {toApprove.map((a) => <ApproveRow key={a.id} a={a} />)}
              </div>
            )}
          </Card>
        )}
        <Card title={<>My requests <span className="font-mono text-[11px] text-muted">({mine.length})</span></>} icon={<KeyRound size={14} className="text-cyan" />} bodyClass="p-0">
          {mine.length === 0 ? <EmptyState title="You haven't requested access" hint="When a chat answer withholds sources by policy, use “Request access” to ask for a time-bound grant." /> : (
            <div className="divide-y divide-border">
              {mine.map((a) => (
                <div key={a.id} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{a.resource_label || a.department}</span>
                      <Badge tone="muted">{a.department}</Badge>
                      <Badge mono>{a.hours}h</Badge>
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">{a.justification}</div>
                    <div className="mt-1 text-[11px] text-faint">Requested {fmtTime(a.created_at)}{a.decided_at && ` · decided ${fmtTime(a.decided_at)}`}{a.approver_name && ` by ${a.approver_name}`}</div>
                  </div>
                  <StatusChip status={a.state} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </QueryState>
  );
}

function ApproveRow({ a }: { a: AccessRequest }) {
  const qc = useQueryClient();
  const [hours, setHours] = useState<number>(HOURS.includes(a.hours) ? a.hours : 2);
  const [note, setNote] = useState('');
  const pending = (a.state || '').toLowerCase() === 'pending';
  const done = () => { qc.invalidateQueries({ queryKey: ['access-requests'] }); qc.invalidateQueries({ queryKey: ['grants'] }); };
  const approve = useMutation({
    mutationFn: () => api.post<AccessRequest>(`/api/access-requests/${encodeURIComponent(a.id)}/approve`, { hours }),
    onSuccess: () => { toast.success('Access granted', `${a.requester_name} · ${a.department} · ${hours}h`); done(); },
    onError: (e) => toast.error('Approve failed', (e as Error).message),
  });
  const reject = useMutation({
    mutationFn: () => api.post<AccessRequest>(`/api/access-requests/${encodeURIComponent(a.id)}/reject`, { note }),
    onSuccess: () => { toast('Request rejected', { body: a.requester_name }); done(); },
    onError: (e) => toast.error('Reject failed', (e as Error).message),
  });
  return (
    <div className="flex flex-wrap items-start gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{a.requester_name || a.requester}</span>
          <span className="text-muted">→</span>
          <span>{a.resource_label || a.department}</span>
          <Badge tone="muted">{a.department}</Badge>
          <Badge mono>asked {a.hours}h</Badge>
        </div>
        <div className="mt-0.5 text-[12px] text-muted">“{a.justification}”</div>
        <div className="mt-1 text-[11px] text-faint">{fmtTime(a.created_at)}</div>
      </div>
      {pending ? (
        <div className="flex items-center gap-1.5">
          <select className="input !w-auto !py-0.5 font-mono text-[12px]" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {HOURS.map((h) => <option key={h} value={h}>{h} h</option>)}
          </select>
          <button className="btn btn-sm btn-cyan" disabled={approve.isPending || reject.isPending} onClick={() => approve.mutate()}>
            {approve.isPending ? <Spinner size={12} /> : <Check size={12} />} Approve
          </button>
          <input className="input !w-[140px] !py-0.5 text-[12px]" placeholder="Reject note" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-sm btn-danger" disabled={approve.isPending || reject.isPending} onClick={() => reject.mutate()}>
            {reject.isPending ? <Spinner size={12} /> : <X size={12} />} Reject
          </button>
        </div>
      ) : <StatusChip status={a.state} />}
    </div>
  );
}

function GrantsTab({ q }: { q: UseQueryResult<Grant[]> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const rows = [...(q.data ?? [])].sort((a, b) => new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime());
  return (
    <QueryState q={q} empty={rows.length === 0} emptyTitle="No active grants" emptyHint="Grants are time-bound and expire automatically — access reverts to your baseline attributes.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((g) => {
          const ms = new Date(g.expires_at).getTime() - now;
          const expired = !(ms > 0);
          const tone = expired ? 'text-faint' : ms < 15 * 60_000 ? 'text-amber' : 'text-ok';
          return (
            <div key={g.id} className={cx('rounded-md border bg-surface p-3', expired ? 'border-border opacity-60' : 'border-ok/30')}>
              <div className="flex items-center gap-2">
                <KeyRound size={14} className={expired ? 'text-faint' : 'text-cyan'} />
                <span className="font-mono text-[12px] font-medium break-all">{g.scope}</span>
                {expired && <StatusChip status="expired" className="ml-auto" />}
              </div>
              <div className={cx('mt-2 font-mono text-[26px] font-semibold tabular-nums', tone)}>{countdown(g.expires_at, now)}</div>
              <div className="mt-1 text-[11.5px] text-muted">Expires {fmtTime(g.expires_at)}{g.approved_by && ` · approved by ${g.approved_by}`}</div>
            </div>
          );
        })}
      </div>
      {q.error ? <ErrorBox error={q.error} /> : null}
    </QueryState>
  );
}
