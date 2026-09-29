"""Ollama integration.

Two ways to use models a user already has in Ollama:

1. **Ollama engine** — talk to a running Ollama (default http://127.0.0.1:11434) through its *native* API
   (/api/tags, /api/generate, /api/chat). The native API is used instead of Ollama's OpenAI-compatible endpoint because
   only the native API accepts `num_ctx`; the OpenAI endpoint silently truncates long prompts (RAG context, system
   prompt) at Ollama's small default context.
2. **Ollama library on disk** — Ollama stores models as GGUF blobs under ~/.ollama/models (or OLLAMA_MODELS). They are
   listed so Yukti's own llama.cpp can run them without Ollama running.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, AsyncIterator

import httpx

DEFAULT_URL = os.environ.get("YUKTI_OLLAMA_URL") or "http://127.0.0.1:11434"


def root(url: str | None) -> str:
    """Normalise what an admin may paste (…/v1, …/api, trailing slash, host:port without scheme) to the server root."""
    u = (url or DEFAULT_URL).strip().rstrip("/")
    if not u.startswith(("http://", "https://")):
        u = "http://" + u
    for suffix in ("/v1", "/api"):
        if u.endswith(suffix):
            u = u[: -len(suffix)]
    return u


def _err_text(r: httpx.Response) -> str:
    try:
        return str(r.json().get("error") or r.text)[:400]
    except Exception:
        return r.text[:400]


async def probe(url: str) -> dict[str, Any]:
    """{'available', 'version', 'models': [...], 'model_info': [...], 'error'}"""
    base = root(url)
    out: dict[str, Any] = {"available": False, "base_url": base}
    try:
        async with httpx.AsyncClient(timeout=2.5) as c:
            v = await c.get(f"{base}/api/version")
            if v.status_code != 200:
                out["error"] = f"{base} answered {v.status_code} - is this an Ollama server?"
                return out
            out["version"] = v.json().get("version")
            t = await c.get(f"{base}/api/tags")
            info = []
            for m in (t.json().get("models") or []) if t.status_code == 200 else []:
                d = m.get("details") or {}
                info.append({"id": m.get("name") or m.get("model"), "size_bytes": m.get("size") or 0,
                             "family": d.get("family") or "", "params": d.get("parameter_size") or "",
                             "quant": d.get("quantization_level") or "", "format": d.get("format") or ""})
            out.update(available=True, models=[i["id"] for i in info], model_info=info)
            if not info:
                out["error"] = "Ollama is running but has no models. Download one first, e.g.: ollama pull gemma3:4b"
    except httpx.ConnectError:
        out["error"] = f"Ollama is not running at {base}. Start the Ollama app (or `ollama serve`) and try again."
    except Exception as e:  # noqa: BLE001
        out["error"] = f"Could not reach Ollama at {base}: {e}"
    return out


def options(pred: dict[str, Any], load_cfg: dict[str, Any]) -> dict[str, Any]:
    """Yukti prediction + load parameters -> Ollama `options`."""
    o: dict[str, Any] = {}
    for src, dst, cast in (("temperature", "temperature", float), ("top_p", "top_p", float), ("top_k", "top_k", int),
                           ("min_p", "min_p", float), ("repeat_penalty", "repeat_penalty", float),
                           ("presence_penalty", "presence_penalty", float), ("frequency_penalty", "frequency_penalty", float)):
        if pred.get(src) not in (None, ""):
            o[dst] = cast(pred[src])
    if int(pred.get("max_tokens") or 0) > 0:
        o["num_predict"] = int(pred["max_tokens"])
    if int(pred.get("seed", -1) if pred.get("seed") not in (None, "") else -1) >= 0:
        o["seed"] = int(pred["seed"])
    if pred.get("stop"):
        o["stop"] = list(pred["stop"])[:8]
    o.update(load_options(load_cfg))
    return o


def load_options(cfg: dict[str, Any]) -> dict[str, Any]:
    o: dict[str, Any] = {"num_ctx": int(cfg.get("ctx_size") or 8192)}
    if cfg.get("gpu_layers") not in (None, ""):
        o["num_gpu"] = int(cfg["gpu_layers"])
    if cfg.get("threads") not in (None, ""):
        o["num_thread"] = int(cfg["threads"])
    if cfg.get("batch_size") not in (None, ""):
        o["num_batch"] = int(cfg["batch_size"])
    if cfg.get("mmap") is not None:
        o["use_mmap"] = bool(cfg["mmap"])
    return o


def preload(url: str, model: str, cfg: dict[str, Any]) -> tuple[bool, str]:
    """Load the model into Ollama now (so errors such as 'not enough memory' surface at load time, not at first chat)."""
    base = root(url)
    try:
        tags = httpx.get(f"{base}/api/tags", timeout=5).json().get("models") or []
    except httpx.ConnectError:
        return False, f"Ollama is not running at {base}. Start the Ollama app and try again."
    except Exception as e:  # noqa: BLE001
        return False, f"Could not reach Ollama at {base}: {e}"
    names = {m.get("name") for m in tags} | {m.get("model") for m in tags}
    if model not in names and f"{model}:latest" not in names:
        return False, f"Ollama has no model named '{model}'. Download it first: ollama pull {model}"
    try:
        r = httpx.post(f"{base}/api/generate", json={"model": model, "prompt": "", "stream": False,
                                                    "keep_alive": cfg.get("keep_alive") or "30m", "options": load_options(cfg)},
                       timeout=httpx.Timeout(900, connect=5))
    except Exception as e:  # noqa: BLE001
        return False, f"Ollama did not finish loading {model}: {e}"
    if r.status_code != 200:
        return False, f"Ollama could not load {model}: {_err_text(r)}"
    detail = ""
    try:
        for m in httpx.get(f"{base}/api/ps", timeout=5).json().get("models") or []:
            if m.get("name") in (model, f"{model}:latest") or m.get("model") in (model, f"{model}:latest"):
                size, vram = m.get("size") or 0, m.get("size_vram") or 0
                pct = round(100 * vram / size) if size else 0
                detail = f"{size / 2**30:.1f} GB loaded, {pct}% on GPU"
    except Exception:  # noqa: BLE001
        pass
    return True, detail


def release(url: str, model: str) -> None:
    """Ask Ollama to free the model's memory (best effort)."""
    try:
        httpx.post(f"{root(url)}/api/generate", json={"model": model, "keep_alive": 0}, timeout=10)
    except Exception:  # noqa: BLE001
        pass


async def stream(url: str, model: str, messages: list[dict[str, Any]], pred: dict[str, Any],
                 load_cfg: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    """Native /api/chat streaming -> Yukti events ('token' | 'reasoning' | 'error' | 'done')."""
    body: dict[str, Any] = {"model": model, "messages": messages, "stream": True, "options": options(pred, load_cfg),
                            "keep_alive": load_cfg.get("keep_alive") or "30m"}
    if pred.get("enable_thinking") in ("on", "off"):
        body["think"] = pred["enable_thinking"] == "on"
    t0 = time.time()
    ttft = None
    n_out = 0
    final: dict[str, Any] = {}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=5)) as c:
            async with c.stream("POST", f"{root(url)}/api/chat", json=body) as r:
                if r.status_code != 200:
                    txt = (await r.aread()).decode(errors="replace")
                    try:
                        txt = json.loads(txt).get("error") or txt
                    except Exception:  # noqa: BLE001
                        pass
                    yield {"type": "error", "code": "engine_error", "message": f"Ollama returned {r.status_code}: {str(txt)[:400]}"}
                    return
                async for line in r.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        ev = json.loads(line)
                    except Exception:  # noqa: BLE001
                        continue
                    if ev.get("error"):
                        yield {"type": "error", "code": "engine_error", "message": f"Ollama: {ev['error']}"}
                        return
                    msg = ev.get("message") or {}
                    if msg.get("thinking"):
                        ttft = ttft or time.time() - t0
                        yield {"type": "reasoning", "t": msg["thinking"]}
                    if msg.get("content"):
                        ttft = ttft or time.time() - t0
                        n_out += 1
                        yield {"type": "token", "t": msg["content"]}
                    if ev.get("done"):
                        final = ev
                        break
    except httpx.ConnectError:
        yield {"type": "error", "code": "engine_unreachable", "message": f"Ollama is not running at {root(url)}."}
        return
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "code": "engine_unreachable", "message": f"Could not reach Ollama: {e}"}
        return
    total = time.time() - t0
    ev_n, ev_ns = final.get("eval_count") or n_out, final.get("eval_duration") or 0
    pe_n, pe_ns = final.get("prompt_eval_count"), final.get("prompt_eval_duration") or 0
    yield {"type": "done", "stats": {
        "tokens_in": pe_n, "tokens_out": ev_n,
        "tok_per_s": round(ev_n / (ev_ns / 1e9), 1) if ev_ns else round(ev_n / max(total - (ttft or 0), 1e-3), 1),
        "ttft_ms": round((ttft or total) * 1000), "total_ms": round(total * 1000),
        "stop_reason": final.get("done_reason") or "stop",
        "prompt_tok_per_s": round(pe_n / (pe_ns / 1e9), 1) if pe_n and pe_ns else 0}}


# ---------------------------------------------------------------- Ollama library on disk (for Yukti's llama.cpp)
def models_dir() -> Path:
    return Path(os.environ.get("OLLAMA_MODELS") or (Path.home() / ".ollama" / "models"))


def library_models() -> list[dict[str, Any]]:
    """GGUF blobs of models pulled with Ollama, as Yukti model entries (runnable by llama.cpp)."""
    base = models_dir()
    man_root = base / "manifests"
    out: list[dict[str, Any]] = []
    if not man_root.exists():
        return out
    for mf in man_root.rglob("*"):
        if not mf.is_file():
            continue
        try:
            doc = json.loads(mf.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        layers = doc.get("layers") or []
        model_layer = next((l for l in layers if l.get("mediaType") == "application/vnd.ollama.image.model"), None)
        if not model_layer:
            continue
        blob = base / "blobs" / model_layer["digest"].replace(":", "-")
        if not blob.exists():
            continue
        rel = mf.relative_to(man_root).parts  # registry / namespace / model / tag
        name = f"{rel[-2]}:{rel[-1]}" if len(rel) >= 2 else mf.name
        if len(rel) >= 3 and rel[-3] not in ("library",):
            name = f"{rel[-3]}/{name}"
        cfg: dict[str, Any] = {}
        cfg_layer = doc.get("config") or {}
        if cfg_layer.get("digest"):
            try:
                cfg = json.loads((base / "blobs" / cfg_layer["digest"].replace(":", "-")).read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                cfg = {}
        params = str(cfg.get("model_type") or "")
        try:
            params_b = float(params.upper().rstrip("B")) if params else None
        except ValueError:
            params_b = None
        out.append({
            "id": str(blob), "name": f"{name} (Ollama library)", "file_name": name, "path": str(blob),
            "size_bytes": blob.stat().st_size, "family": cfg.get("model_family") or name.split(":")[0],
            "params_b": params_b, "quant": cfg.get("file_type") or "?", "arch": cfg.get("model_family") or "",
            "source": "ollama-library", "vision": any(l.get("mediaType") == "application/vnd.ollama.image.projector" for l in layers),
        })
    return out
