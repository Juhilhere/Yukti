import { useSyncExternalStore } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cx } from '../lib/format';

type ToastKind = 'info' | 'success' | 'error' | 'warn';
type ToastItem = { id: number; kind: ToastKind; title: string; body?: string };

let items: ToastItem[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function toast(title: string, opts: { kind?: ToastKind; body?: string; ms?: number } = {}) {
  const id = ++seq;
  // de-dupe identical toasts that are already visible
  if (items.some((t) => t.title === title && t.body === opts.body)) return;
  items = [...items, { id, kind: opts.kind ?? 'info', title, body: opts.body }];
  emit();
  setTimeout(() => dismiss(id), opts.ms ?? 4500);
}
toast.success = (t: string, body?: string) => toast(t, { kind: 'success', body });
toast.error = (t: string, body?: string) => toast(t, { kind: 'error', body, ms: 6500 });
toast.warn = (t: string, body?: string) => toast(t, { kind: 'warn', body });

function dismiss(id: number) { items = items.filter((t) => t.id !== id); emit(); }

export function Toaster() {
  const list = useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => items);
  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-[200] flex w-[340px] flex-col gap-2">
      {list.map((t) => {
        const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? AlertTriangle : t.kind === 'warn' ? AlertTriangle : Info;
        const c = t.kind === 'success' ? 'text-ok' : t.kind === 'error' ? 'text-danger' : t.kind === 'warn' ? 'text-amber' : 'text-cyan';
        return (
          <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 shadow-2xl')}>
            <Icon size={15} className={cx('mt-0.5 shrink-0', c)} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 break-words text-[12px] text-muted">{t.body}</div>}
            </div>
            <button className="text-faint hover:text-text" onClick={() => dismiss(t.id)}><X size={13} /></button>
          </div>
        );
      })}
    </div>
  );
}
