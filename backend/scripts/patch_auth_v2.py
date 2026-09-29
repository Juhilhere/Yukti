"""One-off patch: v0.2 auth features (admin-only perms, forced password change, MFA)."""
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "app" / "auth.py"
s = p.read_text(encoding="utf-8")


def rep(old: str, new: str) -> None:
    global s
    assert old in s, f"anchor not found: {old[:70]!r}"
    s = s.replace(old, new, 1)


rep('''    "*": ["chat", "documents.view", "assets.view", "access.request", "notifications"],''',
    '''    "*": ["chat", "documents.view", "assets.view", "access.request", "notifications", "company.view", "feedback"],''')
rep('''    "planner": ["production.view"],''', '''    "planner": ["production.view", "production.edit"],''')
rep('''    "admin": ["models.manage", "admin", "audit.view", "production.view", "documents.upload", "findings.view",
              "findings.approve", "access.approve", "developer"],''',
    '''    "admin": ["models.manage", "admin", "audit.view", "production.view", "production.edit", "documents.upload", "findings.view",
              "findings.approve", "access.approve", "developer", "users.manage", "ai.settings", "usage.view", "backup.manage"],''')
rep('''            raise err(403, "csrf_invalid", "Missing or invalid CSRF token.")
    return Ctx(u, s)''', '''            raise err(403, "csrf_invalid", "Missing or invalid CSRF token.")
    if u.get("must_change_password") and not request.url.path.startswith("/api/auth/"):
        raise err(403, "password_change_required", "You must change your password before continuing.")
    return Ctx(u, s)''')
rep('''            "roles": ctx.subject.roles, "asset_scopes": ctx.subject.asset_scopes,
        },''', '''            "roles": ctx.subject.roles, "asset_scopes": ctx.subject.asset_scopes,
            "must_change_password": bool(u.get("must_change_password")), "mfa_enabled": bool(u.get("mfa_enabled")),
            "status": u.get("status"), "last_login_at": u.get("last_login_at"),
        },
        "org": {"name": "Mangalore Refinery and Petrochemicals Ltd", "deployment": "On-premise (Yukti)", "languages": ["en", "hi", "kn"]},''')
rep('''    if ph.check_needs_rehash(u["password_hash"]):''', '''    if u["status"] != "active":
        audit.write(username, "auth.login.disabled", f"user:{username}", {"ip": ip})
        raise err(403, "account_disabled", "This account is disabled. Contact the administrator.")
    if u.get("mfa_enabled"):
        code = str(body.get("totp") or "").strip()
        if not code:
            raise err(401, "mfa_required", "Enter the 6-digit code from your authenticator app.")
        if not _verify_totp(u, code):
            audit.write(username, "auth.mfa.fail", f"user:{username}", {"ip": ip})
            raise err(401, "mfa_invalid", "Invalid authentication code.")
    if ph.check_needs_rehash(u["password_hash"]):''')
rep('''    ex("UPDATE users SET locked_until=NULL WHERE id=?", (u["id"],))''',
    '''    ex("UPDATE users SET locked_until=NULL, last_login_at=? WHERE id=?", (now_iso(), u["id"]))''')
rep('''@router.get("/demo-users")''', (Path(__file__).parent / "auth_v2_block.py.txt").read_text(encoding="utf-8") + '''\n\n@router.get("/demo-users")''')
rep('''"WHERE demo_password IS NOT NULL ORDER BY rowid")''', '''"WHERE demo_password IS NOT NULL AND status='active' ORDER BY rowid")''')
p.write_text(s, encoding="utf-8")
print("auth.py patched")
