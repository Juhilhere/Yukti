"""Isolated research layer for experimental models (for example a Heretic-style decensored model studied for
refinery-specific guardrails).

Isolation is enforced by the host, not by the model:
- the experimental model runs in its own llama.cpp process (or at a separate local URL), never as the production engine;
- the policy engine denies it every plant document and every workbench tool (`T-RESEARCH-ISOLATED`, env.layer=research);
- only holders of `research.use` can ask it, each question is audited (as a fingerprint), and every answer is labelled
  experimental. Production chats, the workbench, approvals and the optimizer never call it.
The administrator writes the research layer's own domain guardrails (system rules), which is what it is for.
"""
from __future__ import annotations

import hashlib
import subprocess
import threading
import time
from typing import Any

import httpx

from .db import get_setting, set_setting

_STATE: dict[str, Any] = {"status": "off", "url": None, "model": None, "proc": None, "error": None}
LABEL = "EXPERIMENTAL — research layer, isolated from plant documents, tools and approvals. Not for operational use."
DEFAULT_RULES = ("You are an experimental research model inside a refinery's isolated research sandbox. You have no access to "
                 "plant documents, systems or tools. State uncertainty plainly. Never give operating instructions, setpoints or "
                 "procedures as if they were approved.")


def config() -> dict[str, Any]:
    c = get_setting("research_layer", {}) or {}
    return {"model_id": c.get("model_id") or "", "url": c.get("url") or "", "guardrails": c.get("guardrails") or DEFAULT_RULES,
            "enabled": bool(c.get("enabled"))}


def save_config(body: dict[str, Any], actor: str) -> dict[str, Any]:
    c = config()
    for k in ("model_id", "url", "guardrails"):
        if k in body:
            c[k] = str(body[k] or "")[: 8000 if k == "guardrails" else 500]
    if "enabled" in body:
        c["enabled"] = bool(body["enabled"])
    if c["url"] and not c["url"].startswith(("http://127.", "http://localhost", "http://[::1]")):
        raise ValueError("The research layer must run on this server (a 127.0.0.1 / localhost address).")
    set_setting("research_layer", c, actor)
    return c


def status() -> dict[str, Any]:
    p = _STATE.get("proc")
    if p is not None and p.poll() is not None and _STATE["status"] == "ready":
        _STATE.update(status="error", error=f"research model exited with code {p.returncode}")
    return {k: _STATE[k] for k in ("status", "model", "error")} | {"label": LABEL, "enabled": config()["enabled"]}


def start(actor: str) -> dict[str, Any]:
    """Start the research model in its own process (or connect to its local URL). Never touches the production engine."""
    from . import engine
    from .config import LLAMA_BINARIES, pick_backend
    c = config()
    stop()
    if c["url"]:
        _STATE.update(status="ready", url=c["url"].rstrip("/"), model=c["model_id"] or "research", error=None)
        return status()
    m = engine.model_by_id(c["model_id"]) if c["model_id"] else None
    if not m:
        _STATE.update(status="error", error="Choose a model file for the research layer.")
        return status()
    if engine.state.model_id == m["id"]:
        _STATE.update(status="error", error="The research model must be a different model from the production model.")
        return status()
    binary = LLAMA_BINARIES.get(pick_backend("auto"))
    if not binary:
        _STATE.update(status="error", error="No llama.cpp build is available.")
        return status()
    port = engine._free_port(engine.LLAMA_PORT + 40)
    args = engine.filter_args(binary, [binary, "-m", m["path"], "-c", "4096", "-np", "1", "--fit", "on", "--host", "127.0.0.1",
                                       "--port", str(port), "--offline", "--no-webui"])
    try:
        proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except OSError as e:
        _STATE.update(status="error", error=str(e))
        return status()
    engine._attach_to_job(proc)
    _STATE.update(status="loading", proc=proc, url=f"http://127.0.0.1:{port}/v1", model=m["name"], error=None)

    def wait() -> None:
        for _ in range(1200):
            if proc.poll() is not None:
                _STATE.update(status="error", error=f"research model exited with code {proc.returncode}")
                return
            try:
                if httpx.get(f"http://127.0.0.1:{port}/health", timeout=1).status_code == 200:
                    _STATE["status"] = "ready"
                    return
            except Exception:  # noqa: BLE001
                pass
            time.sleep(0.5)
        _STATE.update(status="error", error="research model did not start in time")

    threading.Thread(target=wait, daemon=True, name="research-start").start()
    return status()


def stop() -> None:
    p = _STATE.get("proc")
    if p is not None and p.poll() is None:
        p.kill()
    _STATE.update(status="off", proc=None, url=None)


def fingerprint(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


async def ask(subject: Any, question: str) -> dict[str, Any]:
    """One question to the experimental model, with the research layer's own guardrails and nothing from the plant."""
    from .policy import pdp
    c = config()
    if not c["enabled"]:
        raise PermissionError("The research layer is switched off.")
    if _STATE["status"] != "ready" or not _STATE["url"]:
        raise RuntimeError("The research model is not running. An administrator starts it under Administration → Research layer.")
    # the isolation rule is checked like any other decision: a document or tool request from this layer is denied
    iso = pdp.decide(subject, "read", {"type": "document", "id": "*", "department": "", "classification": 0, "doc_type": "any",
                                       "asset_tags": [], "units": [], "status": "CURRENT"}, {"layer": "research"})
    t0 = time.time()
    async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=5)) as cl:
        r = await cl.post(f"{_STATE['url']}/chat/completions",
                          json={"messages": [{"role": "system", "content": c["guardrails"]}, {"role": "user", "content": question[:4000]}],
                                "temperature": 0.7, "max_tokens": 800, "stream": False})
    if r.status_code != 200:
        raise RuntimeError(f"Research model returned {r.status_code}.")
    text = (r.json().get("choices") or [{}])[0].get("message", {}).get("content") or ""
    return {"answer": text, "label": LABEL, "model": _STATE["model"], "ms": round((time.time() - t0) * 1000),
            "isolation": {"documents": "denied" if not iso.allowed else "ALLOWED", "rule": iso.matched}}
