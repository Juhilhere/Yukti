"""Regression tests for the review findings fixed before 0.5.0 (silent failures, need-to-know, uploads, voice).

All model-free: no AI model, no llama-server, no whisper-server is needed.
"""
from __future__ import annotations

import asyncio
import io
import threading
import time

import pytest


def _jpeg(text: str | None = None, size: tuple[int, int] = (640, 480)) -> bytes:
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", size, (170, 90, 40))
    if text:
        d = ImageDraw.Draw(img)
        d.rectangle((40, size[1] // 2 - 100, size[0] - 40, size[1] // 2 + 100), fill=(245, 245, 235))
        d.text((70, size[1] // 2 - 60), text, fill=(10, 10, 10), font=ImageFont.load_default(size=100))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


def _upload(u, data: bytes | None = None) -> dict:
    r = u.post("/api/attachments", files={"file": ("p.jpg", data or _jpeg(), "image/jpeg")})
    assert r.status_code == 200, r.text
    return r.json()


def _roles(u, chat_id: str) -> list[dict]:
    return u.get(f"/api/chats/{chat_id}").json()["messages"]


def _put(chat_id: str, role: str, content: str, at: str = "2020-01-01T00:00:00+00:00") -> None:
    from app.db import ex, new_id
    ex("INSERT INTO messages(id, chat_id, role, content, meta_json, created_at) VALUES(?,?,?,?,?,?)",
       (new_id(), chat_id, role, content, "{}", at))


# ------------------------------------------------------------------ chat: regenerate, interrupted answers
def test_regenerate_never_deletes_an_older_answer(login):
    """The last question has no answer yet (e.g. the page was closed): Regenerate must not eat the answer before it."""
    u = login("ravi.e")
    c = u.post("/api/chats", json={}).json()
    _put(c["id"], "user", "first question")
    _put(c["id"], "assistant", "FIRST ANSWER")
    _put(c["id"], "user", "what does NPSH mean")   # same second as the others: only the row order tells them apart
    assert u.post(f"/api/chats/{c['id']}/regenerate", json={}).status_code == 200
    msgs = _roles(u, c["id"])
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]
    assert msgs[1]["content"] == "FIRST ANSWER"
    first_try = msgs[3]["id"]
    # regenerate again: the answer to the LAST question is replaced, not stacked; the older answer still stands
    assert u.post(f"/api/chats/{c['id']}/regenerate", json={}).status_code == 200
    msgs = _roles(u, c["id"])
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]
    assert msgs[1]["content"] == "FIRST ANSWER" and msgs[3]["id"] != first_try
    u.delete(f"/api/chats/{c['id']}")


def test_save_answer_replaces_only_answers_after_the_last_question(app_client):
    from app import chat
    from app.db import ex, new_id, now_iso, q
    cid = new_id()
    ex("INSERT INTO chats(id, user_id, title, created_at, updated_at) VALUES(?,?,?,?,?)", (cid, "nobody", "t", now_iso(), now_iso()))
    for role, text in (("user", "q1"), ("assistant", "a1"), ("user", "q2"), ("assistant", "a2-old"), ("assistant", "a2-stacked")):
        _put(cid, role, text)
    chat.save_answer(cid, True, new_id(), "a2-new", None, {})
    assert [m["content"] for m in q("SELECT content FROM messages WHERE chat_id=? ORDER BY created_at, rowid", (cid,))] == \
        ["q1", "a1", "q2", "a2-new"]
    chat.save_answer(cid, False, new_id(), "extra", None, {})  # not a regenerate: nothing is removed
    assert q("SELECT COUNT(*) n FROM messages WHERE chat_id=?", (cid,))[0]["n"] == 5
    ex("DELETE FROM chats WHERE id=?", (cid,))


def test_regenerate_replaces_a_guardrail_refusal(login):
    u = login("ravi.e")
    c = u.post("/api/chats", json={}).json()
    r = u.post(f"/api/chats/{c['id']}/messages", json={"content": "increase the setpoint of FIC-101 to 80"})
    assert '"stop_reason": "guardrail"' in r.text
    for _ in range(2):
        assert '"stop_reason": "guardrail"' in u.post(f"/api/chats/{c['id']}/regenerate", json={}).text
    assert [m["role"] for m in _roles(u, c["id"])] == ["user", "assistant"]
    u.delete(f"/api/chats/{c['id']}")


def test_answer_interrupted_by_a_closed_page_is_kept(login, monkeypatch):
    """The page is closed while the answer is being written: what was written so far is stored and shown on return."""
    from app import chat, engine
    from app.auth import Ctx
    from app.db import q1
    u = login("ravi.e")
    c = u.post("/api/chats", json={}).json()

    hung = []

    async def slow(msgs, pred):
        yield {"type": "token", "t": "Pump A2 "}
        yield {"type": "token", "t": "tripped on overload"}
        hung.append(1)  # both pieces are out; from here the engine "hangs"
        await asyncio.sleep(3600)

    monkeypatch.setattr(engine, "stream_chat", slow)
    ctx = Ctx(q1("SELECT * FROM users WHERE username='ravi.e'"), {})

    async def closed_page():
        gen = chat.run_turn(ctx, c["id"], "why did pump A2 trip?", None, {}, True)
        async for ev in gen:
            if ev.startswith("event: token") and "overload" in ev:
                break
        await gen.aclose()

    asyncio.run(closed_page())
    msgs = _roles(u, c["id"])
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["content"] == "Pump A2 tripped on overload" and msgs[1]["stats"]["stop_reason"] == "interrupted"

    # the same when the request is cancelled while the engine is still producing (no event being sent at that moment)
    async def cancelled_request():
        async def consume():
            async for _ in chat.run_turn(ctx, c["id"], "what is the rated power of pump A2?", None, {}, True):
                pass
        hung.clear()
        task = asyncio.create_task(consume())
        for _ in range(1500):  # wait (at most 30 s) until both pieces were sent and the engine "hangs"
            if hung or task.done():
                break
            await asyncio.sleep(0.02)
        assert hung and not task.done()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancelled_request())
    msgs = _roles(u, c["id"])
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]
    assert msgs[3]["stats"]["stop_reason"] == "interrupted" and msgs[3]["content"].startswith("Pump A2")
    u.delete(f"/api/chats/{c['id']}")


def test_fit_to_context_drops_documents_before_facts_photo_text_and_notes():
    from app.chat import fit_to_context
    docs = "\n".join(f'<doc id="S{i}" ref="D-{i} rev 1 (CURRENT) p.1 — Title">\n' + "x" * 1400 + "\n</doc>" for i in range(1, 9))
    user = ("CONTEXT:\n" + docs
            + "\n\nNOTE: 2 relevant document(s) exist but are withheld by access policy. Tell the user they can request access."
            + "\n\nFACTS (structured):\n[F1] ratings.power: 75 kW"
            + "\n\nPHOTO 1 TEXT (OCR):\nV-501 LEAN AMINE\nEquipment tags read on photo 1: V-501 = Amine regenerator"
            + "\n\nQUESTION: what is this?")
    out, trimmed = fit_to_context([{"role": "system", "content": "SYSTEM"}, {"role": "user", "content": user}], 1500)
    text = out[-1]["content"]
    assert trimmed and out[0]["content"] == "SYSTEM" and text.endswith("QUESTION: what is this?")
    for kept in ("withheld by access policy", "[F1] ratings.power: 75 kW", "PHOTO 1 TEXT (OCR):\nV-501 LEAN AMINE", '<doc id="S1"'):
        assert kept in text, kept
    assert '<doc id="S8"' not in text and "omitted to fit" in text
    assert text.index('<doc id="S1"') < text.index("omitted to fit") < text.index("NOTE: 2 relevant")
    assert sum(len(m["content"]) // 3 + 8 for m in out) <= 1500
    # nothing to trim: untouched
    same, trimmed = fit_to_context([{"role": "system", "content": "S"}, {"role": "user", "content": user}], 100000)
    assert not trimmed and same[-1]["content"] == user


# ------------------------------------------------------------------ photos
def test_huge_photo_is_refused_before_it_is_decoded(login, monkeypatch):
    from PIL import Image
    from app import attachments
    buf = io.BytesIO()
    Image.new("1", (7000, 6000)).save(buf, "PNG")  # 42 megapixels in a few kilobytes
    decoded = []
    real_load = Image.Image.load
    monkeypatch.setattr("PIL.ImageFile.ImageFile.load", lambda self, *a, **k: decoded.append(1) or real_load(self))
    with pytest.raises(attachments.PhotoError) as e:
        attachments.save("nobody", buf.getvalue())
    assert e.value.status == 413 and e.value.code == "too_large" and not decoded
    monkeypatch.undo()
    r = login("meera.me").post("/api/attachments", files={"file": ("big.png", buf.getvalue(), "image/png")})
    assert r.status_code == 413 and r.json()["detail"]["code"] == "too_large"


def test_large_jpeg_is_still_accepted_and_reduced(login):
    ph = _upload(login("meera.me"), _jpeg(size=(5000, 3000)))  # 15 MP: a normal phone photo
    assert max(ph["width"], ph["height"]) == 1600
    login("meera.me").delete(f"/api/attachments/{ph['id']}")


def test_unsent_photo_can_be_removed_by_its_owner_only(login):
    u = login("meera.me")
    ph = _upload(u)
    assert login("ravi.e").delete(f"/api/attachments/{ph['id']}").status_code == 404
    assert u.get(f"/api/attachments/{ph['id']}").status_code == 200
    assert u.delete(f"/api/attachments/{ph['id']}").status_code == 200
    assert u.get(f"/api/attachments/{ph['id']}").status_code == 404
    assert u.delete(f"/api/attachments/{ph['id']}").status_code == 404
    assert u.delete("/api/attachments/not-a-photo-id").status_code == 404


def test_photo_in_a_saved_question_is_protected_and_survives_another_chat(login):
    from app.i18n import tr
    u = login("meera.me")
    ph = _upload(u)
    c1 = u.post("/api/chats", json={}).json()
    c2 = u.post("/api/chats", json={}).json()
    for c in (c1, c2):  # the same photo is asked about in two chats
        assert u.post(f"/api/chats/{c['id']}/messages", json={"content": "what is this", "images": [ph["id"]]}).status_code == 200
    r = u.delete(f"/api/attachments/{ph['id']}")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "in_use"
    u.c.cookies.clear()
    hi = u.c.delete(f"/api/attachments/{ph['id']}", headers={"X-CSRF-Token": u.csrf, "X-Lang": "hi"}, cookies=u.cookies)
    english = "This photo is part of a saved question. Delete the chat to remove it."
    assert hi.status_code == 409 and hi.json()["detail"]["message"] == tr(english, "hi") != english
    u.delete(f"/api/chats/{c1['id']}")
    assert u.get(f"/api/attachments/{ph['id']}").status_code == 200  # the other chat still shows it
    u.delete(f"/api/chats/{c2['id']}")
    assert u.get(f"/api/attachments/{ph['id']}").status_code == 404  # the last chat took it along


def test_photos_never_sent_are_swept_after_a_day(login):
    from app import attachments
    from app.db import ex
    u = login("meera.me")
    old, fresh, used = _upload(u)["id"], _upload(u)["id"], _upload(u)["id"]
    c = u.post("/api/chats", json={}).json()
    u.post(f"/api/chats/{c['id']}/messages", json={"content": "what is this", "images": [used]})
    ex("UPDATE attachments SET created_at='2020-01-01T00:00:00+00:00' WHERE id IN (?,?)", (old, used))
    assert attachments.sweep_unreferenced() >= 1
    assert u.get(f"/api/attachments/{old}").status_code == 404      # old and never sent: removed (file and record)
    assert not (attachments.DIR / f"{old}.jpg").exists() and not (attachments.DIR / f"{old}_thumb.jpg").exists()
    assert u.get(f"/api/attachments/{fresh}").status_code == 200    # still being composed
    assert u.get(f"/api/attachments/{used}").status_code == 200     # old but part of a question
    u.delete(f"/api/chats/{c['id']}")
    u.delete(f"/api/attachments/{fresh}")


def test_photo_uploads_are_capped_per_day(login, monkeypatch):
    from app import attachments
    from app.i18n import tr
    monkeypatch.setattr(attachments, "MAX_PER_DAY", 0)
    r = login("meera.me").post("/api/attachments", files={"file": ("p.jpg", _jpeg(), "image/jpeg")}, headers={"X-Lang": "kn"})
    english = "You have added too many photos today. Please try again tomorrow."
    assert r.status_code == 429 and r.json()["detail"]["code"] == "too_many"
    assert r.json()["detail"]["message"] == tr(english, "kn") != english


def test_missing_photo_file_gives_a_clean_message_not_a_crash(login):
    from app import attachments
    u = login("meera.me")
    ph = _upload(u)
    for p in attachments._paths(ph["id"]):
        p.unlink()
    c = u.post("/api/chats", json={}).json()
    r = u.post(f"/api/chats/{c['id']}/messages", json={"content": "what is this", "images": [ph["id"]]})
    assert r.status_code == 200 and '"code": "not_found"' in r.text and '"code": "internal"' not in r.text
    u.delete(f"/api/chats/{c['id']}")


RATINGS = ["IP65", "DN100", "PN16", "NB50", "SS316", "SS316L", "M12", "API610", "ISO9001", "IS2062", "EN10204", "ASME16", "REV2",
           "HZ50", "KW75", "HP10", "PT100", "RTD100", "IP-65", "DN-100", "API-610", "ISO-9001"]
REAL_TAGS = ["V-501", "E-310", "XV-2043", "PSV-118", "10-P-101A", "MCC-2", "PT-101", "M-101", "HP-2", "P-101", "K-401", "FE-221", "TR-03"]


def test_ratings_and_standards_are_not_equipment_tags():
    from app import attachments
    for code in RATINGS:
        assert attachments.TAG_RX.fullmatch(code) and attachments.looks_like_rating(code), code  # tag-shaped, but a rating
    for tag in REAL_TAGS:
        assert not attachments.looks_like_rating(tag), tag


def test_photo_with_a_rating_plate_reports_only_real_tags(login):
    from app import attachments
    from app.auth import subject_for
    from app.db import q1
    u = login("meera.me")
    ph = _upload(u, _jpeg("V-501 IP65", size=(1400, 500)))
    me = q1("SELECT * FROM users WHERE username='meera.me'")
    tags = [t["tag"] for t in attachments.analyse(subject_for(me), me["id"], ph["id"])["tags"]]
    assert "V-501" in tags and not any(attachments.looks_like_rating(t) for t in tags), tags
    u.delete(f"/api/attachments/{ph['id']}")


def test_only_tags_the_plant_knows_count_as_a_readable_tag(app_client):
    from app import chat
    photo = {"images": [{"tags": [{"tag": "ZZ-9999", "asset_name": None}, {"tag": "XV-2041", "asset_name": None},
                                  {"tag": "V-501", "asset_name": "Amine regenerator"}]}]}
    assert chat.known_photo_tags(photo) == {"XV-2041", "V-501"}  # asset register + the plant's tag list
    assert chat.known_photo_tags({"images": [{"tags": [{"tag": "SS316", "asset_name": None}]}]}) == set()
    assert chat.known_photo_tags(None) == set()


def test_backup_and_restore_include_chat_photos(login, monkeypatch, tmp_path):
    import zipfile
    from app import admin
    u = login("meera.me")
    ph = _upload(u)
    b = login("admin").post("/api/admin/backups").json()
    with zipfile.ZipFile(admin.BACKUPS / b["name"]) as z:
        names = z.namelist()
    assert f"attachments/{ph['id']}.jpg" in names and f"attachments/{ph['id']}_thumb.jpg" in names and "yukti.db" in names
    u.delete(f"/api/attachments/{ph['id']}")
    # restore (run against a scratch folder, never the live test store)
    store = tmp_path / "store"
    (store / "restore-pending" / "attachments").mkdir(parents=True)
    (store / "restore-pending" / "blobs" / "ab").mkdir(parents=True)
    (store / "restore-pending" / "yukti.db").write_bytes(b"db")
    (store / "restore-pending" / "attachments" / "abc.jpg").write_bytes(b"photo")
    (store / "restore-pending" / "blobs" / "ab" / "doc.pdf").write_bytes(b"doc")
    monkeypatch.setattr(admin, "STORE", store)
    monkeypatch.setattr(admin, "DB_PATH", store / "yukti.db")
    monkeypatch.setattr(admin, "BLOBS", store / "blobs")
    monkeypatch.setattr(admin, "ATTACHMENTS", store / "attachments")
    assert admin.apply_pending_restore() is True
    assert (store / "attachments" / "abc.jpg").read_bytes() == b"photo" and (store / "blobs" / "ab" / "doc.pdf").exists()
    assert (store / "yukti.db").read_bytes() == b"db" and not (store / "restore-pending").exists()


# ------------------------------------------------------------------ policy: top management
def _subject(roles, department="Operations (Production)", clearance=4):
    from app.policy import Subject
    return Subject(id="x", username="x", display_name="x", post="", department=department, clearance=clearance, roles=roles,
                   asset_scopes=[])


def test_executive_is_not_blocked_by_finance_or_chemistry_rules():
    from app.policy import pdp
    md = _subject(["executive"])  # top management outside the MD Office department
    fin = {"type": "document", "id": "d", "department": "Finance & Accounts", "doc_type": "audit_report", "units": [],
           "asset_tags": [], "status": "CURRENT", "classification": 3}
    for action in ("read", "search", "cite"):
        assert pdp.decide(md, action, fin).allowed, action
    for cat in ("process_chemistry", "hazmat_handling", "formulation_confidential", "general", "safety_procedure"):
        d = pdp.decide(md, "ask", {"type": "guard", "category": cat})
        assert d.allowed and "DEFAULT-DENY" not in d.matched, cat
    assert not pdp.decide(md, "ask", {"type": "guard", "category": "control_system_change"}).allowed  # nobody changes setpoints
    assert not pdp.decide(_subject(["executive"], clearance=2), "read", fin).allowed                   # clearance still caps
    eng = _subject(["engineer"], "Electrical Maintenance", 1)
    assert not pdp.decide(eng, "read", {**fin, "classification": 1}).allowed
    assert pdp.decide(eng, "ask", {"type": "guard", "category": "process_chemistry"}).allowed


def test_company_briefing_rule_allows_only_top_management():
    from app.policy import pdp
    company = {"type": "document", "id": "c", "department": "Corporate Branding & Corporate Communication",
               "doc_type": "company_briefing", "units": [], "asset_tags": [], "status": "CURRENT", "classification": 0}
    far = "2999-01-01T00:00:00+00:00"
    for roles in (["engineer"], ["dept_manager", "engineer"], ["plant_manager", "dept_manager"], ["admin"], ["auditor"], ["hse"],
                  ["planner"], ["contractor"]):
        s = _subject(roles, "Corporate Branding & Corporate Communication")  # even in the owning department, even SECRET
        s.grants = [{"department": company["department"], "expires_at": far, "max_classification": 4}]  # even with a grant
        for action in ("read", "search", "cite"):
            d = pdp.decide(s, action, company)
            assert not d.allowed and d.matched == ["R-COMPANY-LEVEL"], (roles, action)
    assert pdp.decide(_subject(["executive"]), "read", company).allowed
    plant = {**company, "doc_type": "public_briefing"}
    assert pdp.decide(_subject(["contractor"], "Mechanical Maintenance", 0), "read", plant).allowed  # plant briefings: everyone


# ------------------------------------------------------------------ accounts
def test_top_management_sample_account_exists_only_in_demo_mode():
    from app import seed
    assert seed.DEMO_ONLY == {"director.md"}
    production = [p for p in seed.PERSONAS if p[0] not in seed.DEMO_ONLY]
    assert production and all("executive" not in p[5] for p in production)  # no executive with a published password


def test_without_top_management_a_production_server_tells_the_admins_and_creates_no_account(app_client, monkeypatch):
    from app import seed
    from app.db import ex, q1
    from app.i18n import tr
    md = q1("SELECT id, roles_json FROM users WHERE username='director.md'")
    before = q1("SELECT COUNT(*) n FROM users")["n"]
    admin_id = q1("SELECT id FROM users WHERE username='admin'")["id"]
    ex("UPDATE users SET roles_json=? WHERE id=?", ('["engineer"]', md["id"]))
    try:
        monkeypatch.setattr("app.config.DEMO_MODE", False)
        seed.ensure_top_management()
        seed.ensure_top_management()  # every start: still one notice
        assert q1("SELECT COUNT(*) n FROM users")["n"] == before
        assert q1("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND title=?", (admin_id, seed.TOP_MANAGEMENT_NOTICE))["n"] == 1
        monkeypatch.setattr("app.config.DEMO_MODE", True)
        seed.ensure_top_management()  # demo: the sample account already exists under that name -> nothing is added
        assert q1("SELECT COUNT(*) n FROM users")["n"] == before
    finally:
        ex("UPDATE users SET roles_json=? WHERE id=?", (md["roles_json"], md["id"]))
    for text in (seed.TOP_MANAGEMENT_NOTICE, seed.TOP_MANAGEMENT_NOTICE_BODY):
        assert tr(text, "hi") != text and tr(text, "kn") != text


def test_giving_top_management_reach_is_audited_and_announced(login):
    a = login("admin")
    r = a.post("/api/admin/users", json={"username": "rv.auditor", "display_name": "Review Auditor", "department": "Internal Audit",
                                         "clearance": 2, "roles": ["auditor"]})
    assert r.status_code == 200, r.text
    created = "A top-management account was created by admin"
    for who in ("director.md", "ramesh.pm"):
        notes = login(who).get("/api/notifications").json()
        assert any(n["title"] == created and "rv.auditor" in n["body"] for n in notes), who
    hi = login("director.md").get("/api/notifications", headers={"X-Lang": "hi"}).json()
    assert any("admin" in n["title"] and "शीर्ष प्रबंधन" in n["title"] and "rv.auditor" in n["body"] for n in hi)
    assert not any(n["title"] == created for n in login("ravi.e").get("/api/notifications").json())
    # an ordinary account: nothing announced ... until it is raised to CONFIDENTIAL
    r2 = a.post("/api/admin/users", json={"username": "rv.engineer", "display_name": "Review Engineer",
                                          "department": "Process Engineering", "clearance": 1, "roles": ["engineer"]})
    uid = r2.json()["user"]["id"]
    changed = "A top-management account was changed by admin"
    assert not any("rv.engineer" in n["body"] for n in login("director.md").get("/api/notifications").json())
    assert a.patch(f"/api/admin/users/{uid}", json={"display_name": "Review Eng."}).status_code == 200
    assert not any(n["title"] == changed for n in login("director.md").get("/api/notifications").json())
    assert a.patch(f"/api/admin/users/{uid}", json={"clearance": 3}).status_code == 200
    assert any(n["title"] == changed and "rv.engineer" in n["body"] and "CONFIDENTIAL" in n["body"]
               for n in login("director.md").get("/api/notifications").json())
    events = [e for e in a.get("/api/audit?event=top_management_assigned").json()]
    assert {e["entity"] for e in events} >= {"user:rv.auditor", "user:rv.engineer"}
    # an administrator still cannot give themselves a role
    me = a.get("/api/auth/me").json()["user"]
    assert a.patch(f"/api/admin/users/{me['id']}", json={"roles": ["admin", "executive"]}).status_code == 403
    for x in (r.json()["user"]["id"], uid):
        a.patch(f"/api/admin/users/{x}", json={"status": "disabled"})


# ------------------------------------------------------------------ Laya
@pytest.mark.parametrize("text", ["नमस्ते", "कैसे हो", "ಹೇಗಿದ್ದೀರಾ", "ಧನ್ಯವಾದಗಳು", "ನಮಸ್ಕಾರ", "धन्यवाद", "hi", "Hello!", "thanks a lot",
                                  "ok", "good morning", "नमस्ते जी", "ಧನ್ಯವಾದ"])
def test_greetings_are_recognised_in_all_three_languages(app_client, text):
    from app import laya
    assert laya.SMALLTALK.search(text), text
    assert not laya.is_off_topic({"intent": "off_topic", "confidence": 0.99}, text)  # a greeting is never "declined"


@pytest.mark.parametrize("text", ["history of A2", "okra recipe", "hip replacement", "thanksgiving menu", "नमस्तेजी कहानी"])
def test_words_that_only_start_like_a_greeting_are_not_greetings(text):
    from app import laya
    assert not laya.SMALLTALK.search(text), text


def test_router_log_never_keeps_what_was_asked(app_client):
    from app import laya
    from app.db import q1
    laya.get().classify("why did pump A2 trip last night XSECRETWORDX")
    row = q1("SELECT text FROM laya_log ORDER BY id DESC LIMIT 1")
    assert row["text"].startswith("len=44 sha=") and "XSECRETWORDX" not in row["text"]
    assert q1("SELECT COUNT(*) n FROM laya_log WHERE text NOT LIKE 'len=%'")["n"] == 0
    samples = laya.sample_texts(12)
    assert len(samples) == 12 == len(set(samples)) and all(s.strip() and "{" not in s for s in samples)


# ------------------------------------------------------------------ engine
def test_api_key_never_reaches_a_log(monkeypatch):
    from app import engine
    monkeypatch.setattr(engine.state, "api_key", "SECRET-key-123")
    assert engine._redacted_args(["llama-server", "-m", "x.gguf", "--api-key", "SECRET-key-123", "--port", "8080"]) == \
        "llama-server -m x.gguf --api-key <per-load key> --port 8080"
    engine.log("Launching: llama-server -m x.gguf --api-key SECRET-key-123 --port 8080")
    engine.log("[llama] srv  init: api key SECRET-key-123 loaded")
    engine.log("[engine] something --api-key ANOTHER-key failed")
    recent = list(engine.LOG)[-3:]
    assert all("SECRET-key-123" not in line and "ANOTHER-key" not in line for line in recent), recent
    assert recent[0].endswith("--api-key <per-load key> --port 8080")
    from app import journal
    assert all("SECRET-key-123" not in p["message"] and "ANOTHER-key" not in p["message"] for p in journal.recent(limit=50))


def test_image_module_goes_only_to_the_model_it_belongs_to(tmp_path):
    from app import engine

    def folder(name, *files):
        d = tmp_path / name
        d.mkdir()
        for f in files:
            (d / f).write_bytes(b"x")
        return d

    one = folder("one", "gemma-3-4b-it-Q4_K_M.gguf", "mmproj-model-f16.gguf")           # one model: its module, whatever the name
    assert engine.mmproj_for(one / "gemma-3-4b-it-Q4_K_M.gguf") == one / "mmproj-model-f16.gguf"
    shards = folder("shards", "big-model-Q4_K_M-00001-of-00002.gguf", "big-model-Q4_K_M-00002-of-00002.gguf", "mmproj-f16.gguf")
    assert engine.mmproj_for(shards / "big-model-Q4_K_M-00001-of-00002.gguf") == shards / "mmproj-f16.gguf"
    many = folder("many", "gemma-3-4b-it-Q4_K_M.gguf", "gemma-3-4b-it-Q8_0.gguf", "qwen2.5-7b-instruct-Q4_K_M.gguf",
                  "mmproj-gemma-3-4b-it-f16.gguf")
    assert engine.mmproj_for(many / "gemma-3-4b-it-Q4_K_M.gguf") == many / "mmproj-gemma-3-4b-it-f16.gguf"
    assert engine.mmproj_for(many / "gemma-3-4b-it-Q8_0.gguf") == many / "mmproj-gemma-3-4b-it-f16.gguf"
    assert engine.mmproj_for(many / "qwen2.5-7b-instruct-Q4_K_M.gguf") is None           # never another model's module
    unclear = folder("unclear", "gemma-3-4b-it-Q4_K_M.gguf", "qwen2.5-7b-instruct-Q4_K_M.gguf", "mmproj-model-f16.gguf")
    assert engine.mmproj_for(unclear / "gemma-3-4b-it-Q4_K_M.gguf") is None              # cannot tell whose it is
    assert engine.mmproj_for(folder("none", "a-Q4_K_M.gguf") / "a-Q4_K_M.gguf") is None


def test_seeing_models_are_looked_up_at_most_every_30_seconds(monkeypatch):
    from app import engine
    scans = []
    monkeypatch.setattr(engine, "vision_models_on_disk", lambda: scans.append(1) or ["some-model"])
    engine.invalidate_vision_cache()
    first = asyncio.run(engine.vision_status())
    again = asyncio.run(engine.vision_status())
    assert first == again and first["installed"] is True and first["models"] == ["some-model"] and len(scans) == 1
    engine.invalidate_vision_cache()  # what load / unload / import / delete do
    asyncio.run(engine.vision_status())
    assert len(scans) == 2
    monkeypatch.setattr(engine, "VISION_CACHE_S", 0.0)  # the 30 s are over
    asyncio.run(engine.vision_status())
    assert len(scans) == 3
    engine.invalidate_vision_cache()


def test_search_failure_log_has_no_question_words(app_client, monkeypatch):
    from app import engine, rag
    from app.auth import subject_for
    from app.db import q1
    real_q = rag.q

    def broken(sql, args=()):
        if "chunks_fts MATCH" in sql:
            raise RuntimeError('fts5: syntax error near "XSECRETWORDX"')
        return real_q(sql, args)

    monkeypatch.setattr(rag, "q", broken)
    got = rag.retrieve(subject_for(q1("SELECT * FROM users WHERE username='ravi.e'")), "XSECRETWORDX pump trip")
    assert got["sources"] == []
    tail = list(engine.LOG)[-2:]
    assert all("[search]" in line and "XSECRETWORDX" not in line and "term(s)" in line for line in tail), tail


# ------------------------------------------------------------------ voice
class _FakeProc:
    def __init__(self) -> None:
        self.killed = False

    def poll(self):
        return 0 if self.killed else None

    def kill(self) -> None:
        self.killed = True


def _client_raising(exc):
    class _Client:
        def __init__(self, *a, **k) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            raise exc

    return _Client


def test_failed_recognition_never_blocks_the_server_and_stops_only_its_own_recogniser(monkeypatch):
    """The start/stop lock is held by another thread (a recogniser start can take 90 s). A failed request must not wait
    for it on the event loop, and must stop the recogniser it talked to - not a newer one."""
    import httpx
    from app import speech
    old, new = _FakeProc(), _FakeProc()
    monkeypatch.setattr(speech._S, "last_used", time.time())
    monkeypatch.setattr(speech._S, "proc", new)  # a newer recogniser has replaced the one the request went to
    monkeypatch.setattr(speech.httpx, "AsyncClient", _client_raising(httpx.ConnectError("connection refused")))
    held, release = threading.Event(), threading.Event()

    def hold() -> None:
        with speech._S.lock:
            held.set()
            release.wait(10)

    holder = threading.Thread(target=hold, daemon=True)
    holder.start()
    assert held.wait(5)

    async def scenario():
        ticks = 0

        async def ticker():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.02)
                ticks += 1

        tick = asyncio.create_task(ticker())
        task = asyncio.create_task(speech._recognise(b"", "en", "", srv=(old, 1, "/x")))
        await asyncio.sleep(0.6)  # all this time the lock is held elsewhere
        during, waiting = ticks, not task.done()
        release.set()
        with pytest.raises(speech.SpeechError) as e:
            await asyncio.wait_for(task, 10)
        tick.cancel()
        return during, waiting, e.value

    try:
        during, waiting, error = asyncio.run(scenario())
    finally:
        release.set()
        holder.join(5)
    assert during >= 10, during          # the event loop kept running while the lock was held
    assert waiting                       # ... and the clean-up really was waiting for that lock (in a worker thread)
    assert error.status == 503 and error.code == "speech_unavailable"
    assert old.killed and not new.killed and speech._S.proc is new


def test_slow_recognition_does_not_stop_a_healthy_recogniser(monkeypatch):
    import httpx
    from app import speech
    from app.i18n import tr
    proc = _FakeProc()
    monkeypatch.setattr(speech._S, "last_used", time.time())
    monkeypatch.setattr(speech._S, "proc", proc)
    monkeypatch.setattr(speech.httpx, "AsyncClient", _client_raising(httpx.ReadTimeout("slow")))
    with pytest.raises(speech.SpeechError) as e:
        asyncio.run(speech._recognise(b"", "en", "", srv=(proc, 1, "/x")))
    assert e.value.status == 504 and e.value.code == "speech_timeout" and not proc.killed and speech._S.proc is proc
    assert tr(e.value.message, "hi") != e.value.message and tr(e.value.message, "kn") != e.value.message
    # the recogniser has exited (even if the error looks like a timeout): it is cleared away
    proc.killed = True
    with pytest.raises(speech.SpeechError) as e:
        asyncio.run(speech._recognise(b"", "en", "", srv=(proc, 1, "/x")))
    assert e.value.code == "speech_unavailable" and speech._S.proc is None


def test_gpu_voice_is_tried_again_after_a_while(monkeypatch, tmp_path):
    from app import speech
    binary, model = tmp_path / "whisper-server.exe", tmp_path / "model.bin"
    binary.write_bytes(b"x")
    model.write_bytes(b"x")
    monkeypatch.setitem(speech.BIN, "gpu", [binary])
    monkeypatch.setitem(speech.BIN, "cpu", [binary])
    monkeypatch.setattr(speech, "_model", lambda dev: model)
    monkeypatch.setattr(speech, "has_nvidia_gpu", lambda: True)
    monkeypatch.setattr(speech, "_gpu_free_mb", lambda: 4000)
    monkeypatch.setattr(speech._S, "device", None)
    monkeypatch.setattr(speech._S, "gpu_disabled_until", 0.0)
    assert speech.choose()["device"] == "gpu"
    monkeypatch.setattr(speech._S, "gpu_disabled_until", time.time() + speech.GPU_RETRY_S)  # a GPU start has just failed
    assert speech.choose()["device"] == "cpu" and speech.gpu_installed() is True            # ... the install is not forgotten
    monkeypatch.setattr(speech._S, "gpu_disabled_until", time.time() - 1)                   # ten minutes later
    assert speech.choose()["device"] == "gpu"


def test_recordings_are_recognised_one_at_a_time(monkeypatch):
    from app import speech
    running, most = 0, 0

    async def fake_recognise(data, lang, prompt, detect_only=False, srv=None):
        nonlocal running, most
        running += 1
        most = max(most, running)
        await asyncio.sleep(0.05)
        running -= 1
        return {"language": "en", "text": "pump A2"}

    monkeypatch.setattr(speech, "_recognise", fake_recognise)
    monkeypatch.setattr(speech, "_locked_start", lambda: (None, 1, "/x"))
    monkeypatch.setattr(speech, "check_wav", lambda data: (2.0, 0.2))
    monkeypatch.setattr(speech, "vocabulary", lambda s: "")

    async def three():
        return await asyncio.gather(*(speech.transcribe(None, b"wav", "en") for _ in range(3)))

    out = asyncio.run(three())
    assert [o["text"] for o in out] == ["pump A2"] * 3 and most == 1
