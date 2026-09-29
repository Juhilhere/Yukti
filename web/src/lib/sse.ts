// POST-based SSE: fetch + ReadableStream parsing of `event:` / `data:` lines.
import { buildHeaders, notifyError, parseError } from './api';

export type SSEEvent = { event: string; data: unknown };

export async function streamSSE(
  path: string,
  body: unknown,
  onEvent: (e: SSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders('POST', body, { Accept: 'text/event-stream' }),
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!res.ok) {
    const err = await parseError(res);
    notifyError(err, path);
    throw err;
  }
  if (!res.body) throw new Error('Streaming not supported by this browser');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let evName = 'message';
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length === 0) { evName = 'message'; return; }
    const raw = dataLines.join('\n');
    let data: unknown = raw;
    try { data = JSON.parse(raw); } catch { /* plain text */ }
    onEvent({ event: evName, data });
    evName = 'message';
    dataLines = [];
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.search(/\r?\n/)) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + (buf[idx] === '\r' ? 2 : 1));
      if (line === '') { dispatch(); continue; }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let val = colon < 0 ? '' : line.slice(colon + 1);
      if (val.startsWith(' ')) val = val.slice(1);
      if (field === 'event') evName = val;
      else if (field === 'data') dataLines.push(val);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) {
    for (const line of buf.split(/\r?\n/)) {
      if (line.startsWith('event:')) evName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  dispatch();
}
