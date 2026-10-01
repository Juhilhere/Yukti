"""Inference engines: a Yukti-managed llama-server process + OpenAI-compatible connectors (Bionic, vLLM, remote)."""
from __future__ import annotations

import asyncio
import collections
import json
import re
import secrets
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, AsyncIterator

import httpx

from .config import BIONIC_URL, LLAMA_BINARIES, LLAMA_PORT, LLAMA_SERVER, LOG_DIR, MODELS_DIRS, VLLM_URL
import socket

import psutil
from .db import q, q1, ex
from .llm_params import DEFAULT_PREDICTION, llama_args, request_body
from . import ollama

LOG = collections.deque(maxlen=3000)
LOG_FILE = LOG_DIR / "engine.log"


_PROBLEM = re.compile(r"\b(error|failed|fail|could not|cannot|crash|out of memory|exited|not responding|timed out)\b", re.I)


KEY_MASK = "<per-load key>"


def _redact(line: str) -> str:
    """The per-load API key of llama-server never reaches a log, whoever prints it (Yukti or llama-server itself)."""
    st = globals().get("state")
    key = getattr(st, "api_key", None)
    if key and key in line:
        line = line.replace(key, KEY_MASK)
    return re.sub(r"(--api-key[ =])(?!<)\S+", lambda m: m.group(1) + KEY_MASK, line)


def log(line: str) -> None:
    line = _redact(line)
    s = f"{time.strftime('%H:%M:%S')} {line.rstrip()}"
    LOG.append(s)
    try:  # engine problems also go into the local journal (errors.log), the rest stays in engine.log
        from . import journal
        area = "speech" if line.startswith("[speech]") else "engine"
        if _PROBLEM.search(line) and not line.startswith("[llama] ") or line.startswith("[llama] ") and " E " in line:
            journal.warn(area, line.strip()[:500])
        elif not line.startswith("[llama] "):   # what Yukti did (model loaded, voice started …); llama.cpp's own chatter stays in engine.log
            journal.event(area, line.strip()[:500])
    except Exception:  # noqa: BLE001
        pass
    try:
        with LOG_FILE.open("a", encoding="utf-8") as fh:
            fh.write(s + "\n")
    except Exception:
        pass


ENGINE_META = {
    "llamacpp": ("llama.cpp (Yukti-managed)", "Yukti launches and tunes a local llama-server process with the full load configuration."),
    "bionic": ("Bionic / LM Studio server", "Use a model already running in Bionic's local server (OpenAI-compatible)."),
    "vllm": ("vLLM (plant GPU server)", "High-throughput serving on the plant GPU server (Tier 2)."),
    "ollama": ("Ollama", "Models already downloaded in Ollama (native API: context length, GPU layers and sampling are applied)."),
    "remote": ("Custom server (OpenAI-compatible)", "Any OpenAI-compatible server by URL: LM Studio, llama.cpp server, vLLM, "
               "LocalAI, Jan, text-generation-webui, or a plant GPU server."),
}
ENGINE_IDS = ["llamacpp", "ollama", "bionic", "vllm", "remote"]
DEFAULT_URLS = {"llamacpp": f"http://127.0.0.1:{LLAMA_PORT}/v1", "bionic": BIONIC_URL, "vllm": VLLM_URL, "remote": "",
                "ollama": ollama.DEFAULT_URL}


def _free_port(start: int = LLAMA_PORT) -> int:
    """First free TCP port on 127.0.0.1 from `start` (a leftover process may hold 8080)."""
    for port in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return start


def cleanup_orphans() -> int:
    """Kill llama-server processes started from Yukti's own binaries that are not ours (left over after a crash)."""
    ours = {str(Path(b).resolve()).lower() for b in LLAMA_BINARIES.values() if b}
    killed = 0
    for p in psutil.process_iter(["name", "exe"]):
        try:
            exe = (p.info.get("exe") or "").lower()
            if exe and exe in ours and (not state.proc or p.pid != state.proc.pid):
                p.kill()
                killed += 1
        except Exception:
            pass
    if killed:
        log(f"[engine] cleaned up {killed} leftover llama-server process(es)")
    return killed


# Windows job object: llama-server is killed automatically if the Yukti server process ever dies (even a hard kill).
_JOB = None


def _job_handle():
    global _JOB
    if _JOB is not None or not hasattr(__import__("ctypes"), "windll"):
        return _JOB
    try:
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.windll.kernel32

        class BASIC(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

        class IO(ctypes.Structure):
            _fields_ = [(n, ctypes.c_uint64) for n in ("R", "W", "O", "RB", "WB", "OB")]

        class EXT(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", IO), ("ProcessMemoryLimit", ctypes.c_size_t),
                        ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                        ("PeakJobMemoryUsed", ctypes.c_size_t)]

        k32.CreateJobObjectW.restype = wintypes.HANDLE
        job = k32.CreateJobObjectW(None, None)
        info = EXT()
        info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info))  # JobObjectExtendedLimitInformation
        _JOB = job
    except Exception as e:  # pragma: no cover
        log(f"[engine] job object unavailable: {e!r}")
        _JOB = 0
    return _JOB


def _attach_to_job(proc: subprocess.Popen) -> None:
    try:
        import ctypes
        job = _job_handle()
        if job:
            ctypes.windll.kernel32.AssignProcessToJobObject(job, int(proc._handle))  # type: ignore[attr-defined]
    except Exception as e:  # pragma: no cover
        log(f"[engine] could not attach llama-server to job object: {e!r}")


def redacted_command() -> str | None:
    if not state.command:
        return None
    return _redacted_args(state.command)


def _redacted_args(command: list[str]) -> str:
    args = list(command)
    if "--api-key" in args and args.index("--api-key") + 1 < len(args):
        args[args.index("--api-key") + 1] = KEY_MASK
    return " ".join(args)


def _llama_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {state.api_key}"} if state.api_key else {}


def engine_url(eid: str) -> tuple[str, str | None]:
    if eid == "llamacpp":
        return f"http://127.0.0.1:{state.port}/v1", state.api_key
    r = q1("SELECT base_url, api_key FROM engines WHERE id=?", (eid,))
    if r and r["base_url"]:
        return r["base_url"].rstrip("/"), r["api_key"]
    return DEFAULT_URLS[eid], None


def llama_version(binary: str = LLAMA_SERVER) -> str | None:
    try:
        out = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=15,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        txt = out.stdout + out.stderr
        m = re.search(r"build (\d+), commit ([0-9a-f]+)", txt) or re.search(r"version:\s*(\d+)\s*\(([0-9a-f]+)\)", txt)
        kind = "CUDA" if "cuda" in binary.lower() else "Vulkan"
        return f"b{m.group(1)} ({m.group(2)}) · {kind}" if m else None
    except Exception:
        return None


_FLAGS: dict[str, set[str]] = {}


def supported_flags(binary: str) -> set[str]:
    if binary not in _FLAGS:
        try:
            out = subprocess.run([binary, "--help"], capture_output=True, text=True, timeout=20,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            _FLAGS[binary] = set(re.findall(r"(?<![\w-])(--?[a-zA-Z][\w-]*)", out.stdout + out.stderr))
        except Exception:
            _FLAGS[binary] = set()
    return _FLAGS[binary]


def filter_args(binary: str, args: list[str]) -> list[str]:
    """Drop flags the chosen llama.cpp build does not support (flag names changed across builds)."""
    ok = supported_flags(binary)
    if not ok:
        return args
    if "--load-mode" in ok and "--mmap" not in ok:  # newer builds merged mmap/mlock into --load-mode
        mm = "--mmap" in args
        ml = "--mlock" in args
        args = [a for a in args if a not in ("--mmap", "--no-mmap", "--mlock")]
        mode = "mmap+mlock" if (mm and ml) else "mmap" if mm else "mlock" if ml else None
        if mode:
            args += ["--load-mode", mode]
    out: list[str] = []
    i = 0
    while i < len(args):
        a = args[i]
        is_flag = a.startswith("-") and not re.match(r"^-\d", a)
        if is_flag:
            nxt = args[i + 1] if i + 1 < len(args) else None
            has_val = nxt is not None and (not nxt.startswith("-") or re.match(r"^-\d", nxt))
            if a in ok:
                out.append(a)
                if has_val:
                    out.append(nxt)  # type: ignore[arg-type]
            else:
                log(f"[engine] flag {a} not supported by this llama.cpp build — skipped")
            i += 2 if has_val else 1
        else:
            out.append(a)
            i += 1
    return out


_LLAMA_VER: str | None = None


def cached_llama_version() -> str | None:
    global _LLAMA_VER
    if _LLAMA_VER is None:
        _LLAMA_VER = llama_version() or ""
    return _LLAMA_VER or None


async def probe(eid: str) -> dict[str, Any]:
    url, key = engine_url(eid)
    name, desc = ENGINE_META[eid]
    out: dict[str, Any] = {"id": eid, "name": name, "description": desc, "base_url": url, "available": False}
    if eid == "llamacpp":
        out["available"] = Path(LLAMA_SERVER).exists() or bool(cached_llama_version())
        out["version"] = cached_llama_version()
        return out
    if eid == "ollama":
        out.update(await ollama.probe(url))
        return out
    if not url:
        out["error"] = "No server address set. Enter the URL the model server listens on (e.g. http://127.0.0.1:1234/v1)."
        return out
    try:
        async with httpx.AsyncClient(timeout=2.5) as c:
            r = await c.get(f"{url}/models", headers={"Authorization": f"Bearer {key}"} if key else {})
            out["available"] = r.status_code == 200
            if r.status_code == 200:
                out["models"] = [m.get("id") for m in r.json().get("data", []) if m.get("id")]
                if not out["models"]:
                    out["error"] = "The server is reachable but reports no models."
            elif r.status_code in (401, 403):
                out["error"] = f"{url} refused the request ({r.status_code}): check the API key."
            elif r.status_code == 404:
                out["error"] = (f"{url}/models was not found (404). OpenAI-compatible servers usually need the /v1 suffix, "
                                f"e.g. {url.rstrip('/')}/v1")
            else:
                out["error"] = f"{url} answered {r.status_code}."
    except httpx.ConnectError:
        out["error"] = f"Nothing is listening at {url}. Start the model server or correct the address."
    except httpx.TimeoutException:
        out["error"] = f"{url} did not answer within 2.5 s."
    except Exception as e:  # noqa: BLE001
        out["error"] = f"Could not reach {url}: {e}"
    return out


# ---------------------------------------------------------------- model discovery
QUANT_RE = re.compile(r"(IQ\d_[A-Z]+|Q\d_K_[SML]|Q\d_K|Q\d_\d|Q\d_[01]|F16|BF16|F32|MXFP4|UD-[A-Z0-9_]+)", re.I)
PARAMS_RE = re.compile(r"(\d+(?:\.\d+)?)[bB](?![a-z])")


def _name_stem(p: Path) -> str:
    """Model name without what differs between a model file and its image module: "mmproj", the quantisation, the shard
    number. gemma-3-4b-it-Q4_K_M.gguf and mmproj-gemma-3-4b-it-f16.gguf both give "gemma-3-4b-it"."""
    s = re.sub(r"-\d{5}-of-\d{5}$", "", p.stem.lower())
    s = re.sub(r"mmproj", " ", s)
    s = QUANT_RE.sub(" ", s)
    toks = [t for t in re.split(r"[-_. ]+", s) if t and t not in ("model", "gguf", "vision", "projector")]
    return "-".join(toks)


def mmproj_for(p: Path) -> Path | None:
    """The image module (mmproj) that belongs to model file `p`. A folder with one model: the module next to it. A folder
    with several models: only a module that shares the model's name, never some other model's module (which would
    make the model fail to load)."""
    files = list(p.parent.glob("*.gguf"))
    mms = sorted(x for x in files if "mmproj" in x.name.lower())
    if not mms:
        return None
    models = {_name_stem(x) + "|" + (QUANT_RE.search(x.stem).group(1).upper() if QUANT_RE.search(x.stem) else "")
              for x in files if "mmproj" not in x.name.lower()}
    if len(models) <= 1:
        return mms[0]
    mine = _name_stem(p)
    for m in mms:
        theirs = _name_stem(m)
        if theirs and mine and (mine == theirs or mine.startswith(theirs + "-") or theirs.startswith(mine + "-")):
            return m
    return None


def scan_models() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for base in MODELS_DIRS:
        if not base.exists():
            continue
        for p in base.rglob("*.gguf"):
            n = p.name.lower()
            if "mmproj" in n or str(p) in seen:
                continue
            seen.add(str(p))
            qm = QUANT_RE.search(p.stem)
            pm = PARAMS_RE.search(p.stem)
            fam = re.split(r"[-_]", p.stem)[0].lower()
            mm = mmproj_for(p)
            out.append({
                "id": str(p), "name": p.stem, "file_name": p.name, "path": str(p), "size_bytes": p.stat().st_size,
                "family": fam, "params_b": float(pm.group(1)) if pm else None, "quant": qm.group(1).upper() if qm else "?",
                "arch": fam, "source": "lmstudio" if ".lmstudio" in str(p) else "yukti",
                # an image projector (mmproj) next to the model lets it see photos
                "vision": bool(mm), "mmproj": str(mm) if mm else None,
            })
    for m in ollama.library_models():
        if m["path"] not in seen:
            seen.add(m["path"])
            out.append(m)
    return sorted(out, key=lambda m: m["size_bytes"])


def vision_models_on_disk() -> list[str]:
    """Names of models on this computer that Yukti's llama.cpp can run with photos (an image module (mmproj) next to them)."""
    return [m["name"] for m in scan_models() if m.get("mmproj")]


def vision_ready() -> bool:
    """The loaded model looks at photos itself (not only the text read from them)."""
    return state.status == "ready" and state.vision


async def vision_status() -> dict[str, Any]:
    """Can Yukti look at photos? `installed`: a model that can see is on this computer (the photo add-on, a model with its
    image module from LM Studio, or a vision model in Ollama such as gemma3) or is loaded; `active`: the loaded one can."""
    active = vision_ready()
    # scanning the model folders (and asking Ollama) for every page load and every photo is wasteful: the list of models
    # that can see is remembered for 30 s and forgotten at once when a model is loaded, unloaded, imported or deleted
    models = _VISION_CACHE["models"] if time.time() - _VISION_CACHE["at"] < VISION_CACHE_S else None
    if models is None:
        gen = _VISION_CACHE["gen"]
        models = await asyncio.to_thread(vision_models_on_disk)
        if not models and not active:
            try:
                info = await probe("ollama")
                models = [f"{m['id']} (Ollama)" for m in info.get("model_info") or [] if m.get("vision")]
            except Exception:  # noqa: BLE001
                models = []
        if gen == _VISION_CACHE["gen"]:  # not invalidated while we were looking
            _VISION_CACHE.update(at=time.time(), models=models)
    return {"installed": active or bool(models), "active": active, "loaded": state.status == "ready", "models": models[:5]}


VISION_CACHE_S = 30.0
_VISION_CACHE: dict[str, Any] = {"at": 0.0, "models": None, "gen": 0}


def invalidate_vision_cache() -> None:
    _VISION_CACHE.update(at=0.0, models=None, gen=_VISION_CACHE["gen"] + 1)


def _short_path(path: str) -> str:
    if path.isascii() or not hasattr(__import__("ctypes"), "windll"):
        return path
    import ctypes
    buf = ctypes.create_unicode_buffer(1024)
    n = ctypes.windll.kernel32.GetShortPathNameW(path, buf, 1024)
    return buf.value if 0 < n < 1024 else path


def model_by_id(mid: str) -> dict[str, Any] | None:
    return next((m for m in scan_models() if m["id"] == mid), None)


# ---------------------------------------------------------------- engine state
class EngineState:
    def __init__(self) -> None:
        self.status = "idle"
        self.engine = "llamacpp"
        self.model_id: str | None = None
        self.model_name: str | None = None
        self.load_config: dict[str, Any] = {}
        self.started_at: float | None = None
        self.error: str | None = None
        self.proc: subprocess.Popen | None = None
        self.requests = 0
        self.last_stats: dict[str, Any] = {}
        self.command: list[str] = []
        self.lock = threading.Lock()
        self.intentional_stop = False           # set while Yukti itself stops llama-server
        self.last_load: tuple[str, str, dict[str, Any]] | None = None
        self.ready_proc: subprocess.Popen | None = None
        self.restarts: list[float] = []         # timestamps of automatic restarts (crash-loop guard)
        self.port = LLAMA_PORT
        self.api_key: str | None = None      # random per load; llama-server rejects requests without it
        self.vision = False                  # the loaded model can see images

    def public(self) -> dict[str, Any]:
        return {"status": self.status, "engine": self.engine, "model_id": self.model_id, "model_name": self.model_name,
                "load_config": self.load_config, "started_at": (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.started_at)) if self.started_at else None), "error": self.error,
                "port": self.port if self.engine == "llamacpp" else None, "vision": self.vision,
                "command": redacted_command(), "last_stats": self.last_stats}


state = EngineState()


MAX_RESTARTS = 3
RESTART_WINDOW_S = 600


_TAILS: dict[int, collections.deque] = {}


def diagnose(lines: list[str]) -> str:
    """Turn llama-server's last output lines into an explanation an administrator can act on."""
    text = "\n".join(lines)
    low = text.lower()
    m = re.search(r"unknown model architecture: '([^']+)'", text)
    if m:
        return (f"This llama.cpp build does not support the model architecture '{m.group(1)}'. Use a model in a supported "
                "architecture, or run it through Ollama / LM Studio and connect that engine.")
    if "invalid magic" in low or "failed to read magic" in low or "not a gguf" in low or "gguf_init_from_file" in low and "failed" in low:
        return "The model file is not a valid GGUF (corrupt or incomplete download). Download or copy it again."
    if "key not found in model" in low or "wrong shape" in low or "check_tensor_dims" in low:
        return ("This model file was written in a variant (typically by Ollama) that the built-in llama.cpp cannot read. "
                "Choose the same model under the Ollama engine instead (Ollama must be running), or use a standard GGUF.")
    if "wrong number of tensors" in low or "missing tensor" in low or "done_getting_tensors" in low:
        return ("The model file contains tensors this llama.cpp build cannot read (for example Ollama's combined vision "
                "models). Load it through the Ollama engine instead, or use a plain GGUF of the same model.")
    if re.search(r"out of memory|cudamalloc failed|failed to allocate|unable to allocate|alloc_buffer.*failed|insufficient memory", low):
        return ("Not enough GPU/CPU memory for this model with these settings. Lower Context length or GPU offload layers, "
                "or use a smaller / more quantized model.")
    if "failed to open" in low or "no such file" in low or "cannot open" in low:
        return "The model file could not be opened. Check that it still exists and that the path is accessible."
    if re.search(r"error while handling argument|invalid argument|unknown argument|error: invalid", low):
        bad = next((l for l in lines if re.search(r"argument|invalid", l, re.I)), "")
        return f"llama-server rejected a load setting: {bad.strip()[:200]}"
    err = [l.strip() for l in lines if re.search(r"\berror\b|failed|exception", l, re.I)]
    if err:
        return f"llama-server stopped while loading: {err[-1][:240]}"
    return "llama-server stopped while loading. See Admin → Developer → Logs for its output."


def _reader(proc: subprocess.Popen) -> None:
    assert proc.stdout is not None
    tail = _TAILS.setdefault(proc.pid, collections.deque(maxlen=80))
    for line in iter(proc.stdout.readline, ""):
        if line:
            tail.append(line.rstrip())
            log("[llama] " + line)
    code = proc.wait()
    log(f"[llama] process exited (code {code})")
    _on_exit(proc, code)


def _on_exit(proc: subprocess.Popen, code: int) -> None:
    """Watchdog: a llama-server that was serving and died unexpectedly is restarted with the same settings."""
    if proc is not state.proc or state.intentional_stop:
        return
    if state.ready_proc is not proc:
        return  # load-time failures are reported by wait_ready (usually out of memory) - never crash-loop
    now = time.time()
    state.restarts = [t for t in state.restarts if now - t < RESTART_WINDOW_S]
    if len(state.restarts) >= MAX_RESTARTS or not state.last_load:
        state.status = "error"
        state.error = (f"llama-server crashed (exit code {code}) {len(state.restarts)} times in {RESTART_WINDOW_S // 60} min; "
                       "automatic restart stopped. Check Developer logs, reduce context/GPU layers, then reload the model.")
        log("[watchdog] " + state.error)
        return
    state.restarts.append(now)
    state.status = "restarting"
    state.error = f"llama-server stopped unexpectedly (exit code {code}); restarting automatically"
    log(f"[watchdog] {state.error} (restart {len(state.restarts)}/{MAX_RESTARTS})")
    eng, mid, cfg = state.last_load

    def again() -> None:
        time.sleep(2)
        try:
            load(eng, mid, cfg, _auto=True)
        except Exception as e:  # pragma: no cover
            state.status = "error"
            state.error = f"Automatic restart failed: {e}"

    threading.Thread(target=again, daemon=True).start()


def _health_monitor() -> None:
    """Detect a hung llama-server (process alive but not answering) and kill it so the watchdog restarts it."""
    fails = 0
    while True:
        time.sleep(15)
        proc = state.proc
        if state.engine != "llamacpp" or state.status != "ready" or not proc or proc.poll() is not None:
            fails = 0
            continue
        try:
            r = httpx.get(f"http://127.0.0.1:{state.port}/health", timeout=10, headers=_llama_headers())
            fails = 0 if r.status_code == 200 else fails + 1
        except Exception:
            fails += 1
        if fails >= 4:
            log("[watchdog] llama-server not responding for ~60 s - restarting it")
            fails = 0
            try:
                proc.kill()
            except Exception:
                pass


threading.Thread(target=_health_monitor, daemon=True, name="llama-health").start()


def unload() -> None:
    invalidate_vision_cache()  # also covers load(), which always unloads first
    if state.engine == "ollama" and state.model_id and state.status in ("ready", "loading"):
        url, _ = engine_url("ollama")
        threading.Thread(target=ollama.release, args=(url, state.model_id), daemon=True).start()
    with state.lock:
        state.intentional_stop = True
        if state.proc and state.proc.poll() is None:
            log(f"Unloading {state.model_name} (pid {state.proc.pid})")
            state.proc.terminate()
            try:
                state.proc.wait(timeout=10)
            except Exception:
                state.proc.kill()
        state.proc = None
        state.ready_proc = None
        state.status = "idle"
        state.vision = False
        state.engine = "llamacpp"  # an unloaded engine is not "selected" any more
        state.model_id = None
        state.model_name = None
        state.error = None
        state.command = []


def load(engine: str, model_id: str, cfg: dict[str, Any], _auto: bool = False) -> dict[str, Any]:
    unload()
    state.intentional_stop = False
    if not _auto:
        state.restarts = []
    state.last_load = (engine, model_id, dict(cfg or {}))
    state.engine = engine
    state.load_config = cfg or {}
    state.error = None
    if engine != "llamacpp":
        state.model_id = model_id
        state.model_name = model_id
        state.status = "loading"

        def check() -> None:
            import asyncio
            if engine == "ollama":
                url, _ = engine_url("ollama")
                log(f"Loading {model_id} in Ollama at {ollama.root(url)} (num_ctx {ollama.load_options(cfg).get('num_ctx')})")
                ok, detail = ollama.preload(url, model_id, cfg or {})
                state.vision = ok and ollama.has_vision(url, model_id)
                if state.last_load and state.last_load[1] != model_id:
                    return  # superseded by another load
                if ok:
                    state.status, state.started_at = "ready", time.time()
                    log(f"Ollama model {model_id} ready" + (f" ({detail})" if detail else ""))
                else:
                    state.status, state.error = "error", detail
                    log(f"[engine] {detail}")
                return
            info = asyncio.run(probe(engine))
            if not info["available"]:
                state.status = "error"
                state.error = info.get("error") or f"{ENGINE_META[engine][0]} is not reachable at {info['base_url']}"
            elif info.get("models") and model_id not in info["models"]:
                state.status = "error"
                state.error = (f"{info['base_url']} has no model '{model_id}'. Available: "
                               + ", ".join(info["models"][:8]))
            else:
                state.status = "ready"
                state.vision = bool((cfg or {}).get("vision"))
                state.started_at = time.time()
                log(f"Connected to {engine} at {info['base_url']} using model {model_id}")
                return
            log(f"[engine] {state.error}")

        threading.Thread(target=check, daemon=True).start()
        return state.public()

    m = model_by_id(model_id)
    if not m:
        state.status = "error"
        state.error = "Model file not found"
        return state.public()
    draft = cfg.get("draft_model") or None
    from .config import pick_backend
    backend = pick_backend(cfg.get("backend"))
    binary = LLAMA_BINARIES.get(backend) or LLAMA_SERVER
    log(f"Compute backend: {backend} ({binary})")
    extra: list[str] = []
    if m.get("mmproj") and cfg.get("vision", True) is not False:
        extra = ["--mmproj", _short_path(m["mmproj"])]
    # voice input on the GPU needs ~1.2 GB next to the AI model: keep that much video memory free when auto-fitting
    # (otherwise the recogniser falls back to the processor and a question takes 30 s instead of 1 s)
    try:
        from . import speech
        if backend == "cuda" and speech.gpu_installed() and cfg.get("fit", "on") == "on":
            extra += ["--fit-target", "2048"]
    except Exception as e:  # noqa: BLE001
        log(f"[speech] could not check voice input before loading the model: {e}")
    args = [binary, *filter_args(binary, llama_args(cfg, _short_path(m["path"]), _short_path(draft) if draft else draft) + extra + [
        "--host", "127.0.0.1", "--port", str(LLAMA_PORT), "--alias", m["name"], "--no-webui", "--metrics",
        "--slot-save-path", str(LOG_DIR.parent / "slots"), "--offline"])]
    (LOG_DIR.parent / "slots").mkdir(exist_ok=True)
    state.port = _free_port()
    args[args.index("--port") + 1] = str(state.port)
    state.vision = "--mmproj" in args
    state.api_key = secrets.token_urlsafe(24) if "--api-key" in supported_flags(binary) else None
    if state.api_key:
        args += ["--api-key", state.api_key]
    state.command = args
    state.model_id = model_id
    state.model_name = m["name"]
    state.status = "loading"
    log("Launching: " + _redacted_args(args))  # the key itself is never written to a log
    try:
        state.proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                      errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception as e:  # pragma: no cover
        state.status = "error"
        state.error = str(e)
        return state.public()
    _attach_to_job(state.proc)
    threading.Thread(target=_reader, args=(state.proc,), daemon=True).start()

    def wait_ready(proc: subprocess.Popen) -> None:
        t0 = time.time()
        while time.time() - t0 < 1800:  # large models from slow disks can take many minutes
            if proc is not state.proc:
                return  # superseded by a newer load - never touch the new load's state
            if proc.poll() is not None:
                if not state.intentional_stop:
                    time.sleep(0.5)  # let the reader thread collect the last lines
                    why = diagnose(list(_TAILS.get(proc.pid, [])))
                    if "--mmproj" in args and proc is state.proc:
                        # the image module may be the reason (wrong or damaged module, not enough memory for it):
                        # try once more without it, so people can at least ask questions (photos are then read as text)
                        log(f"[engine] load failed with the image module (mmproj): {why} - retrying once without it")
                        load(engine, model_id, {**(cfg or {}), "vision": False}, _auto=_auto)
                        return
                    state.status = "error"
                    state.error = why
                    log(f"[engine] load failed: {state.error}")
                return
            try:
                r = httpx.get(f"http://127.0.0.1:{state.port}/health", timeout=1, headers=_llama_headers())
                if r.status_code == 200 and proc is state.proc:
                    state.status = "ready"
                    state.ready_proc = proc
                    state.error = None
                    state.started_at = time.time()
                    log(f"Model ready in {time.time() - t0:.1f}s")
                    return
            except Exception:
                pass
            time.sleep(0.5)
        if proc is state.proc:
            state.status = "error"
            state.error = "llama-server did not become ready within 30 minutes and was stopped. " + diagnose(list(_TAILS.get(proc.pid, [])))
            try:
                proc.kill()  # never leave a half-loaded server holding VRAM
            except Exception:  # noqa: BLE001
                pass

    threading.Thread(target=wait_ready, args=(state.proc,), daemon=True).start()
    return state.public()


def context_tokens() -> int:
    """Tokens one request may use: llama.cpp divides its context between parallel slots; Ollama uses num_ctx;
    external servers do not report theirs, so a conservative 8192 is assumed."""
    cfg = state.load_config or {}
    ctx = int(cfg.get("ctx_size") or 8192)
    if state.engine == "llamacpp":
        return max(1024, ctx // max(1, int(cfg.get("parallel") or 1)))
    if state.engine in ("ollama", "vllm"):
        return ctx
    return 8192


def is_gemma2(name: str | None) -> bool:
    return bool(name and re.search(r"gemma-?2", name, re.I))


def openai_images(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Internal form {"content": str, "images": [base64 JPEG]} -> OpenAI content parts (text + image_url).
    Photos are dropped when the loaded model cannot see images (the chat then relies on the text read by OCR)."""
    out = []
    for m in messages:
        imgs = m.get("images") or []
        mm = {k: v for k, v in m.items() if k != "images"}
        if imgs and state.vision:
            mm["content"] = [{"type": "text", "text": m.get("content") or ""}] + [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b}"}} for b in imgs]
        out.append(mm)
    return out


def prepare_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Some templates (Gemma 2) reject the system role: merge it into the first user turn."""
    if not is_gemma2(state.model_name):
        return openai_images(messages)
    messages = [{k: v for k, v in m.items() if k != "images"} for m in messages]  # Gemma 2 cannot see images
    sys = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    rest = [dict(m) for m in messages if m["role"] != "system"]
    # Gemma requires strict user/assistant alternation
    merged: list[dict[str, Any]] = []
    for m in rest:
        if merged and merged[-1]["role"] == m["role"]:
            merged[-1]["content"] += "\n\n" + m["content"]
        else:
            merged.append(m)
    if merged and sys:
        merged[0]["content"] = f"{sys}\n\n---\n\n{merged[0]['content']}"
    return merged


async def stream_chat(messages: list[dict[str, Any]], pred: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    """Yields {'type': 'token'|'reasoning'|'done'|'error', ...}.

    If the engine is switched or restarted before any text was produced (admin reload, watchdog restart),
    the request is transparently retried once on the new engine instead of failing the employee.
    """
    for attempt in range(3):
        produced = False
        retry = False
        async for ev in _stream_once(messages, pred):
            if ev["type"] in ("token", "reasoning"):
                produced = True
            # a connection failure (model reload, watchdog restart, crash) is retried on the engine that comes back;
            # if part of the answer was already shown, the client is told to clear it first ("reset")
            transient = ev["type"] == "error" and (
                ev.get("code") == "engine_unreachable" or (ev.get("code") == "engine_error" and int(ev.get("status") or 500) >= 500))
            if transient and attempt < 2:
                await asyncio.sleep(1.0 + attempt)
                log("[chat] engine unavailable" + (" mid-answer - restarting the answer" if produced else " before the answer started") + " - retrying")
                if produced:
                    yield {"type": "reset"}
                retry = True
                break
            if ev["type"] == "error" and produced:
                ev = {**ev, "message": "The model was restarted or switched while answering. Please press Regenerate. (" + ev["message"] + ")"}
            yield ev
        if not retry:
            return


async def _stream_once(messages: list[dict[str, Any]], pred: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    # wait (bounded) while the model is loading or being restarted by the watchdog, instead of failing the user
    t_wait = time.time()
    while state.status in ("loading", "restarting") and time.time() - t_wait < 120:
        await asyncio.sleep(0.5)
    if state.status != "ready":
        msg = state.error or "No model is loaded. An administrator must load one (Admin -> Models)."
        yield {"type": "error", "code": "no_model" if state.status == "idle" else "engine_" + state.status, "message": msg}
        return
    engine = state.engine
    url, key = engine_url(engine)
    if engine == "ollama":
        state.requests += 1
        p = {**DEFAULT_PREDICTION, **{k: v for k, v in (pred or {}).items() if v is not None and v != ""}}
        async for ev in ollama.stream(url, state.model_id or "", messages, p, state.load_config or {}):
            if ev["type"] == "done":
                ev["stats"].update(model_name=state.model_name, engine=engine)
                state.last_stats = ev["stats"]
            elif ev["type"] == "error":
                log(f"[chat] {ev['message']}")
            yield ev
        return
    body = request_body(pred, engine)
    body["messages"] = prepare_messages(messages)
    body["stream"] = True
    body["stream_options"] = {"include_usage": True}
    if engine != "llamacpp":
        body["model"] = state.model_id
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    state.requests += 1
    t0 = time.time()
    ttft = None
    n_out = 0
    usage: dict[str, Any] = {}
    timings: dict[str, Any] = {}
    finish = None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=5)) as c:
            async with c.stream("POST", f"{url}/chat/completions", json=body, headers=headers) as r:
                if r.status_code != 200:
                    txt = (await r.aread()).decode(errors="replace")[:500]
                    log(f"[chat] engine error {r.status_code}: {txt}")
                    msg = f"Engine returned {r.status_code}: {txt}"
                    if re.search(r"exceed|context|too long|n_ctx", txt, re.I) and r.status_code == 400:
                        msg = ("This conversation plus the retrieved documents is longer than the model's context window. "
                               "Start a new chat, or ask the administrator to raise Context length when loading the model.")
                    yield {"type": "error", "code": "engine_error", "status": r.status_code, "message": msg}
                    return
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        ev = json.loads(data)
                    except Exception:
                        continue
                    if ev.get("usage"):
                        usage = ev["usage"]
                    if ev.get("timings"):
                        timings = ev["timings"]
                    for ch in ev.get("choices", []):
                        d = ch.get("delta", {}) or {}
                        if ch.get("finish_reason"):
                            finish = ch["finish_reason"]
                        rc = d.get("reasoning_content") or d.get("reasoning")
                        if rc:
                            if ttft is None:
                                ttft = time.time() - t0
                            yield {"type": "reasoning", "t": rc}
                        if d.get("content"):
                            if ttft is None:
                                ttft = time.time() - t0
                            n_out += 1
                            yield {"type": "token", "t": d["content"]}
    except Exception as e:
        log(f"[chat] stream failed: {e!r}")
        yield {"type": "error", "code": "engine_unreachable", "message": f"Could not reach the engine: {e}"}
        return
    total = time.time() - t0
    tokens_out = usage.get("completion_tokens") or timings.get("predicted_n") or n_out
    tps = timings.get("predicted_per_second") or (tokens_out / max(total - (ttft or 0), 1e-3))
    stats = {"tokens_in": usage.get("prompt_tokens") or timings.get("prompt_n"), "tokens_out": tokens_out,
             "tok_per_s": round(float(tps), 1), "ttft_ms": round((ttft or total) * 1000),
             "total_ms": round(total * 1000), "stop_reason": finish or "stop", "model_name": state.model_name,
             "engine": engine, "prompt_tok_per_s": round(float(timings.get("prompt_per_second") or 0), 1)}
    state.last_stats = stats
    yield {"type": "done", "stats": stats}


async def complete_once(messages: list[dict[str, Any]], pred: dict[str, Any] | None = None) -> str:
    out = []
    async for ev in stream_chat(messages, {"temperature": 0.2, "max_tokens": 400, **(pred or {})}):
        if ev["type"] == "token":
            out.append(ev["t"])
        elif ev["type"] == "error":
            raise RuntimeError(ev.get("message") or "engine error")
    return "".join(out)


def autoload(engine_id: str, model_id: str, cfg: dict[str, Any]) -> None:
    """Restore the administrator's model at startup; if it cannot be loaded (e.g. Ollama not running, model deleted),
    fall back to the bundled model so employees are not left without an assistant."""
    log(f"Restoring model {model_id} on {engine_id}")
    load(engine_id, model_id, cfg)
    t0 = time.time()
    while state.status == "loading" and time.time() - t0 < 900:
        time.sleep(1)
    if state.status != "ready":
        log(f"[engine] could not restore {model_id} on {engine_id} ({state.error}); loading the bundled model instead")
        autoload_default()


def autoload_default() -> None:
    """Load the smallest local GGUF on startup so the demo is ready."""
    ms = [m for m in scan_models() if m.get("source") != "ollama-library"]
    if not ms:
        log("No local GGUF models found.")
        return
    # prefer a model that can also see photos (Gemma 3 with its image module), then any Gemma
    pick = next((m for m in ms if m.get("vision") and "gemma" in m["name"].lower()), None) or         next((m for m in ms if "gemma" in m["name"].lower()), ms[0])
    log(f"Auto-loading default model {pick['name']}")
    load("llamacpp", pick["id"], {"backend": "auto", "ctx_size": 16384, "gpu_layers": 99, "flash_attn": "on",
                                  "cache_type_k": "q8_0", "cache_type_v": "q8_0", "parallel": 2})
