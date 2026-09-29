import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { api } from './api';
import type { Engine, LoadedModel, Model, ParamSchema, Preset, SystemInfo } from './types';

export const qk = {
  system: ['system'] as const,
  loaded: ['models', 'loaded'] as const,
  models: ['models'] as const,
  engines: ['engines'] as const,
  schema: ['params', 'schema'] as const,
  presets: ['presets'] as const,
  projects: ['projects'] as const,
  chats: ['chats'] as const,
  chat: (id: string) => ['chat', id] as const,
};

export const useSystem = () => useQuery({ queryKey: qk.system, queryFn: () => api.get<SystemInfo>('/api/system'), refetchInterval: 3000, retry: false });
export const useLoaded = (fast = false) => useQuery({
  queryKey: qk.loaded, queryFn: () => api.get<LoadedModel>('/api/models/loaded'),
  refetchInterval: (q) => (fast || q.state.data?.status === 'loading' ? 1000 : 5000), retry: false,
});
export const useModels = () => useQuery({ queryKey: qk.models, queryFn: () => api.get<Model[]>('/api/models'), staleTime: 30_000 });
export const useEngines = () => useQuery({ queryKey: qk.engines, queryFn: () => api.get<Engine[]>('/api/engines'), staleTime: 15_000 });
export const useSchema = () => useQuery({ queryKey: qk.schema, queryFn: () => api.get<ParamSchema>('/api/params/schema'), staleTime: Infinity });
export const usePresets = () => useQuery({ queryKey: qk.presets, queryFn: () => api.get<Preset[]>('/api/presets') });

/* ---- tiny global UI store: model loader modal + last generation stats ---- */
type UIState = { loaderOpen: boolean; loaderModelId: string | null; lastGen: { tok_per_s: number; model: string; engine: string } | null };
let ui: UIState = { loaderOpen: false, loaderModelId: null, lastGen: null };
const subs = new Set<() => void>();
function set(p: Partial<UIState>) { ui = { ...ui, ...p }; subs.forEach((f) => f()); }
export const uiStore = {
  openLoader: (modelId?: string | null) => set({ loaderOpen: true, loaderModelId: modelId ?? null }),
  closeLoader: () => set({ loaderOpen: false, loaderModelId: null }),
  setLastGen: (g: UIState['lastGen']) => set({ lastGen: g }),
};
export function useUI(): UIState {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => ui);
}
