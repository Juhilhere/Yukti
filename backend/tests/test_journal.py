"""The local journal: server errors get a reference the user sees and the log contains; web-page problems are recorded."""


def test_server_error_gets_a_reference_in_the_journal(app_client, login, monkeypatch):
    from app import journal, main
    u = login("admin")

    def boom(*a, **k):
        raise RuntimeError("simulated failure")
    monkeypatch.setattr(main.engine, "scan_models", boom)
    r = u.get("/api/features")
    assert r.status_code == 500
    ref = r.json()["detail"]["ref"]
    assert ref.startswith("E-") and ref in r.json()["detail"]["message"]
    assert any(p["ref"] == ref for p in journal.recent("ERROR"))
    listed = u.get("/api/admin/problems?level=ERROR").json()["items"]
    assert any(p["ref"] == ref and "simulated failure" in p["message"] for p in listed)


def test_web_page_problems_are_recorded_and_limited(app_client):
    from app import journal
    ok = app_client.post("/api/diagnostics/client-error", json={"kind": "crash", "text": "TypeError: x is undefined", "page": "/chat"})
    assert ok.status_code == 200 and ok.json()["ok"]
    assert any("TypeError: x is undefined" in p["message"] for p in journal.recent())
    # other web sites cannot post plain text into the journal
    assert app_client.post("/api/diagnostics/client-error", content=b"x", headers={"Content-Type": "text/plain"}).status_code == 415


def test_problems_list_needs_permission(login):
    assert login("ravi.e").get("/api/admin/problems").status_code == 403
