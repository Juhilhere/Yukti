YUKTI SERVER 0.3.0 — self-contained, fully offline
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
  "Start Yukti Server.cmd"              — this PC only (also used by the desktop app's All-in-one mode)
  "Start Yukti Server (Plant LAN).cmd"  — serve employee desktop clients on the plant network
  Employees install Yukti-Setup-0.3.0.exe and connect to http://<server>:8000

First start creates data\store\ (database, documents, logs, backups) and loads the default model on the GPU.
Only Heads of Department can add documents, and only for their own department. Administrators manage users, models and AI settings.
