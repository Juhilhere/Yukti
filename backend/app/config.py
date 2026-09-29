"""Central configuration for the Yukti backend (demo tier)."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

import sys

# ROOT = Yukti installation folder. Frozen bundle: folder of yukti-server.exe; dev: repository root.
ROOT = Path(os.environ.get("YUKTI_HOME") or (Path(sys.executable).parent if getattr(sys, "frozen", False)
                                               else Path(__file__).resolve().parents[2]))
BACKEND = ROOT / "backend"
DATA = ROOT / "data"
STORE = Path(os.environ["YUKTI_STORE"]) if os.environ.get("YUKTI_STORE") else DATA / "store"  # runtime data (DB, uploads, logs)
BLOBS = STORE / "blobs"
REPORTS = STORE / "reports"
CORPUS = DATA / "corpus"
WEB_DIST = ROOT / "web" / "dist"
DB_PATH = STORE / "yukti.db"
LOG_DIR = STORE / "logs"
POLICY_FILE = ROOT / "backend" / "policies" / "core.yaml"
MODELS_DIRS = [
    ROOT / "models",
    Path.home() / ".lmstudio" / "models",
]
for p in (STORE, BLOBS, REPORTS, LOG_DIR, ROOT / "models"):
    p.mkdir(parents=True, exist_ok=True)

VERSION = "0.3.0"
TIER = os.environ.get("YUKTI_TIER", "demo")
DEMO_MODE = TIER in ("demo", "dev")

API_HOST = os.environ.get("YUKTI_HOST", "127.0.0.1")  # 0.0.0.0 to serve employee desktop clients on the plant LAN
API_PORT = int(os.environ.get("YUKTI_PORT", "8000"))

def _first(*cands: str | Path | None) -> str:
    for c in cands:
        if c and Path(c).exists():
            return str(c)
    return ""


# Bundled llama.cpp builds first (shipped with Yukti), then dev locations. No external runtime (Bionic/Ollama/vLLM) required.
LLAMA_BINARIES = {
    "cuda": _first(os.environ.get("YUKTI_LLAMA_CUDA"), ROOT / "llama" / "cuda" / "llama-server.exe", "E:/tools/llama-cuda/llama-server.exe"),
    "vulkan": _first(os.environ.get("YUKTI_LLAMA_VULKAN"), ROOT / "llama" / "vulkan" / "llama-server.exe", shutil.which("llama-server")),
}


def has_nvidia_gpu() -> bool:
    try:
        import pynvml
        pynvml.nvmlInit()
        return pynvml.nvmlDeviceGetCount() > 0
    except Exception:
        return False


def pick_backend(requested: str | None = None) -> str:
    """auto → CUDA when an NVIDIA GPU and the CUDA build exist, else Vulkan (AMD/Intel GPUs, or CPU with 0 GPU layers)."""
    if requested in ("cuda", "vulkan") and LLAMA_BINARIES.get(requested):
        return requested
    if LLAMA_BINARIES["cuda"] and has_nvidia_gpu():
        return "cuda"
    return "vulkan" if LLAMA_BINARIES["vulkan"] else "cuda"


LLAMA_SERVER = LLAMA_BINARIES[pick_backend()] or "llama-server"
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
