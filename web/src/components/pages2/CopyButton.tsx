import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => fallback(text));
  } catch { /* ignore */ }
  return Promise.resolve(fallback(text));
}
function fallback(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn btn-ghost btn-sm" title="Copy" onClick={async () => {
      await copyText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    }}>
      {done ? <Check size={12} className="text-ok" /> : <Copy size={12} />}{label}
    </button>
  );
}
