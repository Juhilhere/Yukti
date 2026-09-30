import { useQuery } from '@tanstack/react-query';
import { Camera, CheckCircle2, Mic, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { cx } from '../lib/format';

export type Features = {
  vision: { installed: boolean; active: boolean };
  voice: { installed: boolean };
  can_manage: boolean;
};

export function useFeatures() {
  return useQuery({ queryKey: ['features'], queryFn: () => api.get<Features>('/api/features'), staleTime: 30_000 });
}

/** Running inside the Yukti desktop app (which can download add-ons on the server computer). */
export const inDesktopApp = () => typeof navigator !== 'undefined' && /\bYuktiDesktop\//.test(navigator.userAgent);

const ITEMS = [
  { key: 'vision' as const, icon: Camera, title: 'feat.vision.title', body: 'feat.vision.body', size: 'feat.vision.size' },
  { key: 'voice' as const, icon: Mic, title: 'feat.voice.title', body: 'feat.voice.body', size: 'feat.voice.size' },
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
  if (!f || !f.can_manage) return null;
  const missing = ITEMS.filter((x) => !f[x.key].installed);
  if (variant === 'home' && missing.length === 0) return null;
  const desktop = inDesktopApp();
  const list = variant === 'home' ? missing : ITEMS;
  return (
    <div className={cx('w-full', variant === 'home' ? 'mt-6 max-w-[760px]' : 'max-w-[820px]')}>
      <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-cyan">
        <Sparkles size={14} />{t('feat.heading')}
      </div>
      <div className={cx('grid gap-2.5', variant === 'home' && list.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1')}>
        {list.map((x) => {
          const on = f[x.key].installed;
          const Icon = x.icon;
          return (
            <div key={x.key} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center gap-2 font-medium">
                <Icon size={16} className="text-cyan" />{t(x.title)}
                {on && <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-ok"><CheckCircle2 size={13} />{t('feat.added')}</span>}
              </div>
              <p className="mt-1 text-[12.5px] text-muted">{t(x.body)}</p>
              {!on && x.key === 'vision' && <p className="mt-1 text-[12px] text-faint">{t('feat.vision.withoutIt')}</p>}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {desktop ? (
                  on ? (
                    variant === 'panel' && <button className="btn btn-sm btn-ghost" onClick={() => openDesktop()}>{t('feat.manage')}</button>
                  ) : (
                    <button className="btn btn-sm btn-primary" onClick={() => openDesktop(x.key)}>{t('feat.add', { size: t(x.size) })}</button>
                  )
                ) : (
                  !on && <p className="text-[12px] text-warn">{t('feat.onServerPc')}</p>
                )}
                {!on && desktop && <span className="text-[11.5px] text-faint">{t('feat.once')}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
