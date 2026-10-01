"""Administration: users, organisation AI settings, usage & health (measured only), backups, model import, feedback, Laya benchmark."""
from __future__ import annotations

import csv
import hashlib
import io
import re
import secrets
import shutil
import statistics
import time
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import psutil
from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse

from . import audit, engine
from .auth import ROLE_PERMS, Ctx, current, err, hash_password, notify, strong_password_problem
from .config import BLOBS, CLEARANCE_LABELS, DB_PATH, ROOT, STORE, USER_MODELS
from .db import db, ex, get_setting, j, new_id, now_iso, q, q1, set_setting, uj
from .i18n import get_lang, tr
from .llm_params import DEFAULT_LOAD, DEFAULT_PREDICTION

router = APIRouter(prefix="/api/admin", tags=["admin"])
BACKUPS = STORE / "backups"
BACKUPS.mkdir(parents=True, exist_ok=True)
ATTACHMENTS = STORE / "attachments"  # same folder as attachments.DIR (not imported: that module loads the image library)
MODELS_DIR = USER_MODELS

ROLE_DESC = {
    "engineer": "Plant engineer / technician — asks questions, uploads documents in own scope",
    "dept_manager": "Head of Department (HOD) — the only role that adds/removes documents (own department), approves access requests",
    "executive": "Top management (MD, Chairman, Directors) — company-level information incl. finances, reads across departments",
    "plant_manager": "Plant / refinery head — approvals, escalations, audit, production view",
    "planner": "Production planner — production intelligence (view + edit model)",
    "auditor": "Internal auditor — read-only audit log and chain verification",
    "hse": "HSE officer — safety documents across units",
    "process": "Process engineer — process-chemistry questions within guardrails",
    "contractor": "Contract worker — minimal access, no process chemistry",
    "approver:mechanical": "Approves mechanical findings", "approver:electrical": "Approves electrical findings",
    "approver:finance": "Approves finance findings",
    "admin": "Platform administrator — users, AI settings, models, backups, usage",
}


def _user_out(u: dict[str, Any]) -> dict[str, Any]:
    return {"id": u["id"], "username": u["username"], "display_name": u["display_name"], "post": u["post"],
            "department": u["department"], "clearance": u["clearance"], "clearance_label": CLEARANCE_LABELS.get(u["clearance"], "?"),
            "roles": uj(u["roles_json"], []), "asset_scopes": uj(u["asset_scopes_json"], []), "status": u["status"],
            "mfa_enabled": bool(u.get("mfa_enabled")), "must_change_password": bool(u.get("must_change_password")),
            "locked_until": u.get("locked_until"), "last_login_at": u.get("last_login_at"), "created_at": u.get("created_at")}


def _sync_hod(uid: str) -> None:
    """A user holding the HOD role becomes the approver of their department."""
    u = q1("SELECT * FROM users WHERE id=?", (uid,))
    if not u:
        return
    is_hod = "dept_manager" in uj(u["roles_json"], []) and u["status"] == "active"
    # no longer HOD of a department (role removed, moved or disabled): stop routing its approvals to this user
    ex("UPDATE departments SET manager_user_id=NULL WHERE manager_user_id=? AND NOT (? AND (code=? OR name=?))",
       (uid, int(is_hod), u["department"], u["department"]))
    if is_hod:
        ex("UPDATE departments SET manager_user_id=? WHERE code=? OR name=?", (uid, u["department"], u["department"]))


def _temp_password() -> str:
    return "Yk-" + secrets.token_urlsafe(9) + "7"


# ------------------------------------------------------------------ users
@router.get("/users")
def users(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ctx.require("users.manage")
    return [_user_out(u) for u in q("SELECT * FROM users ORDER BY rowid")]


@router.get("/roles")
def roles(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ctx.require("users.manage")
    return [{"role": r, "description": tr(ROLE_DESC.get(r, "")), "permissions": ROLE_PERMS.get(r, [])} for r in ROLE_DESC]


def _validate(body: dict[str, Any], creating: bool) -> None:
    if creating and not str(body.get("username", "")).strip():
        raise err(422, "invalid", "username is required")
    if creating and not str(body.get("display_name", "")).strip():
        raise err(422, "invalid", "display name is required")
    if creating and not str(body.get("department", "")).strip():
        raise err(422, "invalid", "department is required")
    if creating and not re.match(r"^[a-z0-9][a-z0-9._-]{1,39}$", str(body["username"]).strip().lower()):
        raise err(422, "invalid", "username may contain letters, digits, dot, dash and underscore (2-40 characters)")
    if "clearance" in body and int(body["clearance"]) not in CLEARANCE_LABELS:
        raise err(422, "invalid", "clearance must be 0-4")
    if "department" in body and not q1("SELECT 1 FROM departments WHERE code=? OR name=?", (body["department"], body["department"])):
        raise err(422, "invalid", f"Unknown department: {body['department']}")
    for r in body.get("roles", []) or []:
        if r not in ROLE_DESC:
            raise err(422, "invalid", f"Unknown role: {r}")


PRIVILEGED_ROLES = {"executive", "plant_manager", "auditor"}


def _is_privileged(roles: list[str] | None, clearance: Any) -> bool:
    """Top-management reach: sees company information / reads across departments / the whole audit trail, or
    CONFIDENTIAL clearance and above."""
    return bool(PRIVILEGED_ROLES & set(roles or [])) or int(clearance or 0) >= 3


def _announce_privileged(actor: str, username: str, roles: list[str], clearance: int, created: bool) -> None:
    """An administrator gave an account top-management reach: recorded in the audit trail and announced to everyone who
    already is top management or refinery management (so one administrator cannot do it unnoticed). No approval step."""
    audit.write(actor, "admin.user.top_management_assigned", f"user:{username}",
                {"roles": roles, "clearance": CLEARANCE_LABELS.get(int(clearance), "?"), "created": created})
    title = f"A top-management account was {'created' if created else 'changed'} by {actor}"
    body = f"Account {username}: roles {', '.join(roles) or 'none'}; clearance {CLEARANCE_LABELS.get(int(clearance), '?')}"
    for u in q("SELECT id, username, roles_json FROM users WHERE status='active'"):
        if u["username"] not in (username, actor) and {"executive", "plant_manager"} & set(uj(u["roles_json"], [])):
            notify(u["id"], "security", title, body, "")


def create_user_row(body: dict[str, Any], actor: str) -> tuple[dict[str, Any], str]:
    _validate(body, True)
    username = str(body["username"]).strip().lower()
    if q1("SELECT 1 FROM users WHERE username=?", (username,)):
        raise err(409, "conflict", f"User {username} already exists")
    pw = _temp_password()
    uid = new_id()
    ex("""INSERT INTO users(id, username, display_name, post, department, clearance, roles_json, asset_scopes_json, password_hash,
          must_change_password, created_at) VALUES(?,?,?,?,?,?,?,?,?,1,?)""",
       (uid, username, body.get("display_name") or username, body.get("post", ""), body.get("department", ""),
        int(body.get("clearance", 1)), j(body.get("roles") or ["engineer"]), j(body.get("asset_scopes") or []), hash_password(pw), now_iso()))
    _sync_hod(uid)
    roles, clearance = list(body.get("roles") or ["engineer"]), int(body.get("clearance", 1))
    audit.write(actor, "admin.user.created", f"user:{username}",
                {"department": body.get("department"), "roles": roles, "clearance": clearance})
    if _is_privileged(roles, clearance):
        _announce_privileged(actor, username, roles, clearance, created=True)
    return _user_out(q1("SELECT * FROM users WHERE id=?", (uid,))), pw


@router.post("/users")
def create_user(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("users.manage")
    user, pw = create_user_row(body, ctx.actor)
    return {"user": user, "temp_password": pw}


@router.patch("/users/{uid}")
def update_user(uid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("users.manage")
    u = q1("SELECT * FROM users WHERE id=?", (uid,))
    if not u:
        raise err(404, "not_found", "User not found")
    _validate(body, False)
    if uid == ctx.user["id"] and (body.get("status") == "disabled" or ("roles" in body and "admin" not in body["roles"])):
        raise err(400, "invalid", "You cannot disable or demote your own admin account.")
    if uid == ctx.user["id"]:  # no self-escalation: another administrator must change your own rank or department
        for k, cur in (("clearance", int(u["clearance"])), ("department", u["department"]), ("asset_scopes", uj(u["asset_scopes_json"], []))):
            if k in body and body[k] != cur:
                raise err(403, "policy_denied", "You cannot change your own clearance, department or asset scope.")
        if "roles" in body and set(body["roles"]) != set(uj(u["roles_json"], [])):
            raise err(403, "policy_denied", "You cannot change your own roles.")
    fields = {"display_name": body.get("display_name", u["display_name"]), "post": body.get("post", u["post"]),
              "department": body.get("department", u["department"]), "clearance": int(body.get("clearance", u["clearance"])),
              "roles_json": j(body["roles"]) if "roles" in body else u["roles_json"],
              "asset_scopes_json": j(body["asset_scopes"]) if "asset_scopes" in body else u["asset_scopes_json"],
              "status": body.get("status", u["status"])}
    ex("""UPDATE users SET display_name=?, post=?, department=?, clearance=?, roles_json=?, asset_scopes_json=?, status=?,
          attr_version=attr_version+1 WHERE id=?""", (*fields.values(), uid))
    _sync_hod(uid)
    if fields["status"] == "disabled":
        ex("UPDATE sessions SET revoked_at=?, revoke_reason='disabled' WHERE user_id=? AND revoked_at IS NULL", (now_iso(), uid))
    audit.write(ctx.actor, "admin.user.updated", f"user:{u['username']}", {k: v for k, v in body.items()})
    old_roles, new_roles = uj(u["roles_json"], []), uj(fields["roles_json"], [])
    gained = (PRIVILEGED_ROLES & set(new_roles)) - set(old_roles)
    raised = fields["clearance"] >= 3 and fields["clearance"] > int(u["clearance"])
    if gained or raised:  # only when reach was widened (renaming a director does not announce anything)
        _announce_privileged(ctx.actor, u["username"], new_roles, fields["clearance"], created=False)
    return _user_out(q1("SELECT * FROM users WHERE id=?", (uid,)))


@router.post("/users/{uid}/reset-password")
def reset_password(uid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("users.manage")
    u = q1("SELECT * FROM users WHERE id=?", (uid,))
    if not u:
        raise err(404, "not_found", "User not found")
    if uid == ctx.user["id"]:  # it would sign you out before you could read the new password
        raise err(400, "invalid", "To change your own password, use Account & security. Another administrator can reset it for you.")
    pw = _temp_password()
    ex("UPDATE users SET password_hash=?, must_change_password=1, demo_password=NULL, locked_until=NULL WHERE id=?", (hash_password(pw), uid))
    # earlier wrong guesses are forgiven, otherwise a single typo with the new password would lock the account again
    ex("DELETE FROM login_attempts WHERE username=? AND success=0", (u["username"],))
    ex("UPDATE sessions SET revoked_at=?, revoke_reason='password_reset' WHERE user_id=? AND revoked_at IS NULL", (now_iso(), uid))
    audit.write(ctx.actor, "admin.user.password_reset", f"user:{u['username']}")
    return {"temp_password": pw}


@router.post("/users/{uid}/reset-mfa")
def reset_mfa(uid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    """For a user who lost the phone with the authenticator app (and the recovery codes): turns two-step sign-in off,
    so they can sign in with their password and set it up again on the new phone."""
    ctx.require("users.manage")
    u = q1("SELECT * FROM users WHERE id=?", (uid,))
    if not u:
        raise err(404, "not_found", "User not found")
    if uid == ctx.user["id"]:  # otherwise a stolen admin session could remove the admin's own second step
        raise err(400, "invalid", "You cannot reset your own two-step sign-in. Turn it off in Account & security, or ask another administrator.")
    ex("UPDATE users SET mfa_enabled=0, mfa_secret=NULL, mfa_pending_secret=NULL, recovery_json=NULL WHERE id=?", (uid,))
    n = ex("UPDATE sessions SET revoked_at=?, revoke_reason='mfa_reset' WHERE user_id=? AND revoked_at IS NULL", (now_iso(), uid)).rowcount
    audit.write(ctx.actor, "admin.user.mfa_reset", f"user:{u['username']}", {"sessions_revoked": n})
    return {"ok": True, "user": _user_out(q1("SELECT * FROM users WHERE id=?", (uid,)))}


@router.post("/users/{uid}/unlock")
def unlock(uid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("users.manage")
    u = q1("SELECT username FROM users WHERE id=?", (uid,))
    ex("UPDATE users SET locked_until=NULL WHERE id=?", (uid,))
    ex("DELETE FROM login_attempts WHERE username=? AND success=0", (u["username"] if u else "",))
    audit.write(ctx.actor, "admin.user.unlocked", f"user:{u['username'] if u else uid}")
    return {"ok": True}


@router.post("/users/{uid}/revoke-sessions")
def revoke_sessions(uid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("users.manage")
    n = ex("UPDATE sessions SET revoked_at=?, revoke_reason='admin_revoked' WHERE user_id=? AND revoked_at IS NULL", (now_iso(), uid)).rowcount
    audit.write(ctx.actor, "admin.user.sessions_revoked", f"user:{uid}", {"revoked": n})
    return {"revoked": n}


TEMPLATE = "username,display_name,post,department,clearance,roles,asset_scopes\n" \
           "j.doe,Jane Doe,Engineer — Process,Process Engineering,1,engineer;process,CDU-1;SRU\n"


@router.get("/users/template.csv")
def template(ctx: Ctx = Depends(current)) -> PlainTextResponse:
    ctx.require("users.manage")
    return PlainTextResponse(TEMPLATE, media_type="text/csv", headers={"Content-Disposition": "attachment; filename=yukti_users_template.csv"})


@router.post("/users/import")
async def import_users(file: UploadFile = File(...), ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("users.manage")
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="replace")  # Excel's default "CSV (comma delimited)" on Windows
    try:
        dialect = csv.Sniffer().sniff(text.splitlines()[0] if text else "username", delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames or "username" not in [f.strip().lower() for f in reader.fieldnames]:
        raise err(422, "invalid", "The file needs a header row with at least a 'username' column (download the template).")
    reader.fieldnames = [f.strip().lower() for f in reader.fieldnames]
    created, errors = [], []
    for i, row in enumerate(reader, start=2):
        try:
            body = {"username": row.get("username", ""), "display_name": row.get("display_name", ""), "post": row.get("post", ""),
                    "department": row.get("department", ""), "clearance": int(row.get("clearance") or 1),
                    "roles": [r.strip() for r in (row.get("roles") or "engineer").split(";") if r.strip()],
                    "asset_scopes": [r.strip() for r in (row.get("asset_scopes") or "").split(";") if r.strip()]}
            user, pw = create_user_row(body, ctx.actor)
            created.append({"username": user["username"], "temp_password": pw})
        except Exception as e:  # noqa: BLE001
            detail = getattr(e, "detail", None)
            errors.append({"row": i, "error": detail.get("message") if isinstance(detail, dict) else str(e)})
    audit.write(ctx.actor, "admin.users.imported", "users", {"created": len(created), "errors": len(errors)})
    return {"created": created, "errors": errors}


# ------------------------------------------------------------------ organisation AI settings
def ai_settings() -> dict[str, Any]:
    s = get_setting("ai_settings", {}) or {}
    return {"prediction": {**DEFAULT_PREDICTION, **(s.get("prediction") or {})}, "system_prompt": s.get("system_prompt", ""),
            "default_model_id": s.get("default_model_id"), "default_engine": s.get("default_engine", "llamacpp"),
            "default_load_config": {**DEFAULT_LOAD, **(s.get("default_load_config") or {})}, "autoload": s.get("autoload", True)}


@router.get("/ai-settings")
def get_ai(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("ai.settings")
    return ai_settings()


@router.put("/ai-settings")
def put_ai(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("ai.settings")
    cur = ai_settings()
    new = {k: body.get(k, cur[k]) for k in cur}
    from .llm_params import PREDICTION
    if new.get("default_engine") and new["default_engine"] not in engine.ENGINE_META:
        raise err(422, "invalid", f"Unknown engine '{new['default_engine']}'")
    pred = dict(new.get("prediction") or {})
    for f in PREDICTION:  # every value must match its type and range, otherwise nothing is saved
        k, v = f["key"], pred.get(f["key"])
        if v is None or v == "":
            continue
        try:
            if f["type"] == "int":
                v = int(v)
            elif f["type"] in ("float", "number"):
                v = float(v)
            elif f["type"] == "bool":
                if not isinstance(v, bool):
                    raise ValueError
            elif f["type"] == "select" and f.get("options") and v not in [o["value"] for o in f["options"]]:
                raise ValueError
            elif f["type"] in ("json", "json_schema") or k in ("json_schema", "logit_bias"):
                import json as _json
                if isinstance(v, str) and v.strip():
                    _json.loads(v)
            if f["type"] in ("int", "float", "number") and ((f.get("min") is not None and v < f["min"]) or (f.get("max") is not None and v > f["max"])):
                raise ValueError
        except (TypeError, ValueError):
            from .i18n_params import param_label
            raise err(422, "invalid", f"{param_label(f['label'], get_lang())}: '{pred.get(k)}' is not a valid value")
        pred[k] = v
    new["prediction"] = pred
    set_setting("ai_settings", new, ctx.actor)
    audit.write(ctx.actor, "admin.ai_settings.updated", "ai_settings", {"keys": list(body.keys())})
    return ai_settings()


# ------------------------------------------------------------------ usage & health (measured values only)
@router.get("/usage")
def usage(days: int = 14, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("usage.view")
    # timestamps are stored in UTC; days are counted in the server's local time zone (as the chart shows them)
    local_midnight = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    since = local_midnight.astimezone(timezone.utc).isoformat(timespec="seconds")
    week = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    qpd = {r["d"]: r["n"] for r in q("SELECT date(at, 'localtime') d, COUNT(*) n FROM answer_stats WHERE at>=? GROUP BY d", (since,))}
    dpd = {r["d"]: r["n"] for r in q("""SELECT date(at, 'localtime') d, COUNT(*) n FROM audit_log WHERE at>=? AND
            (event='document.denied' OR (event='retrieval' AND detail_json NOT LIKE '%"denied_n":0%')) GROUP BY d""", (since,))}
    days_list = [(date.today() - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
    perf_rows = q("SELECT tok_per_s, ttft_ms, total_ms FROM answer_stats WHERE error IS NULL AND tok_per_s>0 ORDER BY id DESC LIMIT 500")
    ttfts = sorted(r["ttft_ms"] for r in perf_rows if r["ttft_ms"] is not None)
    perf = {"answers": len(perf_rows),
            "avg_tok_per_s": round(statistics.mean(r["tok_per_s"] for r in perf_rows), 1) if perf_rows else None,
            "avg_ttft_ms": round(statistics.mean(ttfts)) if ttfts else None,
            "p95_ttft_ms": round(ttfts[min(len(ttfts) - 1, int(0.95 * len(ttfts)))]) if ttfts else None,
            "avg_total_ms": round(statistics.mean(r["total_ms"] for r in perf_rows)) if perf_rows else None}
    du = psutil.disk_usage(str(STORE))  # the disk that holds the data
    vm = psutil.virtual_memory()
    from .main import gpu_stats  # local import (avoid cycle)
    s = engine.state
    return {
        "users": {"total": q1("SELECT COUNT(*) n FROM users")["n"],
                  "active_7d": q1("SELECT COUNT(*) n FROM users WHERE last_login_at>=?", (week,))["n"],
                  "disabled": q1("SELECT COUNT(*) n FROM users WHERE status!='active'")["n"],
                  "locked": q1("SELECT COUNT(*) n FROM users WHERE locked_until>?", (now_iso(),))["n"]},
        "sessions_active": q1("SELECT COUNT(*) n FROM sessions WHERE revoked_at IS NULL AND idle_expires_at>?", (now_iso(),))["n"],
        "queries_per_day": [{"date": d, "count": qpd.get(d, 0)} for d in days_list],
        "denials_per_day": [{"date": d, "count": dpd.get(d, 0)} for d in days_list],
        "by_intent": {r["intent"] or "?": r["n"] for r in q("SELECT intent, COUNT(*) n FROM answer_stats GROUP BY intent")},
        "by_department": {r["department"] or "?": r["n"] for r in q("SELECT department, COUNT(*) n FROM answer_stats GROUP BY department")},
        "perf": perf,
        "errors_24h": q1("SELECT COUNT(*) n FROM answer_stats WHERE error IS NOT NULL AND at>=?",
                         ((datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),))["n"],
        "feedback": {"up": q1("SELECT COUNT(*) n FROM feedback WHERE rating>0")["n"], "down": q1("SELECT COUNT(*) n FROM feedback WHERE rating<0")["n"]},
        "knowledge": {"documents": q1("SELECT COUNT(*) n FROM documents")["n"], "pages": q1("SELECT COUNT(*) n FROM pages")["n"],
                      "scanned_pages": q1("SELECT COUNT(*) n FROM pages WHERE mode!='digital'")["n"], "chunks": q1("SELECT COUNT(*) n FROM chunks")["n"],
                      "examples": q1("SELECT COUNT(*) n FROM documents WHERE is_example=1")["n"],
                      "public": q1("SELECT COUNT(*) n FROM documents WHERE is_public=1")["n"]},
        "engine": {"status": s.status, "model_name": s.model_name, "engine": s.engine, "requests": s.requests,
                   "uptime_s": round(time.time() - s.started_at) if s.started_at else 0},
        "gpu": gpu_stats(), "ram": {"total_mb": vm.total // 2**20, "used_mb": (vm.total - vm.available) // 2**20},
        "disk": {"free_gb": round(du.free / 2**30, 1), "total_gb": round(du.total / 2**30, 1)},
        "audit": {"records": q1("SELECT COUNT(*) n FROM audit_log")["n"], "head": (q1("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1") or {}).get("hash")},
    }


# ------------------------------------------------------------------ feedback
@router.get("/feedback")
def feedback_list(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ctx.require("usage.view")
    out = []
    for f in q("SELECT * FROM feedback ORDER BY created_at DESC LIMIT 300"):
        m = q1("SELECT chat_id, content, created_at FROM messages WHERE id=?", (f["message_id"],)) or {}
        qn = q1("SELECT content FROM messages WHERE chat_id=? AND role='user' AND created_at<=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
                (m.get("chat_id"), m.get("created_at") or "")) if m else None
        u = q1("SELECT username FROM users WHERE id=?", (f["user_id"],)) or {}
        # the conversation is shown only if the viewer may read every document the answer cited
        full = q1("SELECT meta_json FROM messages WHERE id=?", (f["message_id"],)) or {}
        meta = uj(full.get("meta_json"), {})
        ids = [x.get("document_id") for x in (meta.get("sources") or []) if isinstance(x, dict)]
        from . import rag
        visible = all((d := q1("SELECT * FROM documents WHERE id=?", (i,))) is None or rag.can_read(ctx.subject, d) for i in ids)             and not (meta.get("denied") or {}).get("count")
        hidden = tr("[hidden: this conversation used documents outside your access]")
        out.append({"message_id": f["message_id"], "user": u.get("username"), "rating": f["rating"], "comment": f["comment"],
                    "question": (qn or {}).get("content") if visible else hidden,
                    "answer_excerpt": (m.get("content") or "")[:300] if visible else hidden, "created_at": f["created_at"]})
    return out


# ------------------------------------------------------------------ backups
@router.post("/backups")
def create_backup(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("backup.manage")
    name = f"yukti-backup-{datetime.now():%Y%m%d-%H%M%S}.zip"
    path = BACKUPS / name
    snap = BACKUPS / "db-snapshot.sqlite"
    if snap.exists():
        snap.unlink()
    db().execute("VACUUM INTO ?", (snap.as_posix(),))  # consistent online snapshot
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(snap, "yukti.db")
        for f in BLOBS.rglob("*"):
            if f.is_file():
                z.write(f, "blobs/" + f.relative_to(BLOBS).as_posix())
        for f in ATTACHMENTS.glob("*.jpg"):  # photos attached to chat questions (the database only holds their ids)
            if f.is_file():
                z.write(f, "attachments/" + f.name)
    snap.unlink()
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    (BACKUPS / (name + ".sha256")).write_text(sha, encoding="utf-8")
    audit.write(ctx.actor, "admin.backup.created", f"backup:{name}", {"sha256": sha, "size": path.stat().st_size})
    return {"name": name, "size_bytes": path.stat().st_size, "sha256": sha, "created_at": now_iso()}


@router.get("/backups")
def list_backups(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ctx.require("backup.manage")
    def _sha(p: Path) -> str | None:
        f = BACKUPS / (p.name + ".sha256")
        return f.read_text(encoding="utf-8").strip() if f.exists() else None
    return [{"name": p.name, "size_bytes": p.stat().st_size, "sha256": _sha(p),
             "created_at": datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")}
            for p in sorted(BACKUPS.glob("yukti-backup-*.zip"), reverse=True)]


def _backup_path(name: str) -> Path:
    p = (BACKUPS / name).resolve()
    if p.parent != BACKUPS.resolve() or not p.exists() or not name.startswith("yukti-backup-"):
        raise err(404, "not_found", "Backup not found")
    return p


@router.get("/backups/{name}/file")
def download_backup(name: str, ctx: Ctx = Depends(current)) -> FileResponse:
    ctx.require("backup.manage")
    return FileResponse(_backup_path(name), filename=name, media_type="application/zip")


@router.post("/backups/{name}/restore")
def restore_backup(name: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("backup.manage")
    p = _backup_path(name)
    side = BACKUPS / (name + ".sha256")
    if side.exists() and hashlib.sha256(p.read_bytes()).hexdigest() != side.read_text(encoding="utf-8").strip():
        raise err(422, "invalid", "This backup file does not match its recorded SHA-256 checksum (damaged or altered). Not restored.")
    try:
        with zipfile.ZipFile(p) as z:
            if z.testzip() is not None or "yukti.db" not in z.namelist():
                raise err(422, "invalid", "This backup is damaged or does not contain a Yukti database. Not restored.")
            stage = STORE / "restore-pending"
            if stage.exists():
                shutil.rmtree(stage)
            stage.mkdir()
            z.extractall(stage)
    except zipfile.BadZipFile:
        raise err(422, "invalid", "This backup is not a valid zip file. Not restored.")
    import sqlite3
    try:
        chk = sqlite3.connect(stage / "yukti.db")
        ok = chk.execute("PRAGMA quick_check").fetchone()[0] == "ok"
        chk.close()
    except sqlite3.DatabaseError:
        ok = False
    if not ok:
        shutil.rmtree(stage, ignore_errors=True)
        raise err(422, "invalid", "The database inside this backup is damaged. Not restored.")
    (stage / ".from").write_text(name, encoding="utf-8")
    audit.write(ctx.actor, "admin.backup.restore_staged", f"backup:{name}")
    return {"ok": True, "restart_required": True, "pending": name,
            "message": tr("Backup checked and staged. Restart Yukti to replace the current data with it.")}


@router.get("/backups/restore-pending")
def restore_pending(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("backup.manage")
    f = STORE / "restore-pending" / ".from"
    return {"pending": f.read_text(encoding="utf-8") if f.exists() else None}


@router.delete("/backups/restore-pending")
def cancel_restore(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("backup.manage")
    stage = STORE / "restore-pending"
    name = (stage / ".from").read_text(encoding="utf-8") if (stage / ".from").exists() else None
    shutil.rmtree(stage, ignore_errors=True)
    audit.write(ctx.actor, "admin.backup.restore_cancelled", f"backup:{name}")
    return {"ok": True}


@router.post("/server/restart")
def restart_server(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    """Exit with code 75; the desktop app and the Start Yukti Server launchers start the server again."""
    ctx.require("backup.manage")
    audit.write(ctx.actor, "admin.server.restart", "server")
    import os
    import threading

    def bye() -> None:
        time.sleep(1.0)  # let this response reach the browser
        engine.unload()
        os._exit(75)

    threading.Thread(target=bye, daemon=True).start()
    return {"ok": True, "message": tr("Yukti is restarting; this page reconnects when it is back.")}


def apply_pending_restore() -> bool:
    """Called at server start before the DB is opened."""
    stage = STORE / "restore-pending"
    if not (stage / "yukti.db").exists():
        return False
    import os
    tmp = Path(str(DB_PATH) + ".restore-tmp")
    old = Path(str(DB_PATH) + ".pre-restore")
    shutil.copy2(stage / "yukti.db", tmp)  # copy first; the current database is only replaced once this succeeded
    for suffix in ("-wal", "-shm"):
        f = Path(str(DB_PATH) + suffix)
        if f.exists():
            f.unlink()
    if DB_PATH.exists():
        os.replace(DB_PATH, old)
    try:
        os.replace(tmp, DB_PATH)
        if (stage / "blobs").exists():
            shutil.copytree(stage / "blobs", BLOBS, dirs_exist_ok=True)
        if (stage / "attachments").exists():  # chat photos (backups made before 0.5.0 have none)
            shutil.copytree(stage / "attachments", ATTACHMENTS, dirs_exist_ok=True)
    except Exception:
        if old.exists():
            os.replace(old, DB_PATH)  # roll back to the data that was there before
        raise
    shutil.rmtree(stage, ignore_errors=True)
    old.unlink(missing_ok=True)
    return True


# ------------------------------------------------------------------ models (offline import)
@router.get("/models/import-dirs")
def import_dirs(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    return {"dirs": list(dict.fromkeys([str(MODELS_DIR), str(ROOT / "models"), str(Path.home() / ".lmstudio" / "models")])),
            "drives": [p.mountpoint for p in psutil.disk_partitions() if "cdrom" not in p.opts]}


@router.post("/models/import")
def import_model(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    src = Path(str(body.get("path", "")).strip().strip('"'))
    if not src.exists() or src.suffix.lower() != ".gguf":
        raise err(422, "invalid", "Path must point to an existing .gguf file on the server (e.g. a USB drive).")
    dest_dir = MODELS_DIR / src.stem
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / src.name
    import re as _re
    shard = _re.match(r"(.+)-(\d{5})-of-(\d{5})\.gguf$", src.name, _re.I)
    parts = sorted(src.parent.glob(f"{shard.group(1)}-*-of-{shard.group(3)}.gguf")) if shard else [src]
    if shard and len(parts) != int(shard.group(3)):
        raise err(422, "invalid", f"This model is split into {int(shard.group(3))} files but only {len(parts)} are in {src.parent}.")
    for part in parts:
        target = dest_dir / part.name
        if target.exists() and target.stat().st_size == part.stat().st_size:
            continue  # already imported completely
        tmp = target.with_suffix(target.suffix + ".part")
        shutil.copyfile(part, tmp)
        if tmp.stat().st_size != part.stat().st_size:
            tmp.unlink(missing_ok=True)
            raise err(500, "copy_failed", f"Copying {part.name} did not complete (disk full or source removed).")
        tmp.replace(target)
    for mm in src.parent.glob("*mmproj*.gguf"):  # keep vision projector alongside
        if not (dest_dir / mm.name).exists():
            shutil.copy2(mm, dest_dir / mm.name)
    h = hashlib.sha256()
    with dest.open("rb") as fh:
        for chunk in iter(lambda: fh.read(8 * 2**20), b""):
            h.update(chunk)
    engine.invalidate_vision_cache()
    audit.write(ctx.actor, "admin.model.imported", f"model:{dest.name}", {"sha256": h.hexdigest(), "size": dest.stat().st_size, "from": str(src)})
    m = engine.model_by_id(str(dest)) or {}
    return {**m, "sha256": h.hexdigest()}


@router.delete("/models/{mid:path}")
def delete_model(mid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    p = Path(mid).resolve()
    if MODELS_DIR.resolve() not in p.parents or not p.exists():
        raise err(400, "invalid", "Only models imported into the Yukti models folder can be deleted here.")
    if engine.state.model_id and Path(engine.state.model_id).resolve() == p:
        raise err(409, "conflict", "Unload the model first.")
    p.unlink()
    engine.invalidate_vision_cache()
    audit.write(ctx.actor, "admin.model.deleted", f"model:{p.name}")
    return {"ok": True}


# ------------------------------------------------------------------ Laya benchmark (measured, not assumed)
@router.post("/laya/benchmark")
async def laya_benchmark(body: dict[str, Any] | None = None, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    from . import laya
    n = int((body or {}).get("n", 10))
    # questions people asked are not kept (the router log holds only their length and a fingerprint), so the comparison
    # runs on Laya's built-in sample questions
    texts = laya.sample_texts(max(1, min(n, 50)))
    if engine.state.status != "ready":
        raise err(409, "conflict", "Load a model first.")
    labels = laya.get().labels
    llm_ms, laya_ms, agree = [], [], 0
    for t in texts:
        t0 = time.perf_counter()
        d = laya.get().classify(t)
        laya_ms.append((time.perf_counter() - t0) * 1000)
        t0 = time.perf_counter()
        try:
            out = await engine.complete_once([{"role": "user", "content": "Classify the user request into exactly one intent from this list and reply with only the "
                                              f"intent name: {', '.join(labels)}.\nRequest: {t}"}], {"max_tokens": 12, "temperature": 0})
        except RuntimeError as e:
            raise err(502, "engine_error", f"The loaded model failed during the benchmark: {e}")
        llm_ms.append((time.perf_counter() - t0) * 1000)
        agree += int(d["intent"] in out.strip().lower())
    res = {"n": len(texts), "llm_router_avg_ms": round(statistics.mean(llm_ms), 1), "laya_avg_ms": round(statistics.mean(laya_ms), 2),
           "agreement_pct": round(100 * agree / len(texts), 1), "measured_at": now_iso(), "model": engine.state.model_name}
    set_setting("laya_benchmark", res, ctx.actor)
    audit.write(ctx.actor, "admin.laya.benchmark", "laya", res)
    return res
