import { useQuery } from '@tanstack/react-query';
import { Camera, CheckCircle2, Info, Mic, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { cx } from '../lib/format';
import { ErrorBox, Spinner } from './ui';

export type Features = {
  /** installed: a model that can see photos is on the server computer (add-on, LM Studio, Ollama) or loaded;
   *  active: the loaded model sees photos; models: which ones can (administrators only) */
  vision: { installed: boolean; active: boolean; loaded?: boolean; models?: string[] };
  voice: { installed: boolean };
  /** the server computer has an NVIDIA graphics card (the voice add-on is then larger and faster) */
  gpu?: boolean;
  /** installed with Yukti-Setup: the desktop app on the server computer can download add-ons (not a complete zip package) */
  downloadable?: boolean;
  can_manage: boolean;
};

export function useFeatures() {
  // refetched when the window gets focus again: after adding or removing an ability the page must not keep old answers
  return useQuery({ queryKey: ['features'], queryFn: () => api.get<Features>('/api/features', { silent: true }), staleTime: 30_000, refetchOnWindowFocus: true });
}

/** Running inside the Yukti desktop app (which can download add-ons on the server computer). */
export const inDesktopApp = () => typeof navigator !== 'undefined' && /\bYuktiDesktop\//.test(navigator.userAgent);

/** The desktop app on the server computer itself (its own Yukti server always listens on this computer). Only there can
 *  abilities be added; a desktop app connected to a plant server elsewhere would open an add-on screen with nothing to add. */
export const canAddHere = () => inDesktopApp() && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(window.location.hostname);

const ITEMS = [
  { key: 'vision' as const, icon: Camera, title: 'feat.vision.title', body: 'feat.vision.body' },
  { key: 'voice' as const, icon: Mic, title: 'feat.voice.title', body: 'feat.voice.body' },
];

/** Opens the desktop app's own add-on screen (download, pause, remove). The web page itself never downloads anything. */
function openDesktop(add?: string) {
  window.location.assign(add ? `/desktop/features?add=${add}` : '/desktop/features');
}

/**
 * Photos and voice are optional abilities, downloaded later so the first download stays small.
 * home: shown to administrators on the home screen only while something is missing.
 * panel: Admin > New abilities, with status and add/remove.
 */
export default function FeatureOffers({ variant }: { variant: 'home' | 'panel' }) {
  const t = useT();
  const q = useFeatures();
  const f = q.data;
  if (!f) {
    // the home screen stays quiet; the admin panel must never be an empty page
    if (variant === 'home') return null;
    return (
      <div className="max-w-[820px]">
        {q.isLoading ? <Spinner /> : <ErrorBox error={q.error ?? t('feat.loadFailed')} onRetry={() => void q.refetch()} />}
      </div>
    );
  }
  if (!f.can_manage) return null;
  const missing = ITEMS.filter((x) => !f[x.key].installed);
  if (variant === 'home' && missing.length === 0) return null;
  const here = canAddHere() && f.downloadable !== false;
  const list = variant === 'home' ? missing : ITEMS;
  const size = (key: 'vision' | 'voice') => t(key === 'vision' ? 'feat.vision.size' : f.gpu ? 'feat.voice.sizeGpu' : 'feat.voice.size');
  return (
    <div className={cx('w-full', variant === 'home' ? 'mt-6 max-w-[760px]' : 'max-w-[820px]')}>
      <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-cyan">
        <Sparkles size={14} />{t('feat.heading')}
      </div>
      <div className={cx('grid gap-2.5', variant === 'home' && list.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1')}>
        {list.map((x) => {
          const on = f[x.key].installed;
          const Icon = x.icon;
          const visionIdle = x.key === 'vision' && on && !f.vision.active && f.vision.loaded !== false;  // a text-only model is loaded
          return (
            <div key={x.key} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center gap-2 font-medium">
                <Icon size={16} className="text-cyan" />{t(x.title)}
                {on && <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-ok"><CheckCircle2 size={13} />{t('feat.added')}</span>}
              </div>
              <p className="mt-1 text-[12.5px] text-muted">{t(x.body)}</p>
              {!on && x.key === 'vision' && <p className="mt-1 text-[12px] text-faint">{t('feat.vision.withoutIt')}</p>}
              {variant === 'panel' && visionIdle && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-amber"><Info size={13} className="mt-0.5 shrink-0" />{t('feat.vision.notActive')}</p>
              )}
              {variant === 'panel' && x.key === 'vision' && on && !!f.vision.models?.length && (
                <p className="mt-1 text-[11.5px] text-faint">{t('feat.vision.models', { models: f.vision.models.join(', ') })}</p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {here ? (
                  on ? (
                    variant === 'panel' && <button className="btn btn-sm btn-ghost" onClick={() => openDesktop()}>{t('feat.manage')}</button>
                  ) : (
                    <button className="btn btn-sm btn-primary" onClick={() => openDesktop(x.key)}>{t('feat.add', { size: size(x.key) })}</button>
                  )
                ) : (
                  !on && <p className="text-[12px] text-warn">{t(f.downloadable === false ? 'feat.needPackage' : 'feat.onServerPc')}</p>
                )}
                {!on && here && <span className="text-[11.5px] text-faint">{t('feat.once')}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
