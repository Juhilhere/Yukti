"""Yukti API — FastAPI app serving the REST/SSE API and the built SPA."""
from __future__ import annotations

import asyncio
import re
import os
import hashlib
import socket
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import psutil
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import admin, attachments, audit, chat, engine, laya, mrpl, production, rag, seed, speech
from .auth import Ctx, current, err, notify, router as auth_router, user_by_id
from .config import CLEARANCE_LABELS, CLEARANCE_BY_LABEL, DEMO_MODE, REPORTS, VERSION, WEB_DIST
from . import scope
from .db import ex, get_setting, init_db, j, new_id, now_iso, q, q1, set_setting, uj
from .llm_params import DEFAULT_PREDICTION, schema, vllm_command
from .policy import pdp
from .i18n import answer_language_instruction, get_lang, tr, tr_list

app = FastAPI(title="Yukti — Sovereign Industrial AI Workbench", version=VERSION, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.include_router(auth_router)
app.include_router(admin.router)

# ------------------------------------------------------------------ offline guard (egress block)
_ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1", "0.0.0.0"}
_BLOCKED = {"count": 0}
_orig_connect = socket.socket.connect
_orig_gai = socket.getaddrinfo


def _allowed(host: str) -> bool:
    return host in _ALLOWED_HOSTS or host.startswith("127.")


def _guard_connect(self, address):  # type: ignore[no-untyped-def]
    host = address[0] if isinstance(address, tuple) else str(address)
    if not _allowed(str(host)):
        _BLOCKED["count"] += 1
        raise ConnectionRefusedError(f"Yukti offline guard blocked egress to {host}")
    return _orig_connect(self, address)


def _guard_gai(host, *a, **k):  # type: ignore[no-untyped-def]
    if host is not None and not _allowed(str(host)):
        _BLOCKED["count"] += 1
        raise socket.gaierror(f"Yukti offline guard blocked DNS for {host}")
    res = _orig_gai(host, *a, **k)
    if host is not None:  # an allowed name (e.g. gpu.plant.local) may connect to the addresses it resolves to
        for r in res:
            try:
                _ALLOWED_HOSTS.add(str(r[4][0]))
            except Exception:
                pass
    return res


def _guard_async_connect(orig):  # type: ignore[no-untyped-def]
    async def sock_connect(self, sock, address):  # type: ignore[no-untyped-def]
        host = address[0] if isinstance(address, tuple) else str(address)
        if not _allowed(str(host)):
            _BLOCKED["count"] += 1
            raise ConnectionRefusedError(f"Yukti offline guard blocked egress to {host}")
        return await orig(self, sock, address)
    return sock_connect


def install_guard() -> None:
    bind = os.environ.get("YUKTI_HOST", "")
    if bind:
        _ALLOWED_HOSTS.add(bind)
    for u in (engine.DEFAULT_URLS.get("bionic"), engine.DEFAULT_URLS.get("vllm"), engine.DEFAULT_URLS.get("ollama")):
        h = urlparse(u or "").hostname  # engine addresses configured through environment variables
        if h:
            _ALLOWED_HOSTS.add(h)
    # asyncio (httpx async) connects through the event loop, not socket.connect: guard that path too
    import asyncio.proactor_events as _pe
    import asyncio.selector_events as _se
    for cls in (getattr(_pe, "BaseProactorEventLoop", None), getattr(_se, "BaseSelectorEventLoop", None)):
        if cls is not None and not getattr(cls.sock_connect, "_yukti_guard", False):
            wrapped = _guard_async_connect(cls.sock_connect)
            wrapped._yukti_guard = True  # type: ignore[attr-defined]
            cls.sock_connect = wrapped
    for r in q("SELECT base_url FROM engines WHERE base_url IS NOT NULL AND base_url != ''"):
        h = urlparse(r["base_url"]).hostname
        if h:
            _ALLOWED_HOSTS.add(h)
    socket.socket.connect = _guard_connect  # type: ignore[method-assign]
    socket.getaddrinfo = _guard_gai  # type: ignore[assignment]


STARTUP: dict[str, Any] = {"stage": "Starting", "done": 0, "total": 0, "knowledge_ready": False, "error": None}


def _prepare_knowledge() -> None:
    """First-start preparation (OCR of example documents, public MRPL briefings) runs in the background so the
    server answers immediately and clients can show real progress. Resumable if interrupted."""
    try:
        def prog(done: int, total: int, title: str) -> None:
            STARTUP.update(stage=f"Preparing knowledge base ({done + 1}/{total + 4})", done=done, total=total + 4)
        seed.ingest_examples(prog)
        seed.seed_workflows()
        STARTUP.update(stage="Loading MRPL public information", done=STARTUP["total"] - 4)
        mrpl.ensure_public_docs()
        seed.refresh_alert_notifications()
        STARTUP.update(stage="Knowledge base ready", done=STARTUP["total"], knowledge_ready=True)
    except Exception as e:  # pragma: no cover
        STARTUP.update(error=f"Knowledge preparation failed: {e!r}", knowledge_ready=True)
        engine.log("[startup] " + STARTUP["error"])


def startup() -> None:
    if admin.apply_pending_restore():
        engine.log("Restored database and documents from staged backup.")
    init_db()
    # ingestion jobs that were running when the server stopped will never finish: say so instead of spinning forever
    ex("UPDATE jobs SET status='error', error='Interrupted by a server restart - upload the file again.', updated_at=? "
       "WHERE status IN ('queued','running')", (now_iso(),))
    seed.run(ingest=False)          # accounts, departments, example assets: fast
    mrpl.ensure_departments()
    laya.get()
    install_guard()
    engine.cleanup_orphans()
    if os.environ.get("YUKTI_SYNC_STARTUP") == "1":
        _prepare_knowledge()        # tests: deterministic
    else:
        threading.Thread(target=_prepare_knowledge, daemon=True, name="prepare-knowledge").start()
    audit.write("system", "app.started", "api", {"version": VERSION})
    ai = admin.ai_settings()
    if ai.get("autoload", True) and os.environ.get("YUKTI_AUTOLOAD", "1") != "0":
        last = get_setting("last_loaded_model", "never")
        if ai.get("default_model_id"):  # administrator's configured default
            threading.Thread(target=engine.autoload, args=(ai.get("default_engine") or "llamacpp", ai["default_model_id"],
                                                            ai.get("default_load_config") or {}), daemon=True).start()
        elif isinstance(last, dict) and last.get("model_id"):  # the model the administrator loaded last
            threading.Thread(target=engine.autoload, args=(last.get("engine") or "llamacpp", last["model_id"],
                                                            last.get("load_config") or {}), daemon=True).start()
        elif last is None:
            engine.log("Model was unloaded by the administrator - not loading one at startup")
        else:
            threading.Thread(target=engine.autoload_default, daemon=True).start()


def shutdown() -> None:
    engine.unload()
    speech.stop()


from contextlib import asynccontextmanager  # noqa: E402


@asynccontextmanager
async def _lifespan(_app: FastAPI):  # type: ignore[no-untyped-def]
    startup()
    try:
        yield
    finally:
        shutdown()


app.router.lifespan_context = _lifespan


@app.exception_handler(HTTPException)
async def http_exc(request: Request, exc: HTTPException) -> JSONResponse:
    d = exc.detail if isinstance(exc.detail, dict) else {"code": "error", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"detail": d})


# ------------------------------------------------------------------ system
_SYS_CACHE: dict[str, Any] = {}


def gpu_stats() -> dict[str, Any] | None:
    try:
        import pynvml
        pynvml.nvmlInit()
        h = pynvml.nvmlDeviceGetHandleByIndex(0)
        mem = pynvml.nvmlDeviceGetMemoryInfo(h)
        util = pynvml.nvmlDeviceGetUtilizationRates(h)
        name = pynvml.nvmlDeviceGetName(h)
        return {"name": name.decode() if isinstance(name, bytes) else name, "vram_total_mb": mem.total // 2**20,
                "vram_used_mb": mem.used // 2**20, "util_pct": util.gpu}
    except Exception:
        return None


@app.get("/api/system")
def system(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    vm = psutil.virtual_memory()
    if "cpu_name" not in _SYS_CACHE:
        import platform
        _SYS_CACHE["cpu_name"] = platform.processor() or platform.machine()
        try:
            import subprocess
            out = subprocess.run(["powershell", "-NoProfile", "-c", "(Get-CimInstance Win32_Processor).Name"], capture_output=True, text=True, timeout=8)
            if out.stdout.strip():
                _SYS_CACHE["cpu_name"] = out.stdout.strip()
        except Exception:
            pass
    if "developer" not in ctx.perms:  # employees see only that the platform is offline and healthy
        return {"offline_guard": True, "version": VERSION}
    return {"gpu": gpu_stats(), "ram": {"total_mb": vm.total // 2**20, "used_mb": (vm.total - vm.available) // 2**20},
            "cpu": {"name": _SYS_CACHE["cpu_name"], "cores": psutil.cpu_count(False), "threads": psutil.cpu_count(),
                    "util_pct": psutil.cpu_percent(interval=None)},
            "llama_build": engine.cached_llama_version(), "offline_guard": True, "egress_blocked": _BLOCKED["count"],
            "version": VERSION, "audit_head": audit.head()[:16], "last_stats": engine.state.last_stats}


# ------------------------------------------------------------------ engines & models
@app.get("/api/engines")
async def engines(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ctx.require("models.manage")
    return [_probe_out(p) for p in await asyncio.gather(*(engine.probe(e) for e in engine.ENGINE_IDS))]


def _probe_out(p: dict[str, Any]) -> dict[str, Any]:
    """Engine status as shown to the administrator: name, description and problem in the user's language."""
    return {**p, **{k: tr(p[k]) for k in ("name", "description", "error") if p.get(k)}}


def _engine_out(pub: dict[str, Any]) -> dict[str, Any]:
    return {**pub, "error": tr(pub.get("error"))} if pub.get("error") else pub


@app.put("/api/engines/{eid}")
async def set_engine(eid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    if eid not in engine.ENGINE_META or eid == "llamacpp":
        raise err(404, "not_found", "Unknown engine")
    base = str(body.get("base_url") or "").strip().rstrip("/")
    if base and not re.match(r"^https?://", base):
        base = "http://" + base
    if base and (not urlparse(base).hostname or re.search(r"\s", base) or not re.match(r"^https?://[A-Za-z0-9.\-\[\]:]+(/|$)", base)):
        raise err(422, "invalid", "Enter a server address such as http://127.0.0.1:11434 or http://gpu-server:8000/v1")
    if eid == "ollama" and base:
        from . import ollama as _ol
        base = _ol.root(base)
    prev = q1("SELECT api_key FROM engines WHERE id=?", (eid,))
    key = body["api_key"] if "api_key" in body else (prev["api_key"] if prev else None)  # keep the saved key unless replaced
    ex("INSERT OR REPLACE INTO engines(id, base_url, api_key) VALUES(?,?,?)", (eid, base, key or None))
    body = {**body, "base_url": base}
    h = urlparse(base).hostname
    if h:
        _ALLOWED_HOSTS.add(h)
    audit.write(ctx.actor, "engine.configured", f"engine:{eid}", {"base_url": body.get("base_url")})
    return _probe_out(await engine.probe(eid))


@app.delete("/api/engines/{eid}")
async def reset_engine(eid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    """Forget a saved address/API key: the engine goes back to its default address."""
    ctx.require("models.manage")
    if eid not in engine.ENGINE_META or eid == "llamacpp":
        raise err(404, "not_found", "Unknown engine")
    ex("DELETE FROM engines WHERE id=?", (eid,))
    audit.write(ctx.actor, "engine.reset", f"engine:{eid}")
    return _probe_out(await engine.probe(eid))


@app.get("/api/models")
async def models(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ctx.require("models.manage")
    ms = engine.scan_models()
    infos = await asyncio.gather(*(engine.probe(e) for e in ("ollama", "bionic", "vllm", "remote")))
    for eid, info in zip(("ollama", "bionic", "vllm", "remote"), infos):
        if eid == "ollama":
            for m in info.get("model_info") or []:
                pb = re.match(r"([\d.]+)\s*[bB]", m.get("params") or "")
                ms.append({"id": m["id"], "name": m["id"], "file_name": f"Ollama · {m['id']}", "path": "", "size_bytes": m["size_bytes"],
                           "family": m.get("family") or m["id"].split(":")[0], "params_b": float(pb.group(1)) if pb else None,
                           "quant": m.get("quant") or "?", "arch": m.get("family") or "", "source": "ollama", "engine": "ollama", "vision": bool(m.get("vision"))})
            continue
        for mid in info.get("models", []) or []:
            ms.append({"id": mid, "name": mid, "file_name": "", "path": "", "size_bytes": 0, "family": mid.split("/")[-1].split("-")[0],
                       "params_b": None, "quant": "?", "arch": "", "source": "engine", "engine": eid, "vision": False})
    return ms


@app.get("/api/models/loaded")
def loaded(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    pub = _engine_out(engine.state.public())
    if "models.manage" not in ctx.perms:
        return {k: pub[k] for k in ("status", "engine", "model_name", "vision")}
    return pub


@app.post("/api/models/load")
def load_model(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    eid = body.get("engine", "llamacpp")
    if eid not in engine.ENGINE_META:
        raise err(422, "invalid", f"Unknown engine '{eid}'")
    if not str(body.get("model_id") or "").strip():
        raise err(422, "invalid", "Choose a model to load")
    local = engine.model_by_id(str(body["model_id"]))
    if local and eid != "llamacpp":
        raise err(422, "invalid", f"'{local['name']}' is a model file; it runs on the built-in llama.cpp engine, not {engine.ENGINE_META[eid][0]}.")
    if not local and eid == "llamacpp":
        raise err(422, "invalid", "That model file was not found. Choose a model listed under the Yukti models folder, LM Studio or the Ollama library.")
    res = engine.load(eid, body["model_id"], body.get("load_config") or {})
    set_setting("last_loaded_model", {"engine": eid, "model_id": body["model_id"], "load_config": body.get("load_config") or {}}, ctx.actor)
    audit.write(ctx.actor, "model.load", f"model:{body['model_id']}", {"engine": body.get("engine"), "config": body.get("load_config")})
    return _engine_out(res)


@app.post("/api/models/unload")
def unload_model(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    engine.unload()
    set_setting("last_loaded_model", None, ctx.actor)  # an explicit unload stays unloaded after a restart
    audit.write(ctx.actor, "model.unload", "model")
    return {"ok": True}


@app.get("/api/params/schema")
def params_schema(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("ai.settings")
    from .i18n_params import translate_schema
    return translate_schema(schema(engine.scan_models()), get_lang())  # translated copy; the module lists stay English


@app.post("/api/models/command-preview")
def command_preview(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    from .llm_params import llama_args
    m = engine.model_by_id(body.get("model_id", "")) or {"path": body.get("model_id", "<model.gguf>"), "name": "model"}
    cfg = body.get("load_config") or {}
    return {"llamacpp": "llama-server " + " ".join(llama_args(cfg, m["path"], cfg.get("draft_model") or None)),
            "vllm": vllm_command(cfg, body.get("hf_model", "Qwen/Qwen3.8-27B-FP8"))}


# ------------------------------------------------------------------ presets
@app.get("/api/presets")
def presets(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ctx.require("ai.settings")
    rows = q("SELECT * FROM presets WHERE builtin=1 OR user_id=? ORDER BY builtin DESC, created_at", (ctx.user["id"],))
    return [{"id": r["id"], "name": r["name"], "description": r["description"], "system_prompt": r["system_prompt"],
             "prediction": uj(r["prediction_json"], {}), "load": uj(r["load_json"], {}), "builtin": bool(r["builtin"])} for r in rows]


@app.post("/api/presets")
def create_preset(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("ai.settings")
    pid = new_id()
    ex("INSERT INTO presets(id, user_id, name, description, system_prompt, prediction_json, load_json, builtin, created_at) VALUES(?,?,?,?,?,?,?,0,?)",
       (pid, ctx.user["id"], body.get("name", "Preset"), body.get("description", ""), body.get("system_prompt", ""),
        j(body.get("prediction", {})), j(body.get("load", {})), now_iso()))
    return next(p for p in presets(ctx) if p["id"] == pid)


@app.put("/api/presets/{pid}")
def update_preset(pid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("ai.settings")
    if q1("SELECT 1 FROM presets WHERE id=? AND builtin=1", (pid,)):
        raise err(403, "builtin_preset", "Built-in presets cannot be changed. Save your changes as a new preset.")
    ex("UPDATE presets SET name=?, description=?, system_prompt=?, prediction_json=?, load_json=? WHERE id=? AND user_id=?",
       (body.get("name"), body.get("description", ""), body.get("system_prompt", ""), j(body.get("prediction", {})),
        j(body.get("load", {})), pid, ctx.user["id"]))
    return next((p for p in presets(ctx) if p["id"] == pid), {})


@app.delete("/api/presets/{pid}")
def delete_preset(pid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("ai.settings")
    if q1("SELECT 1 FROM presets WHERE id=? AND builtin=1", (pid,)):
        raise err(403, "builtin_preset", "Built-in presets cannot be deleted.")
    ex("DELETE FROM presets WHERE id=? AND user_id=? AND builtin=0", (pid, ctx.user["id"]))
    return {"ok": True}


# ------------------------------------------------------------------ projects & chats
@app.get("/api/projects")
def projects(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    return q("""SELECT p.id, p.name, (SELECT COUNT(*) FROM chats c WHERE c.project_id=p.id) chat_count
                FROM projects p WHERE p.user_id=? ORDER BY p.created_at""", (ctx.user["id"],))


@app.post("/api/projects")
def create_project(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    pid = new_id()
    name = str(body.get("name") or "").strip()[:80] or "New folder"
    ex("INSERT INTO projects(id, user_id, name, created_at) VALUES(?,?,?,?)", (pid, ctx.user["id"], name, now_iso()))
    return {"id": pid, "name": name, "chat_count": 0}


@app.patch("/api/projects/{pid}")
def rename_project(pid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    name = str(body.get("name") or "").strip()[:80]
    if not name:
        raise err(422, "invalid", "Enter a folder name")
    if not q1("SELECT 1 FROM projects WHERE id=? AND user_id=?", (pid, ctx.user["id"])):
        raise err(404, "not_found", "Folder not found")
    ex("UPDATE projects SET name=? WHERE id=?", (name, pid))
    return {"id": pid, "name": name}


@app.delete("/api/projects/{pid}")
def delete_project(pid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    """Deletes the folder only; its chats move back to the main list."""
    if not q1("SELECT 1 FROM projects WHERE id=? AND user_id=?", (pid, ctx.user["id"])):
        raise err(404, "not_found", "Folder not found")
    ex("UPDATE chats SET project_id=NULL WHERE project_id=? AND user_id=?", (pid, ctx.user["id"]))
    ex("DELETE FROM projects WHERE id=?", (pid,))
    return {"ok": True}


@app.get("/api/chats")
def chats(project_id: str | None = None, ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    rows = q("""SELECT c.id, c.title, c.project_id, c.updated_at, (SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id) message_count
                FROM chats c WHERE c.user_id=? ORDER BY c.updated_at DESC""", (ctx.user["id"],))
    if project_id:
        rows = [r for r in rows if r["project_id"] == project_id]
    return rows


def _own_project(pid: Any, ctx: Ctx) -> str | None:
    if not pid:
        return None
    if not q1("SELECT 1 FROM projects WHERE id=? AND user_id=?", (pid, ctx.user["id"])):
        raise err(404, "not_found", "Project not found")
    return str(pid)


@app.post("/api/chats")
def create_chat(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    cid = new_id()
    body = {**body, "project_id": _own_project(body.get("project_id"), ctx)}
    ex("INSERT INTO chats(id, user_id, project_id, title, system_prompt, prediction_json, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)",
       (cid, ctx.user["id"], body.get("project_id"), body.get("title") or "New chat", "", j({}), now_iso(), now_iso()))
    return get_chat(cid, ctx)


@app.get("/api/chats/{cid}")
def get_chat(cid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    c = q1("SELECT * FROM chats WHERE id=? AND user_id=?", (cid, ctx.user["id"]))
    if not c:
        raise err(404, "not_found", "Chat not found")
    msgs = q("SELECT * FROM messages WHERE chat_id=? ORDER BY created_at, rowid", (cid,))
    return {"id": c["id"], "title": c["title"], "project_id": c["project_id"], "system_prompt": c["system_prompt"] or "",
            "prediction": ({**admin.ai_settings()["prediction"], **uj(c["prediction_json"], {})} if "ai.settings" in ctx.perms else {}),
            "messages": [_recheck_sources(chat.message_out(m), ctx) for m in msgs],
            "updated_at": c["updated_at"]}


def _recheck_sources(m: dict[str, Any], ctx: Ctx) -> dict[str, Any]:
    srcs = m.get("sources") or []
    if not srcs:
        return m
    out = []
    for sr in srcs:
        d = q1("SELECT * FROM documents WHERE id=?", (sr.get("document_id"),)) if isinstance(sr, dict) else None
        if d and rag.can_read(ctx.subject, d, "cite"):
            out.append(sr)
        elif isinstance(sr, dict):
            out.append({**sr, "snippet": "", "withheld": True, "title": tr("Document no longer available to you")})
    return {**m, "sources": out}


@app.patch("/api/chats/{cid}")
def patch_chat(cid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    c = q1("SELECT * FROM chats WHERE id=? AND user_id=?", (cid, ctx.user["id"]))
    if not c:
        raise err(404, "not_found", "Chat not found")
    ex("UPDATE chats SET title=?, system_prompt=?, prediction_json=?, project_id=?, updated_at=? WHERE id=?",
       (body.get("title", c["title"]), body.get("system_prompt", c["system_prompt"]),
        j(body["prediction"]) if "prediction" in body else c["prediction_json"],
        _own_project(body["project_id"], ctx) if "project_id" in body else c["project_id"], now_iso(), cid))
    return get_chat(cid, ctx)


@app.delete("/api/chats/{cid}")
def delete_chat(cid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    if q1("SELECT 1 FROM chats WHERE id=? AND user_id=?", (cid, ctx.user["id"])):
        attachments.delete(ctx.user["id"], chat.chat_images(cid))  # the chat's photos go with it
    ex("DELETE FROM chats WHERE id=? AND user_id=?", (cid, ctx.user["id"]))
    return {"ok": True}


@app.post("/api/attachments")
async def upload_photo(file: UploadFile = File(...), ctx: Ctx = Depends(current)) -> dict[str, Any]:
    """A photo for a chat question: cleaned (no EXIF/GPS), resized, visible only to the uploader."""
    data = await file.read(attachments.MAX_BYTES + 1)
    try:
        out = await asyncio.to_thread(attachments.save, ctx.user["id"], data)
    except attachments.PhotoError as e:
        raise err(e.status, e.code, e.message)
    audit.write(ctx.actor, "photo.upload", f"photo:{out['id']}", {"bytes": out["size_bytes"], "w": out["width"], "h": out["height"]})
    return out


@app.get("/api/attachments/{aid}")
def get_photo(aid: str, thumb: int = 0, ctx: Ctx = Depends(current)) -> FileResponse:
    try:
        p = attachments.file_path(ctx.user["id"], aid, bool(thumb))
    except attachments.PhotoError as e:
        raise err(e.status, e.code, e.message)
    return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/features")
def features(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    """Optional abilities (downloaded later by the desktop app on the server computer): photos and voice."""
    return {
        "vision": {"installed": any(m.get("mmproj") for m in engine.scan_models()),
                   "active": engine.state.status == "ready" and engine.state.vision},
        "voice": {"installed": bool(speech.status().get("available"))},
        "can_manage": "models.manage" in ctx.perms,
    }


@app.get("/api/speech/status")
def speech_status(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    st = speech.status()
    return {**st, "reason": tr(st["reason"])} if st.get("reason") else st


@app.post("/api/speech/transcribe")
async def speech_transcribe(audio: UploadFile = File(...), language: str = Form("auto"), ctx: Ctx = Depends(current)) -> dict[str, Any]:
    """Microphone recording -> text for the question box (never sent to the model automatically)."""
    data = await audio.read(4 * 1024 * 1024)  # 60 s of 16 kHz 16-bit mono is ~1.9 MB
    try:
        out = await speech.transcribe(ctx.subject, data, language)
    except speech.SpeechError as e:
        raise err(e.status, e.code, e.message)
    audit.write(ctx.actor, "speech.transcribe", "speech", {"seconds": out["duration_s"], "language": out["language"],
                                                          "device": out.get("device"), "chars": len(out["text"])})
    return out


def _sse_response(gen) -> StreamingResponse:  # type: ignore[no-untyped-def]
    return StreamingResponse(gen, media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/chats/{cid}/messages")
async def send_message(cid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> StreamingResponse:
    c = q1("SELECT * FROM chats WHERE id=? AND user_id=?", (cid, ctx.user["id"]))
    if not c:
        raise err(404, "not_found", "Chat not found")
    org = admin.ai_settings()
    if "ai.settings" in ctx.perms:  # admins may override per chat (testing)
        pred = {**org["prediction"], **(body.get("prediction") or uj(c["prediction_json"], {}))}
        sp = body.get("system_prompt") if body.get("system_prompt") is not None else (c["system_prompt"] or org["system_prompt"])
        if body.get("prediction") is not None or body.get("system_prompt") is not None:
            ex("UPDATE chats SET prediction_json=?, system_prompt=? WHERE id=?", (j(body.get("prediction") or {}), sp or "", cid))
    else:  # employees always use organisation settings
        pred, sp = org["prediction"], org["system_prompt"]
    images = body.get("images") or []
    if not isinstance(images, list) or not all(isinstance(x, str) for x in images):
        raise err(422, "invalid", "images must be a list of photo ids")
    if len(images) > attachments.MAX_PER_MESSAGE:
        raise err(422, "invalid", f"At most {attachments.MAX_PER_MESSAGE} photos per question")
    content = str(body.get("content", ""))
    if not content.strip() and not images:
        raise err(422, "invalid", "Type a question or attach a photo")
    return _sse_response(chat.run_turn(ctx, cid, content, sp, pred, bool(body.get("use_knowledge", True)), images=images))


@app.post("/api/chats/{cid}/regenerate")
async def regenerate(cid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> StreamingResponse:
    c = q1("SELECT * FROM chats WHERE id=? AND user_id=?", (cid, ctx.user["id"]))
    last_user = chat.last_user_turn(cid) if c else None
    if not c or not last_user:
        raise err(404, "not_found", "Nothing to regenerate")
    org = admin.ai_settings()
    if "ai.settings" in ctx.perms:
        pred, spr = {**org["prediction"], **(body.get("prediction") or uj(c["prediction_json"], {}))}, (c["system_prompt"] or org["system_prompt"])
    else:
        pred, spr = org["prediction"], org["system_prompt"]
    return _sse_response(chat.run_turn(ctx, cid, last_user["content"], spr, pred, bool(body.get("use_knowledge", True)), regenerate=True,
                                       images=last_user["images"]))


@app.post("/api/chats/{cid}/stop")
def stop(cid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    if not q1("SELECT 1 FROM chats WHERE id=? AND user_id=?", (cid, ctx.user["id"])):
        raise err(404, "not_found", "Chat not found")
    chat.request_stop(cid)
    return {"ok": True}


# ------------------------------------------------------------------ documents
def _doc_out(d: dict[str, Any]) -> dict[str, Any]:
    pm = q("SELECT mode, COUNT(*) n FROM pages WHERE document_id=? GROUP BY mode", (d["id"],))
    modes = {r["mode"]: r["n"] for r in pm}
    return {"id": d["id"], "title": d["title"], "doc_number": d["doc_number"], "revision": d["revision"], "status": d["status"],
            "doc_type": d["doc_type"], "department": d["department"], "classification": CLEARANCE_LABELS[int(d["classification"])],
            "pages": d["pages"], "page_modes": {"digital": modes.get("digital", 0), "scanned": modes.get("scanned", 0) + modes.get("image", 0)},
            "asset_tags": uj(d["asset_tags_json"], []), "created_at": d["created_at"], "size_bytes": d["size_bytes"],
            "file_name": d["file_name"], "effective_date": d["effective_date"], "is_example": bool(d.get("is_example")),
            "is_public": bool(d.get("is_public")), "source_url": d.get("source_url")}


@app.get("/api/documents")
def documents(request: Request, ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    qs = request.query_params.get("q")
    docs = [_doc_out(d) for d in rag.visible_documents(ctx.subject)]
    if qs:
        ql = qs.lower()
        docs = [d for d in docs if ql in (d["title"] + " " + (d["doc_number"] or "") + " " + " ".join(d["asset_tags"])).lower()]
    return docs


def _run_ingest(did: str, jid: str, actor: str) -> None:
    try:
        rag.ingest(did, jid, actor)  # records its own failure in the job (shown to the HOD)
    except Exception as e:  # noqa: BLE001
        engine.log(f"[ingest] {did}: {e!r}")


@app.post("/api/documents")
async def upload(background: BackgroundTasks, file: UploadFile = File(...), title: str = Form(""), doc_type: str = Form("other"),
                 department: str = Form("Operations"), classification: str = Form("INTERNAL"), doc_number: str = Form(""),
                 revision: str = Form(""), ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("documents.upload")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in rag.SUPPORTED_EXTS:
        raise err(422, "unsupported_type", f"'{ext or 'no extension'}' files cannot be indexed. Supported: " + ", ".join(sorted(rag.SUPPORTED_EXTS)))
    data = await file.read()
    if len(data) > 50 * 2**20:
        raise err(413, "too_large", "Max 50 MB")
    cl = CLEARANCE_BY_LABEL.get(classification.upper(), 1)
    if cl > ctx.subject.clearance:
        raise err(403, "policy_denied", "You cannot upload above your own clearance.")
    department = ctx.user["department"]  # HODs add data only for their own department
    if doc_type not in scope.UPLOAD_DOC_TYPES:
        raise err(422, "invalid", f"Unknown document type '{doc_type}'.")
    need = scope.RESTRICTED_UPLOAD_TYPES.get(doc_type)
    if need and need not in ctx.subject.roles:
        raise err(403, "policy_denied", f"{doc_type} documents are shared plant-wide and can be added only by the {need.replace('_', ' ')} office.")
    same = q1("SELECT title FROM documents WHERE sha256=? AND department=?", (hashlib.sha256(data).hexdigest(), department))
    if same:
        raise err(409, "duplicate", f"This exact file is already in Knowledge as “{same['title']}”.")
    if doc_number and q1("SELECT 1 FROM documents WHERE doc_number=? AND department<>?", (doc_number, department)):
        raise err(409, "conflict", f"Document number {doc_number} belongs to another department.")
    did = rag.create_document({"title": title or Path(file.filename or "upload").stem, "doc_type": doc_type, "department": department,
                               "classification": cl, "doc_number": doc_number or None, "revision": revision,
                               "effective_date": date.today().isoformat()}, file.filename or "upload.bin", data, ctx.actor)
    jid = rag.job_create("ingest", did, ctx.actor)
    audit.write(ctx.actor, "document.uploaded", f"document:{did}", {"file": file.filename, "size": len(data), "classification": classification})
    background.add_task(_run_ingest, did, jid, ctx.actor)
    return {"document_id": did, "job_id": jid}


@app.get("/api/jobs/{jid}")
def job(jid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    r = q1("SELECT * FROM jobs WHERE id=?", (jid,))
    if not r or (r.get("created_by") and r["created_by"] != ctx.actor and "admin" not in ctx.subject.roles):
        raise err(404, "not_found", "Job not found")
    stages = [{**s, "name": tr(s.get("name")), "detail": tr(s.get("detail"))} for s in uj(r["stages_json"], []) if isinstance(s, dict)]
    return {"id": r["id"], "status": r["status"], "stages": stages, "document_id": r["document_id"], "error": tr(r["error"])}


def _doc_or_403(did: str, ctx: Ctx) -> dict[str, Any]:
    d = q1("SELECT * FROM documents WHERE id=?", (did,))
    if not d:
        raise err(404, "not_found", "Document not found")
    dec = pdp.decide(ctx.subject, "read", rag.doc_resource(d))
    if not dec.allowed:
        audit.write(ctx.actor, "document.denied", f"document:{did}", {"rules": dec.matched})
        raise err(403, "policy_denied", dec.reason)
    return d


@app.get("/api/documents/{did}")
def document(did: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    d = _doc_or_403(did, ctx)
    out = _doc_out(d)
    out["pages_detail"] = q("SELECT page_no, mode, text, ocr_conf FROM pages WHERE document_id=? ORDER BY page_no", (did,))
    out["pages_list"] = out["pages_detail"]
    audit.write(ctx.actor, "document.read", f"document:{did}")
    return {**out, "pages": out["pages_detail"], "page_count": d["pages"]}


@app.get("/api/documents/{did}/file")
def document_file(did: str, ctx: Ctx = Depends(current)) -> FileResponse:
    d = _doc_or_403(did, ctx)
    return FileResponse(d["file_path"], filename=d["file_name"], media_type=d["mime"])


@app.delete("/api/documents/{did}")
def delete_document(did: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("documents.upload")
    d = _doc_or_403(did, ctx)
    if d["department"] != ctx.user["department"] or d.get("is_public"):
        raise err(403, "policy_denied", "HODs can remove only their own department's documents.")
    for c in q("SELECT id FROM chunks WHERE document_id=?", (did,)):
        ex("DELETE FROM chunks_fts WHERE chunk_id=?", (c["id"],))
    ex("DELETE FROM pages WHERE document_id=?", (did,))
    ex("DELETE FROM chunks WHERE document_id=?", (did,))
    ex("DELETE FROM documents WHERE id=?", (did,))
    try:  # the stored file goes too (removed data must not linger on disk)
        if d.get("file_path") and not q1("SELECT 1 FROM documents WHERE file_path=?", (d["file_path"],)):
            Path(d["file_path"]).unlink(missing_ok=True)
    except OSError as e:
        engine.log(f"[documents] could not delete {d.get('file_path')}: {e}")
    audit.write(ctx.actor, "document.deleted", f"document:{did}")
    return {"ok": True}


# ------------------------------------------------------------------ access requests & grants
def _ar_out(r: dict[str, Any], ctx: Ctx) -> dict[str, Any]:
    req = user_by_id(r["requester_id"]) or {}
    appr = user_by_id(r["approver_id"]) or {}
    doc = q1("SELECT * FROM documents WHERE id=?", (r["document_id"],)) if r["document_id"] else None
    if doc and (r["approver_id"] == ctx.user["id"] or rag.can_read(ctx.subject, doc)):
        label = doc["title"]
    elif doc:
        label = f"A {r['department']} document"
    else:
        label = f"{r['department']} documents" + (f" ({r['doc_type']})" if r["doc_type"] else "")
    return {"id": r["id"], "requester": req.get("username"), "requester_name": req.get("display_name"), "resource_label": tr(label),
            "department": r["department"], "justification": r["justification"], "hours": r["hours"], "state": r["state"],
            "created_at": r["created_at"], "decided_at": r["decided_at"], "approver_name": appr.get("display_name"), "note": r["note"]}


def _approver_for(dept: str) -> str | None:
    d = q1("SELECT manager_user_id FROM departments WHERE code=?", (dept,))
    return d["manager_user_id"] if d else None


def _escalation_user() -> str | None:
    """Refinery management (plant manager role) handles escalations and requests without a department HOD."""
    for u in q("SELECT id, roles_json FROM users WHERE status='active' ORDER BY created_at"):
        if "plant_manager" in uj(u["roles_json"], []):
            return u["id"]
    return None


@app.get("/api/access-requests")
def access_requests(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    mine = q("SELECT * FROM access_requests WHERE requester_id=? ORDER BY created_at DESC", (ctx.user["id"],))
    to_approve = q("SELECT * FROM access_requests WHERE approver_id=? ORDER BY state='PENDING' DESC, created_at DESC", (ctx.user["id"],))
    return {"mine": [_ar_out(r, ctx) for r in mine], "to_approve": [_ar_out(r, ctx) for r in to_approve]}


@app.post("/api/access-requests")
def create_access_request(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    if body.get("document_id"):
        dept = (q1("SELECT department FROM documents WHERE id=?", (body.get("document_id"),)) or {}).get("department")
    else:
        dept = body.get("department")
        if dept and not q1("SELECT 1 FROM departments WHERE code=? OR name=?", (dept, dept)):
            raise err(422, "invalid", f"Unknown department '{dept}'.")
    if not dept:
        raise err(422, "invalid", "department or document_id required")
    if len(str(body.get("justification") or "").strip()) < 5:
        raise err(422, "invalid", "Explain briefly why you need access (at least 5 characters).")
    if q1("SELECT 1 FROM access_requests WHERE requester_id=? AND department=? AND IFNULL(document_id,'')=? AND state='PENDING'",
          (ctx.user["id"], dept, body.get("document_id") or "")):
        raise err(409, "duplicate", f"You already have a pending request for {dept}. Wait for the decision (see Inbox → Access requests).")
    approver = _approver_for(dept)
    if not approver or approver == ctx.user["id"]:
        approver = _escalation_user()
    if not approver or approver == ctx.user["id"]:
        raise err(409, "conflict", "No approver is configured for this department. Ask the administrator to assign its HOD.")
    rid = new_id()
    hours = max(1, min(int(body.get("hours", 2)), 72))
    ex("""INSERT INTO access_requests(id, requester_id, department, doc_type, document_id, justification, hours, state, approver_id, created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)""",
       (rid, ctx.user["id"], dept, body.get("doc_type"), body.get("document_id"), body.get("justification", ""), hours, "PENDING", approver, now_iso()))
    notify(approver, "access_request", f"Access request from {ctx.user['display_name']}",
           f"{dept} documents for {hours} h — “{body.get('justification', '')}”", "/inbox?tab=access")
    audit.write(ctx.actor, "access.requested", f"access_request:{rid}", {"department": dept, "hours": hours})
    return _ar_out(q1("SELECT * FROM access_requests WHERE id=?", (rid,)), ctx)


def _decide(rid: str, ctx: Ctx, approve: bool, body: dict[str, Any]) -> dict[str, Any]:
    ctx.require("access.approve")
    r = q1("SELECT * FROM access_requests WHERE id=?", (rid,))
    if not r:
        raise err(404, "not_found", "Request not found")
    if r["approver_id"] != ctx.user["id"]:  # business access is decided by the responsible HOD, never by IT
        raise err(403, "policy_denied", "You are not the approver for this request.")
    if r["requester_id"] == ctx.user["id"]:
        raise err(403, "policy_denied", "You cannot approve your own request.")
    if r["state"] != "PENDING":
        raise err(409, "conflict", f"Request already {r['state']}")
    if approve:
        hours = max(1, min(int(body.get("hours", r["hours"])), int(r["hours"]) if int(r["hours"]) else 72))  # may narrow, never widen
        # rank: an approver can never grant more than their own clearance; they may choose a lower ceiling
        ceiling = ctx.subject.clearance
        if body.get("max_classification") is not None:
            want = body["max_classification"]
            want = CLEARANCE_BY_LABEL.get(str(want).upper(), want) if isinstance(want, str) else want
            ceiling = max(0, min(int(want), ceiling))
        if r["document_id"]:
            d = q1("SELECT classification FROM documents WHERE id=?", (r["document_id"],))
            if d and int(d["classification"]) > ceiling:
                raise err(403, "policy_denied", "This document is classified above your clearance; escalate the request to refinery management.")
        exp = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(timespec="seconds")
        ex("""INSERT INTO grants(id, user_id, department, doc_type, document_id, expires_at, approved_by, request_id, created_at, max_classification)
              VALUES(?,?,?,?,?,?,?,?,?,?)""",
           (new_id(), r["requester_id"], r["department"], r["doc_type"], r["document_id"], exp, ctx.user["id"], rid, now_iso(), ceiling))
        ex("UPDATE access_requests SET state='GRANTED', decided_at=?, hours=?, note=? WHERE id=?", (now_iso(), hours, body.get("note", ""), rid))
        ex("UPDATE users SET attr_version=attr_version+1 WHERE id=?", (r["requester_id"],))
        notify(r["requester_id"], "access_granted", f"Access granted: {r['department']} documents for {hours} h",
               f"Approved by {ctx.user['display_name']} — expires {exp[:16].replace('T', ' ')} UTC", "/chat")
        audit.write(ctx.actor, "access.granted", f"access_request:{rid}",
                    {"hours": hours, "expires_at": exp, "max_classification": CLEARANCE_LABELS[ceiling]})
    else:
        ex("UPDATE access_requests SET state='REJECTED', decided_at=?, note=? WHERE id=?", (now_iso(), body.get("note", ""), rid))
        notify(r["requester_id"], "access_rejected", "Access request rejected", body.get("note", ""), "/inbox?tab=access")
        audit.write(ctx.actor, "access.rejected", f"access_request:{rid}", {"note": body.get("note", "")})
    return _ar_out(q1("SELECT * FROM access_requests WHERE id=?", (rid,)), ctx)


@app.post("/api/access-requests/{rid}/approve")
def approve(rid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    return _decide(rid, ctx, True, body)


@app.post("/api/access-requests/{rid}/reject")
def reject(rid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    return _decide(rid, ctx, False, body)


@app.get("/api/grants")
def grants(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    out = []
    for g in q("SELECT * FROM grants WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY expires_at", (ctx.user["id"], now_iso())):
        a = user_by_id(g["approved_by"]) or {}
        lvl = g.get("max_classification")
        out.append({"id": g["id"], "scope": tr(f"{g['department']} documents" + (f" up to {CLEARANCE_LABELS[int(lvl)]}" if lvl is not None else "")),
                    "expires_at": g["expires_at"], "approved_by": a.get("display_name")})
    return out


# ------------------------------------------------------------------ assets, alerts, notifications
def _items(tag: str) -> list[dict[str, Any]]:
    today = date.today()
    out = []
    for it in q("SELECT * FROM ledger_items WHERE tag=? ORDER BY expires_on", (tag,)):
        dl = (date.fromisoformat(it["expires_on"]) - today).days if it["expires_on"] else None
        st = "expired" if dl is not None and dl < 0 else "amber" if dl is not None and dl <= 30 else "green"
        out.append({"type": it["type"], "ref_no": it["ref_no"], "issued_on": it["issued_on"], "expires_on": it["expires_on"], "days_left": dl, "status": st})
    return out


@app.get("/api/assets")
def assets(request: Request, ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    qs = (request.query_params.get("q") or "").lower()
    out = []
    for a in q("SELECT * FROM assets ORDER BY unit, tag"):
        if not scope.asset_visible(ctx.subject, a):
            continue
        if qs and qs not in (a["tag"] + " " + a["name"] + " " + (a["unit"] or "")).lower():
            continue
        items = _items(a["tag"])
        out.append({**{k: a[k] for k in ("tag", "name", "unit", "class", "vendor", "serial", "location", "owner_department", "criticality", "model")},
                    "is_example": bool(a.get("is_example")), "items": items, "nearest_days": min((i["days_left"] for i in items if i["days_left"] is not None), default=None)})
    return out


@app.get("/api/assets/{tag}")
def asset(tag: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    a = q1("SELECT * FROM assets WHERE tag=?", (tag,))
    if not a or not scope.asset_visible(ctx.subject, a):
        raise err(404, "not_found", "Asset not found")
    docs = [x for x in rag.visible_documents(ctx.subject) if tag in uj(x["asset_tags_json"], [])]
    detail = scope.record_readable(ctx.subject, a)
    return {**a, "specs": uj(a["specs_json"], {}) if detail else {}, "items": _items(tag),
            "work_orders": q("SELECT * FROM work_orders WHERE tag=? ORDER BY opened_at DESC LIMIT 30", (tag,))
            if scope.record_readable(ctx.subject, a, "work_order_export") else [],
            "documents": [_doc_out(d) for d in docs]}


@app.get("/api/alerts")
def alerts(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    today = date.today()
    out = []
    for r in q("""SELECT l.*, a.name, a.unit, a.owner_department FROM ledger_items l JOIN assets a ON a.tag=l.tag
                  WHERE l.expires_on <= ? ORDER BY l.expires_on""", ((today + timedelta(days=30)).isoformat(),)):
        if not scope.asset_visible(ctx.subject, r):
            continue
        dl = (date.fromisoformat(r["expires_on"]) - today).days
        out.append({"id": r["id"], "severity": "red" if dl <= 7 else "amber", "title": tr(f"{r['tag']} {r['type']} " + (f"expired {-dl} d ago" if dl < 0 else f"expires in {dl} d")),
                    "detail": f"{r['name']} · {r['ref_no']}", "tag": r["tag"], "due": r["expires_on"], "created_at": now_iso()})
    return out


@app.get("/api/notifications")
def notifications(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    # stored in English (written for whoever reads them later); shown in the reader's language
    return [{"id": n["id"], "kind": n["kind"], "title": tr(n["title"]), "body": tr(n["body"]), "created_at": n["created_at"],
             "read": bool(n["read_at"]), "link": n["link"]}
            for n in q("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50", (ctx.user["id"],))]


@app.post("/api/notifications/{nid}/read")
def read_notification(nid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ex("UPDATE notifications SET read_at=? WHERE id=? AND user_id=?", (now_iso(), nid, ctx.user["id"]))
    return {"ok": True}


# ------------------------------------------------------------------ findings
def _is_discipline_approver(f: dict[str, Any], ctx: Ctx) -> bool:
    """Approve/reject is a decision of rank: RESTRICTED clearance or above, and either the named approver, a holder of the
    discipline's approver role, the HOD of the discipline's department, or refinery management."""
    s = ctx.subject
    if "findings.approve" not in ctx.perms or s.clearance < 2:
        return False
    hod = "dept_manager" in s.roles and scope.finding_department(f) == s.department
    return (f"approver:{(f['discipline'] or '').lower()}" in s.roles or f["approver_id"] == ctx.user["id"] or hod
            or "plant_manager" in s.roles)


def _in_finding_dept(f: dict[str, Any], ctx: Ctx) -> bool:
    return scope.finding_department(f) == ctx.subject.department or f["approver_id"] == ctx.user["id"] \
        or bool({"plant_manager", "hse"} & set(ctx.subject.roles))


def _finding_visible(f: dict[str, Any], ctx: Ctx) -> bool:
    d = q1("SELECT * FROM documents WHERE id=?", (f["source_document_id"],)) if f["source_document_id"] else None
    return scope.finding_visible(ctx.subject, f, d is None or rag.can_read(ctx.subject, d))


def _allowed_actions(f: dict[str, Any], ctx: Ctx) -> list[str]:
    st = f["state"]
    appr = _is_discipline_approver(f, ctx)
    member = "findings.view" in ctx.perms and _in_finding_dept(f, ctx)  # people of the finding's own department
    acts: list[str] = []
    if st in ("PENDING", "ESCALATED"):
        acts += ["acknowledge"] if appr or member else []
        acts += ["approve", "reject"] if appr else []
        acts += ["escalate"] if appr or member else []
    elif st == "ACKNOWLEDGED":
        acts += ["approve", "reject", "escalate"] if appr else (["escalate"] if member else [])
    if member or appr:
        acts.append("note")
    return acts


def _finding_out(f: dict[str, Any], ctx: Ctx) -> dict[str, Any]:
    a = user_by_id(f["approver_id"]) or {}
    return {**{k: f[k] for k in ("id", "title", "tag", "discipline", "severity", "state", "due_date", "evidence", "source_document_id", "page", "created_at")},
            "approver_name": a.get("display_name"), "history": uj(f["history_json"], []), "is_example": bool(f.get("is_example")),
            "discipline_approver": _is_discipline_approver(f, ctx), "allowed_actions": _allowed_actions(f, ctx)}


@app.get("/api/findings")
def findings(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    if "findings.view" not in ctx.perms and "inbox" not in ctx.perms:
        return []
    return [_finding_out(f, ctx) for f in q("SELECT * FROM findings ORDER BY created_at DESC") if _finding_visible(f, ctx)]


@app.post("/api/findings/{fid}/action")
def finding_action(fid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    f = q1("SELECT * FROM findings WHERE id=?", (fid,))
    if not f or not _finding_visible(f, ctx):
        raise err(404, "not_found", "Finding not found")
    act = body.get("action")
    if act not in _allowed_actions(f, ctx):
        raise err(403, "policy_denied", f"'{act}' is not allowed for you on a finding in state {f['state']}.")
    to = {"acknowledge": "ACKNOWLEDGED", "approve": "APPROVED", "reject": "REJECTED", "escalate": "ESCALATED", "note": f["state"]}[act]
    hist = uj(f["history_json"], [])
    hist.append({"at": now_iso(), "event": "NOTE" if act == "note" else to, "by": ctx.user["display_name"], "note": body.get("note", "")})
    approver = f["approver_id"]
    if act == "escalate":
        approver = _escalation_user() or approver
        notify(approver, "escalation", f"Escalated finding: {f['title']}", body.get("note", ""), "/inbox")
    ex("UPDATE findings SET state=?, history_json=?, approver_id=? WHERE id=?", (to, j(hist), approver, fid))
    audit.write(ctx.actor, f"finding.{act}", f"finding:{fid}", {"from": f["state"], "to": to})
    return _finding_out(q1("SELECT * FROM findings WHERE id=?", (fid,)), ctx)


# ------------------------------------------------------------------ production
@app.get("/api/production/overview")
def prod_overview(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("production.view")
    ov = production.overview()
    return {**ov, "note": tr(ov.get("note"))}


def _model_out(m: dict[str, Any]) -> dict[str, Any]:
    return {**m, "missing": tr_list(m.get("missing"))}


@app.get("/api/production/model")
def prod_model(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("production.view")
    return _model_out(production.get_model())


@app.put("/api/production/model")
def prod_model_put(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("production.edit")
    try:
        m = production.save_model(body, ctx.actor)
    except ValueError as e:
        raise err(422, "invalid", str(e))
    audit.write(ctx.actor, "production.model.saved", "production_model", {"complete": m["complete"], "missing": len(m["missing"])})
    return _model_out(m)


@app.post("/api/production/scenario")
async def prod_scenario(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("production.view")
    res = production.solve(body)
    if res.get("error"):
        raise HTTPException(status_code=422, detail={"code": "model_incomplete", "message": tr("The plant model is incomplete."), "missing": tr_list(res["missing"])})
    top = sorted(res["delta_pct"].items(), key=lambda kv: -abs(kv[1]))[:5]
    facts = (f"Monthly margin baseline US$ {res['margin_usd']['baseline']:,.0f} vs scenario US$ {res['margin_usd']['scenario']:,.0f}. "
             "Largest product changes: " + ", ".join(f"{k} {v:+.1f}%" for k, v in top) + ". Binding: " + (", ".join(res["binding"]) or "none") + ".")
    explanation = facts
    if engine.state.status == "ready":
        try:
            import re as _re
            txt = await asyncio.wait_for(engine.complete_once([
                {"role": "system", "content": "Explain these refinery planning LP results to planners in 4 short bullet points. Use ONLY the numbers given. End with: 'Planners decide.'"
                 + (" " + answer_language_instruction() if answer_language_instruction() else "")},
                {"role": "user", "content": facts}]), timeout=40)
            plain = facts.replace(",", "")  # compare numbers without thousands separators on both sides
            nums = [n for n in _re.findall(r"\d+(?:\.\d+)?", txt.replace(",", "")) if n not in ("4",)]
            if not txt.strip():
                explanation = facts
            elif all(n in plain for n in nums):
                explanation = txt
            else:
                explanation = tr(facts) + " " + tr("(AI wording withheld: it contained numbers that are not in the optimizer output.)")
        except Exception as e:  # noqa: BLE001
            explanation = tr(facts) + " " + tr(f"(AI wording unavailable: {str(e)[:160]})")
    res["explanation"] = tr(explanation) if explanation == facts else explanation
    res["assumptions"] = tr_list(res.get("assumptions"))
    audit.write(ctx.actor, "production.scenario", "scenario", {"inputs": body, "margin_usd": res["margin_usd"]})
    return res


# ------------------------------------------------------------------ MRPL public intelligence & departments
@app.get("/api/company")
def company(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    return mrpl.load()


@app.get("/api/departments")
def departments_list(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    return mrpl.departments()


@app.post("/api/admin/mrpl/reload")
def mrpl_reload(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("admin")
    mrpl.ensure_departments()
    n = mrpl.ensure_public_docs()
    from . import mrpl_facts
    mrpl_facts.reset()
    audit.write(ctx.actor, "mrpl.reloaded", "mrpl", {"documents_reingested": n})
    return {"ok": True, "documents_reingested": n, "departments": len(mrpl.departments())}


# ------------------------------------------------------------------ laya
@app.post("/api/laya/classify")
def laya_classify(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    d = laya.get().classify(str(body.get("text", "")))
    d["guard_category"] = laya.guard_category(str(body.get("text", "")))
    return d


@app.get("/api/laya/stats")
def laya_stats(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    st = laya.get().stats()
    bench = admin.get_setting("laya_benchmark")
    st["baseline_llm_router_ms"] = bench.get("llm_router_avg_ms") if bench else None
    st["benchmark"] = bench
    return st


# ------------------------------------------------------------------ reports (A2 dossier PDF)
@app.post("/api/reports/dossier")
def dossier_report(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    from .reports import dossier_pdf
    tag = str(body.get("tag", "A2"))
    a = q1("SELECT * FROM assets WHERE tag=?", (tag,))
    if not a or not scope.asset_visible(ctx.subject, a):
        raise err(404, "not_found", "Asset not found")
    path = dossier_pdf(ctx, tag)
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    rid = new_id()
    ex("INSERT INTO reports(id, kind, file_name, file_path, sha256, created_by, created_at) VALUES(?,?,?,?,?,?,?)",
       (rid, "dossier", path.name, str(path), sha, ctx.user["id"], now_iso()))
    audit.write(ctx.actor, "report.generated", f"report:{rid}", {"tag": tag, "sha256": sha})
    return {"id": rid, "file_name": path.name, "url": f"/api/reports/{rid}/file", "sha256": sha}


@app.get("/api/reports")
def reports(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    return q("SELECT id, kind, file_name, sha256, created_at FROM reports WHERE created_by=? ORDER BY created_at DESC", (ctx.user["id"],))


@app.get("/api/reports/{rid}/file")
def report_file(rid: str, ctx: Ctx = Depends(current)) -> FileResponse:
    r = q1("SELECT * FROM reports WHERE id=? AND created_by=?", (rid, ctx.user["id"]))
    if not r:
        raise err(404, "not_found", "Report not found")
    return FileResponse(r["file_path"], filename=r["file_name"], media_type="application/pdf")


# ------------------------------------------------------------------ audit, server, admin
def _audit_org_wide(ctx: Ctx) -> bool:
    return "audit.export" in ctx.perms  # Internal Audit, refinery management, administrator


@app.get("/api/audit/events")
def audit_events(ctx: Ctx = Depends(current)) -> list[str]:
    ctx.require("audit.view")
    return [r["event"] for r in q("SELECT DISTINCT event FROM audit_log ORDER BY event")]


@app.get("/api/audit")
def audit_list(request: Request, ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ctx.require("audit.view")
    lim = max(1, min(int(request.query_params.get("limit", 300) or 300), 2000))
    ev = request.query_params.get("event")
    where, args = [], []
    if ev:
        where.append("event LIKE ?")
        args.append(f"%{ev}%")
    if not _audit_org_wide(ctx):  # an HOD sees the trail of their own department's people
        where.append("actor IN (SELECT username FROM users WHERE department=?)")
        args.append(ctx.user["department"])
    before = request.query_params.get("before")  # paging: records older than this sequence number
    if before and before.isdigit():
        where.append("seq < ?")
        args.append(int(before))
    rows = q("SELECT * FROM audit_log " + ("WHERE " + " AND ".join(where) + " " if where else "") + "ORDER BY seq DESC LIMIT ?",
             (*args, lim))
    return [{"seq": r["seq"], "at": r["at"], "actor": r["actor"], "event": r["event"], "entity": r["entity"],
             "detail": uj(r["detail_json"], {}), "hash": r["hash"], "prev_hash": r["prev_hash"]} for r in rows]


@app.post("/api/messages/{mid}/feedback")
def message_feedback(mid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    m = q1("SELECT m.id FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=? AND c.user_id=?", (mid, ctx.user["id"]))
    if not m:
        raise err(404, "not_found", "Message not found")
    rating = 1 if int(body.get("rating", 1)) > 0 else -1
    ex("DELETE FROM feedback WHERE message_id=? AND user_id=?", (mid, ctx.user["id"]))
    ex("INSERT INTO feedback(id, message_id, user_id, rating, comment, created_at) VALUES(?,?,?,?,?,?)",
       (new_id(), mid, ctx.user["id"], rating, str(body.get("comment", ""))[:2000], now_iso()))
    audit.write(ctx.actor, "chat.feedback", f"message:{mid}", {"rating": rating})
    return {"ok": True}


@app.get("/api/audit/export")
def audit_export(request: Request, ctx: Ctx = Depends(current)):  # type: ignore[no-untyped-def]
    ctx.require("audit.view")
    if not _audit_org_wide(ctx):
        raise err(403, "forbidden", "Exporting the full audit log is limited to Internal Audit, refinery management and the administrator.")
    import csv
    import io
    fmt = request.query_params.get("format", "csv")
    rows = q("SELECT seq, at, actor, event, entity, detail_json, prev_hash, hash FROM audit_log ORDER BY seq")
    audit.write(ctx.actor, "audit.exported", "audit", {"format": fmt, "records": len(rows)})
    if fmt == "jsonl":
        import json as _json
        body = "\n".join(_json.dumps(r, ensure_ascii=False) for r in rows)
        return StreamingResponse(iter([body]), media_type="application/x-ndjson",
                                 headers={"Content-Disposition": "attachment; filename=yukti_audit.jsonl"})
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["seq", "at", "actor", "event", "entity", "detail_json", "prev_hash", "hash"])
    w.writeheader()
    w.writerows(rows)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=yukti_audit.csv"})


@app.get("/api/audit/verify")
def audit_verify(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("audit.view")
    res = audit.verify()
    audit.write(ctx.actor, "audit.verified", "audit", {"ok": res["ok"], "count": res["count"]})
    return res


@app.get("/api/server/logs")
def server_logs(request: Request, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    tail = max(1, min(int(request.query_params.get("tail", 300) or 300), 2000))
    return {"lines": list(engine.LOG)[-tail:]}


@app.get("/api/server/status")
def server_status(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    s = engine.state
    url, _ = engine.engine_url(s.engine)
    return {"engine": s.engine, "status": s.status, "port": s.port if s.engine == "llamacpp" else None, "openai_base_url": url,
            "uptime_s": round(time.time() - s.started_at) if s.started_at else 0, "requests": s.requests, "model_name": s.model_name,
            "command": engine.redacted_command()}


@app.get("/api/admin/policies")
def admin_policies(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("admin")
    return {"version": pdp.version, "sha256": pdp.sha, "yaml": pdp.yaml_text}


@app.get("/api/admin/policies/documents")
def simulate_documents(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    """Metadata only (no content) of every document, so the admin can simulate decisions on restricted ones too."""
    ctx.require("admin")
    rows = q("SELECT id, title, doc_number, department, classification FROM documents ORDER BY department, title")
    return [{**r, "classification": CLEARANCE_LABELS[int(r["classification"])]} for r in rows]


@app.post("/api/admin/policies/simulate")
def simulate(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("admin")
    from .auth import subject_for
    u = q1("SELECT * FROM users WHERE username=?", (body.get("username"),))
    d = q1("SELECT * FROM documents WHERE id=?", (body.get("document_id"),))
    if not u or not d:
        raise err(404, "not_found", "user or document not found")
    dec = pdp.decide(subject_for(u), body.get("action", "read"), rag.doc_resource(d))
    return {"effect": dec.effect, "matched": dec.matched, "reason": tr(dec.reason)}


@app.post("/api/admin/demo/reset")
def demo_reset(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    """Rehearsal helper: revoke all grants, clear access requests, reset findings to PENDING."""
    ctx.require("admin")
    if not DEMO_MODE:
        raise err(404, "not_found", "Available only in demonstration mode.")
    g = ex("UPDATE grants SET revoked_at=? WHERE revoked_at IS NULL", (now_iso(),)).rowcount
    a = ex("DELETE FROM access_requests").rowcount
    ex("UPDATE findings SET state='PENDING'")
    audit.write(ctx.actor, "demo.reset", "demo", {"grants_revoked": g, "requests_cleared": a})
    return {"ok": True, "grants_revoked": g, "requests_cleared": a}


_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
        "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; "
        "frame-ancestors 'none'")


@app.middleware("http")
async def request_language(request: Request, call_next):  # type: ignore[no-untyped-def]
    from .i18n import set_lang
    set_lang(request.headers.get("x-lang") or request.query_params.get("lang"))
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
    resp = await call_next(request)
    h = resp.headers
    h.setdefault("Content-Security-Policy", _CSP)
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "no-referrer")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=(), usb=()")
    h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    h.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    if request.url.path.startswith("/api/"):
        h.setdefault("Cache-Control", "no-store")
    if request.url.scheme == "https":
        h.setdefault("Strict-Transport-Security", "max-age=31536000")
    return resp


# fingerprint of this installation (the desktop app only re-attaches to a server started from its own folder)
from .config import ROOT as _ROOT  # noqa: E402
_INSTANCE = hashlib.sha256(str(_ROOT.resolve()).lower().encode()).hexdigest()[:12]


@app.get("/api/health")
def health() -> dict[str, Any]:
    eng = engine.state.status
    kr = STARTUP["knowledge_ready"]
    if not kr:
        stage = STARTUP["stage"]
    elif eng in ("loading", "restarting"):
        stage = "Loading AI model" if eng == "loading" else "Restarting AI model"
    elif eng == "idle":
        stage = "Ready (no AI model loaded)"
    elif eng == "error":
        stage = "Ready (AI model failed to load)"
    else:
        stage = "Ready"
    return {"ok": True, "version": VERSION, "engine": eng, "stage": tr(stage), "instance": _INSTANCE,
            "progress": {"done": STARTUP["done"], "total": STARTUP["total"]} if not kr else None,
            "knowledge_ready": kr, "ready": kr and eng in ("ready", "idle", "error"),
            "error": tr(STARTUP["error"] or (engine.state.error if eng == "error" else None))}


# ------------------------------------------------------------------ SPA
if WEB_DIST.exists():
    app.mount("/assets-static", StaticFiles(directory=WEB_DIST), name="static")


@app.get("/{full_path:path}")
def spa(full_path: str) -> FileResponse:
    if full_path.startswith("api/"):
        raise err(404, "not_found", "Unknown API route")
    f = WEB_DIST / full_path
    if full_path and f.exists() and f.is_file():
        return FileResponse(f)
    idx = WEB_DIST / "index.html"
    if idx.exists():
        return FileResponse(idx, headers={"Cache-Control": "no-cache"})
    return JSONResponse({"detail": "Frontend not built yet (web/dist missing)."}, status_code=503)
