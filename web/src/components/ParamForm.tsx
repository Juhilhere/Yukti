import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import type { ParamField } from '../lib/types';
import { cx } from '../lib/format';
import { InfoTip, Slider, Toggle } from './ui';

type Values = Record<string, unknown>;

function isDefault(f: ParamField, v: unknown) {
  if (v === undefined) return true;
  try { return JSON.stringify(v) === JSON.stringify(f.default); } catch { return v === f.default; }
}

function FieldInput({ f, value, onChange }: { f: ParamField; value: unknown; onChange: (v: unknown) => void }) {
  const v = value === undefined ? f.default : value;
  switch (f.type) {
    case 'bool':
      return <Toggle size="sm" checked={Boolean(v)} onChange={onChange} />;
    case 'number':
    case 'int': {
      const n = typeof v === 'number' ? v : Number(v ?? 0);
      const step = f.step ?? (f.type === 'int' ? 1 : 0.01);
      const fix = (x: number) => (f.type === 'int' ? Math.round(x) : x);
      if (f.min !== undefined && f.max !== undefined) {
        return <Slider value={n} min={f.min} max={f.max} step={step} unit={f.unit} onChange={(x) => onChange(fix(x))} />;
      }
      return (
        <div className="flex items-center gap-1">
          <input type="number" className="input font-mono !py-0.5 text-[12px]" value={isFinite(n) ? n : ''} step={step} min={f.min} max={f.max}
            onChange={(e) => onChange(e.target.value === '' ? null : fix(Number(e.target.value)))} />
          {f.unit && <span className="text-[11px] text-muted">{f.unit}</span>}
        </div>
      );
    }
    case 'select':
      return (
        <select className="input !py-0.5 text-[12px]" value={JSON.stringify(v ?? null)} onChange={(e) => onChange(JSON.parse(e.target.value))}>
          {(f.options ?? []).map((o) => <option key={JSON.stringify(o.value)} value={JSON.stringify(o.value ?? null)}>{o.label}</option>)}
        </select>
      );
    case 'textarea':
      return <textarea className="input min-h-[60px] font-mono text-[12px]" value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'tags': {
      const arr = Array.isArray(v) ? (v as unknown[]).map(String) : typeof v === 'string' && v ? [v] : [];
      return (
        <input className="input font-mono !py-0.5 text-[12px]" placeholder="comma separated" defaultValue={arr.join(', ')}
          key={arr.join('|')}
          onBlur={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
      );
    }
    case 'json':
      return <JsonInput value={v} onChange={onChange} />;
    default:
      return <input className="input !py-0.5 text-[12px]" value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
}

function JsonInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const initial = value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const [text, setText] = useState(initial);
  const [err, setErr] = useState('');
  return (
    <div>
      <textarea className={cx('input min-h-[70px] font-mono text-[11.5px]', err && '!border-danger')} value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!text.trim()) { setErr(''); onChange(null); return; }
          try { onChange(JSON.parse(text)); setErr(''); } catch { setErr('Invalid JSON'); }
        }} />
      {err && <div className="text-[11px] text-danger">{err}</div>}
    </div>
  );
}

/** Generic schema-driven form; groups fields by `group`, advanced fields behind a toggle. */
export function ParamForm({ fields, values, onChange, engine, showAdvanced: showAdvProp, compact, collapsedGroups }: {
  fields: ParamField[]; values: Values; onChange: (key: string, v: unknown) => void; engine?: string | null;
  showAdvanced?: boolean; compact?: boolean; collapsedGroups?: string[];
}) {
  const [showAdvLocal, setShowAdvLocal] = useState(false);
  const showAdv = showAdvProp ?? showAdvLocal;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((collapsedGroups ?? []).map((g) => [g, true])));

  const groups = useMemo(() => {
    const m = new Map<string, ParamField[]>();
    for (const f of fields) {
      if (f.advanced && !showAdv) continue;
      const g = f.group || 'General';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(f);
    }
    return [...m.entries()];
  }, [fields, showAdv]);
  const advCount = fields.filter((f) => f.advanced).length;

  return (
    <div className="space-y-2">
      {showAdvProp === undefined && advCount > 0 && (
        <div className="flex items-center justify-end">
          <Toggle size="sm" checked={showAdvLocal} onChange={setShowAdvLocal} label={<span className="text-[11.5px] text-muted">Show advanced ({advCount})</span>} />
        </div>
      )}
      {groups.map(([g, fs]) => (
        <div key={g} className="rounded-md border border-border bg-surface/60">
          <button className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left" onClick={() => setCollapsed((c) => ({ ...c, [g]: !c[g] }))}>
            {collapsed[g] ? <ChevronRight size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
            <span className="label">{g}</span>
            <span className="ml-auto font-mono text-[10.5px] text-faint">{fs.length}</span>
          </button>
          {!collapsed[g] && (
            <div className={cx('space-y-2.5 border-t border-border px-2.5', compact ? 'py-2' : 'py-2.5')}>
              {fs.map((f) => {
                const unsupported = engine && f.engines?.length > 0 && !f.engines.includes(engine);
                const v = values[f.key];
                const changed = !isDefault(f, v);
                const inline = f.type === 'bool';
                return (
                  <div key={f.key} className={cx(unsupported && 'opacity-45')}>
                    <div className={cx('flex items-center gap-1.5', !inline && 'mb-1')}>
                      <span className={cx('text-[12px]', changed ? 'text-text font-medium' : 'text-muted')}>{f.label}</span>
                      <InfoTip text={<>
                        <div>{f.description}</div>
                        <div className="mt-1 font-mono text-[10.5px] text-faint">{f.key}{f.engines?.length ? ` · ${f.engines.join(', ')}` : ''}</div>
                        {unsupported && <div className="mt-1 text-amber">Not supported by current engine</div>}
                      </>} />
                      {f.advanced && <span className="rounded bg-surface-3 px-1 text-[9.5px] uppercase text-faint">adv</span>}
                      <span className="ml-auto flex items-center gap-1">
                        {changed && (
                          <button title="Reset to default" className="text-faint hover:text-amber" onClick={() => onChange(f.key, undefined)}>
                            <RotateCcw size={11} />
                          </button>
                        )}
                        {inline && <FieldInput f={f} value={v} onChange={(x) => onChange(f.key, x)} />}
                      </span>
                    </div>
                    {!inline && <FieldInput f={f} value={v} onChange={(x) => onChange(f.key, x)} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
      {groups.length === 0 && <div className="py-4 text-center text-[12px] text-muted">No parameters</div>}
    </div>
  );
}

/** Build a values object from schema defaults merged with overrides (only non-undefined). */
export function withDefaults(fields: ParamField[], overrides: Values | null | undefined): Values {
  const out: Values = {};
  for (const f of fields) out[f.key] = f.default;
  for (const [k, v] of Object.entries(overrides ?? {})) if (v !== undefined) out[k] = v;
  return out;
}
/** Only keep keys that differ from default (to send compact payloads). */
export function diffFromDefaults(fields: ParamField[], values: Values): Values {
  const out: Values = {};
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    const f = byKey.get(k);
    if (!f || !isDefault(f, v)) out[k] = v;
  }
  return out;
}
