# Yukti administrator guide

Administrators run the platform: users, models, AI settings, health, backups and policy. **Administrators do not add documents.** That is done by the
Head of Department of each department. Installation is covered in [DEPLOYMENT.md](DEPLOYMENT.md).

## Model engines

Admin → Models (or **Ctrl+L**) lists every model Yukti can use, grouped by where it comes from:

| Engine | Use it for | Notes |
|---|---|---|
| **llama.cpp (built-in)** | GGUF files in the Yukti models folder or the LM Studio library | Fully managed: context, GPU layers, KV cache… |
| **Ollama** | Models already downloaded with `ollama pull` | Yukti uses Ollama's native API so the context length you choose is applied (Ollama's OpenAI endpoint would silently cut long prompts). Newer Ollama models (e.g. Gemma 3) only load through Ollama. |
| **Bionic / LM Studio**, **vLLM**, **Custom server** | A model server that is already running | Enter its address under **Connection** and press **Test & save**; the reason is shown if it cannot connect (wrong URL, missing `/v1`, API key, no models). |

Only addresses saved there are allowed through Yukti's offline guard. The model you load is loaded again automatically after a restart
(or the default model set in **AI settings**); if that fails, Yukti falls back to the bundled model.

## First steps after installation

1. Make sure there is **no `DEMO_MODE` file** in the install folder (and `YUKTI_TIER` is not `demo`) before the first start, so no passwords are shown and every seeded account must change its password.
2. Sign in as `admin`. Change the password and turn on MFA under **Account & security**.
3. Go to **Admin → Users**. Disable the demo accounts and import your real users (below).
4. Go to **Admin → Models** and **Admin → AI settings**. Confirm the default model loads and set the organisation defaults.
5. Ask each HOD to upload their department's documents. Delete the EXAMPLE documents when real data is in place.
6. Create a first backup under **Admin → Backup & export**.

## Users

**Admin → Users**

| Task | How |
|---|---|
| Create a user | **Create**: username, display name, post, department, clearance (0 PUBLIC … 4 SECRET), roles, asset scopes (plant units, `*` for all). A temporary password is shown once, and the user must change it at first sign-in. |
| Bulk import | Download `template.csv` (`username,display_name,post,department,clearance,roles,asset_scopes`; separate multiple roles or scopes with `;`). Upload the file. The result lists temporary passwords and any row errors. |
| Make someone an HOD | Give the role `dept_manager` and set their department. HODs upload and remove documents only for their own department and approve its access requests. |
| Reset password / unlock / revoke sessions | Row actions. Accounts lock for 5 minutes after 5 failed attempts in 15 minutes. |
| Disable | Set the status to *disabled*. The user can no longer sign in. |

Roles: `engineer`, `hse`, `process`, `contractor`, `dept_manager`, `plant_manager`, `executive`, `planner`, `auditor`, `stores`, `researcher`,
`approver:<lane>`, `admin`. **Admin → Users** shows the permissions of each role.

New roles and permissions for the workbench, scans, the ledger and the research layer:

| Role or permission | Who has it | Allows |
|---|---|---|
| `work.create` | everyone | Workbench: approval notes, Word, PowerPoint, Excel, calculations, sandboxed code (each tool is still checked by the policy; see *Policies & Laya*) |
| `scan.review` | `engineer`, `hse`, `dept_manager`, `plant_manager` | Start scan-to-finding on a scan they may read; confirm, correct or dismiss uncertain fields for their department |
| `assets.edit` | `hse`, `dept_manager`, `plant_manager`, `stores` | Register assets, add and renew ledger entries (own department; `stores` and refinery management for any asset they can see) |
| `queue.view` | `admin`, `plant_manager`, `auditor` | **Admin → Work queue** |
| `research.use` | `researcher` | The **Research** page (experimental model only) |
| `research.manage` | `admin` | **Admin → Research layer** |
| `stores` | role | Stores / asset team: registers purchased and installed items in the asset ledger |
| `researcher` | role | Research layer only: no plant documents or tools through it |
| `approver:hse`, `approver:procurement`, `approver:management` | roles | Approve findings in the HSE, Procurement and Management lanes (alongside `approver:electrical`, `approver:mechanical`, `approver:finance`) |

A lane's approver is the holder of `approver:<lane>` (in the lane's department first), else that department's HOD, else refinery management.
Give at least one person each approver role you use, and one person `approver:management` or `executive` as the top of the escalation chain.

## Models

**Admin → Models**

- **Load** a model with the engine and load settings: context size, GPU layers, KV-cache types, flash attention, batching, RoPE, speculative decoding,
  parallel slots and more. There are 67 load parameters in total, grouped by topic, with advanced ones hidden by default. The compute backend (`auto`,
  `cuda`, `vulkan`) defaults to CUDA when an NVIDIA GPU is present.
- **Import from path**: copy a `.gguf` from a USB drive or share into the Yukti models folder. Its SHA-256 is recorded. Any llama.cpp GGUF works.
- **Delete** removes an imported model file (only files in the Yukti models folder).
- **External engines**: point `bionic` (LM Studio-compatible), `vllm` or `remote` at an OpenAI-compatible URL. The offline guard allows only the hosts you configure here.
- **Watchdog**: if the engine crashes or hangs after it has loaded, Yukti restarts it automatically, up to 3 times in 10 minutes. After that the status
  shows *error*. Reduce the context size or GPU layers and reload. Chats wait while the engine loads or restarts.

## Performance Engine profiles

Load settings are chosen from **profiles** rather than changed at random. A profile is a complete llama.cpp load configuration for one class of model
on one class of GPU: context size, GPU offload (auto-fitted to free video memory), batch and micro-batch size, q8_0 KV cache, flash attention,
continuous batching, parallel slots and, for 27B models, speculative decoding. When Yukti auto-loads the default model it picks the largest
profile that fits the model's size and the free video memory. You can also pick a profile (or *auto*) when you load a llama.cpp model; any setting
you enter yourself wins over the profile.

Each profile has a status, shown next to it:

| Status | Meaning |
|---|---|
| **measured** | Measured by Team UniMinds on the stated hardware. `small-6gb`: Gemma 3 4B Q4_K_M on an RTX 4050 laptop GPU (6 GB), 44–58 tok/s, 5.1 of 6 GB in use with Whisper turbo (0.2 s to the first token was measured on the same GPU with Gemma 2 2B Q8_0). `small-cpu`: Gemma 2 2B Q8_0 on the processor, 13.4 tok/s (CUDA on the same laptop 51.7 tok/s, 3.9× faster). |
| **reference** | A starting point for hardware we have **not** measured: 8B on 8 GB, and 27B-class reasoning models on 12, 16 and 24 GB GPUs. |
| **validated** | Validated on **this** server by an administrator. |

To validate: load a model with the profile, then press **Validate**. Yukti runs the same short prompt three times and records the median and
range of tok/s, the median time to first token, the video memory in use, the model and the load settings, with who did it and when (also in the
audit log). Without a loaded model, Validate returns an error. Only validated numbers say anything about your hardware.

## Work queue and workers

Laya's typed decision includes the **worker** that should do the job. Every chat turn and every piece of background work becomes a row in the
work queue before anything runs, so background work survives a restart: tasks that were running are queued again (at most 3 attempts), and a
chat answer that was cut off is marked *interrupted*.

**Admin → Work queue** (administrators, refinery management, auditors) shows each worker, what it is for, how many tasks it has by status,
how many are running, and which model serves it. Recent tasks are listed by kind only: the queue view shows the work, not what people asked.
It also shows the hot KV cache statistics (below).

| Worker | Used for | Runs at once |
|---|---|---|
| Policy engine (no model) | Guardrail denials, off-topic and need-to-know answers | 8 |
| Small quantized LLM | Cited answers from documents, summaries | 2 |
| OCR + vision-language model | Photos and scan-to-finding | 1 |
| Deterministic analytics engine | Forecasts, the optimizer, ledger and expiry questions, calculations, Excel exports | 2 |
| Reasoning model (27B class) | Synthesis: *why*, *root cause*, *compare*, conflicting sources | 1 |
| Sandboxed coding model | Scripts; code runs only in the sandbox | 1 |
| Workflow engine | Access requests, approval notes, lanes, escalation | 4 |

### Assigning models to workers

Under **Admin → AI settings → Worker models** you can assign a model, and extra sampling settings, to each worker. For example, assign a
27B-class reasoning model to the **reasoning** worker. Workers without an assignment use the loaded chat model. Each worker also has built-in
settings: the reasoning worker turns thinking on at temperature 0.3, the coder uses temperature 0.1, the vision worker 0.2.

**One llama.cpp model is resident at a time on a single GPU.** A worker whose assigned model is not the loaded one is served by the loaded model
with that worker's settings, and Yukti says so: the chat stream and **Admin → Work queue** show the assigned model, the model that actually served
it, and `fallback`. Nothing is hidden. To use the 27B model for reasoning, load it (with a 27B profile above) on a GPU with enough memory.

## AI settings

**Admin → AI settings** applies to **every employee chat**. Employees cannot change any of it.

- Default model, engine and load configuration, and whether to auto-load it at start.
- Sampling: 35 parameters, including temperature, top-p/k, min-p, penalties, Mirostat, DRY, XTC, output limits, reasoning and structured output.
- An organisation system prompt that is added to Yukti's built-in rules. The built-in rules (cite sources, never invent values, advisory only, treat
  documents as data) always apply.
- Administrators can also save **presets** (system prompt + sampling + load settings) from the chat configuration sidebar.
- **Worker models** (above) and the **performance profile** used at auto-load (`auto`, `off` or a profile id).

### Hot KV cache

There is no single persistent KV cache for everything. Context is reused in two ways: earlier turns and relevant documents are **retrieved again**
for each question, and a chat keeps **its own llama.cpp slot** while it is in use, so its next turn reuses the cached prompt instead of
recomputing it. The settings:

| Setting | Default | Meaning |
|---|---|---|
| `kv_ttl_s` | 1800 s | A chat idle longer than this loses its slot (60 s to 24 h). |
| LRU | — | When every slot is taken, the slot of the least recently used idle chat is handed over. |
| `kv_spill` | off | When on, an evicted chat's slot is saved to disk (`data\store\slots\`) and restored if the chat comes back within the TTL. |
| `kv_spill_max_mb` | 4096 MB | Size cap for saved slots (256 MB to 256 GB). Files older than the TTL go first, then the least recently used. |

**Admin → Work queue** and `GET /api/admin/kv` show slots, hot chats, hits, misses, evictions, restores, files on disk, the KV-cache type and the
context per slot. Each answered turn also stores a checkpoint (worker, model, slot, hot/cold/restored, tokens served from cache, tool calls,
guard decisions and citations) that the chat's owner can read.

## Usage & health

**Admin → Usage & health** shows **only measured values** (null when nothing has been measured yet):

- users and active sessions
- queries and policy denials per day, and queries by intent and department
- performance: answers, average tok/s, average and p95 TTFT, and total time
- errors in the last 24 h, and feedback 👍 / 👎
- knowledge: documents, pages, scanned pages, chunks and examples
- engine status, GPU, RAM and disk
- audit record count and **head hash**

**Admin → Feedback** lists rated answers with the question, an excerpt of the answer and the comment.

## Backup & export

- **Create backup**: a ZIP of the database snapshot and documents, with its SHA-256 recorded in the audit log. Download it and keep it off-server. It
  contains password hashes and chat history.
- **Restore**: stages the backup. **Restart the server** to apply it.
- **Audit export**: CSV or JSONL (also available to auditors).

## Policies & Laya

**Admin → Policies & Laya**

- View the active policy (`backend/policies/core.yaml`) and its version.
- Simulate a decision through the API: `POST /api/admin/policies/simulate` `{username, document_id, action}` returns *allow* or *deny*, the matched rules and the reason.
- Laya statistics: total routed, LLM calls saved, average latency and a breakdown by intent. **Benchmark** runs the loaded LLM as a router on logged
  queries so you can compare latency and agreement measured on your own hardware.

The policy also authorises every **workbench tool** (`T-TOOLS`, `T-SANDBOX`, `T-NO-CONTRACTOR-CODE`, `R-NO-CONTROL-WRITE`) and isolates the
research layer (`T-RESEARCH-ISOLATED`). See [SECURITY_MODEL.md](SECURITY_MODEL.md#11-tools-sandbox-and-research-layer).

To change the policy, edit `core.yaml` on the server, keep a copy of the previous version, and restart. Rules are deny-overrides with default deny.
See [SECURITY_MODEL.md](SECURITY_MODEL.md#2-access-control-abac).

## Retrieval: knowledge graph and vectors

**Admin → Retrieval** shows the channels of the hybrid search: BM25 keywords (SQLite FTS5), asset tags, document metadata, knowledge-graph links,
dense vectors (when installed) and structured facts.

- **Knowledge graph.** Links between assets, documents, procedures and records, built from the plant's own data: an asset's documents and
  procedures, newer revisions superseding older ones, document numbers written in another document's text, tags named in the same passage, and
  work orders, findings and ledger entries. It is rebuilt at start and after each upload; **Rebuild graph** rebuilds it by hand. The panel
  shows the number of links by type.
- **Vectors (optional).** Meaning-based search with the multilingual **BGE-M3** embedding model. To turn it on, either put a GGUF whose file name
  contains `bge-m3` into a models folder (the Yukti `models` folder or the LM Studio models folder) and restart — Yukti then starts a second
  llama.cpp server in embedding mode on 127.0.0.1 and embeds every passage in the background — or set `YUKTI_EMBED_URL` to an existing local
  OpenAI-compatible `/v1/embeddings` server. The panel shows the status, the model, and how many passages have vectors. Without either, nothing
  here runs and search uses the other channels.

Graph links and vectors only help **find** passages. Every document they find still passes the same per-document policy check before anything
about it is used.

## Research layer

**Admin → Research layer** (administrators) runs an experimental model, for example a Heretic-style model studied for refinery-specific
guardrails, isolated from production:

1. Choose a model file (it must be different from the production model; Yukti starts it in its own llama.cpp process on 127.0.0.1 with a 4096
   context), **or** enter the address of a model server that is already running on this server. Only `127.0.0.1` / `localhost` addresses are accepted.
2. Write the research layer's own **guardrails** (its system rules). A cautious default is filled in.
3. Switch it **on** and press **Start** (**Stop** ends it).
4. Give the `researcher` role to the people who may use it.

Isolation is enforced by Yukti, not by the model: the policy rule **`T-RESEARCH-ISOLATED`** denies the research layer every plant document and
every workbench tool. Production chats, the Workbench, approvals and the optimizer never call it. Answers are labelled EXPERIMENTAL, and every
question is audited as a fingerprint.

## Speech models (AI4Bharat IndicWhisper, optional)

Voice input uses whisper.cpp with OpenAI Whisper models by default (large-v3-turbo on an NVIDIA GPU, small on the processor). For better Hindi
and Kannada, you can add AI4Bharat's IndicWhisper models converted to ggml format:

| File | Language |
|---|---|
| `speech\models\ggml-indicwhisper-hi.bin` | Hindi |
| `speech\models\ggml-indicwhisper-kn.bin` | Kannada |

When a file is present, Whisper still detects the spoken language; speech detected as Hindi or Kannada is then recognised by that language's
IndicWhisper model, in its own whisper.cpp process (started on first use, stopped after 10 idle minutes). If it cannot start, Yukti falls back to
Whisper. `GET /api/speech/status` lists the installed IndicWhisper models, and the transcription result names the model used.

## Developer

**Admin → Developer** shows the server logs (including the `llama-server` output and the exact launch command), the engine status and the OpenAI-compatible base URL.
Use it when a model fails to load.

## Audit

**Audit log** (admins, auditors, HODs, plant managers): filter events, **Verify chain** to recompute the hash chain, and export. Record the head hash
externally at regular intervals if you need proof that the log was not edited.

## Rehearsal reset

`POST /api/admin/demo/reset` (demonstration mode only) revokes all grants, clears access requests and sets findings back to PENDING, so a demonstration can be run again.
For a full reset, see [DEPLOYMENT.md §8](DEPLOYMENT.md#8-reset).
