import { getLang, tr } from './i18n';
import { recordProblem } from './diagnostics';
// Fetch wrapper: cookie session + CSRF header + global 401/403 handling.

export class ApiError extends Error {
  status: number;
  code: string;
  /** Raw `detail` object from the server (may carry extra fields, e.g. `missing[]`). */
  detail: Record<string, unknown> | null;
  constructor(status: number, code: string, message: string, detail: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

let csrfToken = '';
export function setCsrf(token: string) { csrfToken = token || ''; }
export function getCsrf() { return csrfToken; }

type Listener = (e: ApiError) => void;
const unauthListeners = new Set<Listener>();
const forbiddenListeners = new Set<Listener>();
const pwChangeListeners = new Set<Listener>();
/** Called when any request returns 403 password_change_required. */
export function onPasswordChangeRequired(fn: Listener) { pwChangeListeners.add(fn); return () => { pwChangeListeners.delete(fn); }; }
/** Called when any request (other than auth probes) returns 401. */
export function onUnauthorized(fn: Listener) { unauthListeners.add(fn); return () => { unauthListeners.delete(fn); }; }
/** Called when any request returns 403 policy_denied. */
export function onForbidden(fn: Listener) { forbiddenListeners.add(fn); return () => { forbiddenListeners.delete(fn); }; }

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function buildHeaders(method: string, body?: unknown, extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  if (body !== undefined && !(body instanceof FormData) && !h.has('Content-Type')) h.set('Content-Type', 'application/json');
  if (UNSAFE.has(method.toUpperCase()) && csrfToken) h.set('X-CSRF-Token', csrfToken);
  h.set('Accept', h.get('Accept') || 'application/json');
  h.set('X-Lang', getLang());  // the server translates its messages (errors, notices) into the chosen language
  return h;
}

export async function parseError(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let message = res.statusText || tr('err.requestFailed', { status: res.status });
  let detail: Record<string, unknown> | null = null;
  try {
    const j = await res.json();
    const d = j?.detail;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      code = d.code || code;
      message = d.message || message;
      detail = d;
    } else if (typeof d === 'string') {
      message = d;
    } else if (Array.isArray(d)) {
      message = d.map((x: { msg?: string }) => x?.msg).filter(Boolean).join('; ') || message;
      code = 'validation_error';
    }
  } catch { /* non-json */ }
  return new ApiError(res.status, code, message, detail);
}

export function notifyError(err: ApiError, path: string) {
  if (err.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/me')) {
    unauthListeners.forEach((f) => f(err));
  }
  if (err.status === 403 && err.code === 'policy_denied') forbiddenListeners.forEach((f) => f(err));
  if (err.status === 403 && err.code === 'password_change_required') pwChangeListeners.forEach((f) => f(err));
}

type Opts = { signal?: AbortSignal; headers?: HeadersInit; silent?: boolean };

export async function request<T = unknown>(method: string, path: string, body?: unknown, opts: Opts = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'include',
      headers: buildHeaders(method, body, opts.headers),
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    // kept for the user's own problem report only: with the server unreachable it cannot be written to the journal there
    recordProblem('api', `${method} ${path}: server not reachable`, false);
    throw new ApiError(0, 'network', tr('err.network', 'Yukti cannot reach its server. If Yukti was just started, wait a moment; otherwise restart the Yukti app.'));
  }
  if (!res.ok) {
    const err = await parseError(res);
    if (res.status >= 500 || res.status === 0) recordProblem('api', `${method} ${path}: ${res.status} ${err.code} ${err.message}`, res.status !== 0);
    if (!opts.silent) notifyError(err, path);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T,>(p: string, o?: Opts) => request<T>('GET', p, undefined, o),
  post: <T,>(p: string, b?: unknown, o?: Opts) => request<T>('POST', p, b ?? {}, o),
  put: <T,>(p: string, b?: unknown, o?: Opts) => request<T>('PUT', p, b ?? {}, o),
  patch: <T,>(p: string, b?: unknown, o?: Opts) => request<T>('PATCH', p, b ?? {}, o),
  del: <T,>(p: string, o?: Opts) => request<T>('DELETE', p, undefined, o),
  upload: <T,>(p: string, fd: FormData, o?: Opts) => request<T>('POST', p, fd, o),
};

export function qs(params: Record<string, string | number | undefined | null>) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') u.set(k, String(v)); });
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Download a file (GET, with cookie) and save it via a blob link. */
export async function downloadFile(url: string, fallbackName = 'download') {
  const res = await fetch(url, { credentials: 'include', headers: { 'X-Lang': getLang() } });
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
