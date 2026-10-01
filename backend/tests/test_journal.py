"""The local journal: server errors get a reference the user sees and the log contains; web-page problems are recorded."""


def test_server_error_gets_a_reference_in_the_journal(app_client, login, monkeypatch):
    from app import journal, main
    u = login("admin")

    def boom(*a, **k):
        raise RuntimeError("simulated failure")
    monkeypatch.setattr(main.engine, "scan_models", boom)
    main.engine.invalidate_vision_cache()  # the list of seeing models is remembered for 30 s: make the scan run now
    r = u.get("/api/features")
    assert r.status_code == 500
    ref = r.json()["detail"]["ref"]
    assert ref.startswith("E-") and ref in r.json()["detail"]["message"]
    assert any(p["ref"] == ref for p in journal.recent("ERROR"))
    listed = u.get("/api/admin/problems?level=ERROR").json()["items"]
    assert any(p["ref"] == ref and "simulated failure" in p["message"] for p in listed)
    assert all("_n" not in p for p in listed)


def test_server_error_message_follows_the_request_language(login, monkeypatch):
    from app import main
    from app.i18n import tr
    english = "Something went wrong on the server. Please try again. If it keeps happening, give your administrator this reference:"

    def boom(*a, **k):
        raise RuntimeError("simulated failure")
    monkeypatch.setattr(main.engine, "scan_models", boom)
    u = login("admin")
    for lang in ("hi", "kn"):
        main.engine.invalidate_vision_cache()
        r = u.get("/api/features", headers={"X-Lang": lang})
        assert r.status_code == 500
        d = r.json()["detail"]
        assert tr(english, lang) != english and d["message"] == f"{tr(english, lang)} {d['ref']}"
    main.engine.invalidate_vision_cache()
    assert u.get("/api/features").json()["detail"]["message"].startswith(english)  # no language asked: English


def test_web_page_reports_cannot_push_server_problems_out_of_the_list(app_client):
    from app import journal
    ref = journal.error("api", "a real server problem")
    for i in range(400):  # far more than the list holds
        journal.warn("web", f"script: noise {i}")
    assert any(p["ref"] == ref for p in journal.recent("ERROR"))
    assert len([p for p in journal.recent(limit=1000) if p["area"] == "web"]) <= 60
    assert journal.recent()[0]["message"].endswith("noise 399")  # newest first, across both lists


def test_oversized_web_report_is_refused_before_it_is_read(app_client):
    big = {"kind": "crash", "text": "x" * 6000}
    r = app_client.post("/api/diagnostics/client-error", json=big)
    assert r.status_code == 413 and r.json()["detail"]["code"] == "too_large"


def _asgi_call(app, scope, chunks):
    """Drive an ASGI app by hand: returns (status, how many body chunks the inner app pulled)."""
    import asyncio
    sent, pulled = [], [0]
    queue = list(chunks)

    async def receive():
        pulled[0] += 1
        if queue:
            body = queue.pop(0)
            return {"type": "http.request", "body": body, "more_body": bool(queue)}
        return {"type": "http.disconnect"}

    async def send(msg):
        sent.append(msg)

    asyncio.run(app(scope, receive, send))
    start = [m for m in sent if m["type"] == "http.response.start"]
    assert len(start) == 1, sent  # exactly one answer
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start[0]["status"], body, pulled[0]


def test_upload_size_limit_refuses_by_declared_length_without_reading(app_client):
    from app import main
    reached = []

    async def inner(scope, receive, send):
        reached.append(1)

    scope = {"type": "http", "method": "POST", "path": "/api/attachments", "query_string": b"",
             "headers": [(b"content-length", str(17 * 2**20).encode()), (b"x-lang", b"hi")]}
    status, body, pulled = _asgi_call(main.BodyLimit(inner), scope, [b"x"])
    assert status == 413 and not reached and pulled == 0
    assert "too_large" in body.decode() and "This file is too large" not in body.decode()  # translated (Hindi)
    assert main.body_limit("POST", "/api/speech/transcribe") == 5 * 2**20
    assert main.body_limit("POST", "/api/documents") >= 50 * 2**20
    assert main.body_limit("GET", "/api/attachments") is None and main.body_limit("POST", "/api/chats") is None


def test_upload_size_limit_counts_the_bytes_actually_received(app_client, monkeypatch):
    import re
    from app import main
    monkeypatch.setattr(main, "BODY_LIMITS", [(re.compile(r"^/api/attachments/?$"), 10)])
    got = []

    async def inner(scope, receive, send):  # an app that reads the whole body and then answers 200
        while True:
            msg = await receive()
            if msg["type"] == "http.disconnect":
                break
            got.append(msg["body"])
            if not msg.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    scope = {"type": "http", "method": "POST", "path": "/api/attachments", "query_string": b"", "headers": []}  # no length declared
    status, body, _ = _asgi_call(main.BodyLimit(inner), scope, [b"12345", b"67890", b"ABCDE", b"FGHIJ"])
    assert status == 413 and b"".join(got) == b"1234567890"  # nothing beyond the limit reached the app
    # within the limit: untouched
    got.clear()
    status, body, _ = _asgi_call(main.BodyLimit(inner), {**scope}, [b"12345"])
    assert status == 200 and body == b"ok"


def test_oversized_photo_upload_is_refused(login):
    u = login("meera.me")
    r = u.post("/api/attachments", files={"file": ("big.jpg", b"\xff" * (16 * 2**20 + 1024), "image/jpeg")})
    assert r.status_code == 413 and r.json()["detail"]["code"] == "too_large"


def test_web_page_problems_are_recorded_and_limited(app_client):
    from app import journal
    ok = app_client.post("/api/diagnostics/client-error", json={"kind": "crash", "text": "TypeError: x is undefined", "page": "/chat"})
    assert ok.status_code == 200 and ok.json()["ok"]
    assert any("TypeError: x is undefined" in p["message"] for p in journal.recent())
    # other web sites cannot post plain text into the journal
    assert app_client.post("/api/diagnostics/client-error", content=b"x", headers={"Content-Type": "text/plain"}).status_code == 415


def test_problems_list_needs_permission(login):
    assert login("ravi.e").get("/api/admin/problems").status_code == 403
