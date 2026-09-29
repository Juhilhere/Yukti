import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, Circle, FileUp, Search, Upload, XCircle, MinusCircle } from 'lucide-react';
import { api, qs } from '../lib/api';
import type { DocumentSummary, Job, JobStage } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Badge, ErrorBox, Field, PageHeader, ProvenanceBadges, QueryState, Spinner, StatusChip } from '../components/ui';
import { useT } from '../lib/i18n';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { cx, fmtBytes, fmtDate } from '../lib/format';

// value = policy document type (must match policies/core.yaml); role = only that role may add it (shared plant-wide)
// label / note are i18n keys
const DOC_TYPES: { value: string; label: string; role?: string; note?: string }[] = [
  { value: 'SOP', label: 'knowledge.type.SOP' }, { value: 'drawing_pid', label: 'knowledge.type.drawing_pid' }, { value: 'drawing_sld', label: 'knowledge.type.drawing_sld' },
  { value: 'datasheet', label: 'knowledge.type.datasheet' }, { value: 'manual', label: 'knowledge.type.manual' }, { value: 'troubleshooting_guide', label: 'knowledge.type.troubleshooting_guide' },
  { value: 'process_manual', label: 'knowledge.type.process_manual' }, { value: 'inspection_report', label: 'knowledge.type.inspection_report' },
  { value: 'calibration_certificate', label: 'knowledge.type.calibration_certificate' }, { value: 'shift_log', label: 'knowledge.type.shift_log' },
  { value: 'work_order_export', label: 'knowledge.type.work_order_export' }, { value: 'asset_register', label: 'knowledge.type.asset_register' },
  { value: 'audit_report', label: 'knowledge.type.audit_report' }, { value: 'MSDS', label: 'knowledge.type.MSDS', role: 'hse', note: 'knowledge.type.hseOnly' },
  { value: 'contact_list', label: 'knowledge.type.contact_list', role: 'plant_manager', note: 'knowledge.type.mgmtOnly' }, { value: 'other', label: 'knowledge.type.other' },
];
const DOC_TYPE_LABEL: Record<string, string> = Object.fromEntries(DOC_TYPES.map((d) => [d.value, d.label]));
// must match rag.SUPPORTED_EXTS on the server
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp,.docx,.xlsx,.xlsm,.txt,.csv,.md,.log,.json,.xml';
const CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'RESTRICTED', 'CONFIDENTIAL'];

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function Knowledge() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const nav = useNavigate();
  const { me } = useAuth();
  // Only Heads of Department hold documents.upload (checked literally — no admin bypass).
  const canUpload = !!me?.permissions?.includes('documents.upload');
  const [uploadOpen, setUploadOpen] = useState(false);
  const t = useT();
  const docs = useQuery({ queryKey: ['documents', dq], queryFn: () => api.get<DocumentSummary[]>(`/api/documents${qs({ q: dq })}`) });
  // department first: default to the user's own department; "All I can access" adds shared unit documents and public data
  const [mine, setMine] = useState(true);
  const all = Array.isArray(docs.data) ? docs.data : [];
  const myDept = me?.user.department;
  const ownCount = all.filter((d) => d.department === myDept).length;
  const rows = mine ? all.filter((d) => d.department === myDept) : all;

  const columns: Column<DocumentSummary>[] = [
    { key: 'title', header: t('knowledge.col.title'), render: (d) => <div className="min-w-[220px]"><div className="flex flex-wrap items-center gap-1.5 font-medium text-text">{d.title || t('knowledge.untitled')}<ProvenanceBadges isExample={d.is_example} isPublic={d.is_public} /></div><div className="text-[11px] text-faint">{fmtDate(d.created_at)} · {fmtBytes(d.size_bytes)}</div></div> },
    { key: 'doc_number', header: t('knowledge.col.docNo'), mono: true, render: (d) => <span className="text-cyan">{d.doc_number || '—'}</span> },
    { key: 'revision', header: t('knowledge.col.rev'), mono: true, render: (d) => d.revision || '—' },
    { key: 'status', header: t('knowledge.col.status'), render: (d) => <StatusChip status={d.status} /> },
    { key: 'doc_type', header: t('knowledge.col.type'), render: (d) => <Badge mono title={d.doc_type}>{DOC_TYPE_LABEL[d.doc_type] ? t(DOC_TYPE_LABEL[d.doc_type]) : (d.doc_type || '—')}</Badge> },
    { key: 'department', header: t('knowledge.col.department'), render: (d) => d.department || '—' },
    { key: 'classification', header: t('knowledge.col.class'), render: (d) => <StatusChip status={d.classification} /> },
    {
      key: 'pages', header: t('knowledge.col.pages'), sortValue: (d) => d.pages, render: (d) => (
        <div className="flex items-center gap-1 font-mono text-[12px]">
          <span>{d.pages ?? 0}</span>
          {d.page_modes && <span className="text-faint" title={t('knowledge.pageModesTip')}>(<span className="text-cyan">{t('knowledge.pagesDigital', { n: d.page_modes.digital ?? 0 })}</span>/<span className="text-amber">{t('knowledge.pagesScanned', { n: d.page_modes.scanned ?? 0 })}</span>)</span>}
        </div>
      ),
    },
    {
      key: 'asset_tags', header: t('knowledge.col.tags'), sortValue: (d) => (d.asset_tags ?? []).join(','), render: (d) => (
        <div className="flex max-w-[220px] flex-wrap gap-1">
          {(d.asset_tags ?? []).slice(0, 4).map((tag) => <Badge key={tag} mono tone="muted">{tag}</Badge>)}
          {(d.asset_tags ?? []).length > 4 && <span className="text-[11px] text-faint">+{d.asset_tags.length - 4}</span>}
        </div>
      ),
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={<BookOpen size={18} />} title={t('page.knowledge')} subtitle={t('page.knowledge.sub')}
        actions={<>
          <div className="flex overflow-hidden rounded-md border border-border text-[12px]">
            <button className={cx('px-2.5 py-1', mine ? 'bg-surface-2 text-text' : 'text-muted hover:text-text')} onClick={() => setMine(true)}
              title={myDept}>{t('knowledge.myDept')} <span className="font-mono text-faint">{ownCount}</span></button>
            <button className={cx('border-l border-border px-2.5 py-1', !mine ? 'bg-surface-2 text-text' : 'text-muted hover:text-text')} onClick={() => setMine(false)}
              title={t('knowledge.allTip')}>{t('knowledge.all')} <span className="font-mono text-faint">{all.length}</span></button>
          </div>
          <div className="relative w-[280px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input !pl-8" placeholder={t('knowledge.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {canUpload
            ? <button className="btn btn-primary" onClick={() => setUploadOpen(true)}><Upload size={14} /> {t('btn.upload')}</button>
            : <span className="text-[11.5px] text-muted">{t('knowledge.hodOnly')}</span>}
        </>} />
      <div className="min-h-0 flex-1 overflow-hidden p-4">
        <div className="h-full overflow-hidden rounded-md border border-border bg-surface">
          <QueryState q={docs} empty={rows.length === 0} emptyTitle={dq ? t('knowledge.noMatch') : mine ? t('knowledge.noDeptDocs', { dept: myDept ?? '' }) : t('knowledge.noDocs')}
            emptyHint={canUpload ? t('knowledge.emptyHint') : undefined}>
            <DataTable rows={rows} columns={columns} rowKey={(d) => d.id} onRowClick={(d) => nav(`/knowledge/${d.id}`)} maxHeight="100%" />
          </QueryState>
        </div>
      </div>
      {uploadOpen && <UploadDialog onClose={() => setUploadOpen(false)} />}
    </div>
  );
}

function StageIcon({ s }: { s: JobStage['status'] }) {
  if (s === 'done') return <CheckCircle2 size={15} className="text-ok" />;
  if (s === 'running') return <Spinner size={15} />;
  if (s === 'error') return <XCircle size={15} className="text-danger" />;
  if (s === 'skipped') return <MinusCircle size={15} className="text-faint" />;
  return <Circle size={15} className="text-faint" />;
}

function JobStepper({ jobId, onDone }: { jobId: string; onDone: (docId: string) => void }) {
  const t = useT();
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.get<Job>(`/api/jobs/${jobId}`),
    refetchInterval: (qq) => (qq.state.data?.status === 'done' || qq.state.data?.status === 'error' ? false : 1000),
  });
  const firedRef = useRef(false);
  useEffect(() => {
    if (job.data?.status === 'done' && !firedRef.current) { firedRef.current = true; onDone(job.data.document_id); }
  }, [job.data, onDone]);
  if (job.error) return <ErrorBox error={job.error} onRetry={() => job.refetch()} />;
  const j = job.data;
  const stages = j?.stages ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="label">{t('knowledge.job')}</span>
        <span className="font-mono text-[11px] text-faint">{jobId}</span>
        <StatusChip status={j?.status ?? 'queued'} className="ml-auto" />
      </div>
      {stages.length === 0 && <div className="flex items-center gap-2 text-muted"><Spinner /> {t('knowledge.waiting')}</div>}
      <ol className="relative space-y-0">
        {stages.map((s, i) => (
          <li key={`${s.name}-${i}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <StageIcon s={s.status} />
              {i < stages.length - 1 && <div className={cx('my-0.5 w-px flex-1 min-h-[14px]', s.status === 'done' ? 'bg-ok/50' : 'bg-border')} />}
            </div>
            <div className="pb-2.5 min-w-0">
              <div className={cx('font-medium', s.status === 'pending' ? 'text-muted' : 'text-text')}>{s.name}</div>
              {s.detail && <div className="break-words font-mono text-[11px] text-muted">{s.detail}</div>}
            </div>
          </li>
        ))}
      </ol>
      {j?.status === 'error' && <ErrorBox error={j.error || t('knowledge.jobFailed')} />}
    </div>
  );
}

function UploadDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState('SOP');
  const { me } = useAuth();
  // Uploads always go into the HOD's own department.
  const dept = me?.user.department ?? '';
  const clearance = me?.user.clearance ?? 0;
  const allowedCls = CLASSIFICATIONS.filter((_, i) => i <= clearance);
  const [cls, setCls] = useState(() => (allowedCls.includes('INTERNAL') ? 'INTERNAL' : allowedCls[0] ?? 'PUBLIC'));
  const [docNo, setDocNo] = useState('');
  const [rev, setRev] = useState('');
  const [job, setJob] = useState<{ job_id: string; document_id: string } | null>(null);
  const [doneDoc, setDoneDoc] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file as File);
      if (title) fd.append('title', title);
      fd.append('doc_type', docType);
      fd.append('department', dept);
      fd.append('classification', cls);
      if (docNo) fd.append('doc_number', docNo);
      if (rev) fd.append('revision', rev);
      return api.upload<{ document_id: string; job_id: string }>('/api/documents', fd);
    },
    onSuccess: (r) => { setJob(r); toast(t('knowledge.uploadAccepted'), { body: t('knowledge.uploadAcceptedBody') }); },
  });

  const pick = (f?: File | null) => {
    if (!f) return;
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  return (
    <Modal open onClose={onClose} title={t('knowledge.uploadTitle')} icon={<FileUp size={15} className="text-amber" />} width={600}
      footer={job ? <>
        {doneDoc && <button className="btn btn-cyan" onClick={() => { onClose(); nav(`/knowledge/${doneDoc}`); }}>{t('knowledge.openDoc')}</button>}
        <button className="btn" onClick={onClose}>{doneDoc ? t('btn.close') : t('knowledge.background')}</button>
      </> : <>
        <button className="btn" onClick={onClose}>{t('btn.cancel')}</button>
        <button className="btn btn-primary" disabled={!file || !dept || upload.isPending} onClick={() => upload.mutate()}>
          {upload.isPending ? <Spinner /> : <Upload size={14} />} {t('knowledge.uploadIndex')}
        </button>
      </>}>
      {job ? (
        <JobStepper jobId={job.job_id} onDone={(d) => {
          setDoneDoc(d || job.document_id);
          qc.invalidateQueries({ queryKey: ['documents'] });
          toast.success(t('knowledge.indexed'), title || file?.name);
        }} />
      ) : (
        <div className="space-y-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
            onClick={() => inputRef.current?.click()}
            className={cx('flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-4 py-7 text-center transition-colors',
              drag ? 'border-cyan bg-cyan/5' : 'border-border hover:border-border-strong')}>
            <FileUp size={24} className={file ? 'text-cyan' : 'text-faint'} />
            {file ? (
              <><div className="font-medium">{file.name}</div><div className="font-mono text-[11px] text-muted">{fmtBytes(file.size)}</div></>
            ) : (
              <><div className="font-medium">{t('knowledge.drop')}</div><div className="text-[11.5px] text-muted">{t('knowledge.dropHint')}</div></>
            )}
            <input ref={inputRef} type="file" className="hidden" accept={ACCEPT} onChange={(e) => pick(e.target.files?.[0])} />
          </div>
          <Field label={t('knowledge.f.title')}><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('knowledge.f.titlePh')} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('knowledge.f.type')}>
              <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>{DOC_TYPES.filter((d) => !d.role || me?.user.roles.includes(d.role)).map((d) => <option key={d.value} value={d.value}>{d.note ? t(d.note, { type: t(d.label) }) : t(d.label)}</option>)}</select>
            </Field>
            <Field label={t('knowledge.f.department')}>
              <input className="input" value={dept} readOnly disabled title={t('knowledge.f.deptTip')} />
            </Field>
            <Field label={t('knowledge.f.class')}>
              <select className="input" value={cls} onChange={(e) => setCls(e.target.value)}>{allowedCls.map((d) => <option key={d} value={d}>{t(`knowledge.cls.${d}`, d)}</option>)}</select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('knowledge.f.docNo')}><input className="input font-mono" value={docNo} onChange={(e) => setDocNo(e.target.value)} placeholder={t('knowledge.f.docNoPh')} /></Field>
            <Field label={t('knowledge.f.rev')}><input className="input font-mono" value={rev} onChange={(e) => setRev(e.target.value)} placeholder={t('knowledge.f.revPh')} /></Field>
          </div>
          {upload.error && <ErrorBox error={upload.error} />}
          {!file && upload.isIdle && <EmptyHint />}
        </div>
      )}
    </Modal>
  );
}

function EmptyHint() {
  const t = useT();
  return <div className="text-[11.5px] text-faint">{t('knowledge.pipeline')}</div>;
}

