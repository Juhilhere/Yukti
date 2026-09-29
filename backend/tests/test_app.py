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
    """A valid PDF with a unique trailer, so each upload is a distinct file (identical files are rejected as duplicates)."""
    import uuid
    from app.config import CORPUS
    return (CORPUS / root_rel).read_bytes() + b"\n% " + str(uuid.uuid4()).encode() + b"\n"


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
def test_findings_scoped_by_department_and_rank(login):
    assert login("suresh.em").get("/api/findings").json() == []  # electrical HOD does not see a mechanical finding
    assert login("contractor.x").get("/api/findings").json() == []
    m = login("meera.me")  # mechanical engineer (INTERNAL): works the finding but cannot approve it
    f = m.get("/api/findings").json()[0]
    assert {"acknowledge", "escalate", "note"} <= set(f["allowed_actions"]) and "approve" not in f["allowed_actions"]
    assert m.post(f"/api/findings/{f['id']}/action", json={"action": "approve"}).status_code == 403
    assert m.post(f"/api/findings/{f['id']}/action", json={"action": "note", "note": "ci"}).status_code == 200
    hod = login("rajesh.mm")  # mechanical HOD (RESTRICTED) approves
    assert {"approve", "reject"} <= set(hod.get("/api/findings").json()[0]["allowed_actions"])
    assert login("suresh.em").post(f"/api/findings/{f['id']}/action", json={"action": "note"}).status_code == 404


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


# ------------------------------------------------------------------ startup / health / admin tools
def test_health_reports_startup_progress(app_client):
    h = app_client.get("/api/health").json()
    assert h["knowledge_ready"] is True and h["stage"] and "ready" in h


def test_backup_list_has_checksum(login):
    a = login("admin")
    b = a.post("/api/admin/backups").json()
    listed = next(x for x in a.get("/api/admin/backups").json() if x["name"] == b["name"])
    assert listed["sha256"] == b["sha256"]


def test_policy_simulator(login):
    a = login("admin")
    assert login("ravi.e").get("/api/admin/policies/documents").status_code == 403
    fin = next(d for d in a.get("/api/admin/policies/documents").json() if d["doc_number"] == "FIN-AUD-2026-Q2")
    deny = a.post("/api/admin/policies/simulate", json={"username": "ravi.e", "document_id": fin["id"], "action": "read"}).json()
    allow = a.post("/api/admin/policies/simulate", json={"username": "kavita.fm", "document_id": fin["id"], "action": "read"}).json()
    assert deny["effect"] == "deny" and allow["effect"] == "allow"


def test_command_preview_and_maintenance(login):
    a = login("admin")
    r = a.post("/api/models/command-preview", json={"model_id": "x.gguf", "load_config": {"ctx_size": 4096}}).json()
    assert "-c 4096" in r["llamacpp"] and r["vllm"].startswith("vllm serve")
    assert a.post("/api/admin/mrpl/reload").json()["ok"] is True
    assert a.post("/api/admin/demo/reset").json()["ok"] is True


def test_free_port_and_server_port_check():
    import socket

    import server_main
    from app import engine
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        busy = s.getsockname()[1]
        s.listen()
        assert server_main._port_free("127.0.0.1", busy) is False
        assert engine._free_port(busy) != busy


def test_engine_internals_admin_only(login):
    for path in ("/api/server/status", "/api/server/logs"):
        assert login("ravi.e").get(path).status_code == 403
        assert login("admin").get(path).status_code == 200


def test_security_headers(app_client):
    h = app_client.get("/api/health").headers
    assert "default-src 'self'" in h["content-security-policy"] and "frame-ancestors 'none'" in h["content-security-policy"]
    assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY" and h["cache-control"] == "no-store"


def test_offline_guard_blocks_egress():
    import socket

    import pytest
    from app import main
    main.install_guard()
    with pytest.raises(OSError):
        socket.create_connection(("1.1.1.1", 443), timeout=2)
    with pytest.raises(OSError):
        socket.getaddrinfo("example.com", 443)


# ------------------------------------------------------------------ department & rank scoping
def test_assets_and_alerts_scoped(login):
    ravi = login("ravi.e").get("/api/assets").json()
    assert "A2" in {a["tag"] for a in ravi}
    assert all(a["unit"] in ("CDU-1", "VDU-1") or a["owner_department"] == "Electrical Maintenance" for a in ravi)
    from app.db import q1
    b02 = q1("SELECT owner_department FROM assets WHERE tag='B-02'")
    assert b02["owner_department"] != "Electrical Maintenance" and login("ravi.e").get("/api/assets/B-02").status_code == 404
    assert "UTIL" in {a["unit"] for a in login("anil.u").get("/api/assets").json()}
    c = login("contractor.x")
    a2 = c.get("/api/assets/A2").json()
    assert a2["work_orders"] == [] and a2["specs"] == {}  # contractor: no CMMS history or specifications
    assert all(x["unit"] == "CDU-1" for x in c.get("/api/assets").json())
    assert len(login("deepa.au").get("/api/alerts").json()) >= len(login("ravi.e").get("/api/alerts").json())


def test_contractor_dossier_has_no_internal_records(login):
    ev = login("contractor.x").chat("A2 tripped - give me the isolation and restart dossier")
    facts = ev["facts"]["facts"] if ev.get("facts") else []
    assert not any(f["attribute"] in ("open_work_orders", "breakdowns_5y", "on_call") for f in facts)
    assert not any(f["status"] in ("KNOWN", "CONFLICTING") for f in facts)
    assert ev["retrieval"]["denied"]["departments"] == []


def test_audit_scoped_to_department(login):
    login("ravi.e")
    login("kavita.fm")
    rows = login("suresh.em").get("/api/audit?limit=2000").json()
    from app.db import q
    elec = {r["username"] for r in q("SELECT username FROM users WHERE department='Electrical Maintenance'")}
    assert rows and all(r["actor"] in elec for r in rows)
    assert login("suresh.em").get("/api/audit/export").status_code == 403
    assert login("deepa.au").get("/api/audit/export").status_code == 200


def test_it_admin_cannot_read_or_grant_business_documents(login):
    a = login("admin")
    assert not any(d["doc_number"] == "FIN-AUD-2026-Q2" for d in a.get("/api/documents").json())
    anil = login("anil.u")
    ar = anil.post("/api/access-requests", json={"department": "Finance & Accounts", "justification": "B-02 RCA cross-check", "hours": 1}).json()
    assert a.post(f"/api/access-requests/{ar['id']}/approve", json={}).status_code == 403


def test_grant_never_exceeds_ceiling():
    from app.policy import Subject, pdp
    far = "2999-01-01T00:00:00+00:00"
    s = Subject(id="u", username="u", display_name="u", post="", department="Electrical Maintenance", clearance=1,
                roles=["engineer"], asset_scopes=[], grants=[{"department": "Finance & Accounts", "expires_at": far, "max_classification": 2}])
    doc = {"type": "document", "id": "d", "department": "Finance & Accounts", "doc_type": "audit_report", "units": [], "status": "CURRENT"}
    assert pdp.decide(s, "read", {**doc, "classification": 2}).allowed
    assert not pdp.decide(s, "read", {**doc, "classification": 3}).allowed


def test_admin_cannot_escalate_self(login):
    a = login("admin")
    me = a.get("/api/auth/me").json()["user"]
    assert a.patch(f"/api/admin/users/{me['id']}", json={"clearance": 4}).status_code == 403
    assert a.patch(f"/api/admin/users/{me['id']}", json={"roles": ["admin", "plant_manager"]}).status_code == 403


def test_upload_type_rules(login):
    hod = login("rajesh.mm")
    f = {"file": ("x.pdf", _pdf(), "application/pdf")}
    assert hod.post("/api/documents", files=f, data={"doc_type": "P&ID"}).status_code == 422
    assert hod.post("/api/documents", files={"file": ("x.pdf", _pdf(), "application/pdf")}, data={"doc_type": "MSDS"}).status_code == 403


def test_jobs_and_chat_stop_are_owner_only(login):
    hod = login("rajesh.mm")
    r = hod.post("/api/documents", files={"file": ("own.pdf", _pdf(), "application/pdf")}, data={"doc_type": "manual"}).json()
    assert hod.get(f"/api/jobs/{r['job_id']}").status_code == 200
    assert login("ravi.e").get(f"/api/jobs/{r['job_id']}").status_code == 404
    cid = hod.post("/api/chats", json={}).json()["id"]
    assert login("ravi.e").post(f"/api/chats/{cid}/stop", json={}).status_code == 404
    hod.delete(f"/api/documents/{r['document_id']}")


def test_upload_rejects_unsupported_types_and_revision_order(login):
    hod = login("rajesh.mm")
    r = hod.post("/api/documents", files={"file": ("old.doc", b"\xd0\xcf\x11\xe0binary", "application/msword")}, data={"doc_type": "manual"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "unsupported_type"
    from app.rag import _rev_key
    assert _rev_key("R9") < _rev_key("R10") and _rev_key("B") < _rev_key("C") and _rev_key("2") < _rev_key("10")


def test_builtin_presets_are_protected(login):
    a = login("admin")
    from app.db import ex, now_iso
    ex("INSERT OR IGNORE INTO presets(id, user_id, name, description, system_prompt, prediction_json, load_json, builtin, created_at) "
       "VALUES('ci-builtin', NULL, 'Built-in', '', '', '{}', '{}', 1, ?)", (now_iso(),))
    builtin = next(p for p in a.get("/api/presets").json() if p["builtin"])
    assert a.put(f"/api/presets/{builtin['id']}", json={"name": "x"}).status_code == 403
    assert a.delete(f"/api/presets/{builtin['id']}").status_code == 403


def test_restore_validation_and_cancel(login):
    a = login("admin")
    b = a.post("/api/admin/backups").json()
    assert a.post(f"/api/admin/backups/{b['name']}/restore", json={}).json()["pending"] == b["name"]
    assert a.get("/api/admin/backups/restore-pending").json()["pending"] == b["name"]
    assert a.delete("/api/admin/backups/restore-pending").json()["ok"] is True
    assert a.get("/api/admin/backups/restore-pending").json()["pending"] is None


def test_engines_list_includes_ollama_with_reason(login):
    es = {e["id"]: e for e in login("admin").get("/api/engines").json()}
    assert {"llamacpp", "ollama", "bionic", "vllm", "remote"} <= set(es)
    assert es["remote"]["available"] is False and es["remote"]["error"]


def test_offline_guard_blocks_async_egress(app_client):
    import asyncio

    import pytest
    from app import main
    main.install_guard()

    async def go():
        await asyncio.wait_for(asyncio.open_connection("1.1.1.1", 443), 3)
    with pytest.raises(ConnectionRefusedError, match="offline guard"):
        asyncio.run(go())


def test_duplicates_and_bad_input_rejected(login):
    hod = login("rajesh.mm")
    data = _pdf()
    first = hod.post("/api/documents", files={"file": ("d.pdf", data, "application/pdf")}, data={"doc_type": "manual"})
    again = hod.post("/api/documents", files={"file": ("d2.pdf", data, "application/pdf")}, data={"doc_type": "manual"})
    assert first.status_code == 200 and again.status_code == 409
    hod.delete(f"/api/documents/{first.json()['document_id']}")
    m = login("meera.me")
    assert m.post("/api/access-requests", json={"department": "Process Engineering", "justification": "x"}).status_code == 422
    assert m.post("/api/access-requests", json={"department": "Process Engineering", "justification": "SRU amine check"}).status_code == 200
    assert m.post("/api/access-requests", json={"department": "Process Engineering", "justification": "SRU amine check"}).status_code == 409
    a = login("admin")
    assert a.post("/api/admin/users", json={"username": "no.name"}).status_code == 422
    s = a.get("/api/admin/ai-settings").json()
    assert a.put("/api/admin/ai-settings", json={**s, "prediction": {**s["prediction"], "temperature": "hot"}}).status_code == 422
    assert a.put("/api/engines/remote", json={"base_url": "not a url"}).status_code == 422
    assert a.post("/api/models/load", json={"engine": "bionic", "model_id": "C:/nope.gguf"}).status_code in (200, 422)
