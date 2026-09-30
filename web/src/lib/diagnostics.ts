// Keeps the last few problems the app ran into (failed requests, script errors, crashes) so a problem report can include
// them automatically. Nothing leaves the PC unless the user sends the report themselves.
export type DiagEvent = { at: string; kind: 'api' | 'script' | 'crash'; text: string };

const MAX = 25;
const events: DiagEvent[] = [];

let sent = 0;
/** Also written into the server's local journal (logs\errors.log on the Yukti server computer), so an administrator can
 *  see and fix problems without asking the user to describe them. At most 20 per page load; never throws. */
function toJournal(kind: DiagEvent['kind'], text: string) {
  if (sent >= 20) return;
  sent += 1;
  try {
    const app = /\bYuktiDesktop\/(\S+)/.exec(navigator.userAgent)?.[1] ?? 'browser';
    void fetch('/api/diagnostics/client-error', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', keepalive: true,
      body: JSON.stringify({ kind, text: text.slice(0, 600), page: location.pathname, app }),
    }).catch(() => { /* the server is unreachable: the problem stays in the report list below */ });
  } catch { /* never let error reporting cause an error */ }
}

export function recordProblem(kind: DiagEvent['kind'], text: string) {
  events.push({ at: new Date().toISOString(), kind, text: text.slice(0, 400) });
  if (events.length > MAX) events.splice(0, events.length - MAX);
  if (!/client-error/.test(text)) toJournal(kind, text);
}

export function recentProblems(): DiagEvent[] { return [...events]; }

let installed = false;
export function installDiagnostics() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => recordProblem('script', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => recordProblem('script', `Unhandled: ${String((e.reason as Error)?.message ?? e.reason)}`));
}
