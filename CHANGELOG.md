# Changelog

All notable changes to Yukti are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] — 2026-09-30

### Added
- **Ask with a photo.** Add up to 4 photos to a question with the camera, the gallery, paste or drag-and-drop.
  - The text on the photo (stencils, tag plates, nameplates) is read offline by OCR, and equipment tags are matched to the asset register within the person's access.
  - Documents about the photographed tag are preferred.
  - "What Yukti read in the photo" shows the lines read and the tags found.
  - The model names a line or chemical only from a readable tag and the documents, never from colour. It says so when no tag is readable, and points out rust, leaks and damage.
- **Privacy of photos:** photos are stripped of EXIF/GPS, resized, visible only to the sender and deleted with their chat.
- **Gemma 3 4B with its image module** is the new default model: it sees photos and answers well in English, Hindi and Kannada. Models in Ollama that can see photos (e.g. `gemma3`) are detected too.
- **Speak instead of typing.** Offline Whisper speech recognition (whisper.cpp): large-v3-turbo on NVIDIA GPUs (well under a second), small on the processor.
  - It is hinted with the plant's own tags ("pump A2", "exchanger E-310").
  - Silence never turns into words.
  - The transcript goes into the question box for checking and is never sent automatically.
- **Setup:** new components *Voice input* and *Voice model*. The GPU version is downloaded only on PCs with an NVIDIA GPU.

### Changed
- **Updating:** running a newer `Yukti-Setup.exe` over an existing installation now offers the update once
  ("Update now" / "Later"), instead of silently starting the old version.
- The assistant answers only what was asked and writes isolation steps only when asked and only from the approved procedure.

## [0.4.0] — 2026-09-30

### Added
- **One download from GitHub**: `Yukti-Setup.exe` (one-click, no questions) installs the app; on first start Yukti downloads
  its AI from the GitHub release (signed manifest, parts under 2 GB, SHA-256 per part, resumable, automatic retry when the
  internet drops) and starts. `ops/release-github.ps1` publishes a release.
- **Setup for non-technical users**: plain steps, time left, pause/resume, plain-language errors, language picker; IT options
  under "Other options". The uninstaller removes the downloaded AI and asks before deleting data.
- **Hindi and Kannada everywhere**: web app (1 293 keys, checked in CI), desktop setup/start-up/menus, server messages and AI
  setting labels; the assistant answers in the chosen language.
- **Simple model chooser**: model cards that say whether a model fits this PC, a recommended model, automatic settings.
- **Report a problem**: guided dialog with automatic technical details, crash screen, report links on every error.

### Added
- **Single-zip distribution** (`ops/bundle.py`, `ops/release-site.ps1`): one `Yukti-<ver>-Windows.zip` with the app, the server, both
  llama.cpp builds and the model. `Yukti.exe` starts the bundled server itself, creates shortcuts, and keeps data in `%LOCALAPPDATA%\Yukti`.
- **Ollama engine** (native API, context length applied, real load errors) and the Ollama model library on disk.
- **Connection panel** for every external engine in the model loader (URL, API key, Test & save, reason when unreachable).
- Admin → Backup: restore is checked (checksum, zip, database) before staging, with **Restart now** and **Cancel restore**.

### Fixed
- llama.cpp load failures now state the real cause (unsupported architecture, corrupt file, Ollama-format file, out of memory, bad flag).
- Prompts are fitted to the model's context; context-overflow errors are explained and not retried; answers interrupted by a model
  reload are regenerated automatically; interrupted streams are shown as interrupted.
- The loaded model is restored after a restart (falls back to the bundled model if it cannot be loaded).
- Offline guard: remote engines given by host name work; asyncio connections are guarded too.
- Uploads: unsupported file types rejected, all TIFF pages OCR'd, documents without text reported, stale jobs failed at start-up,
  natural revision order (R10 after R9), deleted documents removed from disk.
- Backups with apostrophes in the path, CSV import of Excel/semicolon files, atomic model import (incl. split GGUF), built-in presets
  protected, production explanation number check, Laya benchmark parameters.

### Security
- Department and rank scoping for all data, not only documents (`backend/app/scope.py`): assets, alerts, findings, audit log, asset-master
  facts, CMMS work orders and on-call contacts. Dossier facts fail closed.
- Grants carry a classification ceiling capped at the approver's clearance; the IT administrator can no longer approve business access or
  read plant documents. Findings are approved only at RESTRICTED clearance or above.
- Engine status and logs are administrator-only; employees get a reduced system view. Owner checks for jobs, chat stop and projects.
- Content-Security-Policy and other security headers; optional HTTPS (`--tls-cert/--tls-key`, Secure cookie, HSTS).
- llama-server runs with a random per-load API key on a random loopback port.
- Ed25519-signed release manifest; the desktop app refuses unsigned or altered releases.
- Production by default: demonstration mode needs a `DEMO_MODE` file or `YUKTI_TIER=demo`; otherwise seeded accounts must change passwords.
- Disabling MFA needs a current authenticator or recovery code; administrators cannot change their own rank, roles or department.
- Upload document types are validated (P&ID/SLD/work-order uploads now use the policy's type names); MSDS and contact lists are limited to
  HSE and management.

### Changed
- Licence: Yukti Proprietary Licence (`LICENSE`) following the Smart India Hackathon IP rule.
- Knowledge page opens on "My department"; the audit page explains department scope to HODs.
- Chat requests are retried on the new engine if a reload or restart happens before the answer starts.

## [0.3.0] — 2026-09

### Added
- **Self-contained Yukti Server package**: `yukti-server.exe` (PyInstaller) with bundled llama.cpp b11255 CUDA 12.4 and Vulkan builds, the default
  model Gemma-2-2B-it Q8_0, a pre-trained Laya, the UI and the data. No Python, Bionic/LM Studio, Ollama or vLLM required.
- Automatic compute backend: CUDA on NVIDIA GPUs, otherwise Vulkan (AMD/Intel GPUs, or CPU).
- `Start Yukti Server.cmd` (this PC) and `Start Yukti Server (Plant LAN).cmd` (0.0.0.0:8000).
- **Windows desktop app** (Electron) with three modes: connect to a plant server, install Yukti on this PC, or use an existing server folder.
  It has hardened windows, a tray, and no telemetry or auto-update.
- **One-click website install**:
  - `ops/build-release.ps1`, `ops/release-site.ps1` and `ops/publish.py` produce a download page, a manifest and split components.
  - The in-app installer is GPU-aware, resumable (HTTP Range), verifies SHA-256 per part and per component, and updates only changed components.
  - `ops/serve_site.py` serves a release for local or intranet testing.
- **llama-server watchdog**: restarts a crashed or hung engine automatically (at most 3 times per 10 minutes). Chats wait during load or restart and
  are retried once if the engine was switched before any output.
- Live test suites `backend/tests/live/e2e_live.py` (74 checks) and `stress_live.py` (concurrency and fault injection).
- **CI** on GitHub Actions: backend pytest on `windows-latest`, web type-check and build, desktop syntax checks and installer unit test.

### Changed
- **HOD-only knowledge management**: only Heads of Department add or remove documents, and only for their own department.
- **Admin-only LLM configuration**: 67 load and 35 sampling parameters, verified to reach llama.cpp. Unsupported flags are dropped per build.
- Production optimizer refuses to run until the planner has entered a complete plant model. No invented numbers anywhere.
- Example plant documents reduced to 15, each watermarked and badged as EXAMPLE.

## [0.2.0]

### Added
- **User administration**: create, edit, disable, unlock, reset password, revoke sessions, CSV import with a template.
- **Forced password change** for temporary passwords, and a stronger password policy.
- **TOTP MFA** with QR enrolment and single-use recovery codes.
- **Organisation-wide AI settings** applied to every employee chat. Employees can no longer change sampling or system prompts.
- **Usage & health dashboard** with measured values only, plus feedback on answers.
- **Backups and restore** (staged, applied at restart) and **audit export** (CSV/JSONL).
- Offline model import from a path (e.g. a USB drive), with its SHA-256 recorded.
- **Findings workflow** with per-role `allowed_actions` and escalation.
- **MRPL public intelligence** with source links: real department structure, company page, cited public facts in chat, and detection of
  conflicting public figures.
- Hindi and Kannada UI.
- Laya benchmark that measures the loaded LLM as a router, replacing any hard-coded baseline.
- Rehearsal reset endpoint.

## [0.1.0]

### Added
- Demo build:
  - FastAPI backend with argon2id authentication, server sessions, CSRF and lockout.
  - Deterministic ABAC policy engine (YAML, deny-overrides) and hash-chained audit log.
  - Laya intent router (ONNX), company guardrails and policy-filtered retrieval (SQLite FTS5).
  - KNOWN / MISSING / CONFLICTING facts and cited streaming answers from a local llama.cpp model.
  - Ingestion with scanned-page detection and OCR (RapidOCR).
  - Access requests with time-bound grants, asset ledger expiry alerts, an asset dossier PDF and an LP planner (HiGHS).
  - React single-page app.

[Unreleased]: https://github.com/Juhilhere/Yukti/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Juhilhere/Yukti/releases/tag/v0.3.0
