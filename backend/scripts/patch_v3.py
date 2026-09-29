"""v0.3 patch: self-contained bundle paths, auto GPU backend, HOD-only uploads."""
from pathlib import Path

app = Path(__file__).resolve().parents[1] / "app"


def patch(fn: str, pairs: list[tuple[str, str]]) -> None:
    p = app / fn
    s = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert old in s, f"{fn}: anchor not found: {old[:80]!r}"
        s = s.replace(old, new, 1)
    p.write_text(s, encoding="utf-8")
    print("patched", fn)


patch("config.py", [
    ('''ROOT = Path(__file__).resolve().parents[2]          # E:\\SIH-2026-PS2\\yukti''',
     '''import sys

# ROOT = Yukti installation folder. Frozen bundle: folder of yukti-server.exe; dev: repository root.
ROOT = Path(os.environ.get("YUKTI_HOME") or (Path(sys.executable).parent if getattr(sys, "frozen", False)
                                               else Path(__file__).resolve().parents[2]))'''),
    ('''MODELS_DIRS = [
    ROOT / "models",''', '''POLICY_FILE = ROOT / "backend" / "policies" / "core.yaml"
MODELS_DIRS = [
    ROOT / "models",'''),
    ('''LLAMA_BINARIES = {
    "cuda": os.environ.get("YUKTI_LLAMA_CUDA", "E:/tools/llama-cuda/llama-server.exe"),
    "vulkan": shutil.which("llama-server") or "llama-server",
}
LLAMA_SERVER = LLAMA_BINARIES["cuda"] if Path(LLAMA_BINARIES["cuda"]).exists() else LLAMA_BINARIES["vulkan"]''',
     '''def _first(*cands: str | Path | None) -> str:
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


LLAMA_SERVER = LLAMA_BINARIES[pick_backend()] or "llama-server"'''),
    ('''VERSION = "0.2.0"''', '''VERSION = "0.3.0"'''),
])

patch("policy.py", [
    ('''POLICY_FILE = Path(__file__).resolve().parents[1] / "policies" / "core.yaml"''',
     '''from .config import POLICY_FILE'''),
])

patch("engine.py", [
    ('''    binary = LLAMA_BINARIES.get(cfg.get("backend") or "cuda", LLAMA_SERVER)
    if not Path(binary).exists() and not Path(binary).with_suffix(".exe").exists() and binary != LLAMA_BINARIES["vulkan"]:
        binary = LLAMA_SERVER''', '''    from .config import pick_backend
    backend = pick_backend(cfg.get("backend"))
    binary = LLAMA_BINARIES.get(backend) or LLAMA_SERVER
    log(f"Compute backend: {backend} ({binary})")'''),
    ('''    load("llamacpp", pick["id"], {"backend": "cuda", "ctx_size": 16384,''', '''    load("llamacpp", pick["id"], {"backend": "auto", "ctx_size": 16384,'''),
])

patch("llm_params.py", [
    ('''f("backend", "Compute backend", "GPU & Offload", "select", "cuda", "llama.cpp build to use: CUDA (NVIDIA, fastest) or Vulkan (any GPU incl. AMD iGPU).", [L], options=[{"value": "cuda", "label": "CUDA 12.4 (NVIDIA)"}, {"value": "vulkan", "label": "Vulkan"}]),''',
     '''f("backend", "Compute backend", "GPU & Offload", "select", "auto", "Bundled llama.cpp build: auto (CUDA if an NVIDIA GPU is present, else Vulkan), CUDA 12.4 (NVIDIA) or Vulkan (AMD/Intel GPUs; CPU when GPU layers = 0).", [L], options=[{"value": "auto", "label": "Auto-detect"}, {"value": "cuda", "label": "CUDA 12.4 (NVIDIA)"}, {"value": "vulkan", "label": "Vulkan / CPU"}]),'''),
])

patch("auth.py", [
    ('''    "engineer": ["documents.upload", "findings.view"],
    "hse": ["documents.upload", "findings.view"],''', '''    "engineer": ["findings.view"],
    "hse": ["findings.view"],'''),
    ('''    "plant_manager": ["access.approve", "findings.view", "findings.approve", "audit.view", "production.view", "documents.upload"],''',
     '''    "plant_manager": ["access.approve", "findings.view", "findings.approve", "audit.view", "production.view"],'''),
    ('''    "admin": ["models.manage", "admin", "audit.view", "production.view", "production.edit", "documents.upload", "findings.view",''',
     '''    "admin": ["models.manage", "admin", "audit.view", "production.view", "production.edit", "findings.view",'''),
])

patch("admin.py", [
    ('''    "dept_manager": "Department manager — approves access requests for the department, sees audit for own department",''',
     '''    "dept_manager": "Head of Department (HOD) — the only role that adds/removes documents (own department), approves access requests",'''),
    ('''    audit.write(actor, "admin.user.created", f"user:{username}", {"department": body.get("department"), "roles": body.get("roles")})''',
     '''    _sync_hod(uid)
    audit.write(actor, "admin.user.created", f"user:{username}", {"department": body.get("department"), "roles": body.get("roles")})'''),
    ('''    if fields["status"] == "disabled":''', '''    _sync_hod(uid)
    if fields["status"] == "disabled":'''),
    ('''def _temp_password() -> str:''', '''def _sync_hod(uid: str) -> None:
    """A user holding the HOD role becomes the approver of their department."""
    u = q1("SELECT * FROM users WHERE id=?", (uid,))
    if u and "dept_manager" in uj(u["roles_json"], []) and u["status"] == "active":
        ex("UPDATE departments SET manager_user_id=? WHERE code=? OR name=?", (uid, u["department"], u["department"]))


def _temp_password() -> str:'''),
])

patch("main.py", [
    ('''    cl = CLEARANCE_BY_LABEL.get(classification.upper(), 1)
    if cl > ctx.subject.clearance:
        raise err(403, "policy_denied", "You cannot upload above your own clearance.")
    did = rag.create_document({"title": title or Path(file.filename or "upload").stem, "doc_type": doc_type, "department": department,''',
     '''    cl = CLEARANCE_BY_LABEL.get(classification.upper(), 1)
    if cl > ctx.subject.clearance:
        raise err(403, "policy_denied", "You cannot upload above your own clearance.")
    department = ctx.user["department"]  # HODs add data only for their own department
    did = rag.create_document({"title": title or Path(file.filename or "upload").stem, "doc_type": doc_type, "department": department,'''),
    ('''    ctx.require("documents.upload")
    _doc_or_403(did, ctx)
    for c in q(''', '''    ctx.require("documents.upload")
    d = _doc_or_403(did, ctx)
    if d["department"] != ctx.user["department"] or d.get("is_public"):
        raise err(403, "policy_denied", "HODs can remove only their own department's documents.")
    for c in q('''),
])
