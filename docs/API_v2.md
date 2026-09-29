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
