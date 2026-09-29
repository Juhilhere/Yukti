import { useEffect, useMemo, useState } from 'react';
import { Bug, Copy, Download, Mail } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './ui';
import { toast } from './Toast';
import { SUPPORT_EMAIL } from '../lib/contact';
import { recentProblems } from '../lib/diagnostics';
import { useAuth } from '../lib/auth';
import { getLang, useT } from '../lib/i18n';
import { uiStore, useLoaded, useSystem, useUI } from '../lib/queries';

/** Guided problem report for non-technical users: two plain questions, technical details attached automatically,
 *  then the user's email app opens with everything filled in (or they save / copy it). Nothing is sent by Yukti itself. */
export function ReportProblem() {
  const { report } = useUI();
  const open = !!report;
  const t = useT();
  const { me } = useAuth();
  const loaded = useLoaded(open);
  const sys = useSystem();
  const [doing, setDoing] = useState('');
  const [wrong, setWrong] = useState('');
  const [withDetails, setWithDetails] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (open) { setDoing(''); setWrong(report?.about ?? ''); setWithDetails(true); setShowDetails(false); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const details = useMemo(() => {
    if (!open) return '';
    const l = loaded.data;
    const lines = [
      `Yukti version: ${sys.data?.version ?? '?'}`,
      `Time: ${new Date().toString()}`,
      `Page: ${window.location.pathname}`,
      `Language: ${getLang()}`,
      `Role / department: ${(me?.user.roles ?? []).join(', ') || '?'} / ${me?.user.department ?? '?'}`,
      `AI model: ${l ? `${l.status}${l.model_name ? ` · ${l.model_name}` : ''}${l.engine ? ` · ${l.engine}` : ''}` : '?'}`,
      `Browser: ${navigator.userAgent}`,
      `Screen: ${window.innerWidth}x${window.innerHeight}`,
    ];
    const probs = recentProblems();
    if (probs.length) {
      lines.push('', 'Recent problems:');
      probs.slice(-12).forEach((p) => lines.push(`- ${p.at.slice(11, 19)} [${p.kind}] ${p.text}`));
    }
    return lines.join('\n');
  }, [open, loaded.data, sys.data, me]);

  const reportText = () => [
    'What I was trying to do:', doing.trim() || '-', '',
    'What went wrong:', wrong.trim() || '-',
    ...(withDetails ? ['', '--- Technical details (added automatically) ---', details] : []),
  ].join('\n');

  const subject = `[Yukti] Problem report${wrong.trim() ? `: ${wrong.trim().slice(0, 60)}` : ''}`;
  const canSend = (doing.trim() + wrong.trim()).length >= 5;

  const email = () => {
    // mail programs accept about 2 000 characters in a link; longer reports should be saved and attached
    let body = reportText();
    if (body.length > 1800) body = body.slice(0, 1800) + '\n…(shortened; use “Save as file” for the full report)';
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    toast.success(t('report.emailOpened', 'Your email app should open with the report'), t('report.emailHint', 'Check it and press Send. If nothing opens, use “Save as file” and email the file.'));
  };
  const save = () => {
    const blob = new Blob([`${subject}\n\n${reportText()}\n`], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yukti-problem-report-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${subject}\n\n${reportText()}`); toast.success(t('report.copied', 'Report copied')); }
    catch { toast.error(t('report.copyFailed', 'Could not copy — use “Save as file” instead')); }
  };

  return (
    <Modal open={open} onClose={() => uiStore.closeReport()} width={560}
      title={<span className="flex items-center gap-2"><Bug size={15} className="text-amber" />{t('report.title', 'Report a problem')}</span>}
      footer={<>
        <button className="btn btn-ghost mr-auto" onClick={() => uiStore.closeReport()}>{t('btn.cancel', 'Cancel')}</button>
        <button className="btn" disabled={!canSend} onClick={() => void copy()}><Copy size={13} />{t('report.copy', 'Copy')}</button>
        <button className="btn" disabled={!canSend} onClick={save}><Download size={13} />{t('report.save', 'Save as file')}</button>
        <button className="btn btn-primary" disabled={!canSend} onClick={email}><Mail size={13} />{t('report.email', 'Send by email')}</button>
      </>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">{t('report.intro', 'Tell us in your own words. Your report goes to the Yukti team; nothing is sent until you press Send in your email app.')}</p>
        <Field label={t('report.doing', 'What were you trying to do?')}>
          <textarea className="input min-h-[64px]" autoFocus value={doing} onChange={(e) => setDoing(e.target.value)}
            placeholder={t('report.doingHint', 'e.g. I asked about pump A2 in the chat')} />
        </Field>
        <Field label={t('report.wrong', 'What went wrong?')}>
          <textarea className="input min-h-[80px]" value={wrong} onChange={(e) => setWrong(e.target.value)}
            placeholder={t('report.wrongHint', 'e.g. The answer never appeared and a red message said …')} />
        </Field>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 accent-amber" checked={withDetails} onChange={(e) => setWithDetails(e.target.checked)} />
          <span>{t('report.details', 'Attach technical details (recommended) — version, page, recent errors. No documents or chat text.')}{' '}
            <button type="button" className="text-cyan hover:underline" onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? t('report.hideDetails', 'Hide') : t('report.showDetails', 'Show')}
            </button>
          </span>
        </label>
        {showDetails && <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-2 font-mono text-[11px] text-muted">{details}</pre>}
        <p className="text-[11.5px] text-faint">{t('report.to', 'Support address:')} <span className="font-mono">{SUPPORT_EMAIL}</span></p>
      </div>
    </Modal>
  );
}
