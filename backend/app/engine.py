"""Inference engines: a Yukti-managed llama-server process + OpenAI-compatible connectors (Bionic, vLLM, remote)."""
from __future__ import annotations

import collections
import json
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, AsyncIterator

import httpx

from .config import BIONIC_URL, LLAMA_BINARIES, LLAMA_PORT, LLAMA_SERVER, LOG_DIR, MODELS_DIRS, VLLM_URL
from .db import q, q1, ex
from .llm_params import llama_args, request_body

LOG = collections.deque(maxlen=3000)
LOG_FILE = LOG_DIR / "engine.log"


def log(line: str) -> None:
    s = f"{time.strftime('%H:%M:%S')} {line.rstrip()}"
    LOG.append(s)
    try:
        with LOG_FILE.open("a", encoding="utf-8") as fh:
            fh.write(s + "\n")
    except Exception:
        pass


ENGINE_META = {
    "llamacpp": ("llama.cpp (Yukti-managed)", "Yukti launches and tunes a local llama-server process with the full load configuration."),
    "bionic": ("Bionic / LM Studio server", "Use a model already running in Bionic's local server (OpenAI-compatible)."),
    "vllm": ("vLLM (plant GPU server)", "High-throughput serving on the plant GPU server (Tier 2)."),
    "remote": ("Remote OpenAI-compatible", "Any OpenAI-compatible endpoint (Tier 1 remote GPU — synthetic data only)."),
}
DEFAULT_URLS = {"llamacpp": f"http://127.0.0.1:{LLAMA_PORT}/v1", "bionic": BIONIC_URL, "vllm": VLLM_URL, "remote": ""}


def engine_url(eid: str) -> tuple[str, str | None]:
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
    if not url:
        return out
    try:
        async with httpx.AsyncClient(timeout=1.5) as c:
            r = await c.get(f"{url}/models", headers={"Authorization": f"Bearer {key}"} if key else {})
            out["available"] = r.status_code == 200
            if r.status_code == 200:
                out["models"] = [m.get("id") for m in r.json().get("data", [])]
    except Exception:
        pass
    return out


# ---------------------------------------------------------------- model discovery
QUANT_RE = re.compile(r"(IQ\d_[A-Z]+|Q\d_K_[SML]|Q\d_K|Q\d_\d|Q\d_[01]|F16|BF16|F32|MXFP4|UD-[A-Z0-9_]+)", re.I)
PARAMS_RE = re.compile(r"(\d+(?:\.\d+)?)[bB](?![a-z])")


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
            vision = any("mmproj" in x.name.lower() for x in p.parent.glob("*.gguf"))
            out.append({
                "id": str(p), "name": p.stem, "file_name": p.name, "path": str(p), "size_bytes": p.stat().st_size,
                "family": fam, "params_b": float(pm.group(1)) if pm else None, "quant": qm.group(1).upper() if qm else "?",
                "arch": fam, "source": "lmstudio" if ".lmstudio" in str(p) else "yukti", "vision": vision,
            })
    return sorted(out, key=lambda m: m["size_bytes"])


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

    def public(self) -> dict[str, Any]:
        return {"status": self.status, "engine": self.engine, "model_id": self.model_id, "model_name": self.model_name,
                "load_config": self.load_config, "started_at": (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.started_at)) if self.started_at else None), "error": self.error,
                "port": LLAMA_PORT if self.engine == "llamacpp" else None,
                "command": " ".join(self.command) if self.command else None, "last_stats": self.last_stats}


state = EngineState()


def _reader(proc: subprocess.Popen) -> None:
    assert proc.stdout is not None
    for line in iter(proc.stdout.readline, ""):
        if line:
            log("[llama] " + line)
    log("[llama] process exited")


def unload() -> None:
    with state.lock:
        if state.proc and state.proc.poll() is None:
            log(f"Unloading {state.model_name} (pid {state.proc.pid})")
            state.proc.terminate()
            try:
                state.proc.wait(timeout=10)
            except Exception:
                state.proc.kill()
        state.proc = None
        state.status = "idle"
        state.model_id = None
        state.model_name = None
        state.error = None
        state.command = []


def load(engine: str, model_id: str, cfg: dict[str, Any]) -> dict[str, Any]:
    unload()
    state.engine = engine
    state.load_config = cfg or {}
    state.error = None
    if engine != "llamacpp":
        state.model_id = model_id
        state.model_name = model_id
        state.status = "loading"

        def check() -> None:
            import asyncio
            info = asyncio.run(probe(engine))
            if info["available"]:
                state.status = "ready"
                state.started_at = time.time()
                log(f"Connected to {engine} at {info['base_url']} using model {model_id}")
            else:
                state.status = "error"
                state.error = f"{ENGINE_META[engine][0]} is not reachable at {info['base_url']}"
                log(state.error)

        threading.Thread(target=check, daemon=True).start()
        return state.public()

    m = model_by_id(model_id)
    if not m:
        state.status = "error"
        state.error = "Model file not found"
        return state.public()
    draft = cfg.get("draft_model") or None
    binary = LLAMA_BINARIES.get(cfg.get("backend") or "cuda", LLAMA_SERVER)
    if not Path(binary).exists() and not Path(binary).with_suffix(".exe").exists() and binary != LLAMA_BINARIES["vulkan"]:
        binary = LLAMA_SERVER
    args = [binary, *filter_args(binary, llama_args(cfg, m["path"], draft) + [
        "--host", "127.0.0.1", "--port", str(LLAMA_PORT), "--alias", m["name"], "--no-webui", "--metrics",
        "--slot-save-path", str(LOG_DIR.parent / "slots"), "--offline"])]
    (LOG_DIR.parent / "slots").mkdir(exist_ok=True)
    state.command = args
    state.model_id = model_id
    state.model_name = m["name"]
    state.status = "loading"
    log("Launching: " + " ".join(args))
    try:
        state.proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                      errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception as e:  # pragma: no cover
        state.status = "error"
        state.error = str(e)
        return state.public()
    threading.Thread(target=_reader, args=(state.proc,), daemon=True).start()

    def wait_ready(proc: subprocess.Popen) -> None:
        t0 = time.time()
        while time.time() - t0 < 300:
            if proc.poll() is not None:
                state.status = "error"
                state.error = "llama-server exited during load — see Developer logs (likely out of memory: lower context/GPU layers)."
                return
            try:
                r = httpx.get(f"http://127.0.0.1:{LLAMA_PORT}/health", timeout=1)
                if r.status_code == 200:
                    state.status = "ready"
                    state.started_at = time.time()
                    log(f"Model ready in {time.time() - t0:.1f}s")
                    return
            except Exception:
                pass
            time.sleep(0.5)
        state.status = "error"
        state.error = "Timed out waiting for llama-server"

    threading.Thread(target=wait_ready, args=(state.proc,), daemon=True).start()
    return state.public()


def is_gemma2(name: str | None) -> bool:
    return bool(name and re.search(r"gemma-?2", name, re.I))


def prepare_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Some templates (Gemma 2) reject the system role: merge it into the first user turn."""
    if not is_gemma2(state.model_name):
        return messages
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
    """Yields {'type': 'token'|'reasoning'|'done'|'error', ...}."""
    if state.status != "ready":
        yield {"type": "error", "code": "no_model", "message": "No model is loaded. Open the model loader (Ctrl+L) and load one."}
        return
    engine = state.engine
    url, key = engine_url(engine)
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
                    yield {"type": "error", "code": "engine_error", "message": f"Engine returned {r.status_code}: {txt}"}
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
    async for ev in stream_chat(messages, {**(pred or {}), "temperature": 0.2, "max_tokens": 400}):
        if ev["type"] == "token":
            out.append(ev["t"])
    return "".join(out)


def autoload_default() -> None:
    """Load the smallest local GGUF on startup so the demo is ready."""
    ms = scan_models()
    if not ms:
        log("No local GGUF models found.")
        return
    pick = next((m for m in ms if "gemma" in m["name"].lower()), ms[0])
    log(f"Auto-loading default model {pick['name']}")
    load("llamacpp", pick["id"], {"backend": "cuda", "ctx_size": 16384, "gpu_layers": 99, "flash_attn": "on",
                                  "cache_type_k": "q8_0", "cache_type_v": "q8_0", "parallel": 2})
