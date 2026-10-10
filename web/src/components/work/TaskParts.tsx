// Shared views for queue tasks: plan steps, delivered files, calculation steps, sandbox output, sources, scan results.
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDashed, CircleSlash, Download, FileText, Loader2, XCircle } from 'lucide-react';
import { downloadFile, errMsg } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { cx, fmtDate, num } from '../../lib/format';
import type { Source } from '../../lib/types';
import { pct, WORKER_KEY, type CalcStep, type SandboxRun, type ScanCheck, type TaskFile, type TaskStep, type WorkResult } from '../../lib/work';
import { Badge, StatusChip, type Tone } from '../ui';
import { toast } from '../Toast';

export function WorkerBadge({ worker, label, fallback }: { worker: string; label?: string; fallback?: boolean }) {
  const t = useT();
  return (
    <Badge tone={worker === 'policy' ? 'muted' : worker === 'reasoning' ? 'violet' : worker === 'coder' ? 'amber' : 'cyan'} title={t('wb.worker.tip')}>
      {t(WORKER_KEY[worker] ?? '', label || worker)}
      {fallback && <span className="text-amber">· {t('wb.worker.fallbackShort')}</span>}
    </Badge>
  );
}

const STEP_ICON: Record<string, JSX.Element> = {
  done: <CheckCircle2 size={13} className="text-ok" />,
  running: <Loader2 size={13} className="animate-spin text-cyan" />,
  error: <XCircle size={13} className="text-danger" />,
  skipped: <CircleSlash size={13} className="text-faint" />,
  pending: <CircleDashed size={13} className="text-faint" />,
};

/** Step names come from the server (tool names or English step titles); known ones are translated. */
export function stepLabel(t: (k: string, a?: string) => string, name: string) {
  const key = `wb.step.${name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase()}`;
  return t(key, name);
}

export function TaskSteps({ steps }: { steps: TaskStep[] }) {
  const t = useT();
  if (!steps?.length) return null;
  return (
    <ol className="space-y-1">
      {steps.map((s, i) => (
        <li key={`${s.name}-${i}`} className={cx('flex items-start gap-2 rounded px-2 py-1 text-[12.5px]', s.status === 'running' && 'bg-cyan/5')}>
          <span className="mt-0.5 shrink-0">{STEP_ICON[s.status] ?? STEP_ICON.pending}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cx('font-medium', s.status === 'pending' && 'text-muted')}>{stepLabel(t, s.name)}</span>
              <StatusChip status={s.status} />
              {typeof s.ms === 'number' && <span className="font-mono text-[10.5px] text-faint">{num(s.ms, 0)} ms</span>}
            </div>
            {s.detail && <div className="text-[11.5px] text-muted break-words">{s.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function FileButton({ f }: { f: TaskFile }) {
  const t = useT();
  return (
    <button className="btn btn-sm btn-cyan" title={f.sha256 ? `SHA-256 ${f.sha256}` : undefined}
      onClick={() => downloadFile(f.url, f.file_name).catch((e) => toast.error(t('wb.downloadFailed'), errMsg(e)))}>
      <Download size={12} />{f.file_name}
    </button>
  );
}

export function TaskFiles({ files }: { files?: TaskFile[] }) {
  const t = useT();
  const list = (files ?? []).filter((f, i, a) => a.findIndex((x) => x.id === f.id) === i);
  if (!list.length) return null;
  return (
    <div>
      <div className="label mb-1.5">{t('wb.files')}</div>
      <div className="flex flex-wrap gap-1.5">{list.map((f) => <FileButton key={f.id} f={f} />)}</div>
    </div>
  );
}

export function CalcTable({ steps }: { steps: CalcStep[] }) {
  const t = useT();
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-[12px]">
        <thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-muted">
          <th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">{t('wb.calc.name')}</th><th className="px-2 py-1.5">{t('wb.calc.expression')}</th>
          <th className="px-2 py-1.5">{t('wb.calc.substituted')}</th><th className="px-2 py-1.5 text-right">{t('wb.calc.value')}</th><th className="px-2 py-1.5">{t('wb.calc.unit')}</th>
        </tr></thead>
        <tbody>{steps.map((s) => (
          <tr key={s.n} className="border-t border-border/60">
            <td className="px-2 py-1 font-mono text-faint">{s.n}</td>
            <td className="px-2 py-1 font-mono text-cyan">{s.name}</td>
            <td className="px-2 py-1 font-mono">{s.expression}</td>
            <td className="px-2 py-1 font-mono text-muted">{s.substituted}</td>
            <td className="px-2 py-1 text-right font-mono font-semibold">{num(s.value, 4)}</td>
            <td className="px-2 py-1 text-muted">{s.unit || '—'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function SandboxOutput({ run }: { run: SandboxRun }) {
  const t = useT();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Badge tone={run.exit_code === 0 ? 'ok' : 'danger'} mono>{t('wb.code.exit', { n: run.exit_code })}</Badge>
        <Badge mono tone="muted">{num(run.ms, 0)} ms</Badge>
        {run.timed_out && <Badge tone="amber">{t('wb.code.timedOut')}</Badge>}
      </div>
      <div>
        <div className="label mb-1">stdout</div>
        <pre className="max-h-[260px] overflow-auto rounded-md border border-border bg-bg p-2 font-mono text-[11.5px]">{run.stdout || '—'}</pre>
      </div>
      {run.stderr && (
        <div>
          <div className="label mb-1">stderr</div>
          <pre className="max-h-[200px] overflow-auto rounded-md border border-danger/40 bg-bg p-2 font-mono text-[11.5px] text-red-300">{run.stderr}</pre>
        </div>
      )}
    </div>
  );
}

export function SourcesTable({ sources }: { sources: Source[] }) {
  const t = useT();
  if (!sources?.length) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-[12px]">
        <thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-muted">
          <th className="px-2 py-1.5">ID</th><th className="px-2 py-1.5">{t('wb.src.document')}</th><th className="px-2 py-1.5">{t('wb.src.revision')}</th>
          <th className="px-2 py-1.5">{t('wb.src.locator')}</th><th className="px-2 py-1.5">{t('wb.src.date')}</th><th className="px-2 py-1.5 text-right">{t('wb.src.confidence')}</th>
        </tr></thead>
        <tbody>{sources.map((s) => (
          <tr key={s.id} className="border-t border-border/60">
            <td className="px-2 py-1 font-mono text-cyan">{s.id}</td>
            <td className="px-2 py-1"><Link className="hover:text-cyan hover:underline" to={`/knowledge/${s.document_id}?page=${s.page}`}>{s.doc_number || s.title}</Link>
              <div className="text-[11px] text-muted line-clamp-1">{s.title}</div></td>
            <td className="px-2 py-1 font-mono">{s.revision || '—'} <StatusChip status={s.status} /></td>
            <td className="px-2 py-1 font-mono text-[11.5px]">{s.locator || t('sources.page', { n: s.page })}</td>
            <td className="px-2 py-1 text-muted">{fmtDate(s.timestamp)}</td>
            <td className="px-2 py-1 text-right font-mono">{pct(s.confidence) !== null ? `${pct(s.confidence)}%` : '—'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function checkTone(r: string): Tone { return r === 'match' ? 'ok' : r === 'MISMATCH' ? 'danger' : 'muted'; }
export function CheckChip({ result }: { result: string }) {
  const t = useT();
  return <Badge tone={checkTone(result)} mono>{t(`wb.check.${result === 'not checked' ? 'notChecked' : result}`, result)}</Badge>;
}

export function ChecksList({ checks }: { checks: ScanCheck[] }) {
  if (!checks?.length) return null;
  return (
    <ul className="space-y-1">
      {checks.map((c, i) => (
        <li key={i} className="flex items-start gap-2 text-[12px]">
          <CheckChip result={c.result} />
          <span className="min-w-0"><span className="font-medium">{c.check}</span>{c.detail && <span className="text-muted"> — {c.detail}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

/** Result of the scan-to-finding pipeline: fields read, verification against the asset master, the finding raised. */
export function ScanResultView({ r }: { r: WorkResult }) {
  const t = useT();
  const fields = Object.entries(r.fields ?? {});
  return (
    <div className="space-y-3">
      {r.vision && <div className="text-[11.5px] text-muted">{r.vision.used ? t('wb.scan.visionUsed', { model: r.vision.model ?? '' }) : (r.vision.note || t('wb.scan.visionNotUsed'))}</div>}
      {fields.length > 0 && (
        <div>
          <div className="label mb-1">{t('wb.scan.fields', { tag: r.tag || '—' })}</div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-[12px]"><tbody>
              {fields.map(([k, v]) => {
                const c = pct(r.field_confidence?.[k]);
                return (
                  <tr key={k} className="border-b border-border/60 last:border-0">
                    <td className="px-2 py-1 font-mono text-muted">{k}</td>
                    <td className="px-2 py-1">{v === null || v === undefined || v === '' ? '—' : String(v)}</td>
                    <td className="px-2 py-1 text-right">{c !== null && <Badge mono tone={c >= 85 ? 'ok' : c >= 70 ? 'amber' : 'danger'}>{c}%</Badge>}</td>
                  </tr>
                );
              })}
            </tbody></table>
          </div>
        </div>
      )}
      {(r.thickness ?? []).length > 0 && (
        <div>
          <div className="label mb-1">{t('wb.scan.thickness')}</div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-muted">
                <th className="px-2 py-1">{t('wb.scan.point')}</th><th className="px-2 py-1">{t('wb.scan.location')}</th>
                <th className="px-2 py-1 text-right">{t('wb.scan.previous')}</th><th className="px-2 py-1 text-right">{t('wb.scan.current')}</th><th className="px-2 py-1">{t('wb.scan.remark')}</th>
              </tr></thead>
              <tbody>{r.thickness!.map((x, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="px-2 py-1 font-mono">{x.point}</td><td className="px-2 py-1">{x.location || '—'}</td>
                  <td className="px-2 py-1 text-right font-mono">{x.previous_mm ?? '—'}</td><td className="px-2 py-1 text-right font-mono">{x.current_mm ?? '—'}</td>
                  <td className="px-2 py-1 text-muted">{x.remark || ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
      {(r.checks ?? []).length > 0 && (
        <div>
          <div className="label mb-1">{t('wb.scan.checks')}</div>
          <ChecksList checks={r.checks!} />
        </div>
      )}
      <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[12.5px]">
        {!r.finding ? <span className="text-muted">{t('wb.scan.noFinding')}</span> : (
          <div className="flex flex-wrap items-center gap-1.5">
            <FileText size={13} className="text-amber" />
            <span className="font-medium">{r.finding.duplicate ? t('wb.scan.duplicate') : (r.finding.title || t('wb.scan.finding'))}</span>
            {r.finding.severity && <StatusChip status={r.finding.severity} />}
            {r.finding.state && <StatusChip status={r.finding.state} />}
            {!!r.finding.review_items && <Badge tone="amber">{t('wb.scan.reviewN', { n: r.finding.review_items })}</Badge>}
            <Link to={r.waiting_review ? '/inbox?tab=review' : '/inbox?tab=findings'} className="ml-auto text-cyan hover:underline">{t('wb.scan.openInbox')}</Link>
          </div>
        )}
      </div>
    </div>
  );
}
