import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '../lib/format';

function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, children, footer, width = 520, className, icon }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; className?: string; icon?: ReactNode;
}) {
  useEsc(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cx('flex max-h-[84vh] w-full flex-col rounded-lg border border-border bg-surface shadow-2xl', className)} style={{ maxWidth: width }}>
        {title && (
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2 font-semibold">{icon}{title}</div>
            <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X size={15} /></button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, width = 560, footer }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number; footer?: ReactNode;
}) {
  useEsc(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="flex h-full w-full flex-col border-l border-border bg-surface shadow-2xl" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="min-w-0 font-semibold">{title}</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}
