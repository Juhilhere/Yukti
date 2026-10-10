# Feasibility, viability and impact

Why Yukti is feasible, viable and different — with pointers to the code that backs each claim.

| | |
|---|---|
| Product | **Yukti: Sovereign Industrial AI Workbench**, version 0.5.1 |
| Problem statement | SIH26117: *Sovereign On-Premise Agentic AI Workbench using Open-Weight Multimodal LLMs for Confidential Industrial Work* |
| Theme / category | Smart Automation / Software |
| Team | UniMinds (Team ID 152431). Team lead Juhil Modi; members Saswata Das, Harshit Tiwari, Rohan Jangam, Ritesh Prajapati and Sanskriti |
| Code / download | [github.com/Juhilhere/Yukti](https://github.com/Juhilhere/Yukti) · [yukti.cypherion.tech](https://yukti.cypherion.tech) |

Numbers marked **measured** were measured by the team on the hardware stated. Everything else is a design property of the code, not a measurement.

## 1. Challenges and risks, and how we overcome them

| # | Risk | How Yukti handles it | Where |
|---|---|---|---|
| 1 | **Hallucinated or unsafe answers** | Answers come only from cited evidence. Facts that are missing or conflicting are flagged as MISSING or CONFLICTING, not guessed. Citations to sources that were not supplied are flagged. The optimizer refuses incomplete plant models, and an LLM explanation containing a number that is not in the optimizer's result is withheld. | `rag.py`, `chat.py`, `production.py`, `routes_work.py` |
| 2 | **Unauthorized data exposure** | A deterministic ABAC policy engine outside the model decides every read, citation and tool call (deny-overrides, default deny). Extra access is a time-bound, logged grant from the department's HOD. In line with the Digital Personal Data Protection Act, 2023 (see [SECURITY_MODEL.md §12](SECURITY_MODEL.md#12-regulatory-alignment); this is alignment, not certification). | `policy.py`, `core.yaml`, `scope.py` |
| 3 | **OCR / VLM errors on old scans** | Extracted fields are cross-checked against the asset master (tag, unit, serial, make and model, design limits, ledger due date). Fields read with OCR confidence below 0.90, and any mismatch, go to a human reviewer before a finding is raised. | `scan_findings.py` |
| 4 | **Mis-routing by the decision model** | Laya abstains below 0.40 confidence (or when the top two intents are within 0.10), and abstentions are marked for review. Laya is trained on labelled example requests in English, Hindi and Kannada shipped with Yukti; calibrating it on a plant's own labelled workflows is part of the pilot, and **Admin → Policies & Laya → Benchmark** measures its agreement with an LLM router on the plant's own logged queries. | `laya.py` |
| 5 | **GPU memory and latency limits** | Layers are auto-fitted to free video memory; a q8_0 KV cache halves KV memory compared with f16; a watchdog restarts a crashed or hung engine (up to 3 times in 10 minutes). Load settings come from Performance Engine profiles, which an administrator validates on the plant's own server. | `engine.py`, `perf_profiles.py` |
| 6 | **Automation over-reach** | Advisory only. Yukti stays outside the DCS/SCADA path (in line with ISA/IEC 62443 zoning): there is no write path to control systems (`R-NO-CONTROL-WRITE`), setpoint and interlock changes are refused (`G-CONTROL-CHANGE`), and every safety step needs a human approval. Approval notes take effect only when the accountable approver signs them. | `core.yaml`, `deliverables.py`, `lanes.py` |

## 2. Built from mature parts, on modest hardware

### Technically feasible

Every building block, from local LLM serving to OCR, VLMs, hybrid search and policy engines, is mature open source: llama.cpp, ONNX Runtime,
RapidOCR (PP-OCR), SQLite FTS5, HiGHS, whisper.cpp, FastAPI, React + Vite and Electron (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
Our work is the governed integration. **Yukti 0.5.1 already ships as a one-click Windows installer** (`Yukti-Setup.exe`).

Technology stack: Python, FastAPI, React + Vite, Electron, llama.cpp, ONNX Runtime, AI4Bharat ASR, CUDA / Vulkan, Gemma 3 4B, RapidOCR, Laya,
HiGHS LP, SQLite FTS5, ABAC policy, argon2id + MFA, SHA-256 audit. (Speech: whisper.cpp with OpenAI Whisper models is the default engine;
AI4Bharat IndicWhisper models are used for Hindi and Kannada when installed.)

### Modest hardware

All **measured** on an RTX 4050 laptop GPU with 6 GB of video memory:

| What | Measured |
|---|---|
| Generation, Gemma 3 4B Q4_K_M (llama.cpp CUDA) | **44–58 tok/s** |
| Time to first token | **0.2 s** |
| CUDA vs processor | **3.9× faster** (51.7 vs 13.4 tok/s) |
| Model and voice together (Gemma 3 4B + Whisper large-v3-turbo) | **5.1 of 6 GB** video memory |

To be precise about the sources: the 3.9× pair (51.7 vs 13.4 tok/s) and the 0.2 s time to first token in the README's measurement table were
measured with **Gemma 2 2B Q8_0** on the same laptop; the 44–58 tok/s and 5.1 GB figures were measured with Gemma 3 4B. See
[README → Performance (measured)](../README.md#performance-measured).

No cluster, no cloud. We have not benchmarked plant-server GPUs: the 8B and 27B Performance Engine profiles are reference settings until an
administrator validates them, and **Admin → Usage & health** reports only values measured on the plant's own server.

### Economically and operationally viable

- One-time on-premise hardware instead of per-token cloud fees.
- Open-weight models avoid licence lock-in; new models plug in later without redesigning the system.
- Laya cuts unnecessary large-model calls: refusals, off-topic and need-to-know questions are answered without calling the LLM at all.
- Plugs into existing IAM, maintenance, document and asset systems read-first (users by CSV import, documents by upload, asset register and work
  orders as structured data).

### Phased rollout

| Phase | Scope |
|---|---|
| **1 · Pilot** | One unit's maintenance knowledge: equipment dossiers, SOPs and drawings, with identity-aware RAG and citations. |
| **2 · Workflows** | Scan-to-finding pipeline, approval routing, digital asset ledger and expiry alerts. |
| **3 · Planning** | Production intelligence with planners, on authorized historical and market data. |
| **4 · Scale** | Plant-wide rollout, and a template for other refineries and PSUs with the same sovereignty needs. |

What to set up in each phase: [DEPLOYMENT.md §11](DEPLOYMENT.md#11-phased-rollout).

## 3. Impact and benefits

### Impact on every role

| Role | Impact | Where in Yukti |
|---|---|---|
| **Field technicians** | An authorized equipment dossier in one place: ratings, history, wiring, isolation steps and the approved procedure. | Chat, asset dossier (PDF) |
| **Engineers & inspectors** | Scanned reports become linked findings with owners, deadlines and evidence, so nothing is forgotten in a folder. | Scan to finding, Scan review |
| **HSE & approvers** | Electrical, mechanical, HSE, procurement, finance and management approvers, with escalation and follow-up tracked. | Inbox, approver lanes |
| **Asset & stores teams** | Certificates, calibrations, warranties and licences alert before they lapse. | Asset ledger, alerts |
| **Production planners** | A forecast and a constrained optimizer compare product mixes using prices, crack spreads, inventory and feedstock. The optimizer calculates, the LLM explains, planners decide. | Production → Plan (scenario card) |
| **Management & audit** | Every source, tool call, access grant and approval is traceable end to end. | Audit log (SHA-256 hash chain) |

### By the numbers

| | |
|---|---|
| **0.2 s** | time to first token, measured on a 6 GB laptop GPU (see the note in §2 on which model) |
| **3** | languages: English, Hindi and Kannada, with offline speech input |
| **1 ms** | for Laya to route a request, before any LLM call (about 1 ms; Admin → Policies & Laya shows the average measured on your server) |
| **86** | live end-to-end checks on a running Yukti server (`backend/tests/live/e2e_live.py`) |

An offline guard blocks every outbound call (and counts them), and Yukti never changes DCS or SCADA setpoints. Restricted knowledge needs
authorization, permits and safety findings need accountable humans, and every source, tool call and approval is audited: one governed path from
information to action.

### Benefits

| Benefit | |
|---|---|
| **Safety** | Approved isolation and troubleshooting steps on every shift; no lapsed extinguishers or overdue vessel inspections. |
| **Operational** | Less time searching across systems, and faster, better-informed restoration of equipment. |
| **Economic** | Better product-mix decisions within real constraints, no cloud fees and fewer large-model calls. |
| **Governance & compliance** | Role-scoped access, time-bound grants and a complete audit trail support data-protection and safety audits. |
| **Knowledge retention** | Old financial and technical records, contacts and company history are digitised, so expertise outlives retirements. |
| **Sovereign & national** | Confidential industrial data never leaves the organisation: an Atmanirbhar template for other PSUs. |

## 4. What makes our solution unique

| | Cloud AI assistants | Yukti workbench |
|---|---|---|
| Where the data goes | Data must leave the plant | On-premise, air-gapped |
| Cost and fit | Pay per token | Tuned to the local GPU |
| Serving | Generic serving, no tuning | q8_0 KV cache, speculative decoding |
| Answers | Fluent answer, no source | Cited: known, missing, conflict |

## 5. Read more

- [REFERENCES.md](REFERENCES.md): the research behind each stage, and where it lives in the code
- [SECURITY_MODEL.md](SECURITY_MODEL.md): threat model, policy, sandbox, research-layer isolation, regulatory alignment
- [DEPLOYMENT.md](DEPLOYMENT.md): hardware, optional components, phased rollout
