import { useEffect, useRef, useState } from 'react';
import { ArrowUp, BookOpen, BookX, Square } from 'lucide-react';
import { cx, estimateTokens } from '../../lib/format';
import { Kbd } from '../ui';

export function Composer({ busy, onSend, onStop, useKnowledge, onToggleKnowledge, sendWithEnter, modelReady, onOpenLoader, fullWidth }: {
  busy: boolean; onSend: (text: string) => void; onStop: () => void; useKnowledge: boolean; onToggleKnowledge: () => void;
  sendWithEnter: boolean; modelReady: boolean; onOpenLoader: () => void; fullWidth: boolean;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  useEffect(() => { ref.current?.focus(); }, []);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText('');
  };

  return (
    <div className="border-t border-border bg-bg px-4 pb-3 pt-2.5">
      <div className={cx('mx-auto', fullWidth ? 'max-w-none' : 'max-w-[860px]')}>
        {!modelReady && (
          <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" /> No model loaded —
            <button className="text-cyan hover:underline" onClick={onOpenLoader}>select a model to load</button>
            <Kbd>Ctrl+L</Kbd>
          </div>
        )}
        <div className="rounded-lg border border-border bg-surface transition-colors focus-within:border-cyan/60">
          <textarea ref={ref} rows={1} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Ask about SOPs, P&IDs, assets, certificates, work orders…"
            className="block max-h-[240px] w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13.5px] outline-none placeholder:text-faint"
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              const wantsSend = sendWithEnter ? !e.shiftKey : (e.ctrlKey || e.metaKey);
              if (wantsSend) { e.preventDefault(); submit(); }
            }} />
          <div className="flex items-center gap-2 px-2 pb-2">
            <button onClick={onToggleKnowledge} title="Toggle retrieval over the knowledge base (RAG)"
              className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                useKnowledge ? 'border-cyan/40 bg-cyan/10 text-cyan' : 'border-border text-muted hover:text-text')}>
              {useKnowledge ? <BookOpen size={11} /> : <BookX size={11} />}
              {useKnowledge ? 'Knowledge on' : 'Knowledge off'}
            </button>
            <span className="ml-auto font-mono text-[10.5px] text-faint">~{estimateTokens(text)} tok</span>
            <span className="hidden text-[10.5px] text-faint sm:inline">
              {sendWithEnter ? <><Kbd>Enter</Kbd> send · <Kbd>Shift+Enter</Kbd> newline</> : <><Kbd>Ctrl+Enter</Kbd> send</>}
            </span>
            {busy ? (
              <button className="btn btn-danger btn-sm" onClick={onStop} title="Stop generating"><Square size={11} fill="currentColor" />Stop</button>
            ) : (
              <button className="btn btn-primary btn-icon !rounded-md !px-1.5" disabled={!text.trim()} onClick={submit} title="Send"><ArrowUp size={15} /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
