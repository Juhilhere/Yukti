import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight, ImageOff, ScanText, Tag } from 'lucide-react';
import { cx } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { attachmentUrl } from '../../lib/photos';
import type { PhotoReading } from '../../lib/types';
import { Modal } from '../Modal';
import { Spinner } from '../ui';

/** Thumbnails of the photos a user sent; click opens the full picture. */
export function UserPhotos({ ids }: { ids: string[] }) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  if (!ids.length) return null;
  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        {ids.map((id, i) => (
          <button key={id} type="button" onClick={() => setOpen(i)} aria-label={t('photo.open', { n: i + 1 })} title={t('photo.open', { n: i + 1 })}
            className="h-[96px] w-[96px] overflow-hidden rounded-md border border-border bg-surface-2 transition-colors hover:border-cyan/60 focus-visible:border-cyan">
            <SafeImg src={attachmentUrl(id, true)} alt={t('photo.alt', { n: i + 1 })} className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {open !== null && <PhotoViewer ids={ids} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
}

function SafeImg({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const t = useT();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  if (state === 'error') {
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-[10.5px] text-faint">
        <ImageOff size={18} />{t('photo.unavailable')}
      </span>
    );
  }
  return (
    <span className="relative block h-full w-full">
      {state === 'loading' && <span className="absolute inset-0 flex items-center justify-center"><Spinner size={14} /></span>}
      <img src={src} alt={alt} className={className} onLoad={() => setState('ok')} onError={() => setState('error')} />
    </span>
  );
}

function PhotoViewer({ ids, index, onIndex, onClose }: { ids: string[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const t = useT();
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const id = ids[index];
  return (
    <Modal open onClose={onClose} width={1100} title={ids.length > 1 ? t('photo.viewerN', { n: index + 1, total: ids.length }) : t('photo.viewer')}>
      <div className="flex flex-col items-center gap-3">
        {failed[id] ? (
          <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-muted"><ImageOff size={28} />{t('photo.unavailable')}</div>
        ) : (
          <img key={id} src={attachmentUrl(id)} alt={t('photo.alt', { n: index + 1 })}
            className="max-h-[68vh] w-auto max-w-full rounded-md object-contain"
            onError={() => setFailed((f) => ({ ...f, [id]: true }))} />
        )}
        {ids.length > 1 && (
          <div className="flex flex-wrap justify-center gap-2">
            {ids.map((x, i) => (
              <button key={x} type="button" onClick={() => onIndex(i)} aria-label={t('photo.open', { n: i + 1 })} aria-current={i === index}
                className={cx('h-14 w-14 overflow-hidden rounded border', i === index ? 'border-cyan' : 'border-border opacity-70 hover:opacity-100')}>
                <img src={attachmentUrl(x, true)} alt={t('photo.alt', { n: i + 1 })} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

const pct = (c: number) => Math.round(c > 1 ? c : c * 100);

/** "What Yukti read in the photo": the text lines read, recognised equipment tags, and the no-vision note. */
export function PhotoReadingCard({ photo }: { photo: PhotoReading }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const images = photo.images ?? [];
  const nLines = images.reduce((s, im) => s + (im.lines?.length ?? 0), 0);
  const tags = images.flatMap((im) => im.tags ?? []).filter((tg, i, all) => all.findIndex((x) => x.tag === tg.tag) === i);
  return (
    <div className="mb-2 rounded-md border border-border bg-surface/60 text-[12.5px]">
      <button type="button" className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5 text-left text-muted hover:text-text"
        onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <ScanText size={13} className="text-cyan" />
        <span className="font-medium">{t('photo.read.title')}</span>
        <span className="text-[11px] text-faint">
          {nLines ? t('photo.read.lines', { n: nLines }) : t('photo.read.noText')}
          {tags.length > 0 && ` · ${t('photo.read.tagsN', { n: tags.length })}`}
        </span>
      </button>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
          {tags.map((tg) => (
            <Link key={tg.tag} to={`/assets?q=${encodeURIComponent(tg.tag)}`} title={t('photo.read.tagTip', { tag: tg.tag })}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-cyan/40 bg-cyan/10 px-2 py-0.5 text-[11.5px] text-cyan hover:border-cyan hover:bg-cyan/20">
              <Tag size={10} className="shrink-0" />
              <span className="font-mono font-semibold">{tg.tag}</span>
              {tg.asset_name && <span className="truncate text-text/80">· {tg.asset_name}</span>}
            </Link>
          ))}
        </div>
      )}
      {!photo.vision && photo.note && (
        <div className="mx-2.5 mb-2 flex items-start gap-2 rounded border border-amber/40 bg-amber/10 px-2.5 py-1.5 text-[12px] text-amber">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span className="text-text/90">{photo.note}</span>
        </div>
      )}
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {images.map((im, i) => (
            <div key={im.id || i}>
              {images.length > 1 && <div className="label mb-1 !text-[10px]">{t('photo.read.photoN', { n: i + 1 })}</div>}
              {im.lines?.length ? (
                <ul className="space-y-0.5 font-mono text-[12px] leading-relaxed">
                  {im.lines.map((ln, j) => {
                    const c = pct(ln.conf);
                    const unsure = c < 60;
                    return (
                      <li key={j} className={cx('break-words', unsure ? 'text-faint' : 'text-text')}
                        title={t('photo.read.conf', { n: c })}>
                        {ln.text}{unsure && <span className="ml-1.5 font-sans text-[10.5px] text-amber">({t('photo.read.unsure')})</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : im.text ? (
                <div className="whitespace-pre-wrap font-mono text-[12px]">{im.text}</div>
              ) : (
                <div className="text-[12px] text-faint">{t('photo.read.noText')}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
