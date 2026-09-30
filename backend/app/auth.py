"""Authentication: argon2id passwords, server-side opaque sessions, CSRF, lockout, attribute snapshot."""
from __future__ import annotations

import hashlib
import math
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from . import audit
from .config import ABS_TIMEOUT_S, CLEARANCE_LABELS, DEMO_MODE, IDLE_TIMEOUT_S, LOCK_THRESHOLD, LOCK_WINDOW_S
from .db import ex, j, new_id, now_iso, q, q1, uj
from .policy import Subject

ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)  # argon2id, RFC 9106 second profile
_DUMMY = ph.hash("dummy-password-for-timing")
COOKIE = "yukti_sid"
# TOTP codes are accepted up to 2 steps (60 s) either side of the server time: phone clocks are often a little off.
TOTP_WINDOW = 2
LOCK_MINUTES = 5

ROLE_PERMS: dict[str, list[str]] = {
    # need-to-know: company-level information (finances, strategy, company-wide figures) is for top management only
    "*": ["chat", "documents.view", "assets.view", "access.request", "notifications", "feedback"],
    "executive": ["company.view", "production.view", "findings.view"],
    "engineer": ["findings.view"],
    "hse": ["findings.view"],
    "contractor": [],
    "dept_manager": ["access.approve", "findings.view", "findings.approve", "audit.view", "documents.upload"],
    "plant_manager": ["access.approve", "findings.view", "findings.approve", "audit.view", "audit.export", "production.view"],
    "planner": ["production.view", "production.edit"],
    "auditor": ["audit.view", "audit.export"],
    "approver:mechanical": ["findings.approve"],
    "approver:electrical": ["findings.approve"],
    "admin": ["models.manage", "admin", "audit.view", "audit.export", "production.view", "production.edit", "findings.view",
              "findings.approve", "access.approve", "developer", "users.manage", "ai.settings", "usage.view", "backup.manage"],
}


def hash_password(pw: str) -> str:
    return ph.hash(pw)


def _utc(s: str) -> datetime:
    return datetime.fromisoformat(s)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def err(status: int, code: str, message: str) -> HTTPException:
    from .i18n import tr  # messages are written in English and shown in the user's language
    return HTTPException(status_code=status, detail={"code": code, "message": tr(message)})


def active_grants(user_id: str) -> list[dict[str, Any]]:
    return q("SELECT * FROM grants WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY expires_at",
             (user_id, now_iso()))


def subject_for(user: dict[str, Any]) -> Subject:
    return Subject(
        id=user["id"], username=user["username"], display_name=user["display_name"], post=user["post"],
        department=user["department"], clearance=int(user["clearance"]), roles=uj(user["roles_json"], []),
        asset_scopes=uj(user["asset_scopes_json"], []), grants=active_grants(user["id"]),
    )


def permissions(roles: list[str]) -> list[str]:
    perms = set(ROLE_PERMS["*"])
    for r in roles:
        perms.update(ROLE_PERMS.get(r, []))
    if "access.approve" in perms or "findings.approve" in perms:
        perms.add("inbox")
    if any(p.startswith("findings") for p in perms):
        perms.add("inbox")
    return sorted(perms)


class Ctx:
    """Per-request auth context."""

    def __init__(self, user: dict[str, Any], session: dict[str, Any]):
        self.user = user
        self.session = session
        self.subject = subject_for(user)
        self.perms = permissions(self.subject.roles)

    @property
    def actor(self) -> str:
        return self.user["username"]

    def require(self, perm: str) -> None:
        if perm not in self.perms:
            raise err(403, "policy_denied", f"Missing permission: {perm}")


def _session_from_request(request: Request) -> tuple[dict[str, Any], dict[str, Any]]:
    tok = request.cookies.get(COOKIE)
    if not tok:
        raise err(401, "not_authenticated", "Please sign in.")
    th = hashlib.sha256(tok.encode()).hexdigest()
    s = q1("SELECT * FROM sessions WHERE token_hash=?", (th,))
    if not s or s["revoked_at"]:
        raise err(401, "not_authenticated", "Please sign in.")
    now = _now()
    if _utc(s["idle_expires_at"]) < now or _utc(s["abs_expires_at"]) < now:
        ex("UPDATE sessions SET revoked_at=?, revoke_reason='expired' WHERE id=?", (now_iso(), s["id"]))
        audit.write(s["user_id"], "auth.session.expired", f"session:{s['id']}")
        raise err(401, "session_expired", "Your session expired. Please sign in again.")
    u = q1("SELECT * FROM users WHERE id=?", (s["user_id"],))
    if not u or u["status"] != "active":
        raise err(401, "not_authenticated", "Account disabled.")
    # sliding idle window (update at most every 30s)
    if (now - _utc(s["last_seen_at"])).total_seconds() > 30:
        idle = (now + timedelta(seconds=IDLE_TIMEOUT_S)).isoformat(timespec="seconds")
        ex("UPDATE sessions SET last_seen_at=?, idle_expires_at=? WHERE id=?", (now.isoformat(timespec="seconds"), idle, s["id"]))
        s["idle_expires_at"] = idle
    return u, s


def current(request: Request) -> Ctx:
    u, s = _session_from_request(request)
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        if request.headers.get("x-csrf-token") != s["csrf_token"]:
            raise err(403, "csrf_invalid", "Missing or invalid CSRF token.")
    if u.get("must_change_password") and not request.url.path.startswith("/api/auth/"):
        raise err(403, "password_change_required", "You must change your password before continuing.")
    return Ctx(u, s)


def me_payload(ctx: Ctx) -> dict[str, Any]:
    u, s = ctx.user, ctx.session
    return {
        "user": {
            "id": u["id"], "username": u["username"], "display_name": u["display_name"], "post": u["post"],
            "department": u["department"], "clearance": u["clearance"],
            "clearance_label": CLEARANCE_LABELS.get(u["clearance"], "?"),
            "roles": ctx.subject.roles, "asset_scopes": ctx.subject.asset_scopes,
            "must_change_password": bool(u.get("must_change_password")), "mfa_enabled": bool(u.get("mfa_enabled")),
            "status": u.get("status"), "last_login_at": u.get("last_login_at"),
        },
        "org": {"name": "Mangalore Refinery and Petrochemicals Ltd", "deployment": "On-premise (Yukti)", "languages": ["en", "hi", "kn"]},
        "csrf_token": s["csrf_token"],
        "permissions": ctx.perms,
        "grants": [{"id": g["id"], "scope": g["department"] or g["document_id"] or "?", "expires_at": g["expires_at"]}
                   for g in ctx.subject.grants],
        "session": {"idle_expires_at": s["idle_expires_at"], "abs_expires_at": s["abs_expires_at"],
                    "idle_timeout_s": IDLE_TIMEOUT_S},
        "demo_mode": DEMO_MODE,
        # lets the browser correct for a wrong PC clock when it counts down to the session expiry
        "server_time": _now().isoformat(timespec="seconds"),
    }


router = APIRouter(prefix="/api/auth", tags=["auth"])


def _recent_failures(username: str, since: str) -> tuple[int, str | None]:
    """Failed sign-ins in the lockout window that came after the last successful sign-in (a success starts a fresh count)."""
    r = q1("""SELECT COUNT(*) n, MAX(at) at FROM login_attempts WHERE username=? AND success=0 AND at>?
              AND id > (SELECT COALESCE(MAX(id), 0) FROM login_attempts WHERE username=? AND success=1)""",
           (username, since, username))
    return (int(r["n"]), r["at"]) if r else (0, None)


def _locked_error(until: datetime) -> HTTPException:
    mins = max(1, math.ceil((until - _now()).total_seconds() / 60))
    e = err(423, "locked", f"Too many failed sign-in attempts. Try again in {mins} minute{'s' if mins != 1 else ''}, "
                           "or ask the administrator to unlock the account.")
    e.detail["minutes"] = mins  # lets the sign-in page show the wait in whatever language is chosen later
    return e


def _record_failure(username: str, u: dict[str, Any] | None, ip: str, since: str) -> None:
    ex("INSERT INTO login_attempts(username, ip, success, at) VALUES(?,?,0,?)", (username, ip, now_iso()))
    if u and _recent_failures(username, since)[0] >= LOCK_THRESHOLD:
        until = (_now() + timedelta(minutes=LOCK_MINUTES)).isoformat(timespec="seconds")
        ex("UPDATE users SET locked_until=? WHERE id=?", (until, u["id"]))
        audit.write(username, "auth.login.lock_started", f"user:{username}", {"ip": ip, "until": until})


@router.post("/login")
def login(body: dict[str, Any], request: Request, response: Response) -> dict[str, Any]:
    username = str(body.get("username", "")).strip().lower()
    password = str(body.get("password", ""))
    ip = request.client.host if request.client else "?"
    u = q1("SELECT * FROM users WHERE username=?", (username,))
    since = (_now() - timedelta(seconds=LOCK_WINDOW_S)).isoformat(timespec="seconds")
    until = None
    if u and u["locked_until"] and _utc(u["locked_until"]) > _now():
        until = _utc(u["locked_until"])
    elif not u:  # same behaviour for names that do not exist, so the lockout does not reveal which accounts exist
        n, last_at = _recent_failures(username, since)
        if n >= LOCK_THRESHOLD and last_at:
            until = _utc(last_at) + timedelta(minutes=LOCK_MINUTES)
            until = until if until > _now() else None
    if until:
        audit.write(username, "auth.login.locked", f"user:{username}", {"ip": ip})
        raise _locked_error(until)
    ok = False
    try:
        ph.verify(u["password_hash"] if u else _DUMMY, password)
        ok = bool(u)
    except VerifyMismatchError:
        ok = False
    if not ok:
        _record_failure(username, u, ip, since)
        audit.write(username or "?", "auth.login.fail", f"user:{username}", {"ip": ip})
        raise err(401, "bad_credentials", "Invalid username or password.")
    if u["status"] != "active":
        audit.write(username, "auth.login.disabled", f"user:{username}", {"ip": ip})
        raise err(403, "account_disabled", "This account is disabled. Contact the administrator.")
    if u.get("mfa_enabled"):
        code = normalize_code(body.get("totp"))
        if not code:  # password was right: ask for the second step (not counted as a failure)
            raise err(401, "mfa_required", "Enter the 6-digit code from your authenticator app.")
        if not _verify_totp(u, code):
            # wrong codes count towards the lockout, so the 6-digit code cannot be found by trying many
            _record_failure(username, u, ip, since)
            audit.write(username, "auth.mfa.fail", f"user:{username}", {"ip": ip})
            raise err(401, "mfa_invalid", MFA_INVALID)
    ex("INSERT INTO login_attempts(username, ip, success, at) VALUES(?,?,1,?)", (username, ip, now_iso()))
    if ph.check_needs_rehash(u["password_hash"]):
        ex("UPDATE users SET password_hash=? WHERE id=?", (ph.hash(password), u["id"]))
    token = secrets.token_urlsafe(32)
    now = _now()
    sid = new_id()
    ex("""INSERT INTO sessions(id, token_hash, user_id, csrf_token, attr_version, ip, user_agent, created_at, last_seen_at,
          idle_expires_at, abs_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
       (sid, hashlib.sha256(token.encode()).hexdigest(), u["id"], secrets.token_urlsafe(24), u["attr_version"], ip,
        request.headers.get("user-agent", "")[:200], now.isoformat(timespec="seconds"), now.isoformat(timespec="seconds"),
        (now + timedelta(seconds=IDLE_TIMEOUT_S)).isoformat(timespec="seconds"),
        (now + timedelta(seconds=ABS_TIMEOUT_S)).isoformat(timespec="seconds")))
    ex("UPDATE users SET locked_until=NULL, last_login_at=? WHERE id=?", (now_iso(), u["id"]))
    response.set_cookie(COOKIE, token, httponly=True, samesite="strict", secure=os.environ.get("YUKTI_TLS") == "1", path="/", max_age=ABS_TIMEOUT_S)
    audit.write(u["username"], "auth.login.success", f"session:{sid}", {"ip": ip})
    s = q1("SELECT * FROM sessions WHERE id=?", (sid,))
    return me_payload(Ctx(q1("SELECT * FROM users WHERE id=?", (u["id"],)), s))


@router.post("/logout")
def logout(response: Response, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ex("UPDATE sessions SET revoked_at=?, revoke_reason='logout' WHERE id=?", (now_iso(), ctx.session["id"]))
    response.delete_cookie(COOKIE, path="/")
    audit.write(ctx.actor, "auth.logout", f"session:{ctx.session['id']}")
    return {"ok": True}


@router.post("/logout-all")
def logout_all(response: Response, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    cur = ex("UPDATE sessions SET revoked_at=?, revoke_reason='logout_all' WHERE user_id=? AND revoked_at IS NULL",
             (now_iso(), ctx.user["id"]))
    response.delete_cookie(COOKIE, path="/")
    audit.write(ctx.actor, "auth.logout_all", f"user:{ctx.actor}", {"revoked": cur.rowcount})
    return {"ok": True, "revoked": cur.rowcount}


@router.get("/me")
def me(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    return me_payload(ctx)


@router.get("/sessions")
def sessions(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    rows = q("SELECT id, created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id=? AND revoked_at IS NULL "
             "ORDER BY last_seen_at DESC", (ctx.user["id"],))
    for r in rows:
        r["current"] = r["id"] == ctx.session["id"]
    return rows


@router.delete("/sessions/{sid}")
def revoke_session(sid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ex("UPDATE sessions SET revoked_at=?, revoke_reason='revoked' WHERE id=? AND user_id=?", (now_iso(), sid, ctx.user["id"]))
    audit.write(ctx.actor, "auth.session.revoked", f"session:{sid}")
    return {"ok": True}


MFA_INVALID = ("That code did not work. Type the newest 6-digit code from your authenticator app "
               "and check that the time on your phone is correct.")


def normalize_code(code: Any) -> str:
    """A code as the user typed or pasted it: spaces and dashes removed, lower case ("123 456" -> "123456")."""
    return re.sub(r"[\s\-\u2010-\u2015]", "", str(code or "")).lower()


def _totp_step(secret: str, code: str) -> int | None:
    """The 30-second time step whose code matches (within TOTP_WINDOW steps of now), or None."""
    import pyotp
    if not (secret and len(code) == 6 and code.isdigit()):
        return None
    totp = pyotp.TOTP(secret)
    now_step = int(_now().timestamp() // 30)
    for off in sorted(range(-TOTP_WINDOW, TOTP_WINDOW + 1), key=abs):
        if secrets.compare_digest(totp.at((now_step + off) * 30), code):
            return now_step + off
    return None


def _recovery_hash(code: str) -> str:
    """Recovery codes are shown as xxxxxxxx-xxxxxxxx; they are accepted with or without the dash, in any case."""
    c = normalize_code(code)
    if len(c) == 16:
        c = c[:8] + "-" + c[8:]
    return hashlib.sha256(c.encode()).hexdigest()


def _verify_totp(u: dict[str, Any], code: str) -> bool:
    code = normalize_code(code)
    step = _totp_step(u.get("mfa_secret") or "", code)
    if step is not None:
        if u.get("mfa_last_step") is not None and step <= int(u["mfa_last_step"]):
            return False  # this code (or an older one) was already used: refuse a replay
        ex("UPDATE users SET mfa_last_step=? WHERE id=?", (step, u["id"]))
        return True
    codes = uj(u.get("recovery_json"), [])
    h = _recovery_hash(code)
    if code and h in codes:  # single-use recovery code
        codes.remove(h)
        ex("UPDATE users SET recovery_json=? WHERE id=?", (j(codes), u["id"]))
        audit.write(u["username"], "auth.mfa.recovery_code_used", f"user:{u['username']}", {"left": len(codes)})
        return True
    return False


def strong_password_problem(pw: str) -> str | None:
    if len(pw) < 12:
        return "Password must be at least 12 characters."
    if not (any(c.isdigit() for c in pw) and any(c.isalpha() for c in pw)):
        return "Password must contain letters and digits."
    return None


@router.post("/password")
def change_password(body: dict[str, Any], request: Request) -> dict[str, Any]:
    u, s = _session_from_request(request)
    if request.headers.get("x-csrf-token") != s["csrf_token"]:
        raise err(403, "csrf_invalid", "Missing or invalid CSRF token.")
    cur, new = str(body.get("current_password", "")), str(body.get("new_password", ""))
    try:
        ph.verify(u["password_hash"], cur)
    except VerifyMismatchError:
        raise err(400, "bad_password", "Current password is incorrect.")
    if cur == new:
        raise err(400, "weak_password", "New password must differ from the current one.")
    problem = strong_password_problem(new)
    if problem:
        raise err(400, "weak_password", problem)
    ex("UPDATE users SET password_hash=?, must_change_password=0, demo_password=NULL, attr_version=attr_version+1 WHERE id=?",
       (ph.hash(new), u["id"]))
    ex("UPDATE sessions SET revoked_at=?, revoke_reason='password_changed' WHERE user_id=? AND id!=? AND revoked_at IS NULL",
       (now_iso(), u["id"], s["id"]))
    audit.write(u["username"], "auth.password.changed", f"user:{u['username']}")
    return {"ok": True}


@router.post("/mfa/enroll")
def mfa_enroll(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    import io

    import pyotp
    import segno
    if ctx.user.get("mfa_enabled"):  # moving to a new phone must go through "turn off" (password + code) first
        raise err(409, "mfa_already_on", "Two-step sign-in is already turned on. To move it to a new phone, turn it off first "
                                         "(you need your password and a code), then set it up again.")
    secret = pyotp.random_base32()
    ex("UPDATE users SET mfa_pending_secret=? WHERE id=?", (secret, ctx.user["id"]))
    uri = pyotp.TOTP(secret).provisioning_uri(name=ctx.user["username"], issuer_name="Yukti")
    buf = io.BytesIO()
    segno.make(uri, error="m").save(buf, kind="svg", scale=5, dark="#111111", light="#ffffff", border=2)
    audit.write(ctx.actor, "auth.mfa.enroll_started", f"user:{ctx.actor}")
    return {"secret": secret, "otpauth_uri": uri, "qr_svg": buf.getvalue().decode()}


@router.post("/mfa/verify")
def mfa_verify(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    u = q1("SELECT * FROM users WHERE id=?", (ctx.user["id"],))
    if u.get("mfa_enabled"):
        raise err(409, "mfa_already_on", "Two-step sign-in is already turned on.")
    sec = u.get("mfa_pending_secret")
    if not sec:
        raise err(400, "mfa_not_started", "The setup has not been started. Click the set-up button again and scan the new QR code.")
    step = _totp_step(sec, normalize_code(body.get("code")))
    if step is None:
        raise err(400, "mfa_invalid", "Code did not match. Check the time on your phone and try again.")
    codes = [secrets.token_hex(4) + "-" + secrets.token_hex(4) for _ in range(10)]
    # the time step used here is remembered, so the same code cannot be used again to sign in
    ex("UPDATE users SET mfa_enabled=1, mfa_secret=?, mfa_pending_secret=NULL, mfa_last_step=?, recovery_json=? WHERE id=?",
       (sec, step, j([hashlib.sha256(c.encode()).hexdigest() for c in codes]), u["id"]))
    audit.write(ctx.actor, "auth.mfa.enabled", f"user:{ctx.actor}")
    return {"ok": True, "recovery_codes": codes}


@router.post("/mfa/disable")
def mfa_disable(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    try:
        ph.verify(ctx.user["password_hash"], str(body.get("password", "")))
    except VerifyMismatchError:
        raise err(400, "bad_password", "Password is incorrect.")
    if ctx.user.get("mfa_enabled") and not _verify_totp(ctx.user, str(body.get("code", ""))):
        raise err(400, "bad_code", "Enter the current code from your authenticator app (or a recovery code).")
    ex("UPDATE users SET mfa_enabled=0, mfa_secret=NULL, mfa_pending_secret=NULL, recovery_json=NULL WHERE id=?", (ctx.user["id"],))
    audit.write(ctx.actor, "auth.mfa.disabled", f"user:{ctx.actor}")
    return {"ok": True}


@router.get("/demo-users")
def demo_users() -> list[dict[str, Any]]:
    if not DEMO_MODE:
        raise err(404, "not_found", "Not available.")
    return q("SELECT username, display_name, post, department, demo_password AS password FROM users "
             "WHERE demo_password IS NOT NULL AND status='active' ORDER BY rowid")


def user_by_id(uid: str | None) -> dict[str, Any] | None:
    return q1("SELECT * FROM users WHERE id=?", (uid,)) if uid else None


def notify(user_id: str, kind: str, title: str, body: str = "", link: str = "") -> None:
    ex("INSERT INTO notifications(id, user_id, kind, title, body, link, created_at) VALUES(?,?,?,?,?,?,?)",
       (new_id(), user_id, kind, title, body, link, now_iso()))


__all__ = ["router", "current", "Ctx", "hash_password", "err", "notify", "user_by_id", "j"]
