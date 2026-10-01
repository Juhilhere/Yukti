import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent } from 'react';
import { AlertTriangle, ArrowUp, BookOpen, BookX, Camera, ImagePlus, Info, Square, X } from 'lucide-react';
import { cx, estimateTokens } from '../../lib/format';
import { Kbd, Spinner, Tip } from '../ui';
import { useT } from '../../lib/i18n';
import { deleteUploadedPhoto, isImageFile, MAX_PHOTOS, MAX_SOURCE_BYTES, MAX_UPLOAD_BYTES, photoErrorText, preparePhoto, uploadPhoto } from '../../lib/photos';
import { useSpeechStatus, useVoiceInput } from '../../lib/voice';
import { MicButton, VoiceBar } from './VoiceInput';

type Att = {
  key: string; name: string; preview: string;
  status: 'processing' | 'uploading' | 'done' | 'error'; progress: number; id?: string; error?: string;
};
type Notice = { title: string; body?: string };

export type ComposerHandle = { addFiles: (files: File[]) => void };

const coarsePointer = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } };

export const Composer = forwardRef<ComposerHandle, {
  busy: boolean;
  /** resolves true when the question was sent; false = nothing was sent, so the text and photos stay in the box */
  onSend: (text: string, images: string[]) => Promise<boolean>; onStop: () => void; useKnowledge: boolean; onToggleKnowledge: () => void;
  sendWithEnter: boolean; modelReady: boolean; canLoadModel: boolean;
  /** show the rough token count of the question (administrators) */
  showTokens?: boolean; onOpenLoader: () => void; fullWidth: boolean;
  /** false = the loaded model can't see pictures (it only gets the text read from them) */
  vision?: boolean;
}>(function Composer({ busy, onSend, onStop, useKnowledge, onToggleKnowledge, sendWithEnter, modelReady, canLoadModel, showTokens = false, onOpenLoader, fullWidth, vision }, fwd) {
  const t = useT();
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<Att[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const attsRef = useRef<Att[]>([]);
  attsRef.current = atts;
  const aborts = useRef(new Map<string, () => void>());
  const dead = useRef(false);
  const submitting = useRef(false);
  const prepQueue = useRef<Promise<void>>(Promise.resolve());
  const [touch] = useState(coarsePointer);

  const speech = useSpeechStatus();
  const focusEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const n = el.value.length;
      el.setSelectionRange(n, n);
    });
  }, []);
  const voice = useVoiceInput((said) => {
    setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')} ${said}` : said));
    focusEnd();
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  useEffect(() => { ref.current?.focus(); }, []);
  // `dead` = the composer went away: a photo that is still being prepared must not start uploading afterwards
  useEffect(() => {
    dead.current = false;
    const running = aborts.current;
    return () => { dead.current = true; running.forEach((abort) => abort()); };
  }, []);
  // a newer photo notice replaces an older voice message (otherwise the old one would hide it)
  const clearVoiceError = voice.clearError;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (notice) clearVoiceError(); }, [notice]);

  const patch = (key: string, p: Partial<Att>) => setAtts((as) => as.map((a) => (a.key === key ? { ...a, ...p } : a)));

  const gone = (key: string) => dead.current || !attsRef.current.some((a) => a.key === key);  // removed / screen closed meanwhile

  /** Photos are prepared one after another: decoding several large pictures at once can exhaust the PC's memory. */
  const prepareInTurn = (key: string, file: File) => {
    const run = prepQueue.current.then(() => {
      if (gone(key)) throw new DOMException('aborted', 'AbortError');
      return preparePhoto(file);
    });
    prepQueue.current = run.then(() => undefined, () => undefined);
    return run;
  };

  const processOne = async (key: string, file: File) => {
    try {
      // far too large to even open: say so without decoding it
      if (file.size > MAX_SOURCE_BYTES) { patch(key, { status: 'error', error: t('photo.err.tooBig') }); return; }
      const prep = await prepareInTurn(key, file);
      if (gone(key)) return;
      if (prep.blob.size > MAX_UPLOAD_BYTES) { patch(key, { status: 'error', preview: prep.preview, error: t('photo.err.tooBig') }); return; }
      patch(key, { status: 'uploading', preview: prep.preview, progress: 0 });
      const up = uploadPhoto(prep.blob, prep.name, (pct) => patch(key, { progress: pct }));
      aborts.current.set(key, up.abort);
      const res = await up.promise;
      if (gone(key)) { deleteUploadedPhoto(res.id); return; }  // removed just as the upload finished: don't leave it on the server
      patch(key, { status: 'done', id: res.id, progress: 100 });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      patch(key, { status: 'error', error: photoErrorText(e) });
    } finally {
      aborts.current.delete(key);
    }
  };

  const addFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    const images = files.filter(isImageFile);
    const room = MAX_PHOTOS - attsRef.current.length;
    if (images.length < files.length) setNotice({ title: t('photo.err.notImage') });
    else setNotice(null);
    if (!images.length) return;
    if (room <= 0) { setNotice({ title: t('photo.err.max', { n: MAX_PHOTOS }) }); return; }
    if (images.length > room) setNotice({ title: t('photo.err.max', { n: MAX_PHOTOS }), body: t('photo.err.maxAdded', { n: room }) });
    const stamp = Date.now();
    const fresh: Att[] = images.slice(0, room).map((f, i) => ({ key: `${stamp}-${i}`, name: f.name || t('photo.photo'), preview: '', status: 'processing', progress: 0 }));
    attsRef.current = [...attsRef.current, ...fresh];
    setAtts((as) => [...as, ...fresh]);
    fresh.forEach((a, i) => void processOne(a.key, images[i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useImperativeHandle(fwd, () => ({ addFiles }), [addFiles]);

  const remove = (key: string) => {
    if (submitting.current) return;  // the question is going out with this photo right now
    aborts.current.get(key)?.();
    aborts.current.delete(key);
    // already on the server: remove it there too (best effort; never holds up the user)
    const id = attsRef.current.find((a) => a.key === key)?.id;
    if (id) deleteUploadedPhoto(id);
    attsRef.current = attsRef.current.filter((a) => a.key !== key);
    setAtts((as) => as.filter((a) => a.key !== key));
    focusEnd();
  };

  const uploading = atts.some((a) => a.status === 'processing' || a.status === 'uploading');
  const waitTitle = t('photo.waitUpload');
  // the "please wait" hint goes away by itself once the photos are added
  useEffect(() => { if (!uploading) setNotice((n) => (n && n.title === waitTitle ? null : n)); }, [uploading, waitTitle]);
  const ready = atts.filter((a) => a.status === 'done' && a.id);
  const canSend = !busy && !uploading && voice.state === 'idle' && (!!text.trim() || ready.length > 0);

  const submit = async () => {
    // not while a question is going out, and not while recording / converting speech (Enter must not send then)
    if (busy || submitting.current || voice.state !== 'idle') return;
    if (uploading) { setNotice({ title: t('photo.waitUpload') }); return; }
    const q = text.trim();
    if (!q && !ready.length) return;
    submitting.current = true;
    let sent = false;
    try { sent = await onSend(q || t('photo.defaultQuestion'), ready.map((a) => a.id!)); } catch { sent = false; } finally { submitting.current = false; }
    if (!sent) return;  // nothing was sent (e.g. Yukti is restarting): keep the question and the photos
    // only what was typed before sending is cleared; anything typed while it was going out stays
    setText((cur) => (cur.trim() === q ? '' : cur));
    setAtts([]);
    attsRef.current = [];
    setNotice(null);
  };

  const pickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';  // allow picking the same photo again
  };

  const full = atts.length >= MAX_PHOTOS;
  const noVision = vision === false && modelReady;
  const photoTip = full ? t('photo.err.max', { n: MAX_PHOTOS }) : noVision ? t('photo.noVisionHint') : t('photo.addTip');
  const speechUnavailable = speech.data && !speech.data.available ? (speech.data.reason || t('voice.unavailableReason')) : null;
  const showMic = !!speech.data;  // never answered -> no mic button; a failed re-check later keeps the last known answer
  const errors = atts.filter((a) => a.status === 'error');
  // a notice clears the voice message when it is set (effect above), so whichever of the two is newer is shown
  const shownNotice: Notice | null = voice.error ?? notice;
  const closeNotice = () => { voice.clearError(); setNotice(null); };

  return (
    <div className="border-t border-border bg-bg px-4 pb-3 pt-2.5">
      <div className={cx('mx-auto', fullWidth ? 'max-w-none' : 'max-w-[860px]')}>
        {!modelReady && (canLoadModel ? (
          <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" /> {t('chat.noModel.admin')}
            <button className="text-cyan hover:underline" onClick={onOpenLoader}>{t('composer.selectModel')}</button>
            <Kbd>Ctrl+L</Kbd>
          </div>
        ) : (
          <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" /> {t('chat.noModel.user')}
          </div>
        ))}

        {shownNotice && (
          <div role="alert" className="mb-2 flex items-start gap-2 rounded-md border border-amber/40 bg-amber/10 px-3 py-2 text-[12.5px]">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-text">{shownNotice.title}</div>
              {shownNotice.body && <div className="mt-0.5 whitespace-pre-line text-muted">{shownNotice.body}</div>}
            </div>
            <button type="button" className="btn btn-ghost btn-icon -mr-1 -mt-0.5 text-muted" onClick={closeNotice} aria-label={t('btn.close')}><X size={14} /></button>
          </div>
        )}

        <div className={cx('overflow-hidden rounded-lg border bg-surface transition-colors focus-within:border-cyan/60',
          voice.state === 'recording' ? 'border-danger/60' : 'border-border')}>
          <VoiceBar state={voice.state} elapsed={voice.elapsed} level={voice.level} onStop={() => void voice.stop()} onCancel={voice.cancel} />

          {atts.length > 0 && (
            <div className="border-b border-border/60 px-3 pb-2 pt-2.5">
              <div className="flex flex-wrap gap-2.5">
                {atts.map((a, i) => <Thumb key={a.key} a={a} index={i + 1} onRemove={() => remove(a.key)} />)}
              </div>
              {errors.map((a) => (
                <div key={a.key} className="mt-1.5 flex items-start gap-1.5 text-[12px] text-red-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-danger" />
                  <span>{t('photo.err.item', { n: atts.indexOf(a) + 1, msg: a.error ?? '' })}</span>
                </div>
              ))}
              {uploading && <div className="mt-1.5 text-[11.5px] text-muted">{t('photo.uploading')}</div>}
              {noVision && !uploading && ready.length > 0 && (
                <div className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-muted"><Info size={12} className="mt-0.5 shrink-0 text-amber" />{t('photo.noVisionHint')}</div>
              )}
            </div>
          )}

          <textarea ref={ref} rows={1} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={atts.length ? t('photo.placeholder') : t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
            className="block max-h-[240px] w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13.5px] outline-none placeholder:text-faint"
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []).filter(isImageFile);
              if (files.length) { e.preventDefault(); addFiles(files); }
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              const wantsSend = sendWithEnter ? !e.shiftKey : (e.ctrlKey || e.metaKey);
              if (wantsSend) { e.preventDefault(); void submit(); }
            }} />
          <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" multiple hidden onChange={pickFiles} />
            <input ref={galleryInput} type="file" accept="image/*" multiple hidden onChange={pickFiles} />
            <Tip side="top" text={photoTip}>
              <button type="button" className={cx('btn btn-ghost btn-sm', noVision ? 'text-muted' : 'text-muted hover:text-text')}
                disabled={full} onClick={() => cameraInput.current?.click()} aria-label={t('photo.add')}>
                <Camera size={15} /><span className="hidden md:inline">{t('photo.add')}</span>
                {noVision && <Info size={11} className="text-amber" />}
              </button>
            </Tip>
            {touch && (
              <button type="button" className="btn btn-ghost btn-sm text-muted hover:text-text" disabled={full}
                onClick={() => galleryInput.current?.click()} aria-label={t('photo.gallery')} title={t('photo.gallery')}>
                <ImagePlus size={15} />
              </button>
            )}
            {showMic && (
              <MicButton state={voice.state} onToggle={voice.toggle} unavailable={speechUnavailable}
                onUnavailable={() => {
                  // it may have been added on the server computer since this page asked: check again before saying no
                  void speech.refetch().then((r) => {
                    if (r.data?.available) { setNotice(null); voice.toggle(); }
                    else setNotice({ title: t('voice.unavailable'), body: (r.data?.reason || speechUnavailable) ?? undefined });
                  });
                }} />
            )}
            <button onClick={onToggleKnowledge} title={t('composer.knowledgeTip')}
              className={cx('ml-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                useKnowledge ? 'border-cyan/40 bg-cyan/10 text-cyan' : 'border-border text-muted hover:text-text')}>
              {useKnowledge ? <BookOpen size={11} /> : <BookX size={11} />}
              {useKnowledge ? t('chat.knowledgeOn') : t('chat.knowledgeOff')}
            </button>
            <span className="ml-auto" />
            {showTokens && <span className="font-mono text-[10.5px] text-faint">{t('composer.tokens', { n: estimateTokens(text) })}</span>}
            <span className="hidden text-[10.5px] text-faint xl:inline">
              {sendWithEnter ? <><Kbd>Enter</Kbd> {t('composer.send')} · <Kbd>Shift+Enter</Kbd> {t('composer.newline')}</> : <><Kbd>Ctrl+Enter</Kbd> {t('composer.send')}</>}
            </span>
            {busy ? (
              <button className="btn btn-danger btn-sm" onClick={onStop} title={t('composer.stopTip')}><Square size={11} fill="currentColor" />{t('composer.stop')}</button>
            ) : (
              <button className="btn btn-primary btn-icon !rounded-md !px-1.5" disabled={!canSend} onClick={() => void submit()}
                title={uploading ? t('photo.waitUpload') : t('composer.sendTip')} aria-label={t('composer.sendTip')}>
                {uploading ? <Spinner size={15} className="!text-[#1a1204]" /> : <ArrowUp size={15} />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

function Thumb({ a, index, onRemove }: { a: Att; index: number; onRemove: () => void }) {
  const t = useT();
  const working = a.status === 'processing' || a.status === 'uploading';
  return (
    <div className={cx('relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-md border bg-surface-2',
      a.status === 'error' ? 'border-danger/70' : a.status === 'done' ? 'border-border-strong' : 'border-border')}
      title={a.status === 'error' ? a.error : a.name}>
      {a.preview
        ? <img src={a.preview} alt={t('photo.alt', { n: index })} className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center text-faint"><Camera size={20} /></div>}
      {working && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-[10.5px] font-medium text-white">
          <Spinner size={16} className="!text-white" />
          {a.status === 'uploading' ? `${a.progress}%` : t('photo.preparing')}
        </div>
      )}
      {working && a.status === 'uploading' && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40"><div className="h-full bg-cyan transition-[width]" style={{ width: `${a.progress}%` }} /></div>
      )}
      {a.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-danger/25"><AlertTriangle size={20} className="text-red-200" /></div>
      )}
      <button type="button" onClick={onRemove} aria-label={t('photo.remove', { n: index })} title={t('photo.remove', { n: index })}
        className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-white/30 bg-black/70 text-white hover:bg-danger">
        <X size={13} />
      </button>
    </div>
  );
}
