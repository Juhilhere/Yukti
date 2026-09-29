import { useState } from 'react';
import { GitCompare, Star, Table2 } from 'lucide-react';
import type { Fact } from '../../lib/types';
import { Drawer } from '../Modal';
import { Badge, StatusChip } from '../ui';
import { cx, fmtDate } from '../../lib/format';
import { useT } from '../../lib/i18n';

export function FactsTable({ facts, onCite }: { facts: Fact[]; onCite?: (sid: string) => void }) {
  const [cmp, setCmp] = useState<Fact | null>(null);
  const t = useT();
  if (!facts?.length) return null;
  const counts = facts.reduce<Record<string, number>>((a, f) => { a[f.status] = (a[f.status] ?? 0) + 1; return a; }, {});
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Table2 size={13} className="text-cyan" />
        <span className="label">{t('chat.facts')}</span>
        <div className="ml-auto flex gap-1.5">
          {counts.KNOWN ? <Badge tone="cyan" mono>{t('facts.known', { n: counts.KNOWN })}</Badge> : null}
          {counts.CONFLICTING ? <Badge tone="amber" mono>{t('facts.conflicting', { n: counts.CONFLICTING })}</Badge> : null}
          {counts.MISSING ? <Badge tone="muted" mono dashed>{t('facts.missing', { n: counts.MISSING })}</Badge> : null}
        </div>
      </div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wide text-muted">
            <th className="px-3 py-1.5 font-semibold">{t('facts.col.slot')}</th>
            <th className="px-3 py-1.5 font-semibold">{t('facts.col.attribute')}</th>
            <th className="px-3 py-1.5 font-semibold">{t('facts.col.value')}</th>
            <th className="px-3 py-1.5 font-semibold">{t('facts.col.status')}</th>
            <th className="w-[90px]" />
          </tr>
        </thead>
        <tbody>
          {facts.map((f, i) => (
            <tr key={`${f.slot}-${f.attribute}-${i}`} className={cx('border-t border-border/60', f.status === 'CONFLICTING' && 'bg-amber/[0.04]')}>
              <td className="px-3 py-1.5 font-mono text-[11.5px] text-muted">{f.slot}</td>
              <td className="px-3 py-1.5">{f.attribute}</td>
              <td className="px-3 py-1.5 font-mono text-[12px]">
                {f.status === 'MISSING' ? <span className="text-faint italic">{t('facts.notFound')}</span>
                  : f.status === 'CONFLICTING' && !f.value ? <span className="text-amber">{t('facts.candidates', { n: f.candidates.length })}</span>
                  : f.value ?? '—'}
                {f.note && <div className="font-sans text-[11px] text-faint">{f.note}</div>}
              </td>
              <td className="px-3 py-1.5"><StatusChip status={f.status} /></td>
              <td className="px-3 py-1.5 text-right">
                {f.status === 'CONFLICTING' && (
                  <button className="btn btn-sm !border-amber/40 !text-amber" onClick={() => setCmp(f)}><GitCompare size={12} />{t('facts.compare')}</button>
                )}
                {f.status === 'KNOWN' && f.candidates?.[0]?.source_id && (
                  <button className="rounded bg-cyan/10 px-1.5 font-mono text-[10.5px] text-cyan hover:bg-cyan/20"
                    onClick={() => onCite?.(f.candidates[0].source_id)}>{f.candidates[0].source_id}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Drawer open={!!cmp} onClose={() => setCmp(null)} width={Math.min(360 * Math.max(2, cmp?.candidates.length ?? 2) + 40, 1100)}
        title={cmp && <span className="flex items-center gap-2"><GitCompare size={14} className="text-amber" />{t('facts.conflictTitle', { attr: cmp.attribute })}</span>}>
        {cmp && (
          <div className="space-y-3">
            <div className="text-[12px] text-muted">
              {t('facts.conflictBody', { slot: cmp.slot, n: cmp.candidates.length })}
            </div>
            {cmp.note && <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-[12px]">{cmp.note}</div>}
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, cmp.candidates.length)}, minmax(0, 1fr))` }}>
              {cmp.candidates.map((c, i) => (
                <div key={i} className={cx('rounded-md border bg-surface-2 p-3', c.recommended ? 'border-ok/60' : 'border-border')}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded bg-cyan/10 px-1.5 font-mono text-[11px] text-cyan">{c.source_id}</span>
                    {c.recommended && <Badge tone="ok"><Star size={10} />{t('facts.recommended')}</Badge>}
                  </div>
                  <div className="font-mono text-[20px] font-semibold text-text">{c.value}</div>
                  <dl className="mt-3 space-y-1 text-[12px]">
                    <div className="flex justify-between gap-2"><dt className="text-muted">{t('facts.source')}</dt><dd className="text-right">{c.source_label}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-muted">{t('facts.revision')}</dt><dd className="font-mono">{c.revision || '—'}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-muted">{t('facts.effective')}</dt><dd className="font-mono">{c.effective ? fmtDate(c.effective) : '—'}</dd></div>
                  </dl>
                  {onCite && (
                    <button className="btn btn-sm btn-cyan mt-3 w-full justify-center" onClick={() => { setCmp(null); setTimeout(() => onCite(c.source_id), 50); }}>
                      {t('facts.showSource')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
