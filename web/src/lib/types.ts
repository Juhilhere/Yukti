// Types mirroring docs/API.md (v0.1)

export type User = {
  id: string; username: string; display_name: string; post: string; department: string;
  clearance: number; clearance_label: string; roles: string[]; asset_scopes: string[];
};
export type Me = {
  user: User;
  csrf_token: string;
  permissions: string[];
  grants: { id: string; scope: string; expires_at: string }[];
  session: { idle_expires_at: string; abs_expires_at: string; idle_timeout_s: number };
  demo_mode: boolean;
};
export type SessionInfo = { id: string; created_at: string; last_seen_at: string; ip: string; user_agent: string; current: boolean };
export type DemoUser = { username: string; display_name: string; post: string; department: string; password: string };

export type SystemInfo = {
  gpu: { name: string; vram_total_mb: number; vram_used_mb: number; util_pct: number } | null;
  ram: { total_mb: number; used_mb: number };
  cpu: { name: string; cores: number; threads: number; util_pct: number };
  llama_build: string | null;
  offline_guard: boolean;
  version: string;
};

export type EngineId = 'llamacpp' | 'bionic' | 'vllm' | 'remote';
export type Engine = { id: EngineId; name: string; description: string; base_url: string; available: boolean; version?: string };
export type Model = {
  id: string; name: string; file_name: string; path: string; size_bytes: number; family: string;
  params_b?: number; quant: string; arch?: string; source: 'lmstudio' | 'yukti' | 'engine'; vision: boolean;
};
export type LoadedModel = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  engine: string | null; model_id: string | null; model_name: string | null;
  load_config: Record<string, unknown> | null; started_at: string | null; error?: string; port?: number; ctx_used_pct?: number;
};

export type ParamField = {
  key: string; label: string; group: string;
  type: 'number' | 'int' | 'bool' | 'select' | 'text' | 'textarea' | 'tags' | 'json';
  min?: number; max?: number; step?: number; default: unknown; options?: { value: unknown; label: string }[];
  description: string; engines: string[]; advanced?: boolean; unit?: string;
};
export type ParamSchema = { load: ParamField[]; prediction: ParamField[] };

export type Preset = {
  id: string; name: string; description: string; system_prompt: string;
  prediction: Record<string, unknown>; load: Record<string, unknown>; builtin: boolean;
};

export type Project = { id: string; name: string; chat_count: number };
export type ChatSummary = { id: string; title: string; project_id: string | null; updated_at: string; message_count: number; model_name: string | null };

export type RouteDecision = {
  intent: string; department: string; urgency: number | string; needs_review: boolean; sensitivity: string;
  route: string; confidence: number; latency_ms: number; model_version: string;
};
export type GuardDecision = { category: string; decision: 'allow' | 'deny' | 'review'; rule_ids: string[]; reason: string };
export type Source = {
  id: string; document_id: string; title: string; doc_number: string; revision: string; status: 'CURRENT' | 'SUPERSEDED';
  page: number; snippet: string; score: number; classification: string; department: string;
};
export type Denied = { count: number; departments: string[] };
export type FactCandidate = { value: string; source_id: string; source_label: string; revision: string; effective: string; recommended: boolean };
export type Fact = {
  slot: string; attribute: string; value: string | null; status: 'KNOWN' | 'MISSING' | 'CONFLICTING';
  candidates: FactCandidate[]; note: string;
};
export type GenStats = {
  tokens_in: number; tokens_out: number; tok_per_s: number; ttft_ms: number; total_ms: number;
  stop_reason: string; model_name: string; engine: string;
};
export type Message = {
  id: string; role: 'user' | 'assistant' | 'system'; content: string; created_at: string;
  route?: RouteDecision | null; guard?: GuardDecision | null; sources?: Source[] | null; denied?: Denied | null;
  facts?: Fact[] | null; stats?: GenStats | null; reasoning?: string | null;
};
export type ChatDetail = {
  id: string; title: string; project_id: string | null; system_prompt: string | null;
  prediction: Record<string, unknown> | null; messages: Message[];
};

export type DocPageMode = 'digital' | 'scanned' | 'image';
export type DocumentSummary = {
  id: string; title: string; doc_number: string; revision: string; status: string; doc_type: string; department: string;
  classification: string; pages: number; page_modes: { digital: number; scanned: number }; asset_tags: string[];
  created_at: string; size_bytes: number;
};
export type DocPage = { page_no: number; mode: DocPageMode; text: string; ocr_conf?: number };
export type DocumentDetail = Omit<DocumentSummary, 'pages'> & { pages: DocPage[] };
export type JobStage = { name: string; status: 'pending' | 'running' | 'done' | 'skipped' | 'error'; detail: string };
export type Job = { id: string; status: 'queued' | 'running' | 'done' | 'error'; stages: JobStage[]; document_id: string; error?: string };

export type AccessRequest = {
  id: string; requester: string; requester_name: string; resource_label: string; department: string; justification: string;
  hours: number; state: string; created_at: string; decided_at?: string; approver_name?: string;
};
export type Grant = { id: string; scope: string; expires_at: string; approved_by: string };

export type AssetItem = { type: string; ref_no: string; expires_on: string | null; days_left: number | null; status: string };
export type Asset = {
  tag: string; name: string; unit: string; class: string; vendor: string; serial: string; location: string;
  owner_department: string; criticality: string; items: AssetItem[];
};
export type AssetDetail = Asset & { work_orders?: Record<string, unknown>[]; documents?: Partial<DocumentSummary>[] };

export type Alert = { id: string; severity: 'red' | 'amber' | 'info'; title: string; detail: string; tag: string; due: string; created_at: string };
export type Notification = { id: string; kind: string; title: string; body: string; created_at: string; read: boolean; link?: string };

export type Finding = {
  id: string; title: string; tag: string; discipline: string; severity: string; state: string; due_date: string;
  evidence: string; source_document_id: string; page: number; approver_name: string; created_at: string;
};

export type ProductionOverview = {
  capacity_mmtpa: number; nci: number;
  products: { name: string; share_pct: number; margin_usd_bbl: number }[];
  history: { month: string; product: string; demand_kt: number; forecast_kt?: number; lo?: number; hi?: number }[];
};
export type ScenarioInput = { hcu_down_days: number; diesel_crack_delta: number; petchem_margin_delta: number; crude_price_delta: number };
export type ScenarioResult = {
  baseline: Record<string, number>; scenario: Record<string, number>; delta_pct: Record<string, number>;
  margin_cr: { baseline: number; scenario: number }; binding: string[]; shadow_prices: { constraint: string; value: number }[];
  assumptions: string[]; explanation: string;
};

export type LayaStats = { total: number; llm_calls_saved: number; avg_latency_ms: number; by_intent: Record<string, number>; model_version: string };
export type Report = { id: string; file_name: string; url: string; created_at?: string; tag?: string };

export type AuditRecord = { seq: number; at: string; actor: string; event: string; entity: string; detail: unknown; hash: string; prev_hash: string };
export type AuditVerify = { ok: boolean; count: number; broken_at?: number; head: string };

export type ServerStatus = { engine: string; status: string; port: number; openai_base_url: string; uptime_s: number; requests: number; model_name: string | null };

export type AdminUser = { username: string; [k: string]: unknown };
export type PolicyDoc = { version: string; yaml: string };
