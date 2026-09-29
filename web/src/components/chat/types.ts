import type { Message } from '../../lib/types';

export type UIMessage = Message & {
  streaming?: boolean;
  error?: { code: string; message: string } | null;
};

export const SUGGESTIONS: { title: string; prompt: string; tag: string }[] = [
  { tag: 'Trip response', title: 'A2 tripped at 02:15', prompt: 'A2 tripped at 02:15 — give me the isolation and restart dossier' },
  { tag: 'Process limits', title: 'MDEA amine strength', prompt: 'What is the MDEA amine strength limit for the amine unit?' },
  { tag: 'Compliance', title: 'Expiring certificates', prompt: 'Which certificates expire in the next 30 days?' },
  { tag: 'Maintenance', title: 'CDU-1 work orders', prompt: 'Summarise open work orders for CDU-1' },
];

/** Replace bare [S1] markers with markdown links that we render as citation pills. */
export function linkCitations(text: string): string {
  return (text || '').replace(/\[(S\d+)\](?!\()/g, '[$1](#cite-$1)');
}

export function sourceElId(msgId: string, sid: string) {
  return `src-${msgId}-${sid}`;
}

export function flashSource(msgId: string, sid: string) {
  const el = document.getElementById(sourceElId(msgId, sid));
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  el.classList.remove('hl-flash');
  void el.offsetWidth;
  el.classList.add('hl-flash');
  setTimeout(() => el.classList.remove('hl-flash'), 2200);
}
