import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Hammer, ListChecks, Play, Plus, Send, Trash2, Wand2 } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { useT } from '../lib/i18n';
import { cx, timeAgo } from '../lib/format';
import { isFinal, useTask, type TaskOut, type WorkOptions } from '../lib/work';
import { Badge, Card, EmptyState, ErrorBox, Field, PageHeader, QueryState, Spinner, StatusChip } from '../components/ui';
import { toast } from '../components/Toast';
import { CalcTable, SandboxOutput, SourcesTable, TaskFiles, TaskSteps, WorkerBadge } from '../components/work/TaskParts';

type VarRow = { name: string; value: string };
const DELIV_KEYS: Record<string, string> = {
  docx: 'wb.deliv.docx', pptx: 'wb.deliv.pptx', xlsx: 'wb.deliv.xlsx', approval_note: 'wb.deliv.approval_note',
  calc: 'wb.deliv.calc', code: 'wb.deliv.code', answer: 'wb.deliv.answer',
};

export default function Workbench() {
  const t = useT();
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ['work', 'options'], queryFn: () => api.get<WorkOptions>('/api/work/options'), staleTime: 5 * 60_000 });
  const mine = useQuery({ queryKey: ['tasks', 'workbench'], queryFn: () => api.get<TaskOut[]>('/api/tasks?kind=workbench') });
  const [deliverable, setDeliverable] = useState('docx');
  const [goal, setGoal] = useState('');
  const [tag, setTag] = useState('');
  const [calc, setCalc] = useState('P = 250 [kW]\nV = 415 [V]\npf = 0.86\nI = P * 1000 / (sqrt(3) * V * pf) [A]');
  const [vars, setVars] = useState<VarRow[]>([]);
  const [code, setCode] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = useTask(taskId);

  // the coder model wrote the code: put it in the editor so the person can read and run it
  useEffect(() => {
    const r = task.data?.result;
    if (task.data?.status === 'done' && r?.deliverable === 'code' && r.code && !r.run) setCode(r.code);
  }, [task.data?.status, task.data?.result]);
  useEffect(() => { if (task.data && isFinal(task.data.status)) qc.invalidateQueries({ queryKey: ['tasks', 'workbench'] }); }, [task.data?.status, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useMutation({
    mutationFn: (run?: boolean) => {
      const body: Record<string, unknown> = { deliverable, goal: goal.trim() };
      if (tag.trim()) body.tag = tag.trim();
      if (deliverable === 'calc') {
        body.calculation = calc;
        const v: Record<string, number> = {};
        vars.forEach((r) => { if (r.name.trim() && r.value.trim() !== '' && isFinite(Number(r.value))) v[r.name.trim()] = Number(r.value); });
        body.variables = v;
      }
      if (deliverable === 'code' && code.trim()) { body.code = code; body.run = !!run; }
      return api.post<TaskOut>('/api/work', body);
    },
    onSuccess: (r) => { qc.setQueryData(['task', r.id], r); setTaskId(r.id); qc.invalidateQueries({ queryKey: ['tasks', 'workbench'] }); },
    onError: (e) => toast.error(t('wb.submitFailed'), errMsg(e)),
  });

  const delivs = opts.data?.deliverables ?? Object.keys(DELIV_KEYS).map((id) => ({ id, label: id }));
  const canSubmit = deliverable === 'calc' ? calc.trim().length > 0 : deliverable === 'code' ? (goal.trim().length >= 4 || code.trim().length > 0) : goal.trim().length >= 4;
  const running = submit.isPending || (!!task.data && !isFinal(task.data.status));

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={<Hammer size={18} />} title={t('wb.title')} subtitle={t('wb.subtitle')} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid gap-4 xl:grid-cols-[440px_1fr]">
          <div className="space-y-4">
            <Card title={t('wb.form.title')} icon={<Wand2 size={14} className="text-amber" />}>
              <div className="space-y-3">
                <Field label={t('wb.form.deliverable')}>
                  <select className="input" value={deliverable} onChange={(e) => setDeliverable(e.target.value)}>
                    {delivs.map((d) => <option key={d.id} value={d.id}>{t(DELIV_KEYS[d.id] ?? '', d.label)}</option>)}
                  </select>
                </Field>
                <Field label={t('wb.form.goal')} hint={t(`wb.form.goalHint.${deliverable}`, t('wb.form.goalHint'))}>
                  <textarea className="input min-h-[80px]" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t('wb.form.goalPh')} />
                </Field>
                <Field label={t('wb.form.tag')} hint={t('wb.form.tagHint')}>
                  <input className="input font-mono" value={tag} onChange={(e) => setTag(e.target.value.toUpperCase())} placeholder="P-101A" />
                </Field>
                {deliverable === 'calc' && <>
                  <Field label={t('wb.calc.lines')} hint={t('wb.calc.linesHint')}>
                    <textarea className="input min-h-[110px] font-mono text-[12px]" value={calc} onChange={(e) => setCalc(e.target.value)} spellCheck={false} />
                  </Field>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[12px] font-medium text-muted">{t('wb.calc.vars')}</span>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setVars((v) => [...v, { name: '', value: '' }])}><Plus size={12} />{t('wb.calc.addVar')}</button>
                    </div>
                    {vars.length === 0 && <div className="text-[11.5px] text-faint">{t('wb.calc.noVars')}</div>}
                    <div className="space-y-1">
                      {vars.map((r, i) => (
                        <div key={i} className="flex gap-1.5">
                          <input className="input !py-0.5 font-mono text-[12px]" placeholder={t('wb.calc.name')} value={r.name}
                            onChange={(e) => setVars((v) => v.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                          <input className="input !py-0.5 font-mono text-[12px]" type="number" step="any" placeholder={t('wb.calc.value')} value={r.value}
                            onChange={(e) => setVars((v) => v.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                          <button type="button" className="btn btn-ghost btn-icon" title={t('btn.delete')} onClick={() => setVars((v) => v.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>}
                {deliverable === 'code' && (
                  <Field label={t('wb.code.editor')} hint={opts.data ? t('wb.code.sandboxHint', { imports: opts.data.sandbox.imports.join(', '), s: opts.data.sandbox.timeout_s }) : undefined}>
                    <textarea className="input min-h-[200px] font-mono text-[12px]" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} placeholder={t('wb.code.ph')} />
                  </Field>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button className="btn btn-primary" disabled={!canSubmit || running} onClick={() => submit.mutate(false)}>
                    {submit.isPending ? <Spinner className="!text-[#1a1204]" /> : <Send size={13} />}
                    {deliverable === 'code' && code.trim() ? t('wb.code.save') : t('wb.form.submit')}
                  </button>
                  {deliverable === 'code' && (
                    <button className="btn btn-cyan" disabled={!code.trim() || running} onClick={() => submit.mutate(true)}>
                      <Play size={13} />{t('wb.code.run')}
                    </button>
                  )}
                </div>
                {opts.error ? <ErrorBox error={opts.error} /> : null}
              </div>
            </Card>
            <Card title={t('wb.mine')} icon={<ListChecks size={14} className="text-cyan" />} bodyClass="p-0">
              <QueryState q={mine} empty={(mine.data ?? []).length === 0} emptyTitle={t('wb.mineEmpty')}>
                <div className="max-h-[360px] divide-y divide-border/60 overflow-y-auto">
                  {(mine.data ?? []).map((x) => (
                    <button key={x.id} onClick={() => setTaskId(x.id)}
                      className={cx('flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2', taskId === x.id && 'bg-surface-2')}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px]">{x.title || x.kind}</div>
                        <div className="text-[11px] text-faint">{t(DELIV_KEYS[String(x.result?.deliverable ?? '')] ?? '', String(x.result?.deliverable ?? ''))} · {timeAgo(x.created_at)}</div>
                      </div>
                      <StatusChip status={x.status} />
                    </button>
                  ))}
                </div>
              </QueryState>
            </Card>
          </div>
          <div className="min-w-0">
            {!taskId ? (
              <Card><EmptyState icon={<Hammer size={26} />} title={t('wb.emptyTitle')} hint={t('wb.emptyHint')} /></Card>
            ) : task.isLoading ? <Card><Spinner /></Card> : task.error ? <ErrorBox error={task.error} onRetry={() => task.refetch()} /> : task.data ? (
              <TaskView task={task.data} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskView({ task }: { task: TaskOut }) {
  const t = useT();
  const r = task.result ?? {};
  const files = [...(task.files ?? []), ...(r.files ?? [])];
  return (
    <div className="space-y-4">
      <Card title={<span className="flex flex-wrap items-center gap-2">{task.title || task.kind} <StatusChip status={task.status} /></span>}
        actions={<WorkerBadge worker={task.worker} label={task.worker_label} />}>
        <div className="space-y-3">
          <TaskSteps steps={task.steps} />
          {!isFinal(task.status) && <div className="flex items-center gap-2 text-[12px] text-muted"><Spinner size={12} />{t('wb.working')}</div>}
          {task.error && <ErrorBox error={new Error(task.error)} />}
          <TaskFiles files={files} />
          {task.served_by && <div className="text-[11px] text-faint">{t('wb.servedBy', { model: task.served_by })}</div>}
        </div>
      </Card>
      {r.calculation && (
        <Card title={t('wb.calc.result')}>
          <div className="mb-2 font-mono text-[15px]"><span className="text-cyan">{r.calculation.result.name}</span> = <b>{r.calculation.result.value}</b> {r.calculation.result.unit}</div>
          <CalcTable steps={r.calculation.steps} />
        </Card>
      )}
      {r.run && <Card title={t('wb.code.output')}><SandboxOutput run={r.run} /></Card>}
      {r.deliverable === 'code' && r.code && !r.run && (
        <Card title={t('wb.code.written')} actions={r.model ? <Badge mono tone="muted">{r.model}</Badge> : undefined}>
          <div className="mb-2 text-[12px] text-amber">{t('wb.code.reviewFirst')}</div>
          <pre className="max-h-[320px] overflow-auto rounded-md border border-border bg-bg p-2 font-mono text-[11.5px]">{r.code}</pre>
        </Card>
      )}
      {r.draft && (
        <Card title={t('wb.draft')} actions={<>
          {r.model ? <Badge mono tone="muted">{r.model}</Badge> : <Badge tone="amber">{t('wb.extractive')}</Badge>}
          {(r.citations?.unknown ?? []).length > 0 && <Badge tone="danger" title={r.citations!.unknown.join(', ')}>{t('wb.unknownCites', { n: r.citations!.unknown.length })}</Badge>}
        </>}>
          <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{r.draft}</ReactMarkdown></div>
        </Card>
      )}
      {(r.sources ?? []).length > 0 && (
        <Card title={t('wb.sources', { n: r.sources!.length })} bodyClass="p-2">
          <SourcesTable sources={r.sources!} />
          {r.denied && r.denied.count > 0 && <div className="mt-2 text-[11.5px] text-amber">{t('sources.withheldMany', { n: r.denied.count })}</div>}
        </Card>
      )}
    </div>
  );
}
