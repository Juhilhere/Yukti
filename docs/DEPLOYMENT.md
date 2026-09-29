# Deploying Yukti

Yukti 0.3.0 runs on Windows 10/11 (64-bit). There are two ways to run it:

- **Plant server.** One Yukti Server on a GPU machine in the plant network. Employees use the Yukti desktop app (or a browser) to connect.
- **All-in-one.** Yukti Server and the desktop app on the same PC. This suits a laptop, a demo or a small team.

Both use the same self-contained **Yukti Server package**. No Python, Bionic/LM Studio, Ollama, vLLM or internet access is needed at runtime.

## 1. Hardware sizing

| | Laptop / single user | Plant GPU server |
|---|---|---|
| Purpose | Demo, evaluation, one engineer | Many concurrent employees on the LAN |
| GPU | Any NVIDIA GPU with about 6 GB VRAM runs the default Gemma-2-2B-it Q8_0 comfortably. AMD/Intel GPUs work through Vulkan. CPU-only works but is slower. | A data-centre or workstation NVIDIA GPU with more VRAM. This allows larger GGUF models, longer context and more parallel slots. |
| Memory | 8 GB RAM minimum, 16 GB recommended | Enough RAM for the model if it is partly offloaded, plus OCR during uploads |
| Disk | Package + model + documents (the download page shows the exact size) | Also plan space for documents, backups and additional models |
| Network | Local only (`127.0.0.1`) | Fixed IP or DNS name; TCP 8000 open **to the plant subnet only** |

**Measured** on an RTX 4050 laptop GPU (6 GB), Gemma-2-2B-it Q8_0:

| Backend | Generation | TTFT |
|---|---|---|
| llama.cpp CUDA 12.4 | 51.7 tok/s | 0.2 s |
| llama.cpp Vulkan | 50.8 tok/s | not recorded |
| CPU only | 13.4 tok/s | not recorded |

We have not benchmarked plant-server hardware. After deployment, **Admin → Usage & Health** shows tok/s, TTFT and p95 TTFT measured on your own server.

## 2. The server package

Built with `ops\build-release.ps1` (see §6). Output: `E:\yukti-build\Yukti-Server-0.3.0\`

```
yukti-server.exe, _internal\        Yukti backend (PyInstaller)
llama\cuda\                          llama.cpp b11255, CUDA 12.4 (used automatically on NVIDIA GPUs)
llama\vulkan\                        llama.cpp b11255, Vulkan (AMD/Intel GPUs, or CPU)
models\gemma-2-2b-it-GGUF\           default model, Gemma-2-2B-it Q8_0
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
| `YUKTI_TIER` | `demo` | **Set to `prod` for any real deployment.** `demo` shows demo accounts and passwords on the login screen. |
| `YUKTI_HOST` / `YUKTI_PORT` | `127.0.0.1` / `8000` | Bind address (also `--host` / `--port` on `yukti-server.exe`) |
| `YUKTI_HOME` | folder of `yukti-server.exe` | Installation root |
| `YUKTI_STORE` | `<root>\data\store` | Runtime data (put it on a BitLocker-protected volume) |
| `YUKTI_AUTOLOAD` | `1` | `0` skips auto-loading the model at start |
| `YUKTI_LLAMA_CUDA` / `YUKTI_LLAMA_VULKAN` | bundled builds | Use a different `llama-server.exe` |
| `YUKTI_BIONIC_URL` / `YUKTI_VLLM_URL` | `http://127.0.0.1:1234/v1` / `http://127.0.0.1:8001/v1` | Optional external OpenAI-compatible engines |

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

## 4. Desktop clients

Install `Yukti-Setup-0.3.0.exe` on each employee PC. It is a per-user NSIS installer, needs no admin rights, and creates Start-menu and desktop shortcuts.
On first start the user chooses one of these:

| Choice | When |
|---|---|
| **Connect to our plant Yukti server** | Normal plant deployment. Enter `http://<server>:8000` and press **Test connection**. |
| **Install Yukti on this PC** | All-in-one. Downloads the server components from the website manifest into `%LOCALAPPDATA%\Yukti\Server`. |
| **Use an existing Yukti Server folder** | All-in-one with a package copied by USB or a network share |

A browser pointed at `http://<server>:8000` works as well.

## 5. Website release (one-click install)

```powershell
# 1. build the server package and the desktop installer
.\ops\build-release.ps1          # -> E:\yukti-build\Yukti-Server-0.3.0\ and desktop\dist\Yukti-Setup-0.3.0.exe

# 2. bake the site URL into the desktop app, split and hash components, write manifest.json + index.html
.\ops\release-site.ps1 -SiteUrl "https://www.example.com/yukti/"          # add -PartMB 95 for 100 MB host limits

# 3. test locally (build with -SiteUrl http://127.0.0.1:9000/ for this)
python ops\serve_site.py E:\yukti-build\publish --port 9000

# 4. upload everything in E:\yukti-build\publish\ to the site URL, keeping the folder structure
```

`E:\yukti-build\publish\` contains `index.html` (the download page), `Yukti-Setup-0.3.0.exe`, `manifest.json` and `files\*.partNN`.
Users click **Download Yukti**, run the installer and choose **Install Yukti on this PC**. The app then:

- downloads the CUDA runtime only on PCs with an NVIDIA GPU,
- resumes interrupted downloads,
- verifies every part and every component with SHA-256,
- installs, starts the server and opens Yukti.

Serve the site over **HTTPS**. The manifest is the root of trust for the downloaded components.

Build machine requirements: uv, Node 22, the extracted llama.cpp CUDA and Vulkan release folders, and the GGUF model (see the parameters at the top of
`ops\build-release.ps1`).

## 6. Updates

- **Website installs.** Publish a new release to the same URL. Users choose **Install Yukti on this PC** again. Components whose SHA-256 is
  unchanged are skipped, so only what changed is downloaded. `data\store\` is never touched.
- **Plant server.** Take a backup (§7). Stop the server, replace everything in the package folder **except `data\store\`**, and start it again.
  Then update the desktop clients by running the new `Yukti-Setup-<ver>.exe`.
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
