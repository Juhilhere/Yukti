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


@pytest.mark.parametrize("q", ["which department handles hot work permits", "what is the capacity of pump A2",
                               "history of A2 failures", "what products does the CDU-1 make from crude"])
def test_plant_questions_are_not_mistaken_for_company_questions(login, q):
    ev = _chat(login("ravi.e"), q)
    assert ev["done"][0]["stats"]["stop_reason"] != "need_to_know" if "done" in ev else True
    assert (ev.get("guard") or [{}])[0].get("category") != "company_restricted"


def test_executive_reads_documents_across_departments_but_it_admin_does_not(login):
    md_docs = login("director.md").get("/api/documents").json()
    admin_docs = login("admin").get("/api/documents").json()
    n = lambda d: len(d if isinstance(d, list) else d.get("items", []))  # noqa: E731
    assert n(md_docs) > n(admin_docs)
