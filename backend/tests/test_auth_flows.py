"""Sign-in, lockout, two-step sign-in (TOTP) and admin reset flows, as a real user would go through them."""
from __future__ import annotations

import time

import pyotp

from app import auth
from app.db import ex

PW = "FlowPassword2026x"


class Client:
    """One browser: cookie + CSRF token of its own session."""

    def __init__(self, app_client, cookies: dict, csrf: str):
        self.c, self.cookies, self.csrf = app_client, cookies, csrf

    def get(self, path):
        self.c.cookies.clear()
        return self.c.get(path, cookies=self.cookies)

    def post(self, path, json=None, lang="en"):
        self.c.cookies.clear()
        return self.c.post(path, json=json or {}, cookies=self.cookies, headers={"X-CSRF-Token": self.csrf, "X-Lang": lang})


def sign_in(app_client, username, password=PW, lang="en", **extra):
    app_client.cookies.clear()
    r = app_client.post("/api/auth/login", json={"username": username, "password": password, **extra}, headers={"X-Lang": lang})
    if r.status_code != 200:
        return r, None
    return r, Client(app_client, {"yukti_sid": r.cookies.get("yukti_sid")}, r.json()["csrf_token"])


def make_user(login, app_client, username):
    """A fresh engineer account with a known password (temporary password already changed)."""
    a = login("admin")
    r = a.post("/api/admin/users", json={"username": username, "display_name": username, "department": "Process Engineering",
                                         "clearance": 1, "roles": ["engineer"]})
    assert r.status_code == 200, r.text
    temp, uid = r.json()["temp_password"], r.json()["user"]["id"]
    _, c = sign_in(app_client, username, temp)
    assert c.post("/api/auth/password", json={"current_password": temp, "new_password": PW}).status_code == 200
    return uid


def enrol(c):
    r = c.post("/api/auth/mfa/enroll")
    assert r.status_code == 200, r.text
    assert r.json()["qr_svg"].lstrip().startswith("<?xml") and "otpauth://totp/" in r.json()["otpauth_uri"]
    totp = pyotp.TOTP(r.json()["secret"])
    code = totp.now()
    v = c.post("/api/auth/mfa/verify", json={"code": f"{code[:3]} {code[3:]}"})  # as the app shows it: "123 456"
    assert v.status_code == 200, v.text
    return totp, code, v.json()["recovery_codes"]


def code_at(totp, offset_s):
    return totp.at(time.time() + offset_s)


def test_mfa_codes_with_spaces_and_recovery_codes(login, app_client):
    make_user(login, app_client, "flow.mfa")
    _, c = sign_in(app_client, "flow.mfa")
    totp, enrol_code, recovery = enrol(c)
    assert len(recovery) == 10
    r, _ = sign_in(app_client, "flow.mfa")
    assert r.status_code == 401 and r.json()["detail"]["code"] == "mfa_required"
    # the code used to finish the set-up cannot be used again to sign in (replay)
    r, _ = sign_in(app_client, "flow.mfa", totp=enrol_code)
    assert r.status_code == 401 and r.json()["detail"]["code"] == "mfa_invalid"
    # the next code, typed with a space as the app shows it
    nxt = code_at(totp, 30)
    r, _ = sign_in(app_client, "flow.mfa", totp=f"{nxt[:3]} {nxt[3:]}")
    assert r.status_code == 200, r.text
    # recovery codes: any case, dash optional, single use
    r, _ = sign_in(app_client, "flow.mfa", totp=recovery[0].upper())
    assert r.status_code == 200, r.text
    r, _ = sign_in(app_client, "flow.mfa", totp=recovery[1].replace("-", ""))
    assert r.status_code == 200, r.text
    r, _ = sign_in(app_client, "flow.mfa", totp=recovery[1])
    assert r.status_code == 401
    # wrong code message is translated
    r, _ = sign_in(app_client, "flow.mfa", totp="000000", lang="hi")
    assert r.status_code == 401 and "authenticator" in r.json()["detail"]["message"] and "कोड" in r.json()["detail"]["message"]


def test_mfa_phone_clock_a_little_off(login, app_client):
    make_user(login, app_client, "flow.clock")
    _, c = sign_in(app_client, "flow.clock")
    totp, _, _ = enrol(c)
    # a phone 60 s ahead (2 steps) is still accepted; 3 minutes off is not
    assert sign_in(app_client, "flow.clock", totp=code_at(totp, 60))[0].status_code == 200
    assert sign_in(app_client, "flow.clock", totp=code_at(totp, 180))[0].status_code == 401


def test_wrong_mfa_codes_lock_the_account(login, app_client):
    make_user(login, app_client, "flow.brute")
    _, c = sign_in(app_client, "flow.brute")
    totp, _, _ = enrol(c)
    for _ in range(auth.LOCK_THRESHOLD):
        assert sign_in(app_client, "flow.brute", totp="000000")[0].status_code == 401
    r, _ = sign_in(app_client, "flow.brute", totp=code_at(totp, 30))
    assert r.status_code == 423 and "Try again in 5 minutes" in r.json()["detail"]["message"]


def test_one_typo_after_a_good_sign_in_does_not_lock(login, app_client):
    make_user(login, app_client, "flow.typo")
    for _ in range(auth.LOCK_THRESHOLD - 1):
        assert sign_in(app_client, "flow.typo", "wrong")[0].status_code == 401
    assert sign_in(app_client, "flow.typo")[0].status_code == 200  # a success starts a fresh count
    assert sign_in(app_client, "flow.typo", "typo")[0].status_code == 401
    assert sign_in(app_client, "flow.typo")[0].status_code == 200


def test_lockout_message_says_when_to_try_again_in_user_language(login, app_client):
    make_user(login, app_client, "flow.lock")
    for _ in range(auth.LOCK_THRESHOLD):
        sign_in(app_client, "flow.lock", "wrong")
    r, _ = sign_in(app_client, "flow.lock", lang="kn")
    assert r.status_code == 423 and "5 ನಿಮಿಷದ" in r.json()["detail"]["message"] and r.json()["detail"]["minutes"] == 5


def test_admin_password_reset_forgives_old_failures(login, app_client):
    uid = make_user(login, app_client, "flow.forgot")
    for _ in range(auth.LOCK_THRESHOLD):
        sign_in(app_client, "flow.forgot", "forgot-it")
    a = login("admin")
    temp = a.post(f"/api/admin/users/{uid}/reset-password").json()["temp_password"]
    assert sign_in(app_client, "flow.forgot", "one-typo")[0].status_code == 401  # not 423 on the next try
    r, c = sign_in(app_client, "flow.forgot", temp)
    assert r.status_code == 200 and r.json()["user"]["must_change_password"] is True
    assert c.get("/api/chats").json()["detail"]["code"] == "password_change_required"


def test_admin_cannot_reset_own_password_or_mfa(login):
    a = login("admin")
    me = a.me["user"]["id"]
    r = a.post(f"/api/admin/users/{me}/reset-password")
    assert r.status_code == 400 and "Account & security" in r.json()["detail"]["message"]
    assert a.post(f"/api/admin/users/{me}/reset-mfa").status_code == 400
    assert a.get("/api/auth/me").status_code == 200  # still signed in


def test_admin_resets_mfa_for_lost_phone(login, app_client):
    uid = make_user(login, app_client, "flow.lostphone")
    _, c = sign_in(app_client, "flow.lostphone")
    enrol(c)
    assert sign_in(app_client, "flow.lostphone")[0].json()["detail"]["code"] == "mfa_required"
    assert login("ravi.e").post(f"/api/admin/users/{uid}/reset-mfa").status_code == 403  # admins only
    r = login("admin").post(f"/api/admin/users/{uid}/reset-mfa")
    assert r.status_code == 200 and r.json()["user"]["mfa_enabled"] is False
    assert c.get("/api/auth/me").status_code == 401  # old sessions signed out
    r, c2 = sign_in(app_client, "flow.lostphone")  # password alone works again, and a new phone can be set up
    assert r.status_code == 200 and r.json()["user"]["mfa_enabled"] is False
    enrol(c2)


def test_mfa_cannot_be_replaced_without_turning_it_off(login, app_client):
    make_user(login, app_client, "flow.swap")
    _, c = sign_in(app_client, "flow.swap")
    totp, _, recovery = enrol(c)
    r = c.post("/api/auth/mfa/enroll")
    assert r.status_code == 409
    # turning off needs the password and a code (a recovery code with spaces works)
    assert c.post("/api/auth/mfa/disable", json={"password": PW, "code": "000000"}).status_code == 400
    ok = c.post("/api/auth/mfa/disable", json={"password": PW, "code": f" {recovery[0]} "})
    assert ok.status_code == 200
    assert c.get("/api/auth/me").json()["user"]["mfa_enabled"] is False
    assert c.post("/api/auth/mfa/enroll").status_code == 200


def test_me_reports_server_time(login):
    me = login("ravi.e").get("/api/auth/me").json()
    assert me["server_time"].endswith("+00:00")


def test_session_expiry_message(login, app_client):
    make_user(login, app_client, "flow.idle")
    _, c = sign_in(app_client, "flow.idle")
    ex("UPDATE sessions SET idle_expires_at='2000-01-01T00:00:00+00:00' WHERE user_id=(SELECT id FROM users WHERE username='flow.idle')")
    r = c.get("/api/auth/me")
    assert r.status_code == 401 and r.json()["detail"]["code"] == "session_expired"
