import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Info, Inbox, Loader2 } from 'lucide-react';
import { cx } from '../lib/format';
import { errMsg } from '../lib/api';
import { LANGS, setLang, useLang, useT } from '../lib/i18n';
import { uiStore } from '../lib/queries';

/* ---------- Badge / StatusChip ---------- */
export type Tone = 'neutral' | 'amber' | 'cyan' | 'danger' | 'ok' | 'muted' | 'violet';
const toneCls: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-text border-border',
  muted: 'bg-transparent text-muted border-border',
  amber: 'bg-amber/10 text-amber border-amber/40',
  cyan: 'bg-cyan/10 text-cyan border-cyan/40',
  danger: 'bg-danger/10 text-red-300 border-danger/40',
  ok: 'bg-ok/10 text-green-300 border-ok/40',
  violet: 'bg-violet-500/10 text-violet-300 border-violet-500/40',
};
export function Badge({ tone = 'neutral', mono, children, className, title, dashed }: {
  tone?: Tone; mono?: boolean; children: ReactNode; className?: string; title?: string; dashed?: boolean;
}) {
  return (
    <span title={title} className={cx(
      'inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] leading-4 font-medium whitespace-nowrap',
      dashed && 'border-dashed', mono && 'font-mono', toneCls[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  KNOWN: 'cyan', MISSING: 'muted', CONFLICTING: 'amber', CURRENT: 'ok', SUPERSEDED: 'amber',
  allow: 'ok', deny: 'danger', review: 'amber', ready: 'ok', loading: 'cyan', idle: 'muted', error: 'danger',
  done: 'ok', running: 'cyan', queued: 'muted', pending: 'muted', skipped: 'muted',
  approved: 'ok', rejected: 'danger', open: 'amber', acknowledged: 'cyan', escalated: 'violet', expired: 'muted', revoked: 'muted',
  red: 'danger', amber: 'amber', info: 'cyan', critical: 'danger', high: 'danger', medium: 'amber', low: 'cyan',
  PUBLIC: 'ok', INTERNAL: 'cyan', RESTRICTED: 'amber', CONFIDENTIAL: 'danger',
  digital: 'cyan', scanned: 'amber', image: 'violet',
};
export function toneFor(s?: string | null): Tone {
  if (!s) return 'muted';
  return STATUS_TONES[s] ?? STATUS_TONES[s.toLowerCase()] ?? STATUS_TONES[s.toUpperCase()] ?? 'neutral';
}
export function StatusChip({ status, className, title }: { status?: string | null; className?: string; title?: string }) {
  const tone = toneFor(status);
  const t = useT();
  const label = status ? t(`status.${status}`, status) : '—';
  return <Badge tone={tone} mono dashed={status === 'MISSING'} className={className} title={title ?? (label !== status ? status ?? undefined : undefined)}>{label}</Badge>;
}

/** EXAMPLE / PUBLIC SOURCE provenance badges for documents, sources, assets, findings. */
export function ProvenanceBadges({ isExample, isPublic }: { isExample?: boolean | null; isPublic?: boolean | null }) {
  const t = useT();
  return <>
    {isExample ? <Badge tone="amber" className="font-semibold tracking-wide" title={t('badge.example.tip')}>{t('badge.example')}</Badge> : null}
    {isPublic ? <Badge tone="ok" className="font-semibold tracking-wide" title={t('badge.public.tip')}>{t('badge.public')}</Badge> : null}
  </>;
}

/** Language selector (English / हिंदी / ಕನ್ನಡ) — stored in localStorage. */
export function LangSwitcher({ className }: { className?: string }) {
  const lang = useLang();
  const t = useT();
  return (
    <div className={cx('inline-flex overflow-hidden rounded-md border border-border', className)} role="group" aria-label={t('menu.language')}>
      {LANGS.map((l) => (
        <button key={l.id} type="button" onClick={() => setLang(l.id)}
          className={cx('px-2.5 py-1 text-[12px] transition-colors', lang === l.id ? 'bg-amber/15 text-amber' : 'text-muted hover:bg-surface-3 hover:text-text')}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

export function Dot({ tone = 'ok', pulse }: { tone?: 'ok' | 'amber' | 'danger' | 'muted' | 'cyan'; pulse?: boolean }) {
  const c = { ok: 'bg-ok', amber: 'bg-amber', danger: 'bg-danger', muted: 'bg-faint', cyan: 'bg-cyan' }[tone];
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && <span className={cx('absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping', c)} />}
      <span className={cx('relative inline-flex h-2 w-2 rounded-full', c)} />
    </span>
  );
}

/* ---------- Card ---------- */
export function Card({ title, actions, children, className, bodyClass, icon, id }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; icon?: ReactNode; id?: string;
}) {
  return (
    <section id={id} className={cx('rounded-md border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex items-center gap-2 font-semibold text-[13px]">{icon}{title}</div>
          <div className="flex items-center gap-1.5">{actions}</div>
        </header>
      )}
      <div className={cx('p-3', bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && <div className="text-muted">{icon}</div>}
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold leading-tight">{title}</h1>
          {subtitle && <div className="text-muted text-[12px] mt-0.5">{subtitle}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}

/* ---------- Spinner / Empty / Error ---------- */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx('animate-spin text-cyan', className)} />;
}
export function Loading({ label }: { label?: string }) {
  const t = useT();
  return <div className="flex items-center justify-center gap-2 py-10 text-muted"><Spinner />{label ?? t('common.loading')}</div>;
}
export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted">
      <div className="text-faint">{icon ?? <Inbox size={28} />}</div>
      <div className="font-medium text-text">{title}</div>
      {hint && <div className="max-w-md text-[12px]">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
export function ErrorBox({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const t = useT();
  if (!error) return null;
  return (
    <div className={cx('flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-red-200', className)}>
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
      <div className="flex-1 min-w-0 break-words">{errMsg(error)}</div>
      <button className="btn btn-sm btn-ghost" title={t('report.title', 'Report a problem')} onClick={() => uiStore.openReport(errMsg(error))}>{t('report.short', 'Report')}</button>
      {onRetry && <button className="btn btn-sm btn-ghost" onClick={onRetry}>{t('btn.retry', 'Retry')}</button>}
    </div>
  );
}
/** Standard wrapper for react-query results. */
export function QueryState({ q, children, empty, emptyTitle, emptyHint }: {
  q: { isLoading: boolean; error: unknown; refetch: () => unknown; data?: unknown };
  children: ReactNode; empty?: boolean; emptyTitle?: string; emptyHint?: ReactNode;
}) {
  const t = useT();
  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="p-3"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>;
  if (empty) return <EmptyState title={emptyTitle ?? t('common.nothingYet')} hint={emptyHint} />;
  return <>{children}</>;
}

/** Render a translated string that contains simple markup: '<b>bold</b>', '<link>text</link>' or a self-closing '<icon/>'.
 *  Each tag name maps to a renderer; unknown tags are shown as plain text. */
export function rich(text: string, tags: Record<string, (chunk: string) => ReactNode>): ReactNode {
  const out: ReactNode[] = [];
  const rx = /<(\w+)\/>|<(\w+)>([\s\S]*?)<\/\2>/g;
  let last = 0; let i = 0; let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const fn = tags[m[1] ?? m[2]];
    out.push(<Fragment key={i++}>{fn ? fn(m[3] ?? '') : (m[3] ?? '')}</Fragment>);
    last = rx.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/* ---------- Tooltip / InfoTip ---------- */
export function Tip({ text, children, side = 'right' }: { text: ReactNode; children: ReactNode; side?: 'right' | 'top' | 'bottom' | 'left' }) {
  const pos = {
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  }[side];
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span className={cx('pointer-events-none absolute z-50 hidden w-max max-w-[280px] rounded-md border border-border bg-surface-3 px-2 py-1 text-[11.5px] font-normal normal-case tracking-normal text-text shadow-xl group-hover/tip:block', pos)}>
        {text}
      </span>
    </span>
  );
}
export function InfoTip({ text }: { text: ReactNode }) {
  if (!text) return null;
  return <Tip text={text} side="top"><Info size={12} className="text-faint hover:text-muted cursor-help" /></Tip>;
}

/* ---------- Tabs ---------- */
export function Tabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div className={cx('flex items-center gap-1 border-b border-border', className)}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={cx('relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors',
            value === t.id ? 'border-amber text-text' : 'border-transparent text-muted hover:text-text')}>
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="rounded bg-surface-3 px-1.5 font-mono text-[10.5px] text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Toggle ---------- */
export function Toggle({ checked, onChange, label, disabled, size = 'md' }: {
  checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; size?: 'sm' | 'md';
}) {
  const w = size === 'sm' ? 'h-4 w-7' : 'h-[18px] w-8';
  const k = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const tx = size === 'sm' ? 'translate-x-3' : 'translate-x-[14px]';
  return (
    <label className={cx('inline-flex items-center gap-2 select-none', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cx('relative inline-flex shrink-0 items-center rounded-full border transition-colors', w,
          checked ? 'bg-cyan/80 border-cyan' : 'bg-surface-3 border-border-strong')}>
        <span className={cx('inline-block rounded-full bg-white shadow transition-transform translate-x-[2px]', k, checked && tx)} />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}

/* ---------- Slider (range + number) ---------- */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, unit, disabled }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = (s: string) => {
    const n = Number(s);
    if (s.trim() === '' || !isFinite(n)) { setText(String(value)); return; }
    onChange(n);
  };
  return (
    <div className="flex items-center gap-2">
      <input type="range" className="slider flex-1" min={min} max={max} step={step} value={isFinite(value) ? value : min}
        disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="flex items-center">
        <input className="input !w-[72px] !py-0.5 text-right font-mono text-[12px]" value={text} disabled={disabled}
          onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }} />
        {unit && <span className="ml-1 text-[11px] text-muted">{unit}</span>}
      </div>
    </div>
  );
}

/* ---------- Select ---------- */
export function Select<T extends string>({ value, onChange, options, className, placeholder, disabled }: {
  value: T | ''; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; placeholder?: string; disabled?: boolean;
}) {
  return (
    <select className={cx('input', className)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-faint">{hint}</div>}
    </label>
  );
}

/* ---------- Popover / Menu ---------- */
export function useClickOutside<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open, onClose]);
  return ref;
}

export function Popover({ trigger, children, align = 'left', className, direction = 'down' }: {
  trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode;
  align?: 'left' | 'right'; className?: string; direction?: 'down' | 'up';
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative inline-flex">
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div className={cx('absolute z-50 min-w-[180px] rounded-md border border-border bg-surface-2 shadow-2xl',
          direction === 'down' ? 'top-full mt-1' : 'bottom-full mb-1',
          align === 'left' ? 'left-0' : 'right-0', className)}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
export function MenuItem({ icon, children, onClick, danger }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-surface-3',
      danger ? 'text-red-300' : 'text-text')}>
      {icon && <span className="text-muted">{icon}</span>}{children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-2 px-1 font-mono text-[10.5px] text-muted">{children}</kbd>;
}

export function Meter({ pct, tone = 'cyan', className }: { pct: number; tone?: 'cyan' | 'amber' | 'danger' | 'ok'; className?: string }) {
  const c = { cyan: 'bg-cyan', amber: 'bg-amber', danger: 'bg-danger', ok: 'bg-ok' }[tone];
  const p = Math.max(0, Math.min(100, isFinite(pct) ? pct : 0));
  return <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}><div className={cx('h-full rounded-full', c)} style={{ width: `${p}%` }} /></div>;
}

export function JsonView({ value, className }: { value: unknown; className?: string }) {
  let s: string;
  try { s = JSON.stringify(value, null, 2); } catch { s = String(value); }
  return <pre className={cx('overflow-auto rounded-md border border-border bg-bg p-2.5 font-mono text-[11.5px] leading-relaxed text-cyan/90', className)}>{s}</pre>;
}
