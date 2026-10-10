// Durable work queue, workbench, scan-to-finding, Performance Engine and research layer: API types and hooks.
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Fact, Source } from './types';

export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'interrupted' | 'waiting_review';
export type TaskStep = { name: string; status: 'pending' | 'running' | 'done' | 'error' | 'skipped'; detail: string; ms?: number };
export type TaskFile = { id: string; kind?: string; file_name: string; sha256?: string; title?: string; created_at?: string; url: string };
export type CalcStep = { n: number; name: string; expression: string; substituted: string; value: number; unit: string };
export type SandboxRun = { exit_code: number; timed_out: boolean; ms: number; stdout: string; stderr: string };
export type ScanCheck = { check: string; result: string; detail?: string; field?: string | null; expected?: unknown };
export type WorkResult = {
  deliverable?: string; files?: TaskFile[]; tools?: { tool: string; status: string; detail?: string }[];
  sources?: Source[]; denied?: { count: number; departments: string[] } | null; facts?: Fact[]; draft?: string; model?: string | null;
  citations?: { cited: string[]; unknown: string[] };
  calculation?: { steps: CalcStep[]; result: CalcStep; inputs: Record<string, number> };
  code?: string; run?: SandboxRun; explanation?: string;
  // scan to finding
  document_id?: string; tag?: string | null; fields?: Record<string, unknown>; field_confidence?: Record<string, number>;
  thickness?: { point: string; location?: string; previous_mm?: number | null; current_mm?: number | null; remark?: string; confidence?: number }[];
  checks?: ScanCheck[]; vision?: { used: boolean; note?: string; model?: string } | null;
  finding?: { id: string; title?: string; severity?: string; lane?: string; review_items?: number; state?: string; duplicate?: boolean } | null;
  waiting_review?: boolean;
};
export type TaskOut = {
  id: string; kind: string; worker: string; worker_label: string; status: TaskStatus; title: string; chat_id: string | null;
  steps: TaskStep[]; result: WorkResult; error: string | null; attempts: number; served_by: string | null;
  created_at: string; started_at: string | null; finished_at: string | null; files?: TaskFile[];
};
export const TASK_FINAL: TaskStatus[] = ['done', 'error', 'interrupted', 'waiting_review'];
export const isFinal = (s?: string | null) => !!s && (TASK_FINAL as string[]).includes(s);

/** Poll a queue task every 1.5 s until it is done, failed or waiting for a reviewer. */
export function useTask(id: string | null | undefined) {
  return useQuery({
    queryKey: ['task', id],
    queryFn: () => api.get<TaskOut>(`/api/tasks/${encodeURIComponent(id!)}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && isFinal(q.state.data.status) ? false : 1500),
  });
}

export type WorkOptions = { deliverables: { id: string; label: string }[]; sandbox: { imports: string[]; timeout_s: number } };

/** Worker id -> translation key of its label (the server's English label is the fallback). */
export const WORKER_KEY: Record<string, string> = {
  policy: 'wb.worker.policy', small_llm: 'wb.worker.small_llm', ocr_vlm: 'wb.worker.ocr_vlm', analytics: 'wb.worker.analytics',
  reasoning: 'wb.worker.reasoning', coder: 'wb.worker.coder', workflow: 'wb.worker.workflow',
};
export const WORKERS = Object.keys(WORKER_KEY);

/* ---- checkpoints / KV ---- */
export type Checkpoint = {
  message_id: string; task_id: string | null; worker: string; model: string | null;
  kv: { slot?: number | null; state?: string; cached_tokens?: number | null; prompt_tokens?: number | null; kv_type?: string | null; ctx?: number | null };
  tools: { tool: string; result?: unknown }[]; approvals: { rule: string; decision: string }[]; citations: unknown[]; created_at: string;
};
export type KVStats = {
  slots: number; hot_chats: number; busy: number[]; hits: number; misses: number; evictions: number; restores: number;
  spilled_files: number; spilled_mb: number; settings?: { kv_ttl_s: number; kv_spill: boolean; kv_spill_max_mb: number };
  kv_type?: string | null; ctx_per_slot?: number | null;
};

/* ---- admin ---- */
export type QueueWorker = {
  id: string; label: string; purpose: string; concurrency: number; counts: Record<string, number>;
  served_by: { model: string; assigned: string | null; fallback: boolean }; running: number;
};
export type QueueStats = { workers: QueueWorker[]; recent: TaskOut[]; kv: KVStats };
export type PerfProfile = {
  id: string; label: string; status: 'measured' | 'reference' | 'validated'; measured?: string | null; note?: string | null;
  min_vram_mb: number; params_b: number[]; load: Record<string, unknown>;
  validation?: { at: string; by: string; model: string; tok_per_s_median: number; tok_per_s_range: number[]; ttft_ms_median: number;
    vram?: { used_mb: number; total_mb: number } | null } | null;
};
export type ProfilesOut = { free_vram_mb: number | null; recommended: string | null; active: string | null; profiles: PerfProfile[] };
export type RetrievalStatus = {
  graph: { edges: number; by_relation: Record<string, number> };
  vectors: { status: string; model: string | null; vectors: number; chunks: number; error: string | null };
  channels: string[];
};
export type ResearchStatus = { status: 'off' | 'loading' | 'ready' | 'error'; model: string | null; error: string | null; label: string; enabled: boolean };
export type ResearchConfig = ResearchStatus & { model_id: string; url: string; guardrails: string };
export type ResearchAnswer = { answer: string; label: string; model: string | null; ms: number; isolation: { documents: string; rule: string[] } };

/* ---- scan review ---- */
export type ReviewItem = {
  id: string; document_id: string; finding_id: string; finding_title: string; tag: string; field: string; value: unknown;
  expected: unknown; reason: string; confidence: number | null; region: { x: number; y: number; w: number; h: number; page?: number } | null;
  created_at: string;
};

/* ---- ledger / graph ---- */
export type LedgerCategory = { id: string; label: string; alert_days: number; interval_months: number | null };
export type GraphLink = { rel: string; kind: string; id?: string; tag?: string; title?: string; doc_number?: string; revision?: string; status?: string };

/* ---- production plan ---- */
export type ForecastRow = { expected: number; low: number; high: number; method: string; n: number; last_month?: string; unit?: string };
export type PlanResult = {
  forecast: Record<string, ForecastRow>;
  proposal: { product: string; baseline_kt: number; proposed_kt: number; change_pct: number }[];
  expected_value: { margin_usd: number; baseline_margin_usd: number; delta_usd: number };
  alternatives: { case: 'low' | 'high'; label: string; margin_usd: number; mix_kt: Record<string, number>; binding: string[] }[];
  binding: string[]; shadow_prices: { constraint: string; value: number }[]; assumptions: string[]; explanation: string; decision: string;
};

/** "0.87" or "87" -> 87 (percent), else null. */
export function pct(c: unknown): number | null {
  if (typeof c !== 'number' || !isFinite(c)) return null;
  return Math.round(c <= 1 ? c * 100 : c);
}
