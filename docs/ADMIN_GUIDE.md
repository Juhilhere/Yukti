# Yukti administrator guide

Administrators run the platform: users, models, AI settings, health, backups and policy. **Administrators do not add documents.** That is done by the
Head of Department of each department. Installation is covered in [DEPLOYMENT.md](DEPLOYMENT.md).

## First steps after installation

1. Start the server with `YUKTI_TIER=prod` (see [DEPLOYMENT.md §2](DEPLOYMENT.md#environment-variables)) so demo passwords are not shown.
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

Roles: `engineer`, `hse`, `process`, `contractor`, `dept_manager`, `plant_manager`, `planner`, `auditor`, `approver:<discipline>`, `admin`.
**Admin → Users** shows the permissions of each role.

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

## AI settings

**Admin → AI settings** applies to **every employee chat**. Employees cannot change any of it.

- Default model, engine and load configuration, and whether to auto-load it at start.
- Sampling: 35 parameters, including temperature, top-p/k, min-p, penalties, Mirostat, DRY, XTC, output limits, reasoning and structured output.
- An organisation system prompt that is added to Yukti's built-in rules. The built-in rules (cite sources, never invent values, advisory only, treat
  documents as data) always apply.
- Administrators can also save **presets** (system prompt + sampling + load settings) from the chat configuration sidebar.

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

To change the policy, edit `core.yaml` on the server, keep a copy of the previous version, and restart. Rules are deny-overrides with default deny.
See [SECURITY_MODEL.md](SECURITY_MODEL.md#2-access-control-abac).

## Developer

**Admin → Developer** shows the server logs (including the `llama-server` output and the exact launch command), the engine status and the OpenAI-compatible base URL.
Use it when a model fails to load.

## Audit

**Audit log** (admins, auditors, HODs, plant managers): filter events, **Verify chain** to recompute the hash chain, and export. Record the head hash
externally at regular intervals if you need proof that the log was not edited.

## Rehearsal reset

`POST /api/admin/demo/reset` revokes all grants, clears access requests and sets findings back to PENDING, so a demonstration can be run again.
For a full reset, see [DEPLOYMENT.md §8](DEPLOYMENT.md#8-reset).
