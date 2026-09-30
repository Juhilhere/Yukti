import { locale, tr } from './i18n';

export function fmtBytes(n?: number | null): string {
  if (n === undefined || n === null || isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
export function fmtMB(mb?: number | null): string {
  if (mb === undefined || mb === null || isNaN(mb)) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
export function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' });
}
export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return tr('time.justNow');
  if (s < 3600) return tr('time.minAgo', { n: Math.floor(s / 60) });
  if (s < 86400) return tr('time.hourAgo', { n: Math.floor(s / 3600) });
  return tr('time.dayAgo', { n: Math.floor(s / 86400) });
}
export function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '—';
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = Math.floor(sec % 60);
  if (h > 0) return tr('time.dur.hm', { h, m });
  if (m > 0) return tr('time.dur.ms', { m, s });
  return tr('time.dur.s', { s });
}
export function countdown(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (isNaN(ms)) return '—';
  if (ms <= 0) return tr('time.expired');
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = s % 60;
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
export function num(v: unknown, digits = 1): string {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  return v.toLocaleString(locale(), { maximumFractionDigits: digits });
}
export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}
export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

/** Human label for a role code (e.g. dept_manager → Head of Department (HOD)). */
export function roleLabel(role: string): string {
  return role === 'dept_manager' ? tr('common.role.dept_manager') : role === 'executive' ? tr('common.role.executive') : role;
}

/** Human label for a policy document type (values match policies/core.yaml). */
const DOC_TYPE_LABELS: Record<string, string> = { SOP: 'SOP', drawing_pid: 'P&ID', MSDS: 'MSDS' };
const DOC_TYPE_KEYS = new Set(['drawing_sld', 'datasheet', 'manual', 'troubleshooting_guide', 'process_manual', 'inspection_report',
  'calibration_certificate', 'shift_log', 'work_order_export', 'asset_register', 'audit_report', 'contact_list', 'other']);
export const docTypeLabel = (t: string | null | undefined) =>
  (t ? DOC_TYPE_LABELS[t] ?? (DOC_TYPE_KEYS.has(t) ? tr(`common.docType.${t}`) : t.replace(/_/g, ' ')) : '—');
