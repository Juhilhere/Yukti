import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Play, Save, Square } from 'lucide-react';
import { api, errMsg } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { useModels } from '../../lib/queries';
import type { ResearchConfig, ResearchStatus } from '../../lib/work';
import { Badge, Card, ErrorBox, Field, Loading, Spinner, StatusChip, Toggle } from '../../components/ui';
import { toast } from '../../components/Toast';

export default function ResearchAdmin() {
  const t = useT();
  const qc = useQueryClient();
  const models = useModels();
  const q = useQuery({ queryKey: ['admin', 'research'], queryFn: () => api.get<ResearchConfig>('/api/admin/research'), refetchInterval: 4000 });
  const [draft, setDraft] = useState<Pick<ResearchConfig, 'model_id' | 'url' | 'guardrails' | 'enabled'> | null>(null);
  useEffect(() => { if (q.data && !draft) setDraft({ model_id: q.data.model_id, url: q.data.url, guardrails: q.data.guardrails, enabled: q.data.enabled }); }, [q.data, draft]);
  const save = useMutation({
    mutationFn: () => api.put<ResearchConfig>('/api/admin/research', draft),
    onSuccess: (r) => { toast.success(t('rs.admin.saved')); qc.setQueryData(['admin', 'research'], r); },
    onError: (e) => toast.error(t('rs.admin.saveFailed'), errMsg(e)),
  });
  const ctl = useMutation({
    mutationFn: (a: 'start' | 'stop') => api.post<ResearchStatus>(`/api/admin/research/${a}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'research'] }),
    onError: (e) => toast.error(t('rs.admin.ctlFailed'), errMsg(e)),
  });
  if (q.isLoading || !draft) return q.error ? <div className="p-5"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div> : <Loading />;
  const s = q.data!;
  const set = (p: Partial<typeof draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  return (
    <div className="space-y-4 p-5">
      <div className="rounded-md border-2 border-danger/50 bg-danger/10 px-3 py-2 text-[12.5px] text-red-200">
        <b className="tracking-wider text-red-300">{t('rs.experimental')}</b> — {s.label}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card title={t('rs.admin.config')} icon={<FlaskConical size={14} className="text-amber" />}
          actions={<button className="btn btn-sm btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Spinner size={12} className="!text-[#1a1204]" /> : <Save size={12} />}{t('btn.save')}</button>}>
          <div className="space-y-3">
            <Field label={t('rs.admin.model')} hint={t('rs.admin.modelHint')}>
              <select className="input" value={draft.model_id} onChange={(e) => set({ model_id: e.target.value })}>
                <option value="">{t('rs.admin.noModel')}</option>
                {draft.model_id && !(models.data ?? []).some((m) => m.id === draft.model_id) && <option value={draft.model_id}>{draft.model_id}</option>}
                {(models.data ?? []).filter((m) => m.source !== 'engine').map((m) => <option key={m.id} value={m.id}>{m.name}{m.quant ? ` · ${m.quant}` : ''}</option>)}
              </select>
            </Field>
            <Field label={t('rs.admin.url')} hint={t('rs.admin.urlHint')}>
              <input className="input font-mono text-[12px]" value={draft.url} onChange={(e) => set({ url: e.target.value })} placeholder="http://127.0.0.1:8090/v1" />
            </Field>
            <Field label={t('rs.admin.guardrails')} hint={t('rs.admin.guardrailsHint')}>
              <textarea className="input min-h-[140px] text-[12px]" value={draft.guardrails} onChange={(e) => set({ guardrails: e.target.value })} />
            </Field>
            <Toggle checked={draft.enabled} onChange={(v) => set({ enabled: v })} label={t('rs.admin.enabled')} />
          </div>
        </Card>
        <Card title={t('rs.admin.status')}>
          <div className="space-y-2 text-[12.5px]">
            <div className="flex items-center gap-2"><StatusChip status={s.status} />{s.model && <Badge mono tone="muted">{s.model}</Badge>}</div>
            {s.error && <div className="text-[12px] text-amber">{s.error}</div>}
            <div className="text-[11.5px] text-muted">{t('rs.admin.isolation')}</div>
            <div className="flex gap-2 pt-1">
              <button className="btn btn-sm btn-cyan" disabled={ctl.isPending || !s.enabled || s.status === 'ready' || s.status === 'loading'} onClick={() => ctl.mutate('start')}><Play size={12} />{t('rs.admin.start')}</button>
              <button className="btn btn-sm btn-danger" disabled={ctl.isPending || s.status === 'off'} onClick={() => ctl.mutate('stop')}><Square size={12} />{t('rs.admin.stop')}</button>
            </div>
            {!s.enabled && <div className="text-[11px] text-faint">{t('rs.admin.enableFirst')}</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
