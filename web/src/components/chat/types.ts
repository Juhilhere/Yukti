import type { Message } from '../../lib/types';

export type UIMessage = Message & {
  streaming?: boolean;
  error?: { code: string; message: string } | null;
};

/** Example questions on the empty chat screen; values are i18n keys (the translated prompt is sent as the question). */
export const SUGGESTIONS: { title: string; prompt: string; tag: string }[] = [
  { tag: 'chat.sugg.trip.tag', title: 'chat.sugg.trip.title', prompt: 'chat.sugg.trip.prompt' },
  { tag: 'chat.sugg.amine.tag', title: 'chat.sugg.amine.title', prompt: 'chat.sugg.amine.prompt' },
  { tag: 'chat.sugg.certs.tag', title: 'chat.sugg.certs.title', prompt: 'chat.sugg.certs.prompt' },
  { tag: 'chat.sugg.wo.tag', title: 'chat.sugg.wo.title', prompt: 'chat.sugg.wo.prompt' },
  { tag: 'chat.sugg.mrpl.tag', title: 'chat.sugg.mrpl.title', prompt: 'chat.sugg.mrpl.prompt' },
  { tag: 'chat.sugg.products.tag', title: 'chat.sugg.products.title', prompt: 'chat.sugg.products.prompt' },
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
