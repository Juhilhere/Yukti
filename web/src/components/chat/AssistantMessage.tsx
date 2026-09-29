import { memo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, Brain, Check, ChevronDown, ChevronRight, Copy, Gauge, RefreshCw, Route, ShieldCheck, ShieldX, ShieldAlert, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api, errMsg } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { Modal } from '../Modal';
import { toast } from '../Toast';
import type { GuardDecision, RouteDecision } from '../../lib/types';
import { Badge, JsonView, Popover, Spinner } from '../ui';
import { cx, num } from '../../lib/format';
import { FactsTable } from './FactsTable';
import { DeniedCard, SourcesRow } from './SourcesRow';
import { flashSource, linkCitations, type UIMessage } from './types';

function urgencyPct(u: unknown): number {
  if (typeof u === 'number') return u <= 1 ? u * 100 : u <= 5 ? (u / 5) * 100 : Math.min(100, u);
  const s = String(u ?? '').toLowerCase();
  return ({ low: 25, normal: 35, medium: 55, high: 80, critical: 100, emergency: 100 } as Record<string, number>)[s] ?? 0;
}

function RouteChip({ route }: { route: RouteDecision }) {
  const t = useT();
  const pct = urgencyPct(route.urgency);
  const barC = pct >= 75 ? 'bg-danger' : pct >= 45 ? 'bg-amber' : 'bg-cyan';
  return (
    <Popover align="left" className="w-[360px] p-2"
      trigger={(_o, toggle) => (
        <button onClick={toggle} title={t('chat.route.tip')}
          className="inline-flex items-center gap-1.5 rounded border border-cyan/30 bg-cyan/[0.07] px-1.5 py-px text-[11px] text-cyan hover:border-cyan/60">
          <Route size={11} />
          <span className="font-mono">{route.intent}</span>
          <span className="text-faint">·</span>
          <span>{route.department}</span>
          <span className="text-faint">·</span>
          <span className="inline-flex h-1.5 w-10 overflow-hidden rounded-full bg-surface-3" title={t('chat.route.urgency', { u: String(route.urgency) })}>
            <span className={cx('h-full', barC)} style={{ width: `${pct}%` }} />
          </span>
          <span className="text-faint">·</span>
          <span className="font-mono">{route.route}</span>
          <span className="font-mono text-faint">{num(route.latency_ms, 1)}ms</span>
        </button>
      )}>
      {() => (
        <div>
          <div className="mb-1.5 flex items-center gap-2 px-1 text-[11.5px] text-muted">
            <Route size={12} className="text-cyan" /> {t('chat.route.router')} · <span className="font-mono">{route.model_version}</span>
            {route.needs_review && <Badge tone="amber">{t('chat.route.needsReview')}</Badge>}
          </div>
          <JsonView value={route} className="max-h-[300px]" />
        </div>
      )}
    </Popover>
  );
}

function GuardChip({ guard }: { guard: GuardDecision }) {
  const t = useT();
  const d = guard.decision;
  const Icon = d === 'allow' ? ShieldCheck : d === 'deny' ? ShieldX : ShieldAlert;
  const tone = d === 'allow' ? 'ok' : d === 'deny' ? 'danger' : 'amber';
  return (
    <Badge tone={tone} title={`${guard.reason}${guard.rule_ids?.length ? `\n${t('chat.guard.rules', { ids: guard.rule_ids.join(', ') })}` : ''}`}>
      <Icon size={11} /><span className="font-mono">{guard.category}</span>· {t(`chat.guard.${d}`, d)}
    </Badge>
  );
}

function Thinking({ text, streaming }: { text: string; streaming: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const isOpen = open || streaming;
  return (
    <div className="mb-2 rounded-md border border-border bg-surface/60">
      <button className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] text-muted hover:text-text" onClick={() => setOpen((o) => !o)}>
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} className="text-cyan" />
        {streaming ? <span className="flex items-center gap-1.5">{t('chat.thinking')} <Spinner size={11} /></span> : <span>{t('chat.thoughtProcess')}</span>}
        <span className="ml-auto font-mono text-[10.5px] text-faint">{t('chat.tok', { n: Math.ceil(text.length / 4) })}</span>
      </button>
      {isOpen && (
        <div className="max-h-[260px] overflow-y-auto whitespace-pre-wrap border-t border-border px-3 py-2 text-[12px] italic leading-relaxed text-muted">{text}</div>
      )}
    </div>
  );
}

function initialRating(m: UIMessage): number {
  const f = m.feedback;
  if (typeof f === 'number') return f;
  if (f && typeof f === 'object' && typeof f.rating === 'number') return f.rating;
  return 0;
}

function FeedbackButtons({ m }: { m: UIMessage }) {
  const t = useT();
  const [rating, setRating] = useState<number>(() => initialRating(m));
  const [pending, setPending] = useState<1 | -1 | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const persisted = !!m.id && !m.id.startsWith('local-');
  if (!persisted) return null;
  const submit = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await api.post(`/api/messages/${encodeURIComponent(m.id)}/feedback`, comment.trim() ? { rating: pending, comment: comment.trim() } : { rating: pending });
      setRating(pending);
      toast.success(t('chat.feedback.thanks'));
      setPending(null); setComment('');
    } catch (e) {
      toast.error(t('chat.feedback.failed'), errMsg(e));
    } finally { setBusy(false); }
  };
  return (
    <>
      <button className={cx('btn btn-ghost btn-icon', rating > 0 ? 'text-ok' : 'text-muted')} title={t('chat.helpful')} aria-pressed={rating > 0}
        onClick={() => { setComment(''); setPending(1); }}><ThumbsUp size={13} fill={rating > 0 ? 'currentColor' : 'none'} /></button>
      <button className={cx('btn btn-ghost btn-icon', rating < 0 ? 'text-amber' : 'text-muted')} title={t('chat.notHelpful')} aria-pressed={rating < 0}
        onClick={() => { setComment(''); setPending(-1); }}><ThumbsDown size={13} fill={rating < 0 ? 'currentColor' : 'none'} /></button>
      <Modal open={pending !== null} onClose={() => setPending(null)} width={440}
        title={<span className="flex items-center gap-2">{pending === 1 ? <ThumbsUp size={14} className="text-ok" /> : <ThumbsDown size={14} className="text-amber" />}{pending === 1 ? t('chat.helpful') : t('chat.notHelpful')}</span>}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setPending(null)}>{t('btn.cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? <Spinner className="!text-[#1a1204]" /> : null}{t('btn.submit')}</button>
        </>}>
        <div className="space-y-2">
          <div className="text-[12.5px] text-muted">{pending === 1 ? t('chat.feedback.goodQ') : t('chat.feedback.badQ')}</div>
          <textarea autoFocus className="input min-h-[90px]" value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder={pending === 1 ? t('chat.feedback.goodPh') : t('chat.feedback.badPh')} />
          <div className="text-[11px] text-faint">{t('chat.feedback.note')}</div>
        </div>
      </Modal>
    </>
  );
}

function StatsFooter({ m, canRegen, onRegen }: { m: UIMessage; canRegen: boolean; onRegen?: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const s = m.stats;
  const copy = async () => {
    try { await navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-faint">
      {s && (
        <>
          <span className="inline-flex items-center gap-1 text-cyan/80"><Gauge size={11} />{num(s.tok_per_s, 1)} tok/s</span>
          <span>{t('chat.stats.inOut', { in: s.tokens_in ?? '—', out: s.tokens_out ?? '—' })}</span>
          <span>TTFT {num(s.ttft_ms, 0)}ms</span>
          <span>{num((s.total_ms ?? 0) / 1000, 2)}s</span>
          <span>{t('chat.stats.stop', { r: s.stop_reason })}</span>
          <span className="text-muted">{s.model_name}</span>
          <span className="uppercase">{s.engine}</span>
        </>
      )}
      <span className="ml-auto flex items-center gap-0.5 font-sans">
        <FeedbackButtons m={m} />
        <button className="btn btn-ghost btn-icon text-muted" title={t('btn.copy')} onClick={copy}>{copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}</button>
        {canRegen && <button className="btn btn-ghost btn-icon text-muted" title={t('chat.regenerate')} onClick={onRegen}><RefreshCw size={13} /></button>}
      </span>
    </div>
  );
}

function AssistantMessageImpl({ m, isLast, busy, showStats, question, onRegenerate }: {
  m: UIMessage; isLast: boolean; busy: boolean; showStats: boolean; question?: string; onRegenerate?: () => void;
}) {
  const t = useT();
  const cite = (sid: string) => flashSource(m.id, sid);
  const components: Components = {
    a: ({ href, children }) => {
      if (href && href.startsWith('#cite-')) {
        const sid = href.slice(6);
        return (
          <button type="button" onClick={() => cite(sid)}
            className="mx-0.5 inline-flex -translate-y-px items-center rounded bg-cyan/15 px-1 align-baseline font-mono text-[10.5px] font-semibold leading-4 text-cyan no-underline hover:bg-cyan/30">
            {sid}
          </button>
        );
      }
      return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
    },
  };
  const waiting = m.streaming && !m.content && !m.reasoning && !m.error;
  const hasHeader = m.route || m.guard;
  return (
    <div className="group flex gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-cyan/30 bg-cyan/10 font-mono text-[11px] font-bold text-cyan">Y</div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-semibold">Yukti</span>
          {m.route && <RouteChip route={m.route} />}
          {m.guard && <GuardChip guard={m.guard} />}
          {!hasHeader && m.streaming && <span className="text-[11px] text-faint">{t('chat.routing')}</span>}
        </div>
        {m.reasoning ? <Thinking text={m.reasoning} streaming={!!m.streaming && !m.content} /> : null}
        {waiting && <div className="flex items-center gap-2 py-1 text-[12px] text-muted"><Spinner size={12} />{t('chat.generating')}</div>}
        {m.content && (
          <div className={cx('md', m.streaming && 'caret')}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{linkCitations(m.content)}</ReactMarkdown>
          </div>
        )}
        {m.error && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-red-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
            <div><span className="font-mono text-[11px] text-red-300">{m.error.code}</span> {m.error.message}</div>
          </div>
        )}
        {m.facts && m.facts.length > 0 && <FactsTable facts={m.facts} onCite={cite} />}
        {m.sources && m.sources.length > 0 && <SourcesRow msgId={m.id} sources={m.sources} />}
        {m.denied && m.denied.count > 0 && <DeniedCard denied={m.denied} question={question} suggest={m.route?.department} />}
        {!m.streaming && (
          <StatsFooter m={showStats ? m : { ...m, stats: null }} canRegen={isLast && !busy && !!onRegenerate} onRegen={onRegenerate} />
        )}
      </div>
    </div>
  );
}

export const AssistantMessage = memo(AssistantMessageImpl);

export function UserMessage({ m }: { m: UIMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-lg rounded-br-sm border border-border bg-surface-2 px-3 py-2 text-[13.5px]">
        {m.content}
      </div>
    </div>
  );
}
