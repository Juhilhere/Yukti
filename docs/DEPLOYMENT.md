# Deploying Yukti

Yukti 0.5.1 runs on Windows 10/11 (64-bit) and ships as a one-click Windows installer, `Yukti-Setup.exe` (see the [README](../README.md#get-started)).
There are two ways to run it:

- **Plant server.** One Yukti Server on a GPU machine in the plant network. Employees use the Yukti desktop app (or a browser) to connect.
- **All-in-one.** Yukti Server and the desktop app on the same PC. This suits a laptop, a demo or a small team.

Both use the same self-contained **Yukti Server package**. No Python, Bionic/LM Studio, Ollama, vLLM or internet access is needed at runtime.

## 1. Hardware sizing

| | Laptop / single user | Plant GPU server |
|---|---|---|
| Purpose | Demo, evaluation, one engineer | Many concurrent employees on the LAN |
| GPU | Any NVIDIA GPU with about 6 GB VRAM runs the default Gemma-3-4B-it Q4_K_M (with photos) and Whisper voice input together. AMD/Intel GPUs work through Vulkan. CPU-only works but is slower. | A data-centre or workstation NVIDIA GPU with more VRAM. This allows larger GGUF models, longer context and more parallel slots. |
| Memory | 8 GB RAM minimum, 16 GB recommended | Enough RAM for the model if it is partly offloaded, plus OCR during uploads |
| Disk | Package + model + documents (the download page shows the exact size) | Also plan space for documents, backups and additional models |
| Network | Local only (`127.0.0.1`) | Fixed IP or DNS name; TCP 8000 open **to the plant subnet only** |

**Measured** on an RTX 4050 laptop GPU (6 GB), Gemma-2-2B-it Q8_0:

| Backend | Generation | TTFT |
|---|---|---|
| llama.cpp CUDA 12.4 | 51.7 tok/s | 0.2 s |
| llama.cpp Vulkan | 50.8 tok/s | not recorded |
| CPU only | 13.4 tok/s | not recorded |

**Measured** on the same GPU with the default Gemma-3-4B-it Q4_K_M (0.5.x): 44–58 tok/s generation; Gemma 3 together with Whisper
large-v3-turbo voice input uses 5.1 of 6 GB video memory.

We have not benchmarked plant-server hardware. The Performance Engine's 8B and 27B profiles are *reference* starting points until an
administrator validates them on your server (see [ADMIN_GUIDE.md](ADMIN_GUIDE.md#performance-engine-profiles)). After deployment, **Admin → Usage & Health** shows tok/s, TTFT and p95 TTFT measured on your own server.

## 2. The server package

Built with `ops\build-release.ps1` (see §5). Output: `E:\yukti-build\Yukti-Server-0.5.1\`

```
yukti-server.exe, _internal\        Yukti backend (PyInstaller)
llama\cuda\                          llama.cpp b11255, CUDA 12.4 (used automatically on NVIDIA GPUs)
llama\vulkan\                        llama.cpp b11255, Vulkan (AMD/Intel GPUs, or CPU)
models\gemma-3-4b-it-GGUF\           default model, Gemma-3-4B-it Q4_K_M + image module (mmproj) for photos
speech\cuda\, speech\cpu\            voice input: whisper.cpp b5130 whisper-server (NVIDIA GPU / processor)
speech\models\                       Whisper large-v3-turbo q5_0 (GPU) and small q8_0 (processor)
data\store\laya\                     pre-trained Laya router (ONNX)
data\mrpl\, data\structured\         MRPL public research; example structured data
data\corpus\                         15 EXAMPLE documents (watermarked)
web\dist\                            user interface
backend\policies\core.yaml           access-control and guardrail policy
Start Yukti Server.cmd               this PC only (127.0.0.1:8000)
Start Yukti Server (Plant LAN).cmd    all interfaces (0.0.0.0:8000)
README.txt, models\MODELS.txt
```

Copy the folder to the server, for example `D:\Yukti\Server`, and run one of the `.cmd` files. On first start the server creates
`data\store\` (database, documents, logs, backups), seeds the demo data and example documents (about 30 s), and loads the default model on the GPU.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `YUKTI_TIER` | `prod` (or `demo` when a `DEMO_MODE` file is in the install folder) | `demo` shows sample accounts and passwords on the login screen and enables the rehearsal reset. Never use it in production. |
| `YUKTI_TLS_CERT`, `YUKTI_TLS_KEY` | — | PEM certificate and key: serve HTTPS (same as `--tls-cert` / `--tls-key`). |
| `YUKTI_HOST` / `YUKTI_PORT` | `127.0.0.1` / `8000` | Bind address (also `--host` / `--port` on `yukti-server.exe`) |
| `YUKTI_HOME` | folder of `yukti-server.exe` | Installation root |
| `YUKTI_STORE` | `<root>\data\store` | Runtime data (put it on a BitLocker-protected volume) |
| `YUKTI_AUTOLOAD` | `1` | `0` skips auto-loading the model at start |
| `YUKTI_LLAMA_CUDA` / `YUKTI_LLAMA_VULKAN` | bundled builds | Use a different `llama-server.exe` |
| `YUKTI_BIONIC_URL` / `YUKTI_VLLM_URL` | `http://127.0.0.1:1234/v1` / `http://127.0.0.1:8001/v1` | Optional external OpenAI-compatible engines |
| `YUKTI_EMBED_URL` | — | Optional local OpenAI-compatible `/v1/embeddings` server for BGE-M3 vector search (its host is allowed through the offline guard). See §10. |

For example, a production start on the LAN:

```bat
set YUKTI_TIER=prod
yukti-server.exe --host 0.0.0.0 --port 8000
```

## 3. Plant LAN mode

1. Run `Start Yukti Server (Plant LAN).cmd`. It listens on `0.0.0.0:8000`.
2. Allow TCP 8000 **for the plant subnet only** (run as administrator):

   ```powershell
   New-NetFirewallRule -DisplayName "Yukti Server" -Direction Inbound -Protocol TCP -LocalPort 8000 `
     -RemoteAddress 10.20.0.0/16 -Action Allow -Profile Domain,Private
   ```

   Replace `10.20.0.0/16` with your plant subnet. Do not expose the server to the internet.
3. The bundled `llama-server` listens on `127.0.0.1:8080` only. Do **not** open 8080.
4. Yukti serves plain HTTP. On a shared network, put a TLS-terminating reverse proxy in front, or place the server on a segregated VLAN
   (see [SECURITY_MODEL.md §10](SECURITY_MODEL.md#10-known-limitations)).
5. To run it as a service, use Task Scheduler "At startup", running `Start Yukti Server (Plant LAN).cmd` under a dedicated service account.

From a source checkout, the equivalent is `.\ops\start-server.ps1 -Lan`, and `.\ops\stop.ps1` stops it.

## 4. Desktop app (the single zip)

Every PC uses the same file, `Yukti-0.5.1-Windows.zip`: extract it and open `Yukti.exe`. It needs no admin rights, creates Desktop and
Start-menu shortcuts on first start, and keeps data in `%LOCALAPPDATA%\Yukti` (settings in `%APPDATA%\Yukti`).

| Use | What happens |
|---|---|
| **All-in-one (default)** | `Yukti.exe` finds the bundled `server\` folder, starts it, shows the start-up steps and opens Yukti. It stops the server when you quit. |
| **Employee PC in a plant deployment** | **File → Switch server → Connect to our plant Yukti server**, enter `http://<server>:8000`, **Test connection**. |

A browser pointed at `http://<server>:8000` works as well. Remove Yukti by deleting the folder, the shortcuts and `%LOCALAPPDATA%\Yukti`.

## 5. Website release (one zip)

```powershell
.\ops\build-release.ps1          # server package, demo build (add -Production for a build without sample accounts)
.\ops\release-site.ps1            # -> E:\yukti-build\publish\ : index.html, Yukti-0.5.1-Windows.zip, .sha256
python ops\serve_site.py E:\yukti-build\publish --port 9000     # optional local test
```

Upload the contents of `E:\yukti-build\publish\` to your website. The page shows one **Download Yukti** button, the SHA-256 and the three
steps. Serve it over **HTTPS**. (GitHub release assets are limited to 2 GB per file, so host the 3.5 GB zip on your own site.)

Build machine requirements: uv, Node 22, the extracted llama.cpp CUDA and Vulkan release folders, and the GGUF model (see the parameters at the top of
`ops\build-release.ps1`). The Python dependencies come from `backend\pyproject.toml` / `uv.lock`; since 0.5.1 they include **python-pptx**
(PowerPoint deliverables; it brings in XlsxWriter). Run `uv sync` in `backend\` after pulling, so the frozen server includes it.

## 6. Updates

- **Single zip.** Take a backup (§7), quit Yukti, extract the new version's zip and open its `Yukti.exe`. Data lives in
  `%LOCALAPPDATA%\Yukti`, so nothing is lost; the shortcuts are repointed to the new folder automatically. Delete the old folder afterwards.
- **Plant server.** Same: stop the server, extract the new zip, start `server\Start Yukti Server (Plant LAN).cmd` from it. Servers set up by
  older versions keep using their `data\store\` folder (copy it into the new `server\data\store\` to carry it over).
- **Models.** Use **Admin → Models → Import from path** to add GGUF files from a USB drive or share. No reinstall is needed.

## 7. Backups and restore

- **Admin → Backup & Export → Create backup** writes `data\store\backups\yukti-backup-<timestamp>.zip`. It contains a consistent database
  snapshot and the document blobs, and its SHA-256 is recorded in the audit log. Download it and store it off-server as sensitive data.
- **Restore** stages the backup. **Restart the server** to apply it: the database and documents are replaced at start-up before anything else opens them.
- **Audit export.** Auditors can download the audit log as CSV or JSONL from **Audit** or **Admin → Backup & Export**.

## 8. Reset

| Goal | How |
|---|---|
| Rehearsal reset (keep data; revoke grants, clear access requests, reopen findings) | Admin: `POST /api/admin/demo/reset` |
| Full reset to a fresh install | Stop the server, delete the contents of `data\store\` **except `laya\`** (if you delete it, Laya is retrained at start), then start again. Everything reseeds. |
| From a source checkout | `.\ops\stop.ps1`, delete `data\store\`, `.\ops\start.ps1` |

## 9. Troubleshooting

| Symptom | Check |
|---|---|
| Engine shows `error` right after loading | Usually out of VRAM. In **Admin → Models**, lower the context size or the GPU layers. **Developer** logs show the `llama-server` output. |
| "automatic restart stopped" | The watchdog restarted a crashed engine 3 times within 10 minutes. Fix the load settings, then reload the model. |
| Desktop app cannot connect | Server running with the LAN script? Firewall rule? Try `http://<server>:8000/api/health` in a browser. |
| SmartScreen warning | The installer and server are not code-signed yet. Verify the SHA-256 shown on the download page. |
| Slow first answer | The model is still loading. Chats wait (up to 120 s) and continue when the engine is ready. |
| Answer says another model served the worker | Only one llama.cpp model is resident on a GPU. Load the model assigned to that worker, or remove the assignment (**Admin → AI settings → Worker models**). |
| Vector search shows *off* | No GGUF with `bge-m3` in its name was found in a models folder and `YUKTI_EMBED_URL` is not set. Add one and restart. |

## 10. Optional components

None of these is needed to run Yukti. Each one adds a capability and is picked up from a known place; nothing is downloaded by itself.

| Component | What it adds | How to install |
|---|---|---|
| **BGE-M3 embedding model** (BAAI, GGUF) | Multilingual meaning-based (dense vector) search alongside BM25, tags, metadata and the knowledge graph | Put a GGUF whose file name contains `bge-m3` into the Yukti `models` folder (or the LM Studio models folder) and restart. Yukti starts a second llama.cpp server in embedding mode on 127.0.0.1 and embeds every passage in the background. Or set `YUKTI_EMBED_URL` to an existing local embeddings server. Plan extra video memory for it. |
| **Research model** (any GGUF, different from the production model) | The isolated research layer for experimental models (`researcher` role only) | Import it under **Admin → Models**, then choose it under **Admin → Research layer** and press Start. It runs in its own llama.cpp process on 127.0.0.1 (4096 context) and needs its own memory. Or point the research layer at a model server already running on this machine. |
| **AI4Bharat IndicWhisper speech models** (ggml conversions) | Hindi and Kannada voice input recognised by AI4Bharat's models; whisper.cpp with OpenAI Whisper stays the default engine | Copy `ggml-indicwhisper-hi.bin` and/or `ggml-indicwhisper-kn.bin` into `speech\models\`. Used when speech is detected as that language; Yukti falls back to Whisper if they cannot start. |
| **27B-class reasoning model** (GGUF, quantized) | A stronger model for the *reasoning* worker (synthesis, root cause, comparisons) | Import it, load it with a `reasoning-27b-12gb`, `-16gb` or `-24gb` Performance Engine profile (or *auto*), assign it to the reasoning worker in **Admin → AI settings → Worker models**, and press **Validate** to record what it achieves on your GPU. The 27B profiles are reference settings that we have not measured. One llama.cpp model is resident per GPU, so while the 27B model is loaded it also serves the other workers (and says so). |

## 11. Phased rollout

The rollout plan. Each phase builds on the one before. The software each phase uses (cited retrieval, scan-to-finding,
approver lanes, the asset ledger, the production plan) is already in 0.5.1; the phases widen the scope, the data and the people involved.

| Phase | Scope | What to set up |
|---|---|---|
| **1 · Pilot** | One unit's maintenance knowledge: equipment dossiers, SOPs and drawings, with identity-aware RAG and citations. | One server, the unit's users with correct departments, clearances and asset scopes, the unit's HODs uploading their documents, and the asset master for the unit. Measure tok/s and TTFT on your hardware (**Admin → Usage & health**, profile **Validate**) and calibrate Laya against your own logged queries (**Admin → Policies & Laya → Benchmark**). |
| **2 · Workflows** | Scan-to-finding pipeline, approval routing, the digital asset ledger and expiry alerts. | Give `scan.review`, `approver:<lane>` and `stores` roles; register assets and ledger entries; check that every lane has an approver and an escalation path. |
| **3 · Planning** | Production intelligence with planners, on authorised historical and market data. | Planners enter the plant model (units, yields, capacities, prices or crack spreads, inventory, limits, demand history). The optimizer calculates, the LLM explains, planners decide. |
| **4 · Scale** | Plant-wide rollout, and a template for other refineries and PSUs with the same sovereignty needs. | A plant GPU server sized for concurrent users (consider the vLLM engine for multi-user serving), BGE-M3 vectors, the reasoning model, IndicWhisper speech, and the plant's own IAM import. Keep the policy file, roles and lanes as the template. |

