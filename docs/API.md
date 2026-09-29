# Yukti API contract (v0.1 — demo build)

Base: same origin, prefix `/api`. JSON everywhere. Cookie session `yukti_sid` (HttpOnly).
All unsafe methods (POST/PUT/PATCH/DELETE) must send header `X-CSRF-Token: <csrf_token from /api/auth/me or login response>`.
Errors: `{"detail": {"code": "...", "message": "..."}}` with HTTP 401 (`session_expired`/`not_authenticated`), 403 (`policy_denied` | `csrf_invalid`), 404, 422.
Times are ISO-8601 UTC strings.

## Auth
- `POST /api/auth/login` `{username, password}` → `Me` (sets cookie). 401 `{code:"bad_credentials"}` / 423 `{code:"locked", message}`.
- `POST /api/auth/logout` → `{ok:true}`
- `POST /api/auth/logout-all` → `{ok:true, revoked:n}`
- `GET /api/auth/me` → `Me`
- `GET /api/auth/sessions` → `[{id, created_at, last_seen_at, ip, user_agent, current:bool}]`
- `DELETE /api/auth/sessions/{id}` → `{ok:true}`
- `GET /api/auth/demo-users` (only when demo mode) → `[{username, display_name, post, department, password}]`

```ts
type Me = {
  user: {id:string; username:string; display_name:string; post:string; department:string;
         clearance:number; clearance_label:string; roles:string[]; asset_scopes:string[]};
  csrf_token: string;
  permissions: string[];   // e.g. "chat","documents.upload","models.manage","audit.view","production.view","access.approve","admin"
  grants: {id:string; scope:string; expires_at:string}[];
  session: {idle_expires_at:string; abs_expires_at:string; idle_timeout_s:number};
  demo_mode: boolean;
}
```

## System / hardware
- `GET /api/system` → `{gpu:{name, vram_total_mb, vram_used_mb, util_pct}|null, ram:{total_mb, used_mb}, cpu:{name, cores, threads, util_pct}, llama_build:string|null, offline_guard:boolean, version:string}`

## Engines & models (Bionic "My Models" / model loader)
- `GET /api/engines` → `[{id:"llamacpp"|"bionic"|"vllm"|"remote", name, description, base_url, available:boolean, version?:string}]`
  - `llamacpp` = Yukti-managed llama-server process; `bionic` = Bionic/LM Studio local server (OpenAI-compatible, default http://127.0.0.1:1234/v1); `vllm` = vLLM server (plant GPU); `remote` = any OpenAI-compatible URL.
- `PUT /api/engines/{id}` `{base_url, api_key?}` → engine
- `GET /api/models` → `[{id, name, file_name, path, size_bytes, family, params_b?:number, quant, arch?, source:"lmstudio"|"yukti"|"engine", vision:boolean}]` (local GGUF files + models reported by external engines)
- `GET /api/models/loaded` → `{status:"idle"|"loading"|"ready"|"error", engine, model_id, model_name, load_config, started_at, error?:string, port?:number, ctx_used_pct?:number}`
- `POST /api/models/load` `{engine, model_id, load_config}` → same as loaded (status "loading"); poll `/api/models/loaded` until ready.
- `POST /api/models/unload` → `{ok:true}`
- `GET /api/params/schema` → `ParamSchema` describing **every** tunable (render forms generically from this):

```ts
type ParamField = {key:string; label:string; group:string; type:"number"|"int"|"bool"|"select"|"text"|"textarea"|"tags"|"json";
  min?:number; max?:number; step?:number; default:any; options?:{value:any; label:string}[];
  description:string; engines:string[]; advanced?:boolean; unit?:string};
type ParamSchema = {load: ParamField[]; prediction: ParamField[]};
```
Groups (load): "Context", "GPU & Offload", "CPU", "Batching", "Attention & KV Cache", "RoPE", "Memory", "Speculative Decoding", "MoE", "Parallelism", "vLLM", "Advanced".
Groups (prediction): "Sampling", "Penalties", "Mirostat", "DRY", "XTC", "Output", "Reasoning", "Structured Output", "Advanced".

## Presets
- `GET /api/presets` → `[{id, name, description, system_prompt, prediction:{}, load:{}, builtin:boolean}]`
- `POST /api/presets` `{name, description, system_prompt, prediction, load}` → preset; `PUT /api/presets/{id}`; `DELETE /api/presets/{id}`

## Projects & chats
- `GET /api/projects` → `[{id, name, chat_count}]`; `POST /api/projects` `{name}`
- `GET /api/chats?project_id=` → `[{id, title, project_id, updated_at, message_count, model_name}]`
- `POST /api/chats` `{title?, project_id?}` → chat
- `GET /api/chats/{id}` → `{id, title, project_id, system_prompt, prediction, messages: Message[]}`
- `PATCH /api/chats/{id}` `{title?, system_prompt?, prediction?, project_id?}`; `DELETE /api/chats/{id}`
- `POST /api/chats/{id}/messages` `{content, system_prompt?, prediction?, use_knowledge:boolean}` → **SSE stream** (text/event-stream). Events:
  - `route` `{intent, department, urgency, needs_review, sensitivity, route, confidence, latency_ms, model_version}`
  - `guard` `{category, decision:"allow"|"deny"|"review", rule_ids:string[], reason}`
  - `retrieval` `{sources: Source[], denied:{count:number, departments:string[]}}`
  - `reasoning` `{t}` (thinking tokens, if model emits them)
  - `token` `{t}`
  - `facts` `{facts: Fact[]}`
  - `done` `{message_id, stats:{tokens_in, tokens_out, tok_per_s, ttft_ms, total_ms, stop_reason, model_name, engine}}`
  - `error` `{code, message}`
- `POST /api/chats/{id}/stop` → `{ok:true}`
- `POST /api/chats/{id}/regenerate` `{prediction?}` → SSE (same events, replaces last assistant message)

```ts
type Source = {id:string /* "S1" */; document_id:string; title:string; doc_number:string; revision:string; status:"CURRENT"|"SUPERSEDED";
  page:number; snippet:string; score:number; classification:string; department:string};
type Fact = {slot:string; attribute:string; value:string|null; status:"KNOWN"|"MISSING"|"CONFLICTING";
  candidates:{value:string; source_id:string; source_label:string; revision:string; effective:string; recommended:boolean}[]; note:string};
type Message = {id, role:"user"|"assistant"|"system", content, created_at, route?:any, guard?:any, sources?:Source[], denied?:any, facts?:Fact[], stats?:any, reasoning?:string};
```

## Knowledge (documents)
- `GET /api/documents?q=` → `[{id, title, doc_number, revision, status, doc_type, department, classification, pages, page_modes:{digital:number, scanned:number}, asset_tags:string[], created_at, size_bytes}]` (only those the user may read)
- `POST /api/documents` multipart: `file`, `title?`, `doc_type`, `department`, `classification` (PUBLIC|INTERNAL|RESTRICTED|CONFIDENTIAL), `doc_number?`, `revision?` → `{document_id, job_id}`
- `GET /api/jobs/{id}` → `{id, status:"queued"|"running"|"done"|"error", stages:[{name, status:"pending"|"running"|"done"|"skipped"|"error", detail}], document_id, error?}`
- `GET /api/documents/{id}` → document + `pages:[{page_no, mode:"digital"|"scanned"|"image", text, ocr_conf?:number}]`
- `GET /api/documents/{id}/file` → original file
- `DELETE /api/documents/{id}`

## Access requests & grants
- `GET /api/access-requests` → `{mine: AR[], to_approve: AR[]}`; `AR = {id, requester, requester_name, resource_label, department, justification, hours, state, created_at, decided_at?, approver_name?}`
- `POST /api/access-requests` `{department, doc_type?, document_id?, justification, hours}` → AR
- `POST /api/access-requests/{id}/approve` `{hours}` → AR ; `POST /api/access-requests/{id}/reject` `{note}` → AR
- `GET /api/grants` → `[{id, scope, expires_at, approved_by}]`

## Assets, alerts, notifications
- `GET /api/assets?q=` → `[{tag, name, unit, class, vendor, serial, location, owner_department, criticality, items:[{type, ref_no, expires_on, days_left, status}]}]`
- `GET /api/assets/{tag}` → asset + work_orders + items + documents
- `GET /api/alerts` → `[{id, severity:"red"|"amber"|"info", title, detail, tag, due, created_at}]`
- `GET /api/notifications` → `[{id, kind, title, body, created_at, read:boolean, link?}]`; `POST /api/notifications/{id}/read`

## Findings & approvals
- `GET /api/findings` → `[{id, title, tag, discipline, severity, state, due_date, evidence, source_document_id, page, approver_name, created_at}]`
- `POST /api/findings/{id}/action` `{action:"acknowledge"|"approve"|"reject"|"escalate", note?}` → finding

## Production intelligence
- `GET /api/production/overview` → `{capacity_mmtpa, nci, products:[{name, share_pct, margin_usd_bbl}], history:[{month, product, demand_kt, forecast_kt?, lo?, hi?}]}`
- `POST /api/production/scenario` `{hcu_down_days:number, diesel_crack_delta:number, petchem_margin_delta:number, crude_price_delta:number}` → `{baseline:{product:kt}, scenario:{product:kt}, delta_pct:{product:number}, margin_cr:{baseline, scenario}, binding:string[], shadow_prices:[{constraint, value}], assumptions:string[], explanation:string}`

## Laya
- `POST /api/laya/classify` `{text}` → route decision (same as SSE `route`)
- `GET /api/laya/stats` → `{total, llm_calls_saved, avg_latency_ms, by_intent:{[k]:number}, model_version}`

## Reports
- `POST /api/reports/dossier` `{tag}` → `{id, file_name, url}`; `GET /api/reports` → list; `GET /api/reports/{id}/file`

## Audit
- `GET /api/audit?limit=200&event=` → `[{seq, at, actor, event, entity, detail, hash, prev_hash}]`
- `GET /api/audit/verify` → `{ok:boolean, count:number, broken_at?:number, head:string}`

## Server / developer
- `GET /api/server/logs?tail=300` → `{lines:string[]}` (llama-server + app logs)
- `GET /api/server/status` → `{engine, status, port, openai_base_url, uptime_s, requests, model_name}`

## Admin
- `GET /api/admin/users` → users with attributes; `GET /api/admin/policies` → `{version, yaml}`
