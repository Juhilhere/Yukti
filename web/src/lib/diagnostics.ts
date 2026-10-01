// Keeps the last few problems the app ran into (failed requests, script errors, crashes) so a problem report can include
// them automatically. Nothing leaves the PC unless the user sends the report themselves.
export type DiagEvent = { at: string; kind: 'api' | 'script' | 'crash'; text: string };

const MAX = 25;
const events: DiagEvent[] = [];

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;
/** when each journal entry of the current window was sent, and its text (to skip repeats) */
let sent: { at: number; text: string }[] = [];

/** Query strings can carry what the user searched for: only the path goes into the journal. */
const stripQuery = (s: string) => s.replace(/(\/[^\s?]*)\?\S*?(?=:?\s|$)/g, '$1');

/** Also written into the server's local journal (logs\errors.log on the Yukti server computer), so an administrator can
 *  see and fix problems without asking the user to describe them. At most 20 in any 10 minutes, the same problem only
 *  once in that time; never throws. */
function toJournal(kind: DiagEvent['kind'], raw: string) {
  try {
    const text = stripQuery(raw).slice(0, 600);
    const now = Date.now();
    sent = sent.filter((s) => now - s.at < WINDOW_MS);
    if (sent.length >= MAX_PER_WINDOW || sent.some((s) => s.text === text)) return;
    sent.push({ at: now, text });
    const app = /\bYuktiDesktop\/(\S+)/.exec(navigator.userAgent)?.[1] ?? 'browser';
    void fetch('/api/diagnostics/client-error', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', keepalive: true,
      body: JSON.stringify({ kind, text, page: location.pathname, app }),
    }).catch(() => { /* the server is unreachable: the problem stays in the report list below */ });
  } catch { /* never let error reporting cause an error */ }
}

/** `journal: false` keeps the problem for the user's own report only. Used when the server cannot be reached: such an
 *  entry could not be delivered anyway and would only use up the allowance for real problems. */
export function recordProblem(kind: DiagEvent['kind'], text: string, journal = true) {
  events.push({ at: new Date().toISOString(), kind, text: text.slice(0, 400) });
  if (events.length > MAX) events.splice(0, events.length - MAX);
  if (journal && !/client-error|server not reachable/.test(text)) toJournal(kind, text);
}

export function recentProblems(): DiagEvent[] { return [...events]; }

let installed = false;
export function installDiagnostics() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => recordProblem('script', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => recordProblem('script', `Unhandled: ${String((e.reason as Error)?.message ?? e.reason)}`,
    (e.reason as { status?: unknown } | null)?.status !== 0));  // status 0 = the server could not be reached (see recordProblem)
}
