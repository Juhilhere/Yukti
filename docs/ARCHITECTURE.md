# Yukti architecture

This document describes how Yukti 0.5.1 is built and how a request moves through it. For the security view, see
[SECURITY_MODEL.md](SECURITY_MODEL.md). For the HTTP contract, see [API.md](API.md) and [API_v2.md](API_v2.md). The research behind the design is in [REFERENCES.md](REFERENCES.md).

## 1. Components

| Component | Where | Responsibility |
|---|---|---|
| **Yukti Server** | `backend/app/main.py`, `server_main.py` | FastAPI application on `:8000`. Serves the REST/SSE API under `/api` and the SPA from `web/dist`. Frozen into `yukti-server.exe` with PyInstaller. |
| Identity | `auth.py` | argon2id passwords, opaque server-side sessions (cookie `yukti_sid`), CSRF, lockout, forced password change, TOTP MFA and recovery codes. Also role-to-permission mapping and the subject snapshot. |
| Policy decision point | `policy.py`, `policies/core.yaml` | Deterministic ABAC evaluation of YAML rules (simpleeval). Deny-overrides, default deny, fail closed. |
| Laya | `laya.py` | System-One decision model: intent/department/urgency/sensitivity/worker (TF-IDF + logistic regression exported to ONNX). Also hosts the company-guardrail input classifier. |
| Work queue | `workqueue.py` | Durable task queue (`tasks` table) and the specialist workers: policy, small LLM, OCR + VLM, analytics, reasoning, coder, workflow. Background tasks are re-queued after a restart. |
| Chat orchestrator | `chat.py` | Laya, then a task for the chosen worker, then guardrails, then retrieval, then facts, then LLM stream, then citation check, then checkpoint, then audit. |
| Knowledge / RAG | `rag.py`, `graph.py`, `vectors.py` | Ingestion (type sniffing, digital/scanned page detection, RapidOCR, tagging, chunking, FTS5, graph edges) and hybrid policy-filtered retrieval (BM25, tags, metadata, knowledge graph, optional BGE-M3 vectors). Also dossier facts. |
| Engine manager | `engine.py`, `llm_params.py`, `perf_profiles.py`, `kvcache.py` | Starts and monitors `llama-server`, maps 67 load + 35 sampling parameters to llama.cpp flags and request fields (chosen from validated Performance Engine profiles), keeps hot KV slots per chat (TTL + LRU), streams tokens and runs the watchdog. Also talks to external OpenAI-compatible engines (Bionic/LM Studio, vLLM, remote). |
| Workbench | `workbench.py`, `deliverables.py`, `sandbox.py` | Plans multi-step work with policy-checked tools and writes Word, Excel, PowerPoint and approval-note files; runs code only in the sandbox. |
| Scan to finding | `scan_findings.py`, `lanes.py` | OCR with positions + VLM → field extraction → verification against the asset master → human review → finding → approval note → approver lane, with escalation and follow-up. |
| Asset ledger | `ledger.py` | Everything purchased or installed: vendor, serial, location, owner, certificate, interval, warranty, expiry; category-specific alert lead times. |
| Research layer | `research.py` | Experimental model in its own process, its own guardrails, no documents or tools (`T-RESEARCH-ISOLATED`). |
| Administration | `admin.py` | Users and CSV import, organisation AI settings, usage and health, feedback, backups and restore, model import, Laya benchmark. |
| Production | `production.py`, `forecast.py` | Public production/financial overview, planner-entered plant model, demand forecast with uncertainty, HiGHS LP scenario solver and the plan scenario card. |
| MRPL intelligence | `mrpl.py`, `mrpl_facts.py`, `data/mrpl/` | Public research (JSON + Markdown with source URLs). Seeds departments, is ingested as PUBLIC citable documents and backs structured fact search. |
| Reports | `reports.py` | Asset dossier PDF (reportlab) built from the same fact records as chat. |
| Audit | `audit.py` | Append-only, SHA-256 hash-chained log with verification. |
| Seed | `seed.py` | Demo personas, example documents (watermarked, `is_example`), example assets, work orders and findings. |
| Web UI | `web/` | React 18 + Vite + Tailwind SPA. Routes: chat, company, knowledge, inbox, assets, production, audit, admin/*, account, settings, help. UI in English, Hindi and Kannada. |
| Desktop app | `desktop/` | Electron client with three modes (plant server, install on this PC, existing server folder) and an in-app component installer. |
| Release tooling | `ops/` | `build-release.ps1`, `release-site.ps1`, `publish.py`, `serve_site.py`, start/stop scripts, package templates. |

```mermaid
flowchart TB
  subgraph Client
    UI["React SPA<br/>(browser or Electron window)"]
  end
  subgraph Server["yukti-server.exe"]
    API["FastAPI /api"]
    AUTH["auth.py"]
    PDP["policy.py + core.yaml"]
    CHAT["chat.py"]
    LAYA["laya.py (ONNX Runtime)"]
    WQ["workqueue.py (tasks)"]
    WB["workbench.py + sandbox.py"]
    SCAN["scan_findings.py + lanes.py"]
    RAG["rag.py + graph.py + vectors.py"]
    ENG["engine.py"]
    ADM["admin.py"]
    PROD["production.py (HiGHS)"]
    AUD["audit.py"]
    DB[("SQLite WAL<br/>data/store/yukti.db")]
    BLOB[("data/store/blobs")]
  end
  LS["llama-server :8080<br/>(127.0.0.1 only)"]
  UI --> API --> AUTH --> PDP
  API --> CHAT --> LAYA
  CHAT --> WQ
  API --> WB --> WQ
  API --> SCAN --> WQ
  WB --> RAG
  CHAT --> RAG --> DB
  RAG --> BLOB
  CHAT --> ENG --> LS
  API --> ADM
  API --> PROD
  AUTH & CHAT & RAG & ADM & PROD --> AUD --> DB
```

## 2. Request lifecycle: a chat question

```mermaid
sequenceDiagram
  autonumber
  participant U as Employee (UI)
  participant A as FastAPI + auth
  participant L as Laya
  participant P as Policy (PDP)
  participant R as Retrieval (FTS5)
  participant F as Facts
  participant E as llama-server
  participant Au as Audit chain

  U->>A: POST /api/chats/{id}/messages (cookie + X-CSRF-Token)
  A->>A: resolve session, check CSRF, forced password change, build Subject
  A->>L: classify(text)
  L-->>U: SSE route {intent, department, urgency, sensitivity, worker, confidence, latency_ms}
  A->>A: task row on the durable queue (worker = Laya's choice)
  A-->>U: SSE task {id, worker, label, served_by}
  A->>P: decide(subject, "ask", {type: guard, category})
  P-->>U: SSE guard {decision, rule_ids, reason}
  P->>Au: chat.guard
  alt denied by guardrail
    A-->>U: fixed refusal text + done (engine "policy")
  else allowed
    A->>R: hybrid search: BM25 (top 80 chunks) + tags + graph links + metadata (+ vectors)
    R->>P: decide(subject, "cite", document) per document
    R-->>U: SSE retrieval {sources, denied: {count, departments}}
    R->>Au: retrieval (allowed_n, denied_n, cited refs)
    A->>F: dossier facts for asset tag / MRPL public facts
    F-->>U: SSE facts [KNOWN | MISSING | CONFLICTING]
    A->>E: system rules + CONTEXT + FACTS + question (org AI settings + worker settings, the chat's hot KV slot)
    E-->>U: SSE token ... token
    A->>A: citation check ([S#]/[F#] must exist)
    A->>A: checkpoint (task, worker, KV slot/state/cached tokens, tool calls, approvals, citations)
    A->>Au: chat.answer (model, engine, intent, tokens, citations, task, worker)
    A-->>U: SSE done {message_id, stats}
  end
```

Notes:

- Employees cannot supply `prediction` or `system_prompt`. The backend applies the organisation AI settings chosen by an administrator.
- Retrieved text is wrapped in `<doc id=… ref=…>` blocks. The system prompt states that CONTEXT is data and not instructions.
- When relevant documents are withheld, the model is told how many there are and which departments hold them, and to suggest an access request rather than guess.
- Answer statistics (tokens, tok/s, TTFT, total time, denials) go to `answer_stats` and feed the usage dashboard.

## 3. Data model

SQLite in WAL mode (`busy_timeout=5000`, foreign keys on), at `data/store/yukti.db`. Tables:

| Area | Tables |
|---|---|
| Identity | `users`, `sessions`, `login_attempts`, `departments` |
| Knowledge | `documents`, `pages`, `chunks`, `chunks_fts` (FTS5, porter + unicode61), `jobs` |
| Plant (example) | `assets`, `tag_alias`, `ledger_items`, `work_orders`, `contacts`, `facts` |
| Conversations | `projects`, `chats`, `messages`, `chat_checkpoints`, `presets`, `feedback` |
| Work | `tasks` (durable queue), `reports` (also workbench deliverables and approval notes) |
| Knowledge graph & vectors | `kg_edges`, `chunk_vectors` |
| Workflows | `access_requests`, `grants`, `findings` (lane, owner, procedure, evidence region, verification, approval note), `review_items`, `notifications` |
| Configuration | `settings` (org AI settings, production model, …), `engines` |
| Telemetry (local) | `answer_stats`, `laya_log` |
| Audit | `audit_log`. Triggers block `UPDATE` and `DELETE`. |

Original files are stored in `data/store/blobs/` and are fingerprinted with SHA-256.

## 4. Engine management and watchdog

- **Binaries.** The package bundles llama.cpp b11255 builds in `llama\cuda\` (CUDA 12.4) and `llama\vulkan\`. `config.pick_backend("auto")`
  picks CUDA when an NVIDIA GPU is detected (NVML) and the CUDA build exists. Otherwise it picks Vulkan, which also runs on CPU with 0 GPU layers.
  `YUKTI_LLAMA_CUDA` / `YUKTI_LLAMA_VULKAN` override the paths.
- **Launch.** `llama-server` listens on `127.0.0.1:8080` with `--offline`, `--no-webui` and `--metrics`. The load configuration (context, GPU layers, KV
  cache types, flash attention, batching, RoPE, speculative decoding, …) is translated from the 67 load parameters in `llm_params.py`.
  `filter_args` runs `llama-server --help` once and drops any flag the build does not support, so newer or older builds do not fail on renamed flags.
- **Default model.** At startup the server loads the organisation default model. If none is set, it loads the first Gemma GGUF it finds
  (context 16384, all layers on GPU, flash attention, q8_0 KV cache, 2 parallel slots). Set `YUKTI_AUTOLOAD=0` to skip.
- **Watchdog.**
  - If a `llama-server` that had reached *ready* exits unexpectedly, it is restarted with the same settings, at most **3 times per 10 minutes**.
    After that the engine goes to `error` and asks the admin to reduce context or GPU layers.
  - A health monitor polls `/health` every 15 s. If there is no response for about 60 s, it kills the hung process so the watchdog restarts it.
  - Failures during load (usually out of memory) are reported and never retried in a loop.
- **Chats during load or restart.** A request waits up to 120 s while the engine is `loading` or `restarting`. If the engine is switched or restarted
  before any token was produced, the request is retried once on the new engine. If output had already started, the user is asked to press Regenerate.
- **Other engines.** `bionic` (LM Studio-compatible, default `http://127.0.0.1:1234/v1`), `vllm` (`YUKTI_VLLM_URL`) and `remote` (any
  OpenAI-compatible URL) are probed and used through the same streaming path. Only administrators can configure them.

## 5. Ingestion pipeline

Only users with `documents.upload` (Heads of Department) can upload, only into their own department, and never above their own clearance.
The upload limit is 50 MB. Each upload creates a job whose stages are visible in the UI:

| # | Stage | What happens |
|---|---|---|
| 1 | Store & fingerprint | Save to blob store, compute SHA-256. If the new document has the same document number as an earlier one, the older revision is marked `SUPERSEDED`. |
| 2 | Detect type & page modes | PDF pages classified as digital or scanned (pypdfium2). Images are treated as scanned pages. DOCX and XLSX are read structurally. |
| 3 | Extract text / OCR | Text layer, or RapidOCR (PP-OCR on ONNX Runtime) for scanned pages, with a confidence value. XLSX rows become citable records. |
| 4 | Tag assets | Asset tags and aliases (e.g. `A2`, `E-310`, `PSV-118`) are detected and mapped to plant units. |
| 5 | Chunk | About 900 characters with 150 overlap, per page. |
| 6 | Index | Written to `chunks_fts` (FTS5 BM25). |

PDF parsing and OCR are serialised with a lock because pdfium is not thread-safe.

## 6. Retrieval and evidence

1. Asset tags are detected in the question and added to the FTS5 query.
2. The top 80 chunks by BM25 are fetched.
3. **Each document is checked with the policy engine** (`cite` action). Documents the user may not cite are dropped and counted as `denied`
   by department. Their text never reaches the model or the UI.
4. Scoring: tag matches × 1.5, superseded revisions × 0.8. At most 2 chunks per document.
5. **Facts.** When the question concerns an asset (dossier, trip, rating, wiring, isolation, history), structured `facts` rows are evaluated for
   that tag. Each attribute is **KNOWN** (one value), **MISSING** (no authorised source), or **CONFLICTING** (several candidates with source,
   revision and effective date; the current revision is marked *recommended*).
   Company questions are matched against MRPL public facts. When public sources report different numbers, the fact is marked CONFLICTING
   (for example the Nelson Complexity Index, 9.46 vs 11.67).
6. After generation, every `[S#]` / `[F#]` citation is checked against what was actually supplied. Unknown citations are recorded in the message stats.

## 7. Laya

- **Model:** character + word TF-IDF with logistic-regression heads, trained at first start from seeded templates and exported to ONNX
  (`data/store/laya/laya-0.4.0.onnx`). The server package ships a pre-trained copy. Inference runs on ONNX Runtime (CPU) in about 1 ms.
- **Pattern:** a small System-One decision model (Kahneman's fast, typed judgements first). Jev is the closed-source reference
  pattern for this category; Laya is the open-weight implementation with a compatible typed interface, running locally on ONNX Runtime.
- **Output:** intent, department, urgency (raised for trip, fire, leak, H2S, emergency), sensitivity, route, **worker** (queue selection), a review signal, confidence and an **abstain** flag
  (confidence < 0.40 or margin < 0.10). When Laya abstains, the request falls back to the LLM + RAG route and is marked for review.
- **Logging:** every decision goes to `laya_log`. `POST /api/admin/laya/benchmark` measures the loaded LLM as a router on logged queries,
  so the comparison is always measured on your own server and never hard-coded.

## 8. Company guardrails

`laya.guard_category()` maps the question to a category using regular expressions:
`off_domain_harm`, `control_system_change`, `formulation_confidential`, `hazmat_handling`, `process_chemistry`,
`commercial_confidential`, `personal_data`, `safety_procedure`, `asset_info` or `general`.
The **policy engine** then decides using the `guard` rules in `core.yaml` (see [SECURITY_MODEL.md](SECURITY_MODEL.md)). A denial returns a
fixed refusal without calling the LLM. Allowed process-chemistry questions with high urgency are marked `review`.

## 9. Production optimizer

- The overview shows MRPL's **published** production, sales and financial data with source URLs.
- The plant model (units, feeds, yields, capacities, product prices and limits, crude cost) is entered by a planner.
  Only publicly published unit capacities are pre-filled.
- `validate()` lists every missing input. `POST /api/production/scenario` returns **422 `model_incomplete`** until the model is complete.
  **The optimizer never runs on invented numbers.**
- HiGHS maximises margin for the baseline and for the scenario (unit downtime, price deltas, crude cost delta). It returns product deltas,
  binding constraints and shadow prices.
- **Plan (scenario card).** `forecast.py` estimates next month's demand per product from the planner's monthly history
  (Holt linear smoothing, 80 % interval; a short history falls back to the mean). The LP then runs for the expected, low and
  high demand cases with inventory, storage, dispatch, contract-minimum, crude-availability and planned-maintenance
  constraints. The card shows the proposed % change per product, the expected value (margin and its change), the
  alternatives and the assumptions.
- If a model is loaded, the LLM writes a 4-bullet explanation. Any number in that text which is not in the optimizer output causes the
  wording to be withheld, and the factual summary is shown instead.

## 10. Desktop app and installer

`desktop/src/main.js` is the Electron main process. It has no telemetry, no auto-update and no CDN. There are three modes:

| Mode | Behaviour |
|---|---|
| **Connect to our plant Yukti server** (`remote`) | Checks `/api/health` and opens the server UI in a locked-down window. |
| **Install Yukti on this PC** | Runs `installer.js` against the site's `manifest.json`, installs to `%LOCALAPPDATA%\Yukti\Server`, then starts the server as a child process. |
| **Use an existing Yukti Server folder** (`local`) | Starts `yukti-server.exe` from the chosen folder. |

Window hardening: navigation is limited to the server origin, and other links open in the system browser. Webviews are blocked. Child windows
are sandboxed with `contextIsolation` and without `nodeIntegration`. Only clipboard, notification and fullscreen permissions are granted,
and only to the server origin. Downloads prompt for a location.

**Installer (`installer.js`):**

1. Fetch `manifest.json`. Detect an NVIDIA GPU and check free disk space.
2. Select artifacts. Those with `requires: "nvidia"` are skipped on PCs without an NVIDIA GPU.
3. Skip any artifact whose SHA-256 matches `installed.json` and whose `check` file exists. **Updates download only changed components.**
4. Download parts with HTTP `Range` resume. Verify **each part** and the **reassembled artifact** by SHA-256. On a mismatch, delete and fail.
5. Extract zips (removing `replace_dir` first) or place files at `dest`, then record the result in `installed.json`.

**Manifest format** (written by `ops/publish.py`):

```json
{
  "product": "yukti-server",
  "version": "0.5.1",
  "published_at": "2026-…Z",
  "desktop": { "file": "Yukti-Setup.exe", "size": 0, "sha256": "…" },
  "artifacts": [
    { "name": "server-core", "kind": "zip", "check": "yukti-server.exe", "replace_dir": "_internal",
      "label": "Yukti server, UI, Laya, public data, examples", "size": 0, "sha256": "…",
      "parts": [ { "url": "files/server-core.part00", "size": 0, "sha256": "…" } ] },
    { "name": "llama-cuda", "kind": "zip", "requires": "nvidia", "check": "llama/cuda/llama-server.exe", "replace_dir": "llama/cuda", "…": "…" },
    { "name": "llama-vulkan", "kind": "zip", "check": "llama/vulkan/llama-server.exe", "replace_dir": "llama/vulkan", "…": "…" },
    { "name": "model-gemma-3-4b-it-q4_k_m", "kind": "file", "dest": "models/gemma-3-4b-it-GGUF/gemma-3-4b-it-Q4_K_M.gguf", "…": "…" }
  ]
}
```

Parts default to 1900 MB (`-PartMB` lowers this for hosts with file-size limits). `ops/serve_site.py` serves a publish folder with Range support for
local testing or intranet hosting.

## 11. Directories

| Path | Contents |
|---|---|
| `backend/app/` | Server code (see §1) |
| `backend/policies/core.yaml` | ABAC and guardrail policy |
| `backend/tests/`, `backend/tests/live/` | pytest suite; live end-to-end and stress tests |
| `web/src/` | SPA: `pages/`, `pages/admin/`, `layout/`, `components/`, `lib/` (API client, i18n) |
| `desktop/src/` | `main.js`, `installer.js`, `preload.js`, `ui/` (connect and splash windows) |
| `data/mrpl/` | Public research (`corporate`, `refinery`, `products`, `finance_esg` as `.json` + `.md`) |
| `data/corpus/` | Example documents + `manifest.json` |
| `data/structured/` | Example asset and work-order data |
| `data/store/` (runtime, git-ignored) | `yukti.db`, `blobs/`, `reports/` (also workbench files and approval notes), `logs/`, `backups/`, `laya/`, `slots/` (spilled KV slots), `sandbox/` |
| `models/` (git-ignored) | GGUF models |
| `llama/cuda`, `llama/vulkan` (package only) | Bundled llama.cpp builds |
| `ops/` | Build, release and run scripts; `ops/package/` holds files copied into the server package |

In the frozen package, `ROOT` is the folder containing `yukti-server.exe`. `YUKTI_HOME` and `YUKTI_STORE` override the root and the runtime store.

## 12. Durable work queue and workers

Every request that Laya routes becomes a row in `tasks` **before** any work starts. Chat turns run inline (the answer
streams to the person) but are still recorded with their worker, steps and outcome; when the policy engine answers
(guardrail, off-topic, need-to-know) the task is moved to the `policy` worker and no model is called. Background work
(workbench deliverables, scan to finding) is queued and picked up by a dispatcher thread with a concurrency limit per
worker. At startup, background tasks that were running are queued again (at most 3 attempts) and interrupted chat turns
are marked `interrupted`.

| Worker | Serves | Model |
|---|---|---|
| `policy` | Guardrail denials, off-topic and need-to-know answers | none |
| `small_llm` | Cited answers, search, summaries | the loaded chat model |
| `ocr_vlm` | Photos, scans, stamps, drawings | RapidOCR + the loaded model's image module |
| `analytics` | Forecasts, the optimizer, ledger and expiry queries | deterministic code |
| `reasoning` | Synthesis (why / root cause / compare) | a 27B-class model when assigned; thinking on |
| `coder` | Scripts, SQL, calculations | the loaded model; code runs only in the sandbox |
| `workflow` | Access requests, approvals, escalation | deterministic code |

One llama.cpp model is resident per GPU, so a worker whose assigned model is not the loaded one is served by the loaded
model with that worker's settings; the task's `served_by` says so.

## 13. Performance Engine: profiles and hot KV cache

- **Profiles** (`perf_profiles.py`): complete load configurations for a model class on a hardware class (context, offload with
  auto-fit, batch and micro-batch, KV type, flash attention, continuous batching, slots, speculative decoding). Yukti picks one
  from the model's size and the free VRAM when it loads a model by itself; an administrator may pick one explicitly. Profiles
  are `measured` (numbers measured by the team), `reference` (starting points) or `validated` (measured on this server with
  *Validate*, which records tok/s, time to first token and VRAM).
- **Hot KV** (`kvcache.py`): each chat keeps its llama.cpp slot (`id_slot`) while in use, so the next turn reuses the cached
  prompt prefix. Slots are given out least-recently-used first; a chat idle longer than the TTL loses its claim. Optionally
  an evicted slot is saved to disk (`--slot-save-path`) and restored when its chat returns, with a size cap (LRU) on the
  spilled files. Context is otherwise reused retrieval-driven: earlier turns and relevant documents are retrieved again.
- **Checkpoints**: each answered turn writes `chat_checkpoints` (task, worker, model, KV slot and state, cached tokens, tool
  calls, policy approvals, citations).

## 14. Hybrid retrieval and the knowledge graph

`rag.retrieve()` fuses channels and keeps the per-document policy check in front of all of them:

1. **BM25** keywords over chunks (FTS5), tag-matched chunks ×1.5, superseded revisions ×0.8.
2. **Metadata**: document types that fit Laya's intent (an SOP for a procedure question) ×1.15.
3. **Knowledge graph** (`graph.py`, `kg_edges`): documents linked to the asset (documented in, procedure), documents those
   reference by number, documents of related assets; graph-only documents enter below solid keyword hits.
4. **Vectors** (`vectors.py`, optional): BGE-M3 embeddings served by a second local llama.cpp process (`--embedding`) or a
   local `YUKTI_EMBED_URL`; cosine similarity is added to the keyword score.
5. **Structured facts**: asset dossier facts (KNOWN / MISSING / CONFLICTING), ledger entries for expiry questions.

Each source carries document, revision, status, page or record ID (`A2_WorkOrders!34`), timestamp, confidence (relative
score × OCR confidence for scanned pages) and the channels that found it.

## 15. Workbench, deliverables and the sandbox

`POST /api/work` turns a request into a plan of tool calls on one task: `search_documents`, `read_facts`, `read_records`,
`read_spreadsheet`, `calculate` (every step shown), `draft_text` (the LLM drafts from the evidence, cited; without a model an
extractive draft), `write_docx` / `write_xlsx` / `write_pptx`, `run_code`. Each call is authorised by the policy engine
for the person who asked (`T-TOOLS`, `T-SANDBOX`, `T-NO-CONTRACTOR-CODE`; `R-NO-CONTROL-WRITE` stays a hard floor) and
written to the audit log. Code runs in `sandbox.py`: its own process, isolated mode, no network, an import allow-list,
files only in its own folder, a time limit and a memory limit (Windows job object without child processes; resource limits
elsewhere). Files are stored under `reports/`, fingerprinted and downloadable by their owner.

## 16. Scan to finding, approver lanes and follow-up

`scan_findings.py` reads each page with RapidOCR keeping box positions, groups boxes into lines (tolerant of skew), asks the
vision model (when loaded) for stamps, signatures and markings, and extracts fields (report number, dates, tag, serial,
make/model, thickness readings, valve pressures, results). It verifies them against the asset master (tag, unit, serial,
model, design limits, ledger due date). Mismatches and low-confidence fields become `review_items`; the finding stays
`DRAFT` until a reviewer confirms, corrects or dismisses them. The finding is then linked to the asset, the applicable
procedure (graph), the owner department, a due date (by severity) and the evidence region, an approval note is drafted
(.docx) and it is routed to the lane approver (`lanes.py`). Unacknowledged findings escalate (high 24 h, medium 72 h, low
168 h) up the chain lane approver → department HOD → refinery management → top management; overdue findings get a daily
reminder.

## 17. Isolated research layer

`research.py` runs an experimental model (for example a Heretic-style model studied for refinery-specific guardrails) in
its own llama.cpp process or at a 127.0.0.1 URL, never as the production engine. Only `research.use` holders can ask it,
questions are audited as fingerprints, answers are labelled experimental, and the policy engine denies it every document
and tool (`T-RESEARCH-ISOLATED`). Production chats, the workbench, approvals and the optimizer never call it.
