import { Check, Mic, MicOff, Square, X } from 'lucide-react';
import { cx } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { MAX_SECONDS, type VoiceState } from '../../lib/voice';
import { Kbd, Spinner, Tip } from '../ui';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Microphone button in the composer toolbar. `unavailable` = speech is off on this server (reason shown on hover and on click). */
export function MicButton({ state, onToggle, unavailable, onUnavailable, disabled }: {
  state: VoiceState; onToggle: () => void; unavailable?: string | null; onUnavailable: () => void; disabled?: boolean;
}) {
  const t = useT();
  const recording = state === 'recording';
  const working = state === 'starting' || state === 'transcribing';
  if (unavailable) {
    return (
      <Tip side="top" text={<><div className="font-medium">{t('voice.unavailable')}</div>{unavailable && <div className="mt-0.5 text-muted">{unavailable}</div>}</>}>
        <button type="button" aria-disabled="true" aria-label={t('voice.unavailable')} onClick={onUnavailable}
          className="btn btn-ghost btn-sm cursor-not-allowed text-faint">
          <MicOff size={15} /><span className="hidden md:inline">{t('voice.speak')}</span>
        </button>
      </Tip>
    );
  }
  const label = recording ? t('voice.stopTip') : t('voice.startTip');
  return (
    <button type="button" onClick={onToggle} disabled={disabled || working} aria-label={label} title={label} aria-pressed={recording}
      className={cx('btn btn-sm', recording ? 'btn-danger' : 'btn-ghost text-muted hover:text-text')}>
      {working ? <Spinner size={14} /> : recording ? <Square size={12} fill="currentColor" /> : <Mic size={15} />}
      <span className="hidden md:inline">{recording ? t('voice.stop') : t('voice.speak')}</span>
    </button>
  );
}

/** Strip shown inside the composer while listening / converting. */
export function VoiceBar({ state, elapsed, level, onStop, onCancel }: {
  state: VoiceState; elapsed: number; level: number; onStop: () => void; onCancel: () => void;
}) {
  const t = useT();
  if (state === 'idle') return null;
  const BARS = 14;
  const lit = Math.round(level * BARS);
  const left = Math.max(0, MAX_SECONDS - elapsed);
  return (
    // only the status words are announced: a live region around the timer and level meter would be read out non-stop
    <div
      className={cx('flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2',
        state === 'recording' ? 'border-danger/30 bg-danger/[0.07]' : 'border-border bg-surface-2/60')}>
      {state === 'recording' ? (
        <>
          <span className="relative inline-flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-70" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-danger" />
          </span>
          <span role="status" aria-live="polite" className="text-[13px] font-medium">{t('voice.listening')}</span>
          <span className={cx('font-mono text-[12.5px] tabular-nums', left <= 10 ? 'text-amber' : 'text-muted')}
            title={t('voice.maxTip', { n: MAX_SECONDS })}>
            {mmss(elapsed)} / {mmss(MAX_SECONDS)}
          </span>
          <span className="flex h-5 items-end gap-[2px]" aria-label={t('voice.level')} role="meter"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
            {Array.from({ length: BARS }, (_, i) => (
              <span key={i} className={cx('w-[4px] rounded-sm transition-colors duration-75',
                i < lit ? (i >= BARS - 2 ? 'bg-amber' : 'bg-ok') : 'bg-surface-3')}
                style={{ height: `${30 + (i / BARS) * 70}%` }} />
            ))}
          </span>
          {level < 0.05 && elapsed > 2 && <span className="text-[11.5px] text-amber">{t('voice.quiet')}</span>}
          <span className="ml-auto flex items-center gap-1.5">
            <button type="button" className="btn btn-sm btn-primary" onClick={onStop} aria-label={t('voice.done')}>
              <Check size={13} />{t('voice.done')}
            </button>
            <button type="button" className="btn btn-sm btn-ghost text-muted" onClick={onCancel} aria-label={t('voice.cancel')}>
              <X size={13} /><span className="hidden sm:inline">{t('voice.cancel')}</span> <span className="hidden lg:inline"><Kbd>Esc</Kbd></span>
            </button>
          </span>
        </>
      ) : (
        <>
          <Spinner size={14} />
          <span role="status" aria-live="polite" className="text-[13px]">{state === 'starting' ? t('voice.starting') : t('voice.converting')}</span>
          <button type="button" className="btn btn-sm btn-ghost ml-auto text-muted" onClick={onCancel} aria-label={t('voice.cancel')}>
            <X size={13} />{t('voice.cancel')}
          </button>
        </>
      )}
    </div>
  );
}
