// Types mirroring docs/API.md (v0.1)

export type User = {
  id: string; username: string; display_name: string; post: string; department: string;
  clearance: number; clearance_label: string; roles: string[]; asset_scopes: string[];
  must_change_password?: boolean; mfa_enabled?: boolean; status?: string;
};
export type Me = {
  user: User;
  csrf_token: string;
  permissions: string[];
  grants: { id: string; scope: string; expires_at: string }[];
  session: { idle_expires_at: string; abs_expires_at: string; idle_timeout_s: number };
  demo_mode: boolean;
  org?: { name: string; deployment: string; languages: string[] };
};
export type SessionInfo = { id: string; created_at: string; last_seen_at: string; ip: string; user_agent: string; current: boolean };
export type DemoUser = { username: string; display_name: string; post: string; department: string; password: string };

// hardware fields are sent to administrators only; employees get offline_guard + version
export type SystemInfo = {
  gpu?: { name: string; vram_total_mb: number; vram_used_mb: number; util_pct: number } | null;
  ram?: { total_mb: number; used_mb: number };
  cpu?: { name: string; cores: number; threads: number; util_pct: number };
  llama_build?: string | null;
  offline_guard: boolean;
  version: string;
};

export type EngineId = 'llamacpp' | 'ollama' | 'bionic' | 'vllm' | 'remote';
export type Engine = { id: EngineId; name: string; description: string; base_url: string; available: boolean; version?: string; models?: string[]; error?: string };
export type Model = {
  id: string; name: string; file_name: string; path: string; size_bytes: number; family: string;
  params_b?: number; quant: string; arch?: string; source: 'lmstudio' | 'yukti' | 'engine' | 'ollama' | 'ollama-library'; engine?: EngineId; vision: boolean;
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
  is_example?: boolean; is_public?: boolean;
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
  feedback?: { rating: number; comment?: string | null } | number | null;
};
export type ChatDetail = {
  id: string; title: string; project_id: string | null; system_prompt: string | null;
  prediction: Record<string, unknown> | null; messages: Message[];
};

export type DocPageMode = 'digital' | 'scanned' | 'image';
export type DocumentSummary = {
  id: string; title: string; doc_number: string; revision: string; status: string; doc_type: string; department: string;
  classification: string; pages: number; page_modes: { digital: number; scanned: number }; asset_tags: string[];
  created_at: string; size_bytes: number; is_example?: boolean; is_public?: boolean;
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
  owner_department: string; criticality: string; items: AssetItem[]; is_example?: boolean;
};
export type AssetDetail = Asset & { work_orders?: Record<string, unknown>[]; documents?: Partial<DocumentSummary>[] };

export type Alert = { id: string; severity: 'red' | 'amber' | 'info'; title: string; detail: string; tag: string; due: string; created_at: string };
export type Notification = { id: string; kind: string; title: string; body: string; created_at: string; read: boolean; link?: string };

export type Finding = {
  id: string; title: string; tag: string; discipline: string; severity: string; state: string; due_date: string;
  evidence: string; source_document_id: string; page: number; approver_name: string; created_at: string;
  allowed_actions?: string[]; discipline_approver?: boolean; is_example?: boolean;
  history?: { at: string; event: string; by: string; note?: string | null }[];
};

export type PublicProductionRow = { fy: string; product: string; production_kt: number | null; sales_kt: number | null; export_kt: number | null; source_url: string | null };
export type SourcedValue = { value: number | null; label: string; period: string | null; source_url: string | null };
export type ProductionOverview = {
  capacity_mmtpa: number | null; capacity_source?: string | null; nci: number | null; nci_sources?: SourcedValue[];
  public: { production_by_fy: PublicProductionRow[]; financials: Record<string, unknown>[]; throughput?: Record<string, unknown>[] };
  model_complete: boolean; note?: string;
};
export type ProdUnit = {
  code: string; name: string; capacity: string | number | null; unit: string; capacity_kt_month: number | null; source_url: string | null;
  feed: string; yields: Record<string, number | null>; enabled: boolean;
};
export type ProdProduct = { name: string; price_usd_t: number | null; min_kt: number | null; max_kt: number | null };
export type ProductionModel = {
  units: ProdUnit[]; products: ProdProduct[]; crude_cost_usd_t: number | null; notes: string; complete: boolean; missing: string[];
};
export type ScenarioInput = {
  hcu_down_days: number; petchem_margin_delta: number; crude_cost_delta_usd_t: number;
  unit_down_days?: Record<string, number>; price_delta_usd_t?: Record<string, number>;
};
export type ScenarioResult = {
  baseline: Record<string, number>; scenario: Record<string, number>; delta_pct: Record<string, number>;
  units_baseline?: Record<string, number>; units_scenario?: Record<string, number>;
  margin_usd: { baseline: number; scenario: number }; binding: string[]; shadow_prices: { constraint: string; value: number }[];
  assumptions: string[]; explanation: string;
};

export type LayaStats = {
  total: number; llm_calls_saved: number; avg_latency_ms: number; by_intent: Record<string, number>; model_version: string;
  baseline_llm_router_ms?: number | null;
  benchmark?: (LayaBenchmark & { measured_at?: string; model?: string }) | null;
};
export type LayaBenchmark = { n: number; llm_router_avg_ms: number | null; laya_avg_ms: number | null; agreement_pct: number | null };
export type Report = { id: string; file_name: string; url: string; created_at?: string; tag?: string };

export type AuditRecord = { seq: number; at: string; actor: string; event: string; entity: string; detail: unknown; hash: string; prev_hash: string };
export type AuditVerify = { ok: boolean; count: number; broken_at?: number; head: string };

export type ServerStatus = { engine: string; status: string; port: number; openai_base_url: string; uptime_s: number; requests: number; model_name: string | null };

export type AdminUser = {
  id: string; username: string; display_name: string; post: string; department: string; clearance: number; clearance_label: string;
  roles: string[]; asset_scopes: string[]; status: 'active' | 'disabled' | string; mfa_enabled: boolean; must_change_password: boolean;
  locked_until: string | null; last_login_at: string | null; created_at: string;
};
export type Role = { role: string; description: string; permissions: string[] };
export type AiSettings = {
  prediction: Record<string, unknown>; system_prompt: string; default_model_id: string | null; default_engine: string;
  default_load_config: Record<string, unknown>; autoload: boolean;
};
export type DayCount = { date: string; count: number };
export type Usage = {
  users: { total: number | null; active_7d: number | null; disabled: number | null; locked: number | null };
  sessions_active: number | null;
  queries_per_day: DayCount[]; denials_per_day: DayCount[];
  by_intent: Record<string, number>; by_department: Record<string, number>;
  perf: { answers: number | null; avg_tok_per_s: number | null; avg_ttft_ms: number | null; p95_ttft_ms: number | null; avg_total_ms: number | null };
  errors_24h: number | null; feedback: { up: number | null; down: number | null };
  knowledge: { documents: number | null; pages: number | null; scanned_pages: number | null; chunks: number | null; examples: number | null };
  engine: { status: string | null; model_name: string | null; engine: string | null; uptime_s: number | null; requests: number | null } | null;
  gpu: { name?: string; vram_total_mb?: number; vram_used_mb?: number; util_pct?: number } | null;
  ram: { total_mb?: number; used_mb?: number } | null;
  disk: { free_gb: number | null; total_gb: number | null } | null;
  audit: { records: number | null; head: string | null } | null;
};
export type Backup = { name: string; size_bytes: number; sha256?: string | null; created_at: string };
export type FeedbackRow = { message_id: string; user: string; rating: number; comment: string | null; question: string | null; answer_excerpt: string | null; created_at: string };
export type ImportResult = { created: { username: string; temp_password: string }[]; errors: { row: number; error: string }[] };
export type PolicyDoc = { version: string; yaml: string };
