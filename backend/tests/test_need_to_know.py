"""Need-to-know: company-level information (finances, strategy, company-wide figures) is for top management only."""
import json as _j

import pytest


def _chat(u, text):
    chat = u.post("/api/chats", json={}).json()
    r = u.post(f"/api/chats/{chat['id']}/messages", json={"content": text, "use_knowledge": True})
    ev, name = {}, None
    for line in r.text.splitlines():
        if line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:"):
            ev.setdefault(name, []).append(_j.loads(line[5:]))
    return ev


@pytest.mark.parametrize("user", ["ravi.e", "suresh.em", "rajesh.mm", "ramesh.pm", "admin", "contractor.x"])
def test_company_page_only_for_top_management(login, user):
    assert login(user).get("/api/company").status_code == 403
    assert "company.view" not in login(user).me["permissions"] if "permissions" in login(user).me else True


def test_top_management_sees_company_information(login):
    md = login("director.md")
    assert md.get("/api/company").status_code == 200
    ev = _chat(md, "What was MRPL's revenue and profit last financial year?")
    assert "facts" in ev  # public, cited company facts (no model is loaded in tests, so the answer itself ends in an error)
    assert (ev.get("guard") or [{}])[0].get("category") != "company_restricted"


@pytest.mark.parametrize("user", ["ravi.e", "suresh.em", "ramesh.pm", "admin"])
def test_financial_questions_declined_for_everyone_else(login, user):
    ev = _chat(login(user), "What was MRPL's revenue and profit last financial year?")
    assert ev["done"][0]["stats"]["stop_reason"] == "need_to_know"
    assert "facts" not in ev and "retrieval" not in ev


# plant questions that contain a word with a money or company meaning: never declined (the worst mistake of this gate)
PLANT_NOT_COMPANY = [
    "which department handles hot work permits", "what is the capacity of pump A2", "history of A2 failures",
    "what products does the CDU-1 make from crude", "what to do on loss of cooling water", "pressure loss across the exchanger",
    "loss of containment procedure", "isolation strategy for the feeder", "MRPL hot work permit procedure",
    "who is the chairman of the safety committee", "catalyst turnover in the reactor", "what is the PAT test interval for the motor",
    "budget for the pump overhaul work order", "पंप A2 का क्या लाभ है",
    "इस प्रक्रिया का क्या लाभ है", "यह जानकारी शिफ्ट टीम के साथ शेयर करो", "ಈ ವಿಧಾನದ ಲಾಭ ಏನು", "ಇದನ್ನು ಶಿಫ್ಟ್ ತಂಡದೊಂದಿಗೆ ಷೇರು ಮಾಡಿ",
]
# clearly financial / corporate questions: declined for everyone but top management - also with an equipment tag in the
# sentence, and in Hindi and Kannada
COMPANY_ONLY = [
    "What was MRPL's revenue and profit last financial year?", "A2 – what is MRPL's profit?", "what is the company's turnover",
    "MRPL GRM last financial year", "what is the gross refining margin", "MRPL shareholding pattern", "what dividend did MRPL pay",
    "what is the share price of MRPL", "MRPL market cap", "show me the balance sheet", "what is the net worth of the company",
    "MRPL EBITDA", "what was the PAT last year", "net income of MRPL", "MRPL credit rating", "summarise the annual report",
    "who is on the board of directors", "who is the managing director", "who is the chairman", "list the subsidiaries of MRPL",
    # ("लाभ"/"ಲಾಭ" = benefit and "शेयर"/"ಷೇರು" = share are everyday words: not gated by wording, protected at the data layer)
    "MRPL का राजस्व कितना है", "कंपनी का मुनाफा कितना है", "MRPL का टर्नओवर", "MRPL के शेयरधारक कौन हैं", "MRPL का लाभांश",
    "MRPL ಆದಾಯ ಎಷ್ಟು", "MRPL ವಹಿವಾಟು ಎಷ್ಟು", "MRPL ಷೇರುದಾರರು ಯಾರು", "MRPL ಲಾಭಾಂಶ ಎಷ್ಟು",
]
NEUTRAL = {"intent": "general_chat", "confidence": 0.9}


@pytest.mark.parametrize("q", PLANT_NOT_COMPANY)
def test_gate_words_never_decline_a_plant_question(app_client, q):
    from app import chat, laya
    assert not chat.is_company_level(NEUTRAL, q), q                    # the word list alone
    assert not chat.is_company_level(laya.get().classify(q), q), q     # ... and together with Laya's real guess


@pytest.mark.parametrize("q", COMPANY_ONLY)
def test_gate_declines_clearly_financial_questions(app_client, q):
    from app import chat
    assert chat.is_company_level(NEUTRAL, q), q
    assert chat.is_company_level(NEUTRAL, q, photos=True), q  # attaching a photo does not switch the gate off


def test_laya_guess_is_ignored_when_a_photo_is_attached(app_client):
    from app import chat
    sure = {"intent": "company_info", "confidence": 0.95}
    assert chat.is_company_level(sure, "tell me more")                      # Laya confident, nothing plant-related typed
    assert not chat.is_company_level(sure, "tell me more", photos=True)     # with a photo, Laya read the photo's text
    assert not chat.is_company_level(sure, "what is the capacity of pump A2")


@pytest.mark.parametrize("q", ["which department handles hot work permits", "what is the capacity of pump A2",
                               "history of A2 failures", "what products does the CDU-1 make from crude",
                               "what to do on loss of cooling water", "pressure loss across the exchanger",
                               "loss of containment procedure", "isolation strategy for the feeder",
                               "MRPL hot work permit procedure"])
def test_plant_questions_are_not_mistaken_for_company_questions(login, q):
    ev = _chat(login("ravi.e"), q)
    assert "guard" in ev, list(ev)  # every turn passes a guard decision; its category says which gate answered
    assert ev["guard"][0]["category"] != "company_restricted"
    assert all(d["stats"]["stop_reason"] != "need_to_know" for d in ev.get("done", []))


@pytest.mark.parametrize("q", ["A2 – what is MRPL's profit?", "MRPL का राजस्व कितना है", "MRPL ಆದಾಯ ಎಷ್ಟು"])
def test_financial_question_with_a_tag_or_in_hindi_kannada_is_declined(login, q):
    ev = _chat(login("ravi.e"), q)
    assert ev["guard"][0]["category"] == "company_restricted"
    assert ev["done"][0]["stats"]["stop_reason"] == "need_to_know"
    assert "facts" not in ev and "retrieval" not in ev


def test_financial_question_with_a_photo_is_declined(login):
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (400, 300), (120, 120, 120)).save(buf, "JPEG")
    u = login("meera.me")
    ph = u.post("/api/attachments", files={"file": ("p.jpg", buf.getvalue(), "image/jpeg")}).json()
    chat = u.post("/api/chats", json={}).json()
    r = u.post(f"/api/chats/{chat['id']}/messages", json={"content": "what is MRPL's profit?", "images": [ph["id"]]})
    assert '"stop_reason": "need_to_know"' in r.text
    u.delete(f"/api/chats/{chat['id']}")


# ---------------------------------------------------------------- the data layer (the real protection)
def _briefings(u):
    return {d["doc_number"]: d for d in u.get("/api/documents").json() if (d.get("doc_number") or "").startswith("MRPL-PUB-")}


@pytest.mark.parametrize("user", ["ravi.e", "suresh.em", "ramesh.pm", "admin"])
def test_company_briefings_hidden_from_everyone_but_top_management(login, user):
    u = login(user)
    mine = _briefings(u)
    assert "MRPL-PUB-CORP" not in mine and "MRPL-PUB-FIN" not in mine           # document list
    everything = _briefings(login("director.md"))
    for number in ("MRPL-PUB-CORP", "MRPL-PUB-FIN"):
        assert u.get(f"/api/documents/{everything[number]['id']}").status_code == 403      # document read
        assert u.get(f"/api/documents/{everything[number]['id']}/file").status_code == 403


def test_company_briefings_never_retrieved_for_others_and_not_counted_as_withheld(app_client):
    from app import rag
    from app.auth import subject_for
    from app.db import q1
    question = "shareholding pattern promoter revenue EBITDA dividend credit rating board of directors managing director"
    for name in ("ravi.e", "suresh.em", "admin"):
        got = rag.retrieve(subject_for(q1("SELECT * FROM users WHERE username=?", (name,))), question)
        assert all(s["doc_type"] != "company_briefing" for s in got["sources"]), name
        assert "Corporate Branding & Corporate Communication" not in got["denied"]["departments"], name
    md = subject_for(q1("SELECT * FROM users WHERE username='director.md'"))
    assert any(s["doc_type"] == "company_briefing" for s in rag.retrieve(md, question)["sources"])


def test_top_management_reads_company_briefings(login):
    md = login("director.md")
    mine = _briefings(md)
    assert {"MRPL-PUB-CORP", "MRPL-PUB-FIN", "MRPL-PUB-REF", "MRPL-PUB-PROD"} <= set(mine)
    assert md.get(f"/api/documents/{mine['MRPL-PUB-FIN']['id']}").status_code == 200


def test_plant_briefings_stay_open_to_everyone(login):
    assert {"MRPL-PUB-REF", "MRPL-PUB-PROD"} <= set(_briefings(login("ravi.e")))


def test_production_overview_has_no_financials_for_a_planner(login):
    planner = login("arjun.pl").get("/api/production/overview")
    assert planner.status_code == 200 and "financials" not in (planner.json().get("public") or {})
    md = login("director.md").get("/api/production/overview").json()
    assert "financials" in (md.get("public") or {})


def test_executive_reads_documents_across_departments_but_it_admin_does_not(login):
    md_docs = login("director.md").get("/api/documents").json()
    admin_docs = login("admin").get("/api/documents").json()
    n = lambda d: len(d if isinstance(d, list) else d.get("items", []))  # noqa: E731
    assert n(md_docs) > n(admin_docs)
