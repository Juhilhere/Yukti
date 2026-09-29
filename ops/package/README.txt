YUKTI SERVER 0.4.0 — self-contained, fully offline
===================================================
Nothing else needs to be installed: no Python, no Bionic/LM Studio, no Ollama, no vLLM, no internet.

Contents
  yukti-server.exe + _internal\      Yukti backend (auth, policy engine, audit, RAG, OCR, Laya, optimizer)
  llama\cuda\                         llama.cpp b11255 CUDA 12.4 build (NVIDIA GPUs)  — used automatically when an NVIDIA GPU is present
  llama\vulkan\                       llama.cpp b11255 Vulkan build (AMD/Intel GPUs, or CPU)
  models\                             open-weight GGUF models (default: Gemma-2-2B-it Q8_0). Add more via Admin > Models.
  data\store\laya\                    Laya router (pre-trained, ONNX Runtime)
  data\mrpl\                          MRPL public information with source links
  data\corpus\                        15 EXAMPLE plant documents (watermarked; delete in Admin/Knowledge when real data is added)
  web\dist\                           the Yukti user interface
  backend\policies\core.yaml          access-control and company-guardrail policy

Run
  Normally you do not start this folder yourself: Yukti.exe (one folder up) starts and stops it automatically.
  "Start Yukti Server.cmd"              - run only the server on this PC (opens it in the browser)
  "Start Yukti Server (Plant LAN).cmd"  - serve other PCs on the plant network; on employee PCs open Yukti.exe >
                                          File > Switch server > Connect, and enter http://<server>:8000

Data (database, documents, logs, backups) is stored in %LOCALAPPDATA%\Yukti\data, not in this folder, so a newer
version can replace the folder without losing anything. The first start loads the default model on the GPU.

Demonstration mode vs production
  If a file named DEMO_MODE is present in this folder, Yukti runs in demonstration mode: the login page lists the
  sample accounts (Team UniMinds personas, e.g. admin / Admin@2026) and Admin > Backup offers "Reset demonstration state".
  For production use, DELETE the DEMO_MODE file before the first start: every seeded account must then change its
  password at first login, and no passwords are shown anywhere.

Security
  Fully offline: an egress guard blocks every outbound connection except the local AI engine; the UI has a strict
  Content-Security-Policy. The local AI engine (llama-server) listens on 127.0.0.1 only, on a random port, with a
  random per-load key. Access follows department, clearance (rank), assigned plant units and time-bound grants;
  every decision is written to the hash-chained audit log.
  On the plant LAN, serve HTTPS with your organisation's certificate:
    yukti-server.exe --host 0.0.0.0 --port 8443 --tls-cert C:\certs\yukti.pem --tls-key C:\certs\yukti.key
  (the session cookie is then marked Secure). Clients must trust the certificate's issuing CA.
Only Heads of Department can add documents, and only for their own department. Administrators manage users, models and AI settings.
