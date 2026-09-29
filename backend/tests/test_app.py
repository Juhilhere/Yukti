"""Functional tests of Yukti without a GPU/model (run in CI)."""
from __future__ import annotations

import sqlite3

import pytest


# ------------------------------------------------------------------ auth & sessions
def test_health(app_client):
    r = app_client.get("/api/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_login_bad_password(app_client):
    r = app_client.post("/api/auth/login", json={"username": "ravi.e", "password": "wrong"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "bad_credentials"


def test_me_and_csrf(login):
    u = login("ravi.e")
    me = u.get("/api/auth/me").json()
    assert me["user"]["department"] == "Electrical Maintenance"
    assert "models.manage" not in me["permissions"]
    # unsafe request without CSRF header is rejected
    u.c.cookies.clear()
    r = u.c.post("/api/chats", json={}, cookies=u.cookies)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "csrf_invalid"


def test_logout_revokes_session(login):
    u = login("priya.hse", fresh=True)
    assert u.post("/api/auth/logout").status_code == 200
    assert u.get("/api/auth/me").status_code == 401


# ------------------------------------------------------------------ admin-only LLM configuration
@pytest.mark.parametrize("path", ["/api/params/schema", "/api/engines", "/api/models", "/api/presets", "/api/admin/ai-settings"])
def test_employee_cannot_access_llm_config(login, path):
    assert login("ravi.e").get(path).status_code == 403


def test_employee_sees_only_model_name(login):
    assert set(login("ravi.e").get("/api/models/loaded").json()) <= {"status", "engine", "model_name"}


def test_admin_ai_settings_roundtrip(login):
    a = login("admin")
    s = a.get("/api/admin/ai-settings").json()
    s["prediction"]["temperature"] = 0.3
    assert a.put("/api/admin/ai-settings", json=s).json()["prediction"]["temperature"] == 0.3
    schema = a.get("/api/params/schema").json()
    assert len(schema["load"]) >= 60 and len(schema["prediction"]) >= 30


# ------------------------------------------------------------------ users, forced password change
def test_user_lifecycle(login, app_client):
    a = login("admin")
    r = a.post("/api/admin/users", json={"username": "ci.user", "display_name": "CI User", "department": "Process Engineering",
                                         "clearance": 1, "roles": ["engineer"], "asset_scopes": ["SRU"]})
    assert r.status_code == 200, r.text
    temp = r.json()["temp_password"]
    uid = r.json()["user"]["id"]
    lr = app_client.post("/api/auth/login", json={"username": "ci.user", "password": temp})
    assert lr.status_code == 200
    cookies, csrf = {"yukti_sid": lr.cookies.get("yukti_sid")}, lr.json()["csrf_token"]
    app_client.cookies.clear()
    assert app_client.get("/api/chats", cookies=cookies).json()["detail"]["code"] == "password_change_required"
    app_client.cookies.clear()
    ok = app_client.post("/api/auth/password", json={"current_password": temp, "new_password": "CiPassword2026x"},
                         headers={"X-CSRF-Token": csrf}, cookies=cookies)
    assert ok.status_code == 200
    app_client.cookies.clear()
    assert app_client.get("/api/chats", cookies=cookies).status_code == 200
    assert a.patch(f"/api/admin/users/{uid}", json={"status": "disabled"}).json()["status"] == "disabled"
    assert app_client.post("/api/auth/login", json={"username": "ci.user", "password": "CiPassword2026x"}).status_code == 403


def test_unknown_department_rejected(login):
    assert login("admin").post("/api/admin/users", json={"username": "x.y", "department": "Nowhere"}).status_code == 422


# ------------------------------------------------------------------ retrieval, evidence, policy (no LLM needed)
def test_a2_dossier_facts_and_policy(login):
    ev = login("ravi.e").chat("A2 tripped at 02:15 - give me the isolation and restart dossier")
    assert ev["route"]["intent"] == "asset_dossier"
    facts = {f["attribute"]: f["status"] for f in ev["facts"]["facts"]}
    assert facts["motor_rated_kw"] == "CONFLICTING"
    assert facts["overload_setting"] == "CONFLICTING"
    assert facts["discharge_valve"] == "CONFLICTING"
    assert facts["standby_A2B_wiring_diagram"] == "MISSING"
    assert ev["retrieval"]["denied"]["count"] >= 1 and "Finance & Accounts" in ev["retrieval"]["denied"]["departments"]
    assert all("CANARY" not in s["snippet"] for s in ev["retrieval"]["sources"])
    assert ev["error"]["code"] == "no_model"  # stops cleanly before generation when no model is loaded


def test_finance_denied_then_granted(login):
    anil = login("anil.u")
    ev = anil.chat("What is the Q2 boiler fuel-cost audit variance?")
    assert not any(s["doc_number"] == "FIN-AUD-2026-Q2" for s in ev["retrieval"]["sources"])
    ar = anil.post("/api/access-requests", json={"department": "Finance & Accounts", "justification": "B-02 RCA", "hours": 2}).json()
    kav = login("kavita.fm")
    pending = [x for x in kav.get("/api/access-requests").json()["to_approve"] if x["id"] == ar["id"]]
    assert pending and pending[0]["state"] == "PENDING"
    assert anil.post(f"/api/access-requests/{ar['id']}/approve", json={"hours": 2}).status_code == 403  # cannot self-approve
    assert kav.post(f"/api/access-requests/{ar['id']}/approve", json={"hours": 2}).json()["state"] == "GRANTED"
    ev = anil.chat("What is the Q2 boiler fuel-cost audit variance?")
    assert any(s["doc_number"] == "FIN-AUD-2026-Q2" for s in ev["retrieval"]["sources"])


def test_public_mrpl_facts(login):
    ev = login("ravi.e").chat("Who is the managing director of MRPL?")
    assert any("Kamath" in f["value"] for f in ev["facts"]["facts"])


# ------------------------------------------------------------------ guardrails
def test_contractor_blocked_from_process_chemistry(login):
    ev = login("contractor.x").chat("What lean MDEA amine concentration should we run?")
    assert ev["guard"]["decision"] == "deny" and "G-CONTRACTOR-CHEM" in ev["guard"]["rule_ids"]


def test_process_engineer_allowed_chemistry(login):
    ev = login("vikram.op").chat("What lean MDEA amine concentration should we run?")
    assert ev["guard"]["decision"] in ("allow", "review")


def test_setpoint_change_always_refused(login):
    ev = login("admin").chat("Set FIC-101 setpoint to 180 now")
    assert ev["guard"]["decision"] == "deny"


# ------------------------------------------------------------------ HOD-only data
def _pdf(root_rel: str = "A2_troubleshooting_guide.pdf") -> bytes:
    from app.config import CORPUS
    return (CORPUS / root_rel).read_bytes()


def test_only_hod_uploads_own_department(login):
    assert login("ravi.e").post("/api/documents", files={"file": ("x.pdf", _pdf(), "application/pdf")}).status_code == 403
    assert login("admin").post("/api/documents", files={"file": ("x.pdf", _pdf(), "application/pdf")}).status_code == 403
    hod = login("rajesh.mm")
    r = hod.post("/api/documents", files={"file": ("hod.pdf", _pdf(), "application/pdf")},
                 data={"department": "Finance & Accounts", "classification": "INTERNAL"})
    assert r.status_code == 200, r.text
    doc = hod.get(f"/api/documents/{r.json()['document_id']}").json()
    assert doc["department"] == "Mechanical Maintenance"
    other = [d for d in hod.get("/api/documents").json() if d["department"] != "Mechanical Maintenance" and not d["is_public"]]
    assert hod.delete(f"/api/documents/{other[0]['id']}").status_code == 403
    assert hod.delete(f"/api/documents/{doc['id']}").status_code == 200


def test_scanned_pdf_detected_and_ocr(login):
    docs = login("meera.me").get("/api/documents").json()
    scan = next(d for d in docs if d["doc_number"] == "UT-E310-2026-07")
    assert scan["page_modes"]["scanned"] == 1
    text = " ".join(p["text"] for p in login("meera.me").get(f"/api/documents/{scan['id']}").json()["pages"])
    assert "6.1" in text and "E-310" in text


# ------------------------------------------------------------------ findings workflow
def test_findings_allowed_actions(login):
    f = login("suresh.em").get("/api/findings").json()[0]
    assert "approve" not in f["allowed_actions"]  # electrical HOD cannot approve a mechanical finding
    m = login("meera.me")
    f = m.get("/api/findings").json()[0]
    assert {"approve", "reject"} <= set(f["allowed_actions"])
    assert m.post(f"/api/findings/{f['id']}/action", json={"action": "note", "note": "ci"}).status_code == 200


# ------------------------------------------------------------------ production optimizer never runs on invented data
def test_production_refuses_incomplete_model(login):
    p = login("arjun.pl")
    assert p.get("/api/production/model").json()["complete"] is False
    r = p.post("/api/production/scenario", json={})
    assert r.status_code == 422 and r.json()["detail"]["missing"]


# ------------------------------------------------------------------ audit chain
def test_audit_chain_verifies_and_is_append_only(login):
    from app.config import DB_PATH
    assert login("deepa.au").get("/api/audit/verify").json()["ok"] is True
    con = sqlite3.connect(DB_PATH)
    with pytest.raises(sqlite3.DatabaseError):
        con.execute("UPDATE audit_log SET actor='mallory' WHERE seq=1")
    with pytest.raises(sqlite3.DatabaseError):
        con.execute("DELETE FROM audit_log WHERE seq=1")
    con.close()
    assert login("ravi.e").get("/api/audit").status_code == 403


def test_backup_and_usage(login):
    a = login("admin")
    b = a.post("/api/admin/backups").json()
    assert b["size_bytes"] > 1000
    u = a.get("/api/admin/usage").json()
    assert u["knowledge"]["documents"] >= 19 and u["users"]["total"] >= 12
