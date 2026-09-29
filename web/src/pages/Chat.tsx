import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen, PanelRightOpen, ShieldCheck } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { streamSSE } from '../lib/sse';
import { qk, uiStore, useLoaded } from '../lib/queries';
import { setSettings, useSettings } from '../lib/settings';
import type { ChatDetail, Denied, Fact, GenStats, GuardDecision, RouteDecision, Source } from '../lib/types';
import { cx } from '../lib/format';
import { Badge, Dot, ErrorBox, Loading } from '../components/ui';
import { Logo } from '../components/Logo';
import { toast } from '../components/Toast';
import { ChatSidebar } from '../components/chat/ChatSidebar';
import { ConfigSidebar } from '../components/chat/ConfigSidebar';
import { Composer } from '../components/chat/Composer';
import { AssistantMessage, UserMessage } from '../components/chat/AssistantMessage';
import { SUGGESTIONS, type UIMessage } from '../components/chat/types';

type Pred = Record<string, unknown>;

export default function Chat() {
  const { chatId } = useParams<{ chatId?: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const settings = useSettings();
  const loaded = useLoaded();

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [systemPrompt, setSystemPromptRaw] = useState('');
  const [prediction, setPredictionRaw] = useState<Pred>({});
  const [useKnowledge, setUseKnowledge] = useState(true);
  const [busy, setBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const streamChatRef = useRef<string | null>(null);
  const loadedFor = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const detail = useQuery({
    queryKey: qk.chat(chatId ?? ''),
    queryFn: () => api.get<ChatDetail>(`/api/chats/${chatId}`),
    enabled: !!chatId,
  });

  /* ---- route changes ---- */
  useEffect(() => {
    if (streamChatRef.current && streamChatRef.current !== chatId) {
      abortRef.current?.abort();
    }
    if (!chatId) {
      loadedFor.current = null;
      dirtyRef.current = false;
      setMessages([]);
      setSystemPromptRaw('');
      setPredictionRaw({});
    } else if (loadedFor.current !== chatId) {
      setMessages([]);
    }
    stickRef.current = true;
  }, [chatId]);

  /* ---- apply server data ---- */
  useEffect(() => {
    const d = detail.data;
    if (!d || !chatId || d.id !== chatId) return;
    if (streamChatRef.current === chatId) return; // live stream owns the view
    if (loadedFor.current !== chatId) {
      loadedFor.current = chatId;
      dirtyRef.current = false;
      setSystemPromptRaw(d.system_prompt ?? '');
      setPredictionRaw({ ...(d.prediction ?? {}) });
    }
    setMessages((d.messages ?? []).filter((m) => m.role !== 'system'));
  }, [detail.data, chatId]);

  /* ---- persist per-chat config (debounced) ---- */
  const setSystemPrompt = useCallback((s: string) => { dirtyRef.current = true; setSystemPromptRaw(s); }, []);
  const setPrediction = useCallback((p: Pred) => { dirtyRef.current = true; setPredictionRaw(p); }, []);
  useEffect(() => {
    if (!chatId || !dirtyRef.current || loadedFor.current !== chatId) return;
    const t = setTimeout(() => {
      dirtyRef.current = false;
      api.patch(`/api/chats/${chatId}`, { system_prompt: systemPrompt, prediction })
        .catch((e) => toast.error('Could not save chat settings', errMsg(e)));
    }, 700);
    return () => clearTimeout(t);
  }, [systemPrompt, prediction, chatId]);

  /* ---- autoscroll ---- */
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  /* ---- streaming ---- */
  const runStream = useCallback(async (cid: string, path: string, body: unknown, aid: string) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    streamChatRef.current = cid;
    setBusy(true);
    stickRef.current = true;
    const upd = (fn: (m: UIMessage) => UIMessage) => setMessages((ms) => ms.map((m) => (m.id === aid ? fn(m) : m)));
    let doneId: string | null = null;
    try {
      await streamSSE(path, body, ({ event, data }) => {
        switch (event) {
          case 'route': upd((m) => ({ ...m, route: data as RouteDecision })); break;
          case 'guard': upd((m) => ({ ...m, guard: data as GuardDecision })); break;
          case 'retrieval': {
            const r = data as { sources?: Source[]; denied?: Denied };
            upd((m) => ({ ...m, sources: r.sources ?? [], denied: r.denied ?? null }));
            break;
          }
          case 'reasoning': upd((m) => ({ ...m, reasoning: (m.reasoning ?? '') + ((data as { t?: string })?.t ?? '') })); break;
          case 'token': upd((m) => ({ ...m, content: m.content + ((data as { t?: string })?.t ?? '') })); break;
          case 'facts': upd((m) => ({ ...m, facts: (data as { facts?: Fact[] })?.facts ?? [] })); break;
          case 'done': {
            const d = data as { message_id?: string; stats?: GenStats };
            doneId = d.message_id ?? null;
            upd((m) => ({ ...m, stats: d.stats ?? null, streaming: false }));
            if (d.stats) uiStore.setLastGen({ tok_per_s: d.stats.tok_per_s, model: d.stats.model_name, engine: d.stats.engine });
            break;
          }
          case 'error': {
            const e = data as { code?: string; message?: string };
            upd((m) => ({ ...m, error: { code: e?.code ?? 'error', message: e?.message ?? String(data) } }));
            break;
          }
          default: break;
        }
      }, ctrl.signal);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        upd((m) => ({ ...m, stats: m.stats ?? null, error: m.content ? m.error : { code: 'stopped', message: 'Generation stopped.' } }));
      } else {
        upd((m) => ({ ...m, error: { code: 'stream_failed', message: errMsg(e) } }));
      }
    } finally {
      upd((m) => ({ ...m, streaming: false, id: doneId ?? m.id }));
      if (abortRef.current === ctrl) abortRef.current = null;
      if (streamChatRef.current === cid) streamChatRef.current = null;
      setBusy(false);
      qc.invalidateQueries({ queryKey: qk.chats });
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: qk.chat(cid), refetchType: 'none' });
      qc.invalidateQueries({ queryKey: qk.loaded });
    }
  }, [qc]);

  const send = useCallback(async (text: string) => {
    if (busy) return;
    let cid = chatId;
    if (!cid) {
      try {
        const c = await api.post<{ id: string }>('/api/chats', { title: text.slice(0, 60) });
        cid = c.id;
        loadedFor.current = cid;
        streamChatRef.current = cid;
        if (systemPrompt || Object.keys(prediction).length) {
          api.patch(`/api/chats/${cid}`, { system_prompt: systemPrompt, prediction }).catch(() => undefined);
        }
        dirtyRef.current = false;
        nav(`/chat/${cid}`);
        qc.invalidateQueries({ queryKey: qk.chats });
      } catch (e) {
        toast.error('Could not create chat', errMsg(e));
        return;
      }
    }
    const now = new Date().toISOString();
    const stamp = Date.now();
    const aid = `local-a-${stamp}`;
    setMessages((ms) => [
      ...ms,
      { id: `local-u-${stamp}`, role: 'user', content: text, created_at: now },
      { id: aid, role: 'assistant', content: '', created_at: now, streaming: true },
    ]);
    void runStream(cid, `/api/chats/${cid}/messages`, {
      content: text,
      system_prompt: systemPrompt || undefined,
      prediction,
      use_knowledge: useKnowledge,
    }, aid);
  }, [busy, chatId, systemPrompt, prediction, useKnowledge, nav, qc, runStream]);

  const stop = useCallback(() => {
    const cid = streamChatRef.current ?? chatId;
    abortRef.current?.abort();
    if (cid) api.post(`/api/chats/${cid}/stop`).catch(() => undefined);
  }, [chatId]);

  const regenerate = useCallback(() => {
    if (!chatId || busy) return;
    const aid = `local-a-${Date.now()}`;
    setMessages((ms) => {
      const idx = ms.map((m) => m.role).lastIndexOf('assistant');
      const base = idx >= 0 && idx === ms.length - 1 ? ms.slice(0, idx) : ms;
      return [...base, { id: aid, role: 'assistant', content: '', created_at: new Date().toISOString(), streaming: true }];
    });
    void runStream(chatId, `/api/chats/${chatId}/regenerate`, { prediction }, aid);
  }, [chatId, busy, prediction, runStream]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const modelReady = loaded.data?.status === 'ready';
  const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf('assistant');
  const width = settings.chatFullWidth ? 'max-w-none' : 'max-w-[860px]';
  const title = chatId ? (detail.data?.title || (detail.isLoading ? '' : 'Untitled chat')) : 'New chat';
  const showEmpty = messages.length === 0 && !(chatId && detail.isLoading) && !(chatId && detail.error);

  return (
    <div className="flex h-full min-h-0">
      <ChatSidebar activeId={chatId} onNew={() => nav('/chat')} />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
          <div className="min-w-0 flex-1 truncate font-medium">{title}</div>
          {useKnowledge
            ? <Badge tone="cyan"><BookOpen size={11} />Knowledge on</Badge>
            : <Badge tone="muted">Knowledge off</Badge>}
          {loaded.data?.model_name && (
            <Badge tone="muted" mono className="max-w-[220px] truncate">
              <Dot tone={modelReady ? 'ok' : loaded.data.status === 'loading' ? 'cyan' : 'muted'} />{loaded.data.model_name}
            </Badge>
          )}
          {!settings.configSidebarOpen && (
            <button className="btn btn-ghost btn-icon text-muted" title="Show configuration" onClick={() => setSettings({ configSidebarOpen: true })}>
              <PanelRightOpen size={15} />
            </button>
          )}
        </header>

        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          {chatId && detail.isLoading && messages.length === 0 && <Loading label="Loading conversation…" />}
          {chatId && detail.error && messages.length === 0 && (
            <div className={cx('mx-auto p-6', width)}>
              <ErrorBox error={detail.error} onRetry={() => detail.refetch()} />
              <button className="btn btn-sm mt-3" onClick={() => nav('/chat')}>Start a new chat</button>
            </div>
          )}
          {showEmpty && <EmptyChat onPick={(p) => void send(p)} />}
          {messages.length > 0 && (
            <div className={cx('mx-auto space-y-6 px-5 py-6', width)}>
              {messages.map((m, i) => m.role === 'user'
                ? <UserMessage key={m.id} m={m} />
                : (
                  <AssistantMessage key={m.id} m={m} isLast={i === lastAssistantIdx} busy={busy} showStats={settings.showStats}
                    question={messages[i - 1]?.role === 'user' ? messages[i - 1].content : undefined}
                    onRegenerate={regenerate} />
                ))}
            </div>
          )}
        </div>

        <Composer busy={busy} onSend={(t) => void send(t)} onStop={stop} useKnowledge={useKnowledge}
          onToggleKnowledge={() => setUseKnowledge((v) => !v)} sendWithEnter={settings.sendWithEnter}
          modelReady={modelReady} onOpenLoader={() => uiStore.openLoader()} fullWidth={settings.chatFullWidth} />
      </section>

      {settings.configSidebarOpen && (
        <ConfigSidebar systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} prediction={prediction}
          setPrediction={setPrediction} useKnowledge={useKnowledge} setUseKnowledge={setUseKnowledge}
          onClose={() => setSettings({ configSidebarOpen: false })} />
      )}
    </div>
  );
}

function EmptyChat({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-10">
      <Logo size={52} />
      <h2 className="mt-4 text-[18px] font-semibold">What do you need from the plant?</h2>
      <p className="mt-1 max-w-lg text-center text-muted">
        Answers are grounded in documents you are cleared to read — cited, fact-checked for conflicts, and audited.
      </p>
      <div className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-ok"><ShieldCheck size={12} />On-prem · offline · policy-enforced retrieval</div>
      <div className="mt-6 grid w-full max-w-[760px] grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button key={s.prompt} onClick={() => onPick(s.prompt)}
            className="group rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-cyan/50 hover:bg-surface-2">
            <div className="flex items-center gap-2">
              <span className="label !text-[10px] text-amber/90">{s.tag}</span>
              <ArrowRight size={12} className="ml-auto text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-cyan" />
            </div>
            <div className="mt-1 font-medium">{s.title}</div>
            <div className="mt-0.5 text-[12px] text-muted">{s.prompt}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
