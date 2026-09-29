# Yukti — Sovereign Industrial AI Workbench (SIH26117 · Team UniMinds)

Local, role-aware AI workbench for a refinery: login → policy-checked, cited answers from plant documents,
conflict/missing detection, scanned-document OCR, access requests with time-bound grants, company guardrails,
asset expiry alerts, production scenarios (LP optimizer), and a tamper-evident audit log. Runs fully on-premise.
UI modelled on Bionic (LM Studio): model loader with every llama.cpp / vLLM load parameter, per-chat sampling panel.

## Run
```powershell
E:\SIH-2026-PS2\yukti\ops\start.ps1     # starts API + UI on http://127.0.0.1:8000 and auto-loads Gemma-2-2B on the GPU
E:\SIH-2026-PS2\yukti\ops\stop.ps1
```
First start seeds the synthetic corpus (~30 s, includes OCR). Reset: stop, delete `data\store\`, start.

## Demo personas (password shown on the login page in demo mode)
| User | Role | Shows |
|---|---|---|
| ravi.e / Ravi@2026 | Electrician (CDU-1) | A2 dossier: conflicts (45 vs 55 kW, 42 vs 45 A, XV-2042 vs XV-2043), missing A2B wiring, finance source withheld |
| anil.u / Anil@2026 | Boiler engineer | Finance audit denied → Request access |
| kavita.fm / Kavita@2026 | Finance manager | Approves time-bound grant in Inbox |
| vikram.op / Vikram@2026 | Process engineer | Process chemistry allowed (domain model + guardrails) |
| contractor.x / Vendor@2026 | Contractor | Process chemistry blocked by company guardrail |
| meera.me / Meera@2026 | Mechanical approver | E-310 scanned-report finding |
| arjun.pl / Arjun@2026 | Planner | Production scenario (HiGHS LP) |
| deepa.au / Deepa@2026 | Auditor | Audit log + hash-chain verify |
| admin / Admin@2026 | Admin | Models, engines, policies, users |

## Engines
- **llama.cpp (Yukti-managed)** — CUDA build `E:\tools\llama-cuda` (fallback: Vulkan build from winget). All load flags in the loader.
- **Bionic / LM Studio server** — start Bionic's local server (port 1234) and pick the engine in the loader.
- **vLLM / Remote** — set base URL in *My Models → Engines* (plant GPU server / Tier-1 remote GPU).

## Layout
`backend/app` (FastAPI: auth, policy PDP, audit, engine, rag, laya, chat, production, reports) · `backend/policies/core.yaml` ·
`web/` (Vite + React SPA) · `data/gen_corpus.py` (synthetic corpus) · `docs/API.md` · `docs/e2e_test.py` · `ops/`.
