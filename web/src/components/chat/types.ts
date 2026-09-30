import type { Message } from '../../lib/types';

export type UIMessage = Message & {
  streaming?: boolean;
  error?: { code: string; message: string } | null;
};

/**
 * Example questions on the empty chat screen; values are i18n keys (the translated prompt is sent as the question).
 * need: every permission listed is required (need-to-know: company-level questions only with 'company.view', which the
 * IT administrator role does not give by itself). depts: words in the user's department that make the question more relevant.
 */
export type Suggestion = { title: string; prompt: string; tag: string; need: string[]; depts: string[] };
export const SUGGESTIONS: Suggestion[] = [
  { tag: 'chat.sugg.trip.tag', title: 'chat.sugg.trip.title', prompt: 'chat.sugg.trip.prompt',
    need: ['documents.view'], depts: ['electrical', 'mechanical', 'instrument', 'operations'] },
  { tag: 'chat.sugg.amine.tag', title: 'chat.sugg.amine.title', prompt: 'chat.sugg.amine.prompt',
    need: ['documents.view'], depts: ['process', 'operations', 'safety', 'utilities'] },
  { tag: 'chat.sugg.certs.tag', title: 'chat.sugg.certs.title', prompt: 'chat.sugg.certs.prompt',
    need: ['assets.view'], depts: ['safety', 'maintenance', 'utilities'] },
  { tag: 'chat.sugg.wo.tag', title: 'chat.sugg.wo.title', prompt: 'chat.sugg.wo.prompt',
    need: ['assets.view'], depts: ['maintenance', 'operations', 'planning'] },
  { tag: 'chat.sugg.mrpl.tag', title: 'chat.sugg.mrpl.title', prompt: 'chat.sugg.mrpl.prompt',
    need: ['company.view'], depts: [] },
  { tag: 'chat.sugg.products.tag', title: 'chat.sugg.products.title', prompt: 'chat.sugg.products.prompt',
    need: ['company.view'], depts: [] },
];

/** At most `max` suggestions this user may ask about, the ones closest to their work first. */
export function suggestionsFor(has: (perm: string) => boolean, department: string | undefined, max = 4): Suggestion[] {
  const dept = (department ?? '').toLowerCase();
  const score = (s: Suggestion) => (s.need.includes('company.view') ? 2 : 0) + (s.depts.some((d) => dept.includes(d)) ? 1 : 0);
  return SUGGESTIONS.filter((s) => s.need.every(has))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => score(b.s) - score(a.s) || a.i - b.i)
    .slice(0, max)
    .map((x) => x.s);
}

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
