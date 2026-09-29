"""Yukti API — FastAPI app serving the REST/SSE API and the built SPA."""
from __future__ import annotations

import asyncio
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

from . import audit, chat, engine, laya, production, rag, seed
from .auth import Ctx, current, err, notify, router as auth_router, user_by_id
from .config import CLEARANCE_LABELS, CLEARANCE_BY_LABEL, DEMO_MODE, REPORTS, VERSION, WEB_DIST
from .db import ex, init_db, j, new_id, now_iso, q, q1, uj
from .llm_params import DEFAULT_PREDICTION, schema, vllm_command
from .policy import pdp

app = FastAPI(title="Yukti — Sovereign Industrial AI Workbench", version=VERSION, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.include_router(auth_router)

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
    return _orig_gai(host, *a, **k)


def install_guard() -> None:
    for r in q("SELECT base_url FROM engines WHERE base_url IS NOT NULL AND base_url != ''"):
        h = urlparse(r["base_url"]).hostname
        if h:
            _ALLOWED_HOSTS.add(h)
    socket.socket.connect = _guard_connect  # type: ignore[method-assign]
    socket.getaddrinfo = _guard_gai  # type: ignore[assignment]


@app.on_event("startup")
def startup() -> None:
    init_db()
    seed.run(ingest=True)
    seed.refresh_alert_notifications()
    laya.get()
    install_guard()
    audit.write("system", "app.started", "api", {"version": VERSION})
    threading.Thread(target=engine.autoload_default, daemon=True).start()


@app.on_event("shutdown")
def shutdown() -> None:
    engine.unload()


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
        _SYS_CACHE["cpu_name"] = "AMD Ryzen 7 7840HS" if "AMD64" in platform.machine() else platform.processor()
        try:
            import subprocess
            out = subprocess.run(["powershell", "-NoProfile", "-c", "(Get-CimInstance Win32_Processor).Name"], capture_output=True, text=True, timeout=8)
            if out.stdout.strip():
                _SYS_CACHE["cpu_name"] = out.stdout.strip()
        except Exception:
            pass
    return {"gpu": gpu_stats(), "ram": {"total_mb": vm.total // 2**20, "used_mb": (vm.total - vm.available) // 2**20},
            "cpu": {"name": _SYS_CACHE["cpu_name"], "cores": psutil.cpu_count(False), "threads": psutil.cpu_count(),
                    "util_pct": psutil.cpu_percent(interval=None)},
            "llama_build": engine.cached_llama_version(), "offline_guard": True, "egress_blocked": _BLOCKED["count"],
            "version": VERSION, "audit_head": audit.head()[:16], "last_stats": engine.state.last_stats}


# ------------------------------------------------------------------ engines & models
@app.get("/api/engines")
async def engines(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    return list(await asyncio.gather(*(engine.probe(e) for e in ["llamacpp", "bionic", "vllm", "remote"])))


@app.put("/api/engines/{eid}")
async def set_engine(eid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    if eid not in engine.ENGINE_META:
        raise err(404, "not_found", "Unknown engine")
    ex("INSERT OR REPLACE INTO engines(id, base_url, api_key) VALUES(?,?,?)", (eid, body.get("base_url", ""), body.get("api_key")))
    h = urlparse(body.get("base_url", "")).hostname
    if h:
        _ALLOWED_HOSTS.add(h)
    audit.write(ctx.actor, "engine.configured", f"engine:{eid}", {"base_url": body.get("base_url")})
    return await engine.probe(eid)


@app.get("/api/models")
async def models(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ms = engine.scan_models()
    for eid in ("bionic", "vllm", "remote"):
        info = await engine.probe(eid)
        for mid in info.get("models", []) or []:
            ms.append({"id": mid, "name": mid, "file_name": "", "path": "", "size_bytes": 0, "family": mid.split("/")[-1].split("-")[0],
                       "params_b": None, "quant": "?", "arch": "", "source": "engine", "engine": eid, "vision": False})
    return ms


@app.get("/api/models/loaded")
def loaded(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    return engine.state.public()


@app.post("/api/models/load")
def load_model(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage") if not DEMO_MODE else None
    res = engine.load(body.get("engine", "llamacpp"), body["model_id"], body.get("load_config") or {})
    audit.write(ctx.actor, "model.load", f"model:{body['model_id']}", {"engine": body.get("engine"), "config": body.get("load_config")})
    return res


@app.post("/api/models/unload")
def unload_model(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    engine.unload()
    audit.write(ctx.actor, "model.unload", "model")
    return {"ok": True}


@app.get("/api/params/schema")
def params_schema(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    return schema(engine.scan_models())


@app.post("/api/models/command-preview")
def command_preview(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    from .llm_params import llama_args
    m = engine.model_by_id(body.get("model_id", "")) or {"path": body.get("model_id", "<model.gguf>"), "name": "model"}
    cfg = body.get("load_config") or {}
    return {"llamacpp": "llama-server " + " ".join(llama_args(cfg, m["path"], cfg.get("draft_model") or None)),
            "vllm": vllm_command(cfg, body.get("hf_model", "Qwen/Qwen3.8-27B-FP8"))}


# ------------------------------------------------------------------ presets
@app.get("/api/presets")
def presets(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    rows = q("SELECT * FROM presets WHERE builtin=1 OR user_id=? ORDER BY builtin DESC, created_at", (ctx.user["id"],))
    return [{"id": r["id"], "name": r["name"], "description": r["description"], "system_prompt": r["system_prompt"],
             "prediction": uj(r["prediction_json"], {}), "load": uj(r["load_json"], {}), "builtin": bool(r["builtin"])} for r in rows]


@app.post("/api/presets")
def create_preset(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    pid = new_id()
    ex("INSERT INTO presets(id, user_id, name, description, system_prompt, prediction_json, load_json, builtin, created_at) VALUES(?,?,?,?,?,?,?,0,?)",
       (pid, ctx.user["id"], body.get("name", "Preset"), body.get("description", ""), body.get("system_prompt", ""),
        j(body.get("prediction", {})), j(body.get("load", {})), now_iso()))
    return next(p for p in presets(ctx) if p["id"] == pid)


@app.put("/api/presets/{pid}")
def update_preset(pid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ex("UPDATE presets SET name=?, description=?, system_prompt=?, prediction_json=?, load_json=? WHERE id=? AND user_id=?",
       (body.get("name"), body.get("description", ""), body.get("system_prompt", ""), j(body.get("prediction", {})),
        j(body.get("load", {})), pid, ctx.user["id"]))
    return next((p for p in presets(ctx) if p["id"] == pid), {})


@app.delete("/api/presets/{pid}")
def delete_preset(pid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
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
    ex("INSERT INTO projects(id, user_id, name, created_at) VALUES(?,?,?,?)", (pid, ctx.user["id"], body.get("name", "Project"), now_iso()))
    return {"id": pid, "name": body.get("name", "Project"), "chat_count": 0}


@app.get("/api/chats")
def chats(project_id: str | None = None, ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    rows = q("""SELECT c.id, c.title, c.project_id, c.updated_at, (SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id) message_count
                FROM chats c WHERE c.user_id=? ORDER BY c.updated_at DESC""", (ctx.user["id"],))
    if project_id:
        rows = [r for r in rows if r["project_id"] == project_id]
    return rows


@app.post("/api/chats")
def create_chat(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    cid = new_id()
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
            "prediction": {**DEFAULT_PREDICTION, **uj(c["prediction_json"], {})}, "messages": [chat.message_out(m) for m in msgs],
            "updated_at": c["updated_at"]}


@app.patch("/api/chats/{cid}")
def patch_chat(cid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    c = q1("SELECT * FROM chats WHERE id=? AND user_id=?", (cid, ctx.user["id"]))
    if not c:
        raise err(404, "not_found", "Chat not found")
    ex("UPDATE chats SET title=?, system_prompt=?, prediction_json=?, project_id=?, updated_at=? WHERE id=?",
       (body.get("title", c["title"]), body.get("system_prompt", c["system_prompt"]),
        j(body["prediction"]) if "prediction" in body else c["prediction_json"], body.get("project_id", c["project_id"]), now_iso(), cid))
    return get_chat(cid, ctx)


@app.delete("/api/chats/{cid}")
def delete_chat(cid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ex("DELETE FROM chats WHERE id=? AND user_id=?", (cid, ctx.user["id"]))
    return {"ok": True}


def _sse_response(gen) -> StreamingResponse:  # type: ignore[no-untyped-def]
    return StreamingResponse(gen, media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/chats/{cid}/messages")
async def send_message(cid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> StreamingResponse:
    c = q1("SELECT * FROM chats WHERE id=? AND user_id=?", (cid, ctx.user["id"]))
    if not c:
        raise err(404, "not_found", "Chat not found")
    pred = body.get("prediction") or uj(c["prediction_json"], {})
    sp = body.get("system_prompt") if body.get("system_prompt") is not None else c["system_prompt"]
    if body.get("prediction") is not None or body.get("system_prompt") is not None:
        ex("UPDATE chats SET prediction_json=?, system_prompt=? WHERE id=?", (j(pred), sp or "", cid))
    return _sse_response(chat.run_turn(ctx, cid, str(body.get("content", "")), sp, pred, bool(body.get("use_knowledge", True))))


@app.post("/api/chats/{cid}/regenerate")
async def regenerate(cid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> StreamingResponse:
    last_user = q1("SELECT content FROM messages WHERE chat_id=? AND role='user' ORDER BY created_at DESC, rowid DESC LIMIT 1", (cid,))
    c = q1("SELECT * FROM chats WHERE id=? AND user_id=?", (cid, ctx.user["id"]))
    if not c or not last_user:
        raise err(404, "not_found", "Nothing to regenerate")
    pred = body.get("prediction") or uj(c["prediction_json"], {})
    return _sse_response(chat.run_turn(ctx, cid, last_user["content"], c["system_prompt"], pred, bool(body.get("use_knowledge", True)), regenerate=True))


@app.post("/api/chats/{cid}/stop")
def stop(cid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
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
            "file_name": d["file_name"], "effective_date": d["effective_date"]}


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
        rag.ingest(did, jid, actor)
    except Exception:
        pass


@app.post("/api/documents")
async def upload(background: BackgroundTasks, file: UploadFile = File(...), title: str = Form(""), doc_type: str = Form("other"),
                 department: str = Form("Operations"), classification: str = Form("INTERNAL"), doc_number: str = Form(""),
                 revision: str = Form(""), ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("documents.upload")
    data = await file.read()
    if len(data) > 50 * 2**20:
        raise err(413, "too_large", "Max 50 MB")
    cl = CLEARANCE_BY_LABEL.get(classification.upper(), 1)
    if cl > ctx.subject.clearance:
        raise err(403, "policy_denied", "You cannot upload above your own clearance.")
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
    if not r:
        raise err(404, "not_found", "Job not found")
    return {"id": r["id"], "status": r["status"], "stages": uj(r["stages_json"], []), "document_id": r["document_id"], "error": r["error"]}


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
    _doc_or_403(did, ctx)
    for c in q("SELECT id FROM chunks WHERE document_id=?", (did,)):
        ex("DELETE FROM chunks_fts WHERE chunk_id=?", (c["id"],))
    ex("DELETE FROM documents WHERE id=?", (did,))
    audit.write(ctx.actor, "document.deleted", f"document:{did}")
    return {"ok": True}


# ------------------------------------------------------------------ access requests & grants
def _ar_out(r: dict[str, Any]) -> dict[str, Any]:
    req = user_by_id(r["requester_id"]) or {}
    appr = user_by_id(r["approver_id"]) or {}
    doc = q1("SELECT title FROM documents WHERE id=?", (r["document_id"],)) if r["document_id"] else None
    label = doc["title"] if doc else f"{r['department']} documents" + (f" ({r['doc_type']})" if r["doc_type"] else "")
    return {"id": r["id"], "requester": req.get("username"), "requester_name": req.get("display_name"), "resource_label": label,
            "department": r["department"], "justification": r["justification"], "hours": r["hours"], "state": r["state"],
            "created_at": r["created_at"], "decided_at": r["decided_at"], "approver_name": appr.get("display_name"), "note": r["note"]}


def _approver_for(dept: str) -> str | None:
    d = q1("SELECT manager_user_id FROM departments WHERE code=?", (dept,))
    return d["manager_user_id"] if d else None


@app.get("/api/access-requests")
def access_requests(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    mine = q("SELECT * FROM access_requests WHERE requester_id=? ORDER BY created_at DESC", (ctx.user["id"],))
    to_approve = q("SELECT * FROM access_requests WHERE approver_id=? ORDER BY state='PENDING' DESC, created_at DESC", (ctx.user["id"],))
    return {"mine": [_ar_out(r) for r in mine], "to_approve": [_ar_out(r) for r in to_approve]}


@app.post("/api/access-requests")
def create_access_request(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    dept = body.get("department") or (q1("SELECT department FROM documents WHERE id=?", (body.get("document_id"),)) or {}).get("department")
    if not dept:
        raise err(422, "invalid", "department or document_id required")
    approver = _approver_for(dept)
    if not approver or approver == ctx.user["id"]:
        approver = _approver_for("Management")
    rid = new_id()
    hours = max(1, min(int(body.get("hours", 2)), 72))
    ex("""INSERT INTO access_requests(id, requester_id, department, doc_type, document_id, justification, hours, state, approver_id, created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)""",
       (rid, ctx.user["id"], dept, body.get("doc_type"), body.get("document_id"), body.get("justification", ""), hours, "PENDING", approver, now_iso()))
    notify(approver, "access_request", f"Access request from {ctx.user['display_name']}",
           f"{dept} documents for {hours} h — “{body.get('justification', '')}”", "/inbox?tab=access")
    audit.write(ctx.actor, "access.requested", f"access_request:{rid}", {"department": dept, "hours": hours})
    return _ar_out(q1("SELECT * FROM access_requests WHERE id=?", (rid,)))


def _decide(rid: str, ctx: Ctx, approve: bool, body: dict[str, Any]) -> dict[str, Any]:
    ctx.require("access.approve")
    r = q1("SELECT * FROM access_requests WHERE id=?", (rid,))
    if not r:
        raise err(404, "not_found", "Request not found")
    if r["approver_id"] != ctx.user["id"] and "admin" not in ctx.subject.roles:
        raise err(403, "policy_denied", "You are not the approver for this request.")
    if r["requester_id"] == ctx.user["id"]:
        raise err(403, "policy_denied", "You cannot approve your own request.")
    if r["state"] != "PENDING":
        raise err(409, "conflict", f"Request already {r['state']}")
    if approve:
        hours = max(1, min(int(body.get("hours", r["hours"])), int(r["hours"]) if int(r["hours"]) else 72))  # may narrow, never widen
        exp = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(timespec="seconds")
        ex("INSERT INTO grants(id, user_id, department, doc_type, document_id, expires_at, approved_by, request_id, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
           (new_id(), r["requester_id"], r["department"], r["doc_type"], r["document_id"], exp, ctx.user["id"], rid, now_iso()))
        ex("UPDATE access_requests SET state='GRANTED', decided_at=?, hours=?, note=? WHERE id=?", (now_iso(), hours, body.get("note", ""), rid))
        ex("UPDATE users SET attr_version=attr_version+1 WHERE id=?", (r["requester_id"],))
        notify(r["requester_id"], "access_granted", f"Access granted: {r['department']} documents for {hours} h",
               f"Approved by {ctx.user['display_name']} — expires {exp[:16].replace('T', ' ')} UTC", "/chat")
        audit.write(ctx.actor, "access.granted", f"access_request:{rid}", {"hours": hours, "expires_at": exp})
    else:
        ex("UPDATE access_requests SET state='REJECTED', decided_at=?, note=? WHERE id=?", (now_iso(), body.get("note", ""), rid))
        notify(r["requester_id"], "access_rejected", "Access request rejected", body.get("note", ""), "/inbox?tab=access")
        audit.write(ctx.actor, "access.rejected", f"access_request:{rid}", {"note": body.get("note", "")})
    return _ar_out(q1("SELECT * FROM access_requests WHERE id=?", (rid,)))


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
        out.append({"id": g["id"], "scope": f"{g['department']} documents", "expires_at": g["expires_at"], "approved_by": a.get("display_name")})
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
        if qs and qs not in (a["tag"] + " " + a["name"] + " " + (a["unit"] or "")).lower():
            continue
        items = _items(a["tag"])
        out.append({**{k: a[k] for k in ("tag", "name", "unit", "class", "vendor", "serial", "location", "owner_department", "criticality", "model")},
                    "items": items, "nearest_days": min((i["days_left"] for i in items if i["days_left"] is not None), default=None)})
    return out


@app.get("/api/assets/{tag}")
def asset(tag: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    a = q1("SELECT * FROM assets WHERE tag=?", (tag,))
    if not a:
        raise err(404, "not_found", "Asset not found")
    docs = [x for x in rag.visible_documents(ctx.subject) if tag in uj(x["asset_tags_json"], [])]
    return {**a, "specs": uj(a["specs_json"], {}), "items": _items(tag),
            "work_orders": q("SELECT * FROM work_orders WHERE tag=? ORDER BY opened_at DESC LIMIT 30", (tag,)),
            "documents": [_doc_out(d) for d in docs]}


@app.get("/api/alerts")
def alerts(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    today = date.today()
    out = []
    for r in q("SELECT l.*, a.name FROM ledger_items l JOIN assets a ON a.tag=l.tag WHERE l.expires_on <= ? ORDER BY l.expires_on",
               ((today + timedelta(days=30)).isoformat(),)):
        dl = (date.fromisoformat(r["expires_on"]) - today).days
        out.append({"id": r["id"], "severity": "red" if dl <= 7 else "amber", "title": f"{r['tag']} {r['type']} " + (f"expired {-dl} d ago" if dl < 0 else f"expires in {dl} d"),
                    "detail": f"{r['name']} · {r['ref_no']}", "tag": r["tag"], "due": r["expires_on"], "created_at": now_iso()})
    return out


@app.get("/api/notifications")
def notifications(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    return [{"id": n["id"], "kind": n["kind"], "title": n["title"], "body": n["body"], "created_at": n["created_at"],
             "read": bool(n["read_at"]), "link": n["link"]}
            for n in q("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50", (ctx.user["id"],))]


@app.post("/api/notifications/{nid}/read")
def read_notification(nid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ex("UPDATE notifications SET read_at=? WHERE id=? AND user_id=?", (now_iso(), nid, ctx.user["id"]))
    return {"ok": True}


# ------------------------------------------------------------------ findings
def _finding_out(f: dict[str, Any]) -> dict[str, Any]:
    a = user_by_id(f["approver_id"]) or {}
    return {**{k: f[k] for k in ("id", "title", "tag", "discipline", "severity", "state", "due_date", "evidence", "source_document_id", "page", "created_at")},
            "approver_name": a.get("display_name"), "history": uj(f["history_json"], [])}


@app.get("/api/findings")
def findings(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    return [_finding_out(f) for f in q("SELECT * FROM findings ORDER BY created_at DESC")]


@app.post("/api/findings/{fid}/action")
def finding_action(fid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    f = q1("SELECT * FROM findings WHERE id=?", (fid,))
    if not f:
        raise err(404, "not_found", "Finding not found")
    act = body.get("action")
    trans = {"acknowledge": ("PENDING", "ACKNOWLEDGED"), "approve": ("ACKNOWLEDGED", "APPROVED"), "reject": ("ACKNOWLEDGED", "REJECTED"),
             "escalate": (None, "ESCALATED")}
    if act not in trans:
        raise err(422, "invalid", "Unknown action")
    frm, to = trans[act]
    if act in ("approve", "reject"):
        ctx.require("findings.approve")
    if frm and f["state"] not in (frm, "ESCALATED"):
        raise err(409, "conflict", f"Cannot {act} a finding in state {f['state']}")
    hist = uj(f["history_json"], [])
    hist.append({"at": now_iso(), "event": to, "by": ctx.user["display_name"], "note": body.get("note", "")})
    approver = f["approver_id"]
    if act == "escalate":
        approver = _approver_for("Management") or approver
        notify(approver, "escalation", f"Escalated finding: {f['title']}", body.get("note", ""), "/inbox")
    ex("UPDATE findings SET state=?, history_json=?, approver_id=? WHERE id=?", (to, j(hist), approver, fid))
    audit.write(ctx.actor, f"finding.{act}", f"finding:{fid}", {"from": f["state"], "to": to})
    return _finding_out(q1("SELECT * FROM findings WHERE id=?", (fid,)))


# ------------------------------------------------------------------ production
@app.get("/api/production/overview")
def prod_overview(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("production.view")
    return production.overview()


@app.post("/api/production/scenario")
async def prod_scenario(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("production.view")
    res = production.solve(float(body.get("hcu_down_days", 0)), float(body.get("diesel_crack_delta", 0)),
                           float(body.get("petchem_margin_delta", 0)), float(body.get("crude_price_delta", 0)))
    # LLM explains, numbers come only from the JSON
    top = sorted(res["delta_pct"].items(), key=lambda kv: -abs(kv[1]))[:5]
    facts = (f"Margin baseline ₹{res['margin_cr']['baseline']} Cr vs scenario ₹{res['margin_cr']['scenario']} Cr per month. "
             f"Largest product changes: " + ", ".join(f"{k} {v:+.1f}%" for k, v in top) + ". Binding: " + (", ".join(res["binding"]) or "none") + ".")
    explanation = facts
    if engine.state.status == "ready":
        try:
            txt = await asyncio.wait_for(engine.complete_once([
                {"role": "system", "content": "You explain refinery planning LP results to planners in 4 short bullet points. Use ONLY the numbers given; do not invent numbers. End with: 'Planners decide.'"},
                {"role": "user", "content": facts + "\nAssumptions: " + " ".join(res["assumptions"])}]), timeout=40)
            nums_ok = all(n in facts + " ".join(res["assumptions"]) for n in __import__("re").findall(r"\d+(?:\.\d+)?", txt))
            explanation = txt if nums_ok else facts + " (LLM explanation withheld: it contained numbers not present in the optimizer output.)"
        except Exception:
            pass
    res["explanation"] = explanation
    audit.write(ctx.actor, "production.scenario", "scenario", {"inputs": body, "margin_cr": res["margin_cr"]})
    return res


# ------------------------------------------------------------------ laya
@app.post("/api/laya/classify")
def laya_classify(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    d = laya.get().classify(str(body.get("text", "")))
    d["guard_category"] = laya.guard_category(str(body.get("text", "")))
    return d


@app.get("/api/laya/stats")
def laya_stats(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    return laya.get().stats()


# ------------------------------------------------------------------ reports (A2 dossier PDF)
@app.post("/api/reports/dossier")
def dossier_report(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    from .reports import dossier_pdf
    tag = body.get("tag", "A2")
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
@app.get("/api/audit")
def audit_list(request: Request, ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ctx.require("audit.view")
    lim = min(int(request.query_params.get("limit", 300)), 2000)
    ev = request.query_params.get("event")
    rows = q("SELECT * FROM audit_log " + ("WHERE event LIKE ? " if ev else "") + "ORDER BY seq DESC LIMIT ?", ((f"%{ev}%", lim) if ev else (lim,)))
    return [{"seq": r["seq"], "at": r["at"], "actor": r["actor"], "event": r["event"], "entity": r["entity"],
             "detail": uj(r["detail_json"], {}), "hash": r["hash"], "prev_hash": r["prev_hash"]} for r in rows]


@app.get("/api/audit/verify")
def audit_verify(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("audit.view")
    res = audit.verify()
    audit.write(ctx.actor, "audit.verified", "audit", {"ok": res["ok"], "count": res["count"]})
    return res


@app.get("/api/server/logs")
def server_logs(request: Request, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    tail = int(request.query_params.get("tail", 300))
    return {"lines": list(engine.LOG)[-tail:]}


@app.get("/api/server/status")
def server_status(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    s = engine.state
    url, _ = engine.engine_url(s.engine)
    return {"engine": s.engine, "status": s.status, "port": 8080 if s.engine == "llamacpp" else None, "openai_base_url": url,
            "uptime_s": round(time.time() - s.started_at) if s.started_at else 0, "requests": s.requests, "model_name": s.model_name,
            "command": " ".join(s.command) if s.command else None}


@app.get("/api/admin/users")
def admin_users(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ctx.require("admin")
    return [{"id": u["id"], "username": u["username"], "display_name": u["display_name"], "post": u["post"], "department": u["department"],
             "clearance": u["clearance"], "clearance_label": CLEARANCE_LABELS[u["clearance"]], "roles": uj(u["roles_json"], []),
             "asset_scopes": uj(u["asset_scopes_json"], []), "status": u["status"]} for u in q("SELECT * FROM users ORDER BY rowid")]


@app.get("/api/admin/policies")
def admin_policies(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("admin")
    return {"version": pdp.version, "sha256": pdp.sha, "yaml": pdp.yaml_text}


@app.post("/api/admin/policies/simulate")
def simulate(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("admin")
    from .auth import subject_for
    u = q1("SELECT * FROM users WHERE username=?", (body.get("username"),))
    d = q1("SELECT * FROM documents WHERE id=?", (body.get("document_id"),))
    if not u or not d:
        raise err(404, "not_found", "user or document not found")
    dec = pdp.decide(subject_for(u), body.get("action", "read"), rag.doc_resource(d))
    return {"effect": dec.effect, "matched": dec.matched, "reason": dec.reason}


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "version": VERSION, "engine": engine.state.status}


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
