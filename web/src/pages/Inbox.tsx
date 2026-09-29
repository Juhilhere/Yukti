import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ArrowUpRight, Check, Clock, FileText, History, Inbox as InboxIcon, KeyRound, ShieldCheck, StickyNote, X, Eye } from 'lucide-react';
import { Modal } from '../components/Modal';
import { useT } from '../lib/i18n';
import { api, errMsg } from '../lib/api';
import type { AccessRequest, Finding, Grant } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, ProvenanceBadges, QueryState, Spinner, StatusChip, Tabs, toneFor } from '../components/ui';
import { toast } from '../components/Toast';
import { AccessRequestDialog } from '../components/chat/AccessRequestDialog';
import { countdown, cx, fmtDate, fmtTime, timeAgo } from '../lib/format';

type Tab = 'findings' | 'requests' | 'grants';
type FindingAction = 'acknowledge' | 'approve' | 'reject' | 'escalate' | 'note';

export default function Inbox() {
  // deep links from notifications: /inbox?tab=access (or requests / grants / findings)
  const [params] = useSearchParams();
  const want = params.get('tab');
  const initial: Tab = want === 'access' || want === 'requests' ? 'requests' : want === 'grants' ? 'grants' : 'findings';
  const [tab, setTab] = useState<Tab>(initial);
  useEffect(() => { setTab(initial); }, [want]); // eslint-disable-line react-hooks/exhaustive-deps
  const findings = useQuery({ queryKey: ['findings'], queryFn: () => api.get<Finding[]>('/api/findings') });
  const ars = useQuery({ queryKey: ['access-requests'], queryFn: () => api.get<{ mine: AccessRequest[]; to_approve: AccessRequest[] }>('/api/access-requests') });
  const grants = useQuery({ queryKey: ['grants'], queryFn: () => api.get<Grant[]>('/api/grants') });

  const t = useT();
  const openFindings = (findings.data ?? []).filter((f) => (f.allowed_actions ?? []).some((a) => a !== 'note')).length;
  const pendingAr = (ars.data?.to_approve ?? []).filter((a) => (a.state || '').toLowerCase() === 'pending').length;
  const activeGrants = (grants.data ?? []).filter((g) => new Date(g.expires_at).getTime() > Date.now()).length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={<InboxIcon size={18} />} title={t('page.inbox')} subtitle={t('page.inbox.sub')} />
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

const ACTION_META: Record<string, { key: string; icon: React.ReactNode; cls: string; done: string }> = {
  acknowledge: { key: 'btn.acknowledge', icon: <Eye size={12} />, cls: 'btn-sm', done: 'Finding acknowledged' },
  approve: { key: 'btn.approve', icon: <Check size={12} />, cls: 'btn-sm btn-cyan', done: 'Finding approved' },
  reject: { key: 'btn.reject', icon: <X size={12} />, cls: 'btn-sm btn-danger', done: 'Finding rejected' },
  escalate: { key: 'btn.escalate', icon: <ArrowUpRight size={12} className="text-amber" />, cls: 'btn-sm', done: 'Finding escalated' },
};

function FindingCard({ f }: { f: Finding }) {
  const qc = useQueryClient();
  const t = useT();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [showHist, setShowHist] = useState(false);
  const act = useMutation({
    mutationFn: ({ action, note: n }: { action: FindingAction; note?: string }) =>
      api.post<Finding>(`/api/findings/${encodeURIComponent(f.id)}/action`, n ? { action, note: n } : { action }),
    onSuccess: (r, v) => {
      const title = v.action === 'note' ? 'Note added' : ACTION_META[v.action]?.done ?? 'Done';
      toast.success(title, r?.state ? `${r.title || f.title} — now ${r.state}` : (r?.title || f.title));
      setNote(''); setNoteOpen(false);
      qc.invalidateQueries({ queryKey: ['findings'] });
    },
    onError: (e) => toast.error('Action failed', errMsg(e)),
  });
  const allowed = f.allowed_actions ?? [];
  const buttons = allowed.filter((a) => a in ACTION_META);
  const canNote = allowed.includes('note');
  const state = (f.state || '').toLowerCase();
  const closed = ['approved', 'rejected', 'closed'].includes(state);
  const overdue = f.due_date && new Date(f.due_date).getTime() < Date.now() && !closed;
  const sevTone = toneFor(f.severity);
  const hist = f.history ?? [];
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
            <ProvenanceBadges isExample={f.is_example} />
            {f.discipline_approver && <Badge tone="violet" title="You are the discipline approver for this finding">approver</Badge>}
            <span className="ml-auto font-mono text-[10.5px] text-faint">{f.id.slice(0, 8)}</span>
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
            {hist.length > 0 && <button className="flex items-center gap-1 hover:text-text" onClick={() => setShowHist((x) => !x)}><History size={11} />History ({hist.length})</button>}
            <span className="text-faint">{timeAgo(f.created_at)}</span>
          </div>
          {showHist && hist.length > 0 && (
            <ol className="mt-2 space-y-1 border-l border-border pl-3 text-[11.5px]">
              {hist.map((h, i) => (
                <li key={i}>
                  <span className="font-mono text-faint">{fmtTime(h.at)}</span> <span className="font-medium">{h.event}</span> <span className="text-muted">· {h.by}</span>
                  {h.note ? <span className="text-muted"> — {h.note}</span> : null}
                </li>
              ))}
            </ol>
          )}
          {(buttons.length > 0 || canNote) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {buttons.map((a) => {
                const m = ACTION_META[a];
                return <button key={a} className={cx('btn', m.cls)} disabled={act.isPending} onClick={() => act.mutate({ action: a as FindingAction })}>{m.icon} {t(m.key)}</button>;
              })}
              {canNote && <button className="btn btn-sm btn-ghost text-muted" disabled={act.isPending} onClick={() => { setNote(''); setNoteOpen(true); }}><StickyNote size={12} /> {t('btn.addNote')}</button>}
              {act.isPending && <Spinner />}
            </div>
          )}
          {buttons.length === 0 && !canNote && <div className="mt-2 text-[11px] text-faint">No actions available to you for this finding.</div>}
        </div>
      </div>
      <Modal open={noteOpen} onClose={() => setNoteOpen(false)} width={440} title={t('btn.addNote')} icon={<StickyNote size={14} className="text-amber" />}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setNoteOpen(false)}>{t('btn.cancel')}</button>
          <button className="btn btn-primary" disabled={!note.trim() || act.isPending} onClick={() => act.mutate({ action: 'note', note: note.trim() })}>
            {act.isPending ? <Spinner className="!text-[#1a1204]" /> : <StickyNote size={12} />}{t('btn.save')}
          </button>
        </>}>
        <div className="space-y-2">
          <div className="text-[12px] text-muted">Adds a note to <span className="font-mono text-text">{f.tag}</span> without changing its state. Recorded in the audit log.</div>
          <textarea autoFocus className="input min-h-[90px]" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}

const HOURS = [1, 2, 8, 24];

function RequestsTab({ q }: { q: UseQueryResult<{ mine: AccessRequest[]; to_approve: AccessRequest[] }> }) {
  const { can } = useAuth();
  const toApprove = q.data?.to_approve ?? [];
  const mine = q.data?.mine ?? [];
  const pendingCount = toApprove.filter((a) => a.state === 'PENDING').length;
  const [reqOpen, setReqOpen] = useState(false);
  return (
    <QueryState q={q}>
      <div className="space-y-4">
        <AccessRequestDialog open={reqOpen} onClose={() => { setReqOpen(false); void q.refetch(); }} departments={[]} />
        {(can('access.approve') || toApprove.length > 0) && (
          <Card title={<>To approve <span className="font-mono text-[11px] text-muted">({pendingCount} pending)</span></>} icon={<ShieldCheck size={14} className="text-amber" />} bodyClass="p-0">
            {toApprove.length === 0 ? <EmptyState title="No pending requests" /> : (
              <div className="divide-y divide-border">
                {toApprove.map((a) => <ApproveRow key={a.id} a={a} />)}
              </div>
            )}
          </Card>
        )}
        <Card title={<>My requests <span className="font-mono text-[11px] text-muted">({mine.length})</span></>} icon={<KeyRound size={14} className="text-cyan" />} bodyClass="p-0"
          actions={<button className="btn btn-sm btn-cyan" onClick={() => setReqOpen(true)}><KeyRound size={12} />Request access</button>}>
          {mine.length === 0 ? <EmptyState title="You haven't requested access" hint="Ask another department for time-bound access with “Request access”, or from a chat answer that withheld sources." /> : (
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
                    <div className="mt-1 text-[11px] text-faint">Requested {fmtTime(a.created_at)}{a.decided_at ? `${' · '}decided ${fmtTime(a.decided_at)}${a.approver_name ? ` by ${a.approver_name}` : ''}` : a.approver_name ? ` · awaiting ${a.approver_name}` : ''}</div>
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
