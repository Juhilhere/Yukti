import { useSyncExternalStore } from 'react';

export type AppSettings = { chatFullWidth: boolean; showStats: boolean; sendWithEnter: boolean; configSidebarOpen: boolean };
const KEY = 'yukti.settings';
const DEFAULTS: AppSettings = { chatFullWidth: false, showStats: true, sendWithEnter: true, configSidebarOpen: true };

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { ...DEFAULTS };
}
let state = load();
const subs = new Set<() => void>();

export function setSettings(patch: Partial<AppSettings>) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
export function useSettings(): AppSettings {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => state);
}
