import { useSyncExternalStore } from 'react';

export type AppSettings = {
  chatFullWidth: boolean; showStats: boolean; sendWithEnter: boolean;
  /** usernames on this computer who opened the chat settings panel (closed by default, remembered per user) */
  configSidebarOpenFor: string[];
};
const KEY = 'yukti.settings';
const DEFAULTS: AppSettings = { chatFullWidth: false, showStats: true, sendWithEnter: true, configSidebarOpenFor: [] };

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const { configSidebarOpen: _old, ...saved } = JSON.parse(raw) as Partial<AppSettings> & { configSidebarOpen?: boolean };
      const merged = { ...DEFAULTS, ...saved };
      if (!Array.isArray(merged.configSidebarOpenFor)) merged.configSidebarOpenFor = [];
      return merged;
    }
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
/** Chat settings panel: open or closed for this user (closed until the user opens it). */
export function configSidebarOpen(st: AppSettings, username?: string | null): boolean {
  return !!username && st.configSidebarOpenFor.includes(username);
}
export function setConfigSidebarOpen(username: string | null | undefined, open: boolean) {
  if (!username) return;
  const rest = state.configSidebarOpenFor.filter((u) => u !== username);
  setSettings({ configSidebarOpenFor: open ? [...rest, username] : rest });
}

export function useSettings(): AppSettings {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => state);
}
