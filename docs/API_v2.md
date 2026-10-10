> **Legacy design document** (v0.1/v0.2 contract). The live, authoritative API is served by the running server at `/api/docs` (OpenAPI).

# Yukti API v0.2 additions / changes (on top of docs/API.md)

## Roles & gating (IMPORTANT)
- LLM configuration is ADMIN ONLY. Non-admin employees: no Sampling/Model tabs, no model loader, no Developer/My Models/Model import pages, no params schema.
  Backend ignores `prediction` / `system_prompt` sent by non-admins (organisation AI settings are used instead).
- `Me.permissions` now includes: "models.manage", "admin", "users.manage", "ai.settings", "usage.view", "backup.manage", "developer" (admins only),
  "production.view", "production.edit" (planner/admin), "audit.view", "access.approve", "findings.view", "findings.approve", "documents.upload", "chat", ...
- `Me.user` gains: `must_change_password: boolean`, `mfa_enabled: boolean`, `status`.
- Me gains `org: {name, deployment, languages:["en","hi","kn"]}`.

## Auth
- `POST /api/auth/login` body may include `totp` (6 digits). If MFA enabled and missing/invalid → 401 `{code:"mfa_required"}` or `{code:"mfa_invalid"}`.
- `POST /api/auth/password` `{current_password, new_password}` → `{ok}` (min 12 chars, must differ; clears must_change_password; revokes other sessions).
- If `must_change_password` is true, all APIs except auth/* return 403 `{code:"password_change_required"}` → UI must force the Change-password screen.
- `POST /api/auth/mfa/enroll` → `{secret, otpauth_uri, qr_svg}` (qr_svg is an inline SVG string)
- `POST /api/auth/mfa/verify` `{code}` → `{ok, recovery_codes:string[]}`
- `POST /api/auth/mfa/disable` `{password}` → `{ok}`

## Admin — users
- `GET /api/admin/users` → `[{id, username, display_name, post, department, clearance, clearance_label, roles[], asset_scopes[], status:"active"|"disabled", mfa_enabled, must_change_password, locked_until, last_login_at, created_at}]`
- `GET /api/admin/roles` → `[{role, description, permissions[]}]`
- `POST /api/admin/users` `{username, display_name, post, department, clearance(0-4), roles[], asset_scopes[]}` → `{user, temp_password}`
- `PATCH /api/admin/users/{id}` any of `{display_name, post, department, clearance, roles, asset_scopes, status}` → user
- `POST /api/admin/users/{id}/reset-password` → `{temp_password}` (user must change at next login)
- `POST /api/admin/users/{id}/unlock` → `{ok}` ; `POST /api/admin/users/{id}/revoke-sessions` → `{revoked}`
- `POST /api/admin/users/import` multipart `file` (CSV header: username,display_name,post,department,clearance,roles,asset_scopes; roles/scopes separated by `;`) → `{created:[{username,temp_password}], errors:[{row, error}]}`
- `GET /api/admin/users/template.csv` → CSV template

## Admin — AI settings (organisation-wide; replaces per-chat settings for employees)
- `GET /api/admin/ai-settings` → `{prediction:{...all prediction keys}, system_prompt:string, default_model_id:string|null, default_engine:string, default_load_config:{}, autoload:boolean}`
- `PUT /api/admin/ai-settings` same shape → saved; used for every employee chat; default model auto-loads at server start.
- `GET /api/params/schema` (admin only).

## Admin — usage & health (only measured values; nulls when nothing measured)
- `GET /api/admin/usage?days=14` → `{users:{total, active_7d, disabled, locked}, sessions_active, queries_per_day:[{date, count}], denials_per_day:[{date, count}],
  by_intent:{[k]:n}, by_department:{[k]:n}, perf:{answers, avg_tok_per_s, avg_ttft_ms, p95_ttft_ms, avg_total_ms}, errors_24h, feedback:{up, down},
  knowledge:{documents, pages, scanned_pages, chunks, examples}, engine:{status, model_name, engine, uptime_s, requests}, gpu:{...}|null, ram:{...}, disk:{free_gb,total_gb}, audit:{records, head}}`

## Admin — backup / restore / export
- `POST /api/admin/backups` → `{name, size_bytes, sha256, created_at}` (zip of database + document store)
- `GET /api/admin/backups` → list ; `GET /api/admin/backups/{name}/file` → download
- `POST /api/admin/backups/{name}/restore` → `{ok, restart_required:true}`
- `GET /api/audit/export?format=csv|jsonl` → file download (audit.view)

## Admin — models
- `GET /api/admin/models/import-dirs` → `{dirs:string[]}`; `POST /api/admin/models/import` `{path}` (absolute path of a .gguf on the server, e.g. USB drive) → model (copied into models folder, sha256 recorded)
- `DELETE /api/admin/models/{id}` → remove imported model file (only from Yukti models folder)
- Discover page is replaced by "Model import" (no hard-coded catalog).

## Feedback & help
- `POST /api/messages/{id}/feedback` `{rating: 1|-1, comment?}` → `{ok}` ; `GET /api/admin/feedback` → `[{message_id, user, rating, comment, question, answer_excerpt, created_at}]`

## Findings (fixed workflow)
- Every finding in `GET /api/findings` has `allowed_actions: string[]` computed for the current user and state
  (e.g. PENDING → ["acknowledge","approve","reject","escalate"] for the discipline approver; others may only "acknowledge"/"escalate" or nothing).
  UI must render ONLY allowed actions. Also `discipline_approver: boolean`, `is_example: boolean`.
- `POST /api/findings/{id}/action` `{action, note}`; action "note" adds a note without state change.

## Examples & data provenance
- Documents gain `is_example: boolean` (EXAMPLE badge — "Example document prepared by Team UniMinds; not MRPL data") and `is_public: boolean` (public MRPL source).
- Assets gain `is_example`.

## Production intelligence (no invented numbers)
- `GET /api/production/overview` → `{capacity_mmtpa, nci, public:{production_by_fy:[{fy, product, production_kt, sales_kt, export_kt, source_url}], financials:[...]}, model_complete:boolean}`
- `GET /api/production/model` → `{units:[{code, name, capacity, unit, source_url|null, feeds:{}, yields:{[product]:fraction}}], products:[{name, price_usd_t|null, min_kt|null, max_kt|null}], complete:boolean, missing:string[]}`
- `PUT /api/production/model` (production.edit) same shape → saved
- `POST /api/production/scenario` → 422 `{code:"model_incomplete", message, missing[]}` until the planner has entered yields/prices; otherwise result as before.

## Laya
- `GET /api/laya/stats` → no hard-coded baseline; `baseline_llm_router_ms` is null until `POST /api/admin/laya/benchmark` measures it (runs the loaded LLM as router on N logged queries) → `{n, llm_router_avg_ms, laya_avg_ms, agreement_pct}`.

---

# v3 additions — workbench, work queue, scans, ledger, research layer (Yukti 0.5.1)

On top of docs/API.md and the v0.2 additions above. Same conventions: cookie session, `X-CSRF-Token` on every unsafe method, errors as
`{"detail": {"code", "message"}}`. The running server's `/api/docs` remains authoritative. Backend modules: `workqueue.py`, `kvcache.py`,
`perf_profiles.py`, `rag.py`, `graph.py`, `vectors.py`, `ledger.py`, `lanes.py`, `scan_findings.py`, `workbench.py`, `sandbox.py`,
`deliverables.py`, `research.py`, `forecast.py`, `production.py`, `routes_work.py`.

## New permissions
`work.create` (everyone), `scan.review` (engineer, hse, dept_manager, plant_manager), `assets.edit` (hse, dept_manager, plant_manager, stores),
`queue.view` (admin, plant_manager, auditor), `research.use` (researcher), `research.manage` (admin).
New roles: `stores`, `researcher`, `approver:hse`, `approver:procurement`, `approver:management` (with the existing `approver:electrical`,
`approver:mechanical`, `approver:finance`).

## 1. Durable work queue and workers
Laya's route decision (SSE `route`, `POST /api/laya/classify`) gains `worker`: one of `policy` (no model), `small_llm`, `ocr_vlm`, `analytics`,
`reasoning` (27B class when assigned), `coder` (sandbox), `workflow`. Every chat turn is a task row; background work (workbench deliverables,
scan-to-finding) is queued and survives restarts.

- Chat SSE stream: NEW event `task` `{id, worker, label, served_by: {model, assigned, fallback}}`, sent right after `route`.
  Messages in `GET /api/chats/{id}` gain `task: {id, worker}`.
- `GET /api/tasks?kind=workbench|scan_to_finding|chat` → my tasks, `TaskOut[]` (newest first, at most 100)
- `GET /api/tasks/{id}` → `TaskOut` + `files: [{id, kind, file_name, sha256, title, created_at, url}]` (owner, or `queue.view`)
- `GET /api/admin/queue` (`queue.view`) → `{workers: [{id, label, purpose, concurrency, counts: {status: n}, served_by, running}],
  recent: TaskOut[] (title = kind, no result), kv: KVStats}`

```ts
type TaskOut = {id: string; kind: "chat"|"workbench"|"scan_to_finding"; worker: string; worker_label: string;
  status: "queued"|"running"|"done"|"error"|"interrupted"|"waiting_review"; title: string; chat_id: string|null;
  steps: {name: string; status: "pending"|"running"|"done"|"error"|"skipped"; detail: string; ms?: number}[];
  result: object; error: string|null; attempts: number; served_by: string|null;
  created_at: string; started_at: string|null; finished_at: string|null; route: object};
```

## 2. Per-chat checkpoints and hot KV cache
- `GET /api/chats/{cid}/checkpoints` (chat owner) → `[{message_id, task_id, worker, model, kv: {slot, state: "hot"|"cold"|"restored"|"n/a",
  cached_tokens, prompt_tokens, kv_type, ctx}, tools: [{tool, result}], approvals: [{rule, decision}], citations: string[], created_at}]`
- `GET /api/admin/kv` (`models.manage`) → `{slots, hot_chats, busy, hits, misses, evictions, restores, spilled_files, spilled_mb,
  settings: {kv_ttl_s, kv_spill, kv_spill_max_mb}, kv_type, ctx_per_slot}`
- `GET/PUT /api/admin/ai-settings` gain: `worker_models: {[worker]: {model_id, prediction}}`, `kv_ttl_s` (60..86400, default 1800),
  `kv_spill` (bool, default false), `kv_spill_max_mb` (256..262144, default 4096), `performance_profile` (`"auto"` | `"off"` | profile id).

## 3. Performance Engine profiles
- `GET /api/admin/profiles?model_id=` (`models.manage`) → `{free_vram_mb, recommended, active, profiles: [{id, label,
  status: "measured"|"reference"|"validated", measured, note, min_vram_mb, params_b, load: {...}, validation}]}`
- `POST /api/admin/profiles/{id}/validate` (`models.manage`) → measures the loaded model (three runs) → `{at, by, model, engine,
  tok_per_s_median, tok_per_s_range, ttft_ms_median, vram, load_config, runs, measured_at_unix}`. 404 unknown profile, 409 when no model is loaded.
- `POST /api/models/load` accepts optional `profile: "auto" | <id>` (llamacpp only); keys given explicitly in `load_config` win.

## 4. Hybrid retrieval with full citations
Each source (SSE `retrieval.sources[]`, message `sources`) gains:
`record_id` (spreadsheet row, e.g. `A2_WorkOrders!34`, or null), `locator` (`"p.3"` or `"record A2_WorkOrders!34"`), `confidence` (0..1),
`ocr_confidence` (or null), `channels` (subset of `bm25`, `tags`, `metadata`, `graph`, `vector`), `graph_reason` (e.g. `"documented in A2"`),
`timestamp` (effective date, else ingest date), `ingested_at`.
The `retrieval` event gains `related_tags: string[]` and `channels: {bm25, tags, graph, vector, metadata}` (booleans).
- `GET /api/admin/retrieval` (`admin`) → `{graph: {edges, by_relation}, vectors: {status, model, vectors, chunks, error, url}, channels: string[]}`
- `POST /api/admin/graph/rebuild` (`admin`) → `{edges, by_relation}`
- `GET /api/assets/{tag}/graph` → `{tag, links: [{rel, kind: "document"|"asset"|"wo"|"finding"|"ledger", ...}]}` (documents and assets
  filtered by policy and scope for the caller)

## 5. Asset ledger
`GET /api/assets` `items[]` are now `{id, type, category, category_label, ref_no, issued_on, expires_on, days_left, status: "green"|"amber"|"expired",
alert_days, vendor, serial, location, owner, certificate, interval_months, warranty_until, warranty_days_left}`.
- `GET /api/ledger/categories` → `[{id, label, alert_days, interval_months}]`; ids: `fire_extinguisher`, `calibration`,
  `pressure_vessel_inspection`, `safety_device`, `spare`, `licence`, `certificate`, `warranty`
- `POST /api/assets` (`assets.edit`) `{tag, name, unit, class, vendor, model, serial, location, owner_department?, criticality}` → asset.
  Own department unless plant-wide; 409 if the tag exists.
- `POST /api/assets/{tag}/ledger` (`assets.edit`) `{category, type?, ref_no, vendor, serial, location, owner, certificate, issued_on, expires_on,
  interval_months, warranty_until, alert_days}` → item. `expires_on` is computed from `issued_on` + `interval_months` when not given; one of
  expiry, issue date + interval, or warranty end is required.
- `POST /api/ledger/{id}/renew` (`assets.edit`) `{issued_on?, expires_on?, ref_no?, certificate?}` → item
- `GET /api/alerts` items gain `category`; warranty endings are alerted too.

## 6. Approver lanes, escalation, follow-up
Lanes: `electrical`, `mechanical`, `hse`, `procurement`, `finance`, `management`. `GET /api/findings` items gain:
`lane, lane_label, owner_department, procedure: {id, doc_number, revision, title} | null, evidence_region: {x, y, w, h, page} | null` (fractions of
the page), `verification: [{check, result: "match"|"MISMATCH"|"not checked", detail}], note_url` (approval note .docx) `| null, acknowledged_at,
open_review_items`. New state `DRAFT` (waiting for scan review; returned only to holders of `scan.review`).
- `escalate` climbs lane approver → department HOD → refinery management → top management.
- Automatic follow-up (hourly): a `PENDING` finding not acknowledged within 24 h (high), 72 h (medium) or 168 h (low) → `ESCALATED` with history
  event `AUTO-ESCALATED`; overdue findings → reminder to the approver and HOD at most once a day.

## 7. Scan to finding with human review
- `POST /api/documents/{id}/scan-findings` (`scan.review` or `documents.upload`; the document must be readable) → `TaskOut` on the `ocr_vlm` worker.
  Steps: OCR → Vision model (skipped without one) → Extract fields → Verify against the asset master → Human review of uncertain fields →
  Raise finding with evidence region → Draft approval note → Route to approver lane.
  `result`: `{document_id, tag, fields: {name: value}, field_confidence, thickness: [{point, location, previous_mm, current_mm, remark, confidence,
  region}], checks: [...], vision: {used, note | stamps, signature_present, ...}, finding: {id, title, severity, lane, review_items} |
  {id, state, duplicate: true} | null, waiting_review?: true}`
- `GET /api/review-items` (`scan.review`) → `[{id, document_id, finding_id, finding_title, tag, field, value, expected, reason, confidence,
  region: {x, y, w, h}, created_at}]`
- `POST /api/review-items/{id}` `{resolution: "confirm"|"correct"|"dismiss", value?}` → `{finding_id, state, approver?, note?}`.
  When the last open item is resolved the finding is routed (`PENDING`) with an approval note. Dismissing the value a finding rests on
  withdraws the finding (`DISMISSED`).

## 8. Agentic workbench and sandbox
- `GET /api/work/options` → `{deliverables: [{id, label}], sandbox: {imports: string[], timeout_s}}`;
  deliverables: `docx`, `pptx`, `xlsx`, `approval_note`, `calc`, `code`, `answer`
- `POST /api/work` (`work.create`) `{deliverable, goal, tag?, calculation? ("name = expr [unit]" per line), variables? {name: number}, code?,
  run?: boolean, document_id?}` → `TaskOut` + `files`. Poll `GET /api/tasks/{id}` until `done` or `error` (tests run it synchronously).
  `result`: `{deliverable, files: [...], tools: [{tool, status, detail}], sources?, denied?, facts?, draft? (markdown), model?,
  citations?: {cited, unknown}, calculation?: {steps: [{n, name, expression, substituted, value, unit}], result, inputs}, code?,
  run?: {exit_code, timed_out, ms, stdout, stderr}, explanation?}`
  For `code` without `run`, the coder model writes code (a model must be loaded) and returns it; it runs only when re-posted with
  `{deliverable: "code", code, run: true}`.
- Every tool call is authorised by the policy engine (resource type `tool`, see SECURITY_MODEL.md §11) and audited (`tool.call`, `sandbox.run`).
- `GET /api/reports` → my files `[{id, kind, file_name, sha256, created_at, title, task_id, url}]`
- `GET /api/reports/{id}/file` → the file with its proper media type: the owner, the task's owner, or (for an approval note) anyone who may see
  its finding.

## 9. Isolated research layer
- `GET /api/admin/research` / `PUT /api/admin/research` (`research.manage`) `{model_id, url (127.0.0.1 / localhost only), guardrails, enabled}`
  → config + `{status: "off"|"loading"|"ready"|"error", model, error, label, enabled}`
- `POST /api/admin/research/start` | `POST /api/admin/research/stop` (`research.manage`) → status
- `GET /api/research/status` (`research.use`) → status
- `POST /api/research/ask` (`research.use`) `{question}` → `{answer, label: "EXPERIMENTAL — research layer, isolated ...", model, ms,
  isolation: {documents: "denied", rule: string[]}}`. 403 when switched off, 409 when the model is not running.

## 10. Production intelligence: forecast, optimizer, scenario card
`PUT /api/production/model` products gain optional `demand_history: [{month: "YYYY-MM", kt}]`, `inventory_kt`, `storage_max_kt`,
`dispatch_max_kt`, `contract_min_kt`, `crack_usd_t` (instead of a price), `spec_note`; the model gains `crude_max_kt`; units gain
`planned_down_days` (maintenance schedule).
- `GET /api/production/forecast` (`production.view`) → `{forecast: {[product]: {expected, low, high, method, n, last_month, unit, params}}}`
  (Holt linear smoothing; mean for 3–5 months of history; 80 % interval; no forecast under 3 months)
- `POST /api/production/plan` (`production.view`), body as for scenario (`unit_down_days`, `hcu_down_days`, `price_delta_usd_t`,
  `petchem_margin_delta`, `crude_cost_delta_usd_t`) → `{forecast, proposal: [{product, baseline_kt, proposed_kt, change_pct}],
  expected_value: {margin_usd, baseline_margin_usd, delta_usd}, alternatives: [{case: "low"|"high", label, margin_usd, mix_kt, binding}],
  binding, shadow_prices, assumptions: string[], scenario: {...}, explanation: string, decision: string}`;
  422 `model_incomplete` or `infeasible` with `missing`. The LLM explanation is withheld if it contains a number not in the optimizer output.

## 11. Speech
`GET /api/speech/status` may include `indic_models: {hi?: "AI4Bharat IndicWhisper (Hindi)", kn?: "AI4Bharat IndicWhisper (Kannada)"}`;
a transcription's `device` names the AI4Bharat model when it was used.
