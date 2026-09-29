# Contributing to Yukti

Yukti is a private, proprietary repository of Team UniMinds (see [NOTICE](NOTICE)). These notes are for team members and invited collaborators.

## Development setup

Requirements: Windows 10/11, [uv](https://docs.astral.sh/uv/), **Python 3.12** (managed by uv), **Node 22**, Git. For GPU inference you also need a
llama.cpp `llama-server` build and a GGUF model (see `backend/app/config.py` and `ops/package/MODELS.txt`).

```powershell
git clone https://github.com/Juhilhere/Yukti.git
cd Yukti

# Backend: always use a uv-managed Python. Never freeze against Anaconda or system Python.
$env:UV_PYTHON_PREFERENCE = "only-managed"
cd backend
uv sync

# Web UI
cd ..\web
npm ci
npm run build          # served by the backend from web\dist
# npm run dev          # Vite dev server on :5173, proxies /api to :8000

# Desktop app
cd ..\desktop
npm ci
npm start

# Run everything
cd ..
.\ops\start.ps1        # http://127.0.0.1:8000, auto-loads the default model
.\ops\stop.ps1
```

The first start seeds `data\store\`. Delete that folder to start fresh.

## Branches and commits

- `main` is always releasable, and CI must be green. Do not push directly. Open a pull request.
- Branch names: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`, `test/<topic>`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(chat): show withheld count per department`,
  `fix(engine): retry once when the engine is switched before output`, `docs: deployment firewall rule`.
- Keep pull requests focused. Fill in the PR template, including the security and data-provenance checklist.
- Every user-visible change needs an entry under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).

## Tests to run before opening a PR

| Change touches | Run |
|---|---|
| Backend | `cd backend; uv run pytest` (no GPU or model needed) |
| Chat, engine, auth, policy (with a server running) | `cd backend; uv run python tests/live/e2e_live.py` (74 checks) |
| Engine lifecycle, concurrency, uploads | `cd backend; uv run python tests/live/stress_live.py` (it kills and reloads the engine; do not run it against a shared server) |
| Web | `cd web; npm run build` (runs `tsc --noEmit`, then the Vite build) |
| Desktop | `cd desktop; npm test` (installer self-test: download, resume, SHA-256, GPU-aware selection, idempotent update) and `node --check` on changed files |
| Release tooling | Build with `ops\build-release.ps1`, publish with `ops\release-site.ps1 -SiteUrl http://127.0.0.1:9000/`, serve with `python ops\serve_site.py E:\yukti-build\publish --port 9000`, and install through the desktop app |

CI (`.github/workflows/ci.yml`) runs the backend pytest suite on `windows-latest`. It also runs the web type-check and build, and checks that the bundle references no external CDN or font URLs. Finally, it runs the desktop syntax check and installer self-test.

## Code style

- **Python:** 3.12, type hints everywhere, `from __future__ import annotations`, and a short module docstring that says what the module is responsible
  for. Match the surrounding style (lines up to about 150 characters, f-strings, small helper functions). No new runtime dependency without discussion,
  because each one has to work offline and inside PyInstaller.
- **TypeScript/React:** strict TypeScript, function components, TanStack Query for server state. Put every user-facing string in `web/src/lib/i18n.tsx`
  (en/hi/kn).
- **Electron:** keep `contextIsolation` on and `nodeIntegration` off. Only allow navigation to the configured server origin. Add no telemetry and no
  remote code.

## Rules that are not negotiable

1. **Access decisions stay in host code.** Never let the LLM decide, or supply inputs to, the policy engine. New data paths must go through
   `pdp.decide(...)` before content reaches the model or the UI.
2. **No invented numbers.** Do not hard-code metrics, baselines or plant values. Show only measured values or sourced public data, and return null or
   "missing" otherwise.
3. **Provenance.** Anything the team writes as sample plant data is marked EXAMPLE: watermarked, with `is_example` set and a badge in the UI.
   Every MRPL public fact carries its source URL.
4. **Audit.** Every new security-relevant action writes an audit event.
5. **Offline.** No outbound network calls at runtime. The offline guard will block them anyway.
6. **Role boundaries.** Only HODs manage documents (own department). Only admins change LLM settings.
