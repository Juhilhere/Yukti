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
FROZEN = bool(getattr(sys, "frozen", False))
_APPDATA = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "Yukti"


def _default_store() -> Path:
    """Runtime data (database, uploads, logs, backups).

    Packaged builds keep data in %LOCALAPPDATA%\Yukti\data, outside the program folder, so that
    - the program folder may be read-only (e.g. extracted under C:\Program Files), and
    - replacing the folder with a newer version's zip keeps all data.
    An existing database inside the program folder (servers set up by older versions) keeps being used."""
    legacy = DATA / "store"
    if not FROZEN or (legacy / "yukti.db").exists():
        return legacy
    return _APPDATA / "data"


STORE = Path(os.environ["YUKTI_STORE"]) if os.environ.get("YUKTI_STORE") else _default_store()
BLOBS = STORE / "blobs"
REPORTS = STORE / "reports"
CORPUS = DATA / "corpus"
WEB_DIST = ROOT / "web" / "dist"
DB_PATH = STORE / "yukti.db"
LOG_DIR = STORE / "logs"
POLICY_FILE = ROOT / "backend" / "policies" / "core.yaml"
for p in (STORE, BLOBS, REPORTS, LOG_DIR):
    p.mkdir(parents=True, exist_ok=True)


def _writable(d: Path) -> bool:
    try:
        d.mkdir(parents=True, exist_ok=True)
        probe = d / ".yukti-write-test"
        probe.write_text("ok")
        probe.unlink()
        return True
    except OSError:
        return False


# models imported by the administrator go next to the bundled ones when possible, else to the user's app-data folder
USER_MODELS = ROOT / "models" if _writable(ROOT / "models") else _APPDATA / "models"
USER_MODELS.mkdir(parents=True, exist_ok=True)
MODELS_DIRS = list(dict.fromkeys([ROOT / "models", USER_MODELS, Path.home() / ".lmstudio" / "models"]))

# the pre-trained Laya router ships inside the package; copy it into a data folder that lives elsewhere
_SHIPPED_LAYA = DATA / "store" / "laya"
if _SHIPPED_LAYA.exists() and STORE.resolve() != (DATA / "store").resolve() and not (STORE / "laya").exists():
    shutil.copytree(_SHIPPED_LAYA, STORE / "laya")

VERSION = "0.5.0"
# Production by default. Demonstration mode (sample accounts listed on the login page, rehearsal reset) is enabled only
# explicitly: YUKTI_TIER=demo, or a file named DEMO_MODE in the install folder (delete it for production use).
TIER = os.environ.get("YUKTI_TIER") or ("demo" if (ROOT / "DEMO_MODE").exists() else "prod")
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
