// Keeps the last few problems the app ran into (failed requests, script errors, crashes) so a problem report can include
// them automatically. Nothing leaves the PC unless the user sends the report themselves.
export type DiagEvent = { at: string; kind: 'api' | 'script' | 'crash'; text: string };

const MAX = 25;
const events: DiagEvent[] = [];

export function recordProblem(kind: DiagEvent['kind'], text: string) {
  events.push({ at: new Date().toISOString(), kind, text: text.slice(0, 400) });
  if (events.length > MAX) events.splice(0, events.length - MAX);
}

export function recentProblems(): DiagEvent[] { return [...events]; }

let installed = false;
export function installDiagnostics() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => recordProblem('script', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => recordProblem('script', `Unhandled: ${String((e.reason as Error)?.message ?? e.reason)}`));
}
