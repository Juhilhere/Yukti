"""Central configuration for the Yukti backend (demo tier)."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # E:\SIH-2026-PS2\yukti
BACKEND = ROOT / "backend"
DATA = ROOT / "data"
STORE = DATA / "store"
BLOBS = STORE / "blobs"
REPORTS = STORE / "reports"
CORPUS = DATA / "corpus"
WEB_DIST = ROOT / "web" / "dist"
DB_PATH = STORE / "yukti.db"
LOG_DIR = STORE / "logs"
MODELS_DIRS = [
    ROOT / "models",
    Path.home() / ".lmstudio" / "models",
]
for p in (STORE, BLOBS, REPORTS, LOG_DIR, ROOT / "models"):
    p.mkdir(parents=True, exist_ok=True)

VERSION = "0.1.0-demo"
TIER = os.environ.get("YUKTI_TIER", "demo")
DEMO_MODE = TIER in ("demo", "dev")

API_HOST = "127.0.0.1"
API_PORT = int(os.environ.get("YUKTI_PORT", "8000"))

LLAMA_BINARIES = {
    "cuda": os.environ.get("YUKTI_LLAMA_CUDA", "E:/tools/llama-cuda/llama-server.exe"),
    "vulkan": shutil.which("llama-server") or "llama-server",
}
LLAMA_SERVER = LLAMA_BINARIES["cuda"] if Path(LLAMA_BINARIES["cuda"]).exists() else LLAMA_BINARIES["vulkan"]
LLAMA_PORT = 8080
BIONIC_URL = os.environ.get("YUKTI_BIONIC_URL", "http://127.0.0.1:1234/v1")
VLLM_URL = os.environ.get("YUKTI_VLLM_URL", "http://127.0.0.1:8001/v1")

IDLE_TIMEOUT_S = 30 * 60
ABS_TIMEOUT_S = 10 * 60 * 60
LOCK_THRESHOLD = 5
LOCK_WINDOW_S = 15 * 60

# Reference "now" for the synthetic plant (ledger expiry calculations use real today).
CLEARANCE_LABELS = {0: "PUBLIC", 1: "INTERNAL", 2: "RESTRICTED", 3: "CONFIDENTIAL", 4: "SECRET"}
CLEARANCE_BY_LABEL = {v: k for k, v in CLEARANCE_LABELS.items()}
