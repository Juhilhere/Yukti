// Photos in chat: client-side downscale (canvas -> JPEG) and upload with progress to POST /api/attachments.
// No blob: URLs are created (CSP); previews are small data: URLs.
import { ApiError, getCsrf, notifyError } from './api';
import { getLang, tr } from './i18n';
import type { Attachment } from './types';

export const MAX_PHOTOS = 4;
export const MAX_SIDE = 1600;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const attachmentUrl = (id: string, thumb = false) => `/api/attachments/${encodeURIComponent(id)}${thumb ? '?thumb=1' : ''}`;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|heif|tiff?|avif)$/i;
export function isImageFile(f: File): boolean {
  return f.type ? f.type.startsWith('image/') : IMAGE_EXT.test(f.name);
}

type Decoded = { src: CanvasImageSource; w: number; h: number; close: () => void };

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' applies the camera's EXIF rotation so portrait photos stay upright
      const b = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { src: b, w: b.width, h: b.height, close: () => b.close() };
    } catch { /* fall back to <img> */ }
  }
  const url = await readAsDataURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => undefined };
}

function draw(d: Decoded, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(d.w, d.h));
  const w = Math.max(1, Math.round(d.w * scale));
  const h = Math.max(1, Math.round(d.h * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas unavailable');
  g.fillStyle = '#fff';  // transparent PNGs would turn black in JPEG
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(d.src, 0, 0, w, h);
  return c;
}

function toJpeg(c: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', q));
}

export type Prepared = { blob: Blob; preview: string; name: string };

/** Downscale to <= 1600 px and re-encode as JPEG 0.9; also returns a small preview (data: URL).
 *  If the browser cannot decode the file (e.g. HEIC on some browsers), the original is uploaded and the server decides. */
export async function preparePhoto(file: File): Promise<Prepared> {
  const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
  let d: Decoded;
  try { d = await decode(file); } catch { return { blob: file, preview: '', name: file.name || 'photo' }; }
  try {
    const big = draw(d, MAX_SIDE);
    const blob = await toJpeg(big, 0.9);
    const preview = draw(d, 200).toDataURL('image/jpeg', 0.75);
    return { blob, preview, name };
  } finally { d.close(); }
}

/** Upload with progress (fetch has no upload progress, so XHR). Resolves with the server's attachment record. */
export function uploadPhoto(blob: Blob, name: string, onProgress: (pct: number) => void): { promise: Promise<Attachment>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Attachment>((resolve, reject) => {
    xhr.open('POST', '/api/attachments');
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Lang', getLang());
    const csrf = getCsrf();
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let j: unknown = null;
      try { j = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300 && j && typeof j === 'object') { resolve(j as Attachment); return; }
      const d = (j as { detail?: unknown } | null)?.detail;
      const det = d && typeof d === 'object' && !Array.isArray(d) ? d as Record<string, unknown> : null;
      const err = new ApiError(xhr.status, String(det?.code ?? `http_${xhr.status}`), String(det?.message ?? (typeof d === 'string' ? d : xhr.statusText)), det);
      notifyError(err, '/api/attachments');
      reject(err);
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', tr('err.network')));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    const fd = new FormData();
    fd.append('file', blob, name);
    xhr.send(fd);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Plain-words message for a failed photo upload. */
export function photoErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 413) return tr('photo.err.tooBig');
    if (e.status === 422 || e.status === 415) return tr('photo.err.unsupported');
    if (e.status === 0) return tr('photo.err.network');
    if (e.status === 401) return tr('photo.err.signedOut');
    return tr('photo.err.failed', { msg: e.message });
  }
  return tr('photo.err.failed', { msg: e instanceof Error ? e.message : String(e) });
}
