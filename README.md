# Yukti — Sovereign Industrial AI Workbench

**SIH 2026 · PS SIH26117 (Mangalore Refinery and Petrochemicals Ltd) · Team UniMinds**

Yukti is an on-premise, role-aware AI workbench for a refinery. Employees sign in from the **Yukti desktop app**, ask questions and
upload documents; every answer is **policy-checked, cited and audited**. Scanned reports become owned findings with approvals,
assets raise expiry alerts, planners run an LP optimizer on their own plant model, and administrators control models, AI settings,
users and backups. Everything runs locally on open-weight models — no data leaves the organisation.

> Team UniMinds is not affiliated with MRPL. MRPL facts shown in Yukti are **public information with source links**
> (140 sources: website, annual reports, BRSR, filings, rating rationales). Plant documents shipped with Yukti are
> **EXAMPLES written by Team UniMinds**, watermarked on every page and badged in the UI. Nothing else is invented.

## Architecture
```
Employee PCs (Yukti desktop app, Electron)  ──HTTP (plant LAN)──▶  Yukti server (FastAPI :8000)
                                                                     ├─ auth · sessions · MFA · ABAC policy engine · audit hash-chain
                                                                     ├─ chat orchestrator: Laya router → guardrails → retrieval → facts → LLM
                                                                     ├─ ingestion: text/scan detection · OCR (RapidOCR) · chunking · FTS5
                                                                     ├─ SQLite (WAL) · document store · backups
                                                                     └─ llama.cpp llama-server (CUDA/Vulkan) — or Bionic / vLLM / remote engine
```

## Run
| What | Command |
|---|---|
| Server + UI on this PC | `ops\start.ps1` (opens http://127.0.0.1:8000, auto-loads the default model) |
| Server for the plant LAN | `ops\start-server.ps1 -Lan` (listens on 0.0.0.0:8000 — open TCP 8000 for the plant subnet only) |
| Stop | `ops\stop.ps1` |
| Desktop app (dev) | `cd desktop && npm install && npm start` |
| Desktop installer | `cd desktop && npm run dist` → `desktop\dist\Yukti-Setup-<version>.exe` |
| Web UI build | `cd web && npm install && npm run build` (served by the server from `web\dist`) |
| Backend deps | `cd backend && uv sync` (Python 3.12) |
| **Website release (one-click install)** | `opselease-site.ps1 -SiteUrl https://<your-site>/yukti/` → upload `E:\yukti-build\publish\` to that URL |
| Test the website locally | `python ops\serve_site.py E:\yukti-build\publish --port 9000` |
| End-to-end API test | `cd backend && uv run python ..\docs\e2e_v2.py` (68 checks) |

First start seeds the database (employees, MRPL public data, example documents incl. OCR, ~30 s).
Reset: stop, delete `data\store\`, start. Rehearsal reset (revoke grants, reopen findings): Admin → `POST /api/admin/demo/reset`.

**Inference engine:** `E:\tools\llama-cuda\llama-server.exe` (official llama.cpp CUDA 12.4 build, set `YUKTI_LLAMA_CUDA` to change),
falling back to `llama-server` on PATH (Vulkan). Models: any `.gguf` in `models\` or the Bionic/LM Studio models folder;
admins import new models from disk/USB in **Admin → Models**.

## One-click install from your website
1. `opsuild-release.ps1` builds the self-contained server package; `opselease-site.ps1 -SiteUrl …` bakes the site address into the
   desktop app and produces `index.html`, `Yukti-Setup-<ver>.exe`, `manifest.json` and `files\*.partNN`.
2. Upload the folder. Users click **Download Yukti**, run the installer, and on first start choose **Install Yukti on this PC**:
   the app downloads only what the PC needs (CUDA runtime only when an NVIDIA GPU is present), resumes interrupted downloads,
   verifies every part and component with SHA-256, installs to `%LOCALAPPDATA%\Yukti\Server`, starts the server and opens Yukti.
   Re-running later updates only changed components; nothing is re-downloaded otherwise. No admin rights are needed.
3. Plant deployments can instead run the server on one GPU machine (`Start Yukti Server (Plant LAN).cmd`) and have employees choose
   **Connect to our plant Yukti server**.

## Roles
| Role | Can |
|---|---|
| Employee (engineer, HSE, process, contractor…) | Chat with knowledge, sources/facts, request access, inbox for own discipline, feedback, account (password, MFA) |
| Department manager / plant manager | + approve access requests, findings, audit for department |
| Planner | + production intelligence and plant-model editing |
| Auditor | + audit log, chain verification, export |
| **Administrator** | + **all LLM configuration** (models, engines, 67 load + 35 sampling parameters, org AI settings, presets), users, usage & health, backups/restore, policies, Laya benchmark, developer logs |

Employees never see or change LLM settings; the organisation settings chosen by the administrator apply to every chat.

## Demo accounts (fictional employees mapped to MRPL's real departments)
`ravi.e` Electrical Maintenance · `anil.u` Captive Power Plants & Utilities · `suresh.em` Electrical Maintenance manager ·
`kavita.fm` Finance & Accounts manager · `meera.me` Mechanical Maintenance (approver) · `priya.hse` HSE · `vikram.op` Process Engineering ·
`arjun.pl` PP & QC planner · `deepa.au` Internal Audit · `ramesh.pm` CGM Refinery · `contractor.x` contractor · `admin` administrator.
Passwords are shown on the login screen in demo mode (`YUKTI_TIER=demo`); set `YUKTI_TIER=prod` to hide them.

## What is real vs. example
| Real (measured or sourced) | Example (Team UniMinds, badged) | Not included (must come from MRPL) |
|---|---|---|
| All software behaviour, every setting, tok/s, TTFT, VRAM, audit hashes, policy decisions; MRPL public data with sources | 15 plant documents (A2 pump datasheet, SOP-EL-014 r2/r3, P&ID/SLD revs, troubleshooting guide, E-310 & PSV-118 scans, finance audit, amine MSDS/manual, shift log, A2 work orders) and the assets/work orders they describe | Plant yields, prices, contracts for the optimizer (planner enters them); real asset register; real documents; HR directory (CSV import) |

## Layout
`backend/app` (auth, admin, policy, audit, engine, llm_params, rag, laya, chat, mrpl, mrpl_facts, production, reports, seed) ·
`backend/policies/core.yaml` · `web/` (React SPA) · `desktop/` (Electron client) · `data/mrpl/` (public research, cited) ·
`data/corpus/` (example documents) · `data/gen_corpus.py` · `docs/` (API, plans, tests) · `ops/` (start/stop scripts).
