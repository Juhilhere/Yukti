"""Idempotent demo seeding: personas, org, assets, ledger, work orders, contacts, facts, presets, corpus ingestion."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import audit, rag
from .auth import hash_password
from .config import CLEARANCE_BY_LABEL, CORPUS, DATA
from .db import ex, j, new_id, now_iso, q, q1
from .llm_params import DEFAULT_PREDICTION

STRUCT = DATA / "structured"

PERSONAS = [
    # username, display, post, dept, clearance, roles, scopes, password
    ("ravi.e", "Ravi Easwaran", "Senior Electrician (Shift)", "Electrical", 1, ["engineer"], ["CDU-1", "VDU-1"], "Ravi@2026"),
    ("anil.u", "Anil Shetty", "Boiler Engineer", "Utilities", 1, ["engineer"], ["UTIL"], "Anil@2026"),
    ("suresh.em", "Suresh Rao", "Manager — Electrical", "Electrical", 2, ["dept_manager", "approver:electrical", "engineer"], ["*"], "Suresh@2026"),
    ("kavita.fm", "Kavita Nair", "Manager — Finance", "Finance", 3, ["dept_manager", "approver:finance"], [], "Kavita@2026"),
    ("meera.me", "Meera Pai", "Mechanical Engineer (Static)", "Mechanical", 1, ["engineer", "approver:mechanical"], ["CDU-1", "HCU", "UTIL"], "Meera@2026"),
    ("priya.hse", "Priya D'Souza", "HSE Officer", "HSE", 2, ["hse"], ["*"], "Priya@2026"),
    ("vikram.op", "Vikram Kulkarni", "Process Engineer — Amine/SRU", "Operations", 2, ["engineer", "process"], ["SRU", "CDU-1"], "Vikram@2026"),
    ("arjun.pl", "Arjun Hegde", "Production Planner", "Planning", 1, ["planner"], [], "Arjun@2026"),
    ("deepa.au", "Deepa Menon", "Internal Auditor", "Audit", 3, ["auditor"], [], "Deepa@2026"),
    ("ramesh.pm", "Ramesh Bhat", "Plant Manager", "Management", 3, ["plant_manager", "dept_manager"], ["*"], "Ramesh@2026"),
    ("contractor.x", "Vendor Technician", "Contractor (Mechanical)", "Mechanical", 0, ["contractor"], ["CDU-1"], "Vendor@2026"),
    ("admin", "Yukti Admin", "Platform Administrator", "IT", 3, ["admin"], ["*"], "Admin@2026"),
]
DEPT_MANAGERS = {"Electrical": "suresh.em", "Finance": "kavita.fm", "Management": "ramesh.pm", "Mechanical": "meera.me",
                 "Operations": "ramesh.pm", "Utilities": "ramesh.pm", "HSE": "ramesh.pm", "Instrumentation": "suresh.em"}

PRESETS = [
    ("Yukti — Plant Q&A (precise)", "Grounded, low-temperature answers with citations.", "",
     {"temperature": 0.2, "top_k": 40, "top_p": 0.9, "min_p": 0.05, "repeat_penalty": 1.1, "max_tokens": 900}),
    ("Creative drafting", "Drafting notes, emails and summaries.", "Write clear, professional plant documentation.",
     {"temperature": 0.9, "top_k": 80, "top_p": 0.95, "min_p": 0.02, "repeat_penalty": 1.05, "max_tokens": 1500}),
    ("Deterministic (greedy)", "Reproducible outputs for audits and benchmarks.", "",
     {"temperature": 0.0, "top_k": 1, "top_p": 1.0, "min_p": 0.0, "seed": 42, "max_tokens": 800}),
    ("JSON extraction", "Structured extraction with low temperature.", "Return only valid JSON.",
     {"temperature": 0.0, "top_k": 20, "top_p": 0.9, "max_tokens": 600}),
]


def seeded() -> bool:
    return bool(q1("SELECT 1 FROM users LIMIT 1"))


def run(ingest: bool = True) -> None:
    if seeded():
        return
    # users
    for u, name, post, dept, cl, roles, scopes, pw in PERSONAS:
        ex("""INSERT INTO users(id, username, display_name, post, department, clearance, roles_json, asset_scopes_json,
              password_hash, demo_password, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
           (new_id(), u, name, post, dept, cl, j(roles), j(scopes), hash_password(pw), pw, now_iso()))
    for dept, mgr in DEPT_MANAGERS.items():
        uid = q1("SELECT id FROM users WHERE username=?", (mgr,))["id"]
        ex("INSERT OR IGNORE INTO departments(id, code, name, manager_user_id) VALUES(?,?,?,?)", (new_id(), dept, dept, uid))
    # assets, aliases, ledger
    assets = json.loads((STRUCT / "assets.json").read_text(encoding="utf-8"))
    for a in assets:
        ex("""INSERT OR REPLACE INTO assets(tag, name, unit, class, vendor, model, serial, location, owner_department, criticality, specs_json)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
           (a["tag"], a["name"], a["unit"], a["class"], a.get("vendor"), a.get("model"), a.get("serial"), a.get("location"),
            a.get("owner_department"), a.get("criticality"), j(a.get("specs", {}))))
        aliases = {a["tag"], *a.get("specs", {}).get("aliases", [])}
        for al in aliases:
            ex("INSERT OR IGNORE INTO tag_alias(alias, tag) VALUES(?,?)", (al, a["tag"]))
        for it in a.get("items", []):
            ex("INSERT INTO ledger_items(id, tag, type, ref_no, issued_on, expires_on) VALUES(?,?,?,?,?,?)",
               (new_id(), a["tag"], it["type"], it.get("ref_no"), it.get("issued_on"), it.get("expires_on")))
    for extra in ["MCC-2-F07", "XV-2041", "XV-2042", "XV-2043", "FIC-101", "C-2F07-01"]:
        ex("INSERT OR IGNORE INTO tag_alias(alias, tag) VALUES(?,?)", (extra, extra))
    # work orders & contacts
    for w in json.loads((STRUCT / "work_orders.json").read_text(encoding="utf-8")):
        ex("INSERT OR REPLACE INTO work_orders VALUES(?,?,?,?,?,?,?,?,?,?)",
           (w["wo_no"], w["tag"], w["type"], w["opened_at"], w.get("closed_at"), w.get("failure_code"), w.get("cause"),
            w.get("action"), w.get("technician"), w["status"]))
    for c in json.loads((STRUCT / "users_contacts.json").read_text(encoding="utf-8")):
        ex("INSERT INTO contacts(id, name, dept, role, ext, on_call) VALUES(?,?,?,?,?,?)",
           (new_id(), c["name"], c["dept"], c.get("role"), c.get("ext"), int(bool(c.get("on_call")))))
    # dossier facts
    fx = json.loads((STRUCT / "facts.json").read_text(encoding="utf-8"))
    tag = fx.get("asset", "A2")
    for f in fx["facts"]:
        dn = f.get("doc_number") or ""
        kind = ("asset_master" if dn.startswith("ASSET-MASTER") else "datasheet" if dn.startswith("DS-") else
                "sop" if dn.startswith("SOP") else "drawing" if dn.startswith(("PID", "SLD")) else "doc")
        ex("""INSERT INTO facts(id, asset_tag, slot, attribute, value, unit, source_doc_number, revision, effective_date, page, source_kind)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
           (new_id(), tag, f["slot"], f["attribute"], None if f.get("value") is None else str(f["value"]), f.get("unit") or "",
            dn if not dn.startswith("ASSET-MASTER") else "Asset master (M-A2)", f.get("revision"), f.get("effective_date"),
            f.get("page"), kind))
    # presets
    for name, desc, sp, pred in PRESETS:
        ex("INSERT INTO presets(id, user_id, name, description, system_prompt, prediction_json, load_json, builtin, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
           (new_id(), None, name, desc, sp, j({**DEFAULT_PREDICTION, **pred}), j({}), 1, now_iso()))
    audit.write("system", "seed.completed", "demo", {"users": len(PERSONAS), "assets": len(assets)})
    if ingest:
        ingest_corpus()
    seed_workflows()


def ingest_corpus() -> None:
    man = json.loads((CORPUS / "manifest.json").read_text(encoding="utf-8"))
    admin = "system"
    for d in man["documents"]:
        p = CORPUS / d["file"]
        if not p.exists() or p.suffix == ".json":
            continue
        meta = {
            "title": d.get("title") or p.stem, "doc_number": d.get("doc_number"), "revision": d.get("revision") or "",
            "status": d.get("status", "CURRENT"), "doc_type": d.get("doc_type", "other"), "department": d.get("department", "Operations"),
            "classification": CLEARANCE_BY_LABEL.get(d.get("classification", "INTERNAL"), 1),
            "effective_date": d.get("effective_date"), "supersedes": d.get("supersedes") if isinstance(d.get("supersedes"), str) else None,
            "asset_tags": d.get("asset_tags", []),
        }
        did = rag.create_document(meta, d["file"], p, admin)
        rag.ingest(did, None, admin)


def seed_workflows() -> None:
    """E-310 thickness finding + expiry notifications."""
    doc = q1("SELECT id FROM documents WHERE doc_number='UT-E310-2026-07'")
    meera = q1("SELECT id FROM users WHERE username='meera.me'")
    if doc and meera and not q1("SELECT 1 FROM findings"):
        ex("""INSERT INTO findings(id, title, tag, discipline, severity, state, due_date, evidence, source_document_id, page, approver_id,
              history_json, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
           (new_id(), "E-310 shell wall thickness 6.1 mm below minimum 6.5 mm", "E-310", "Mechanical", "high", "PENDING",
            (date.today() + timedelta(days=7)).isoformat(), "UT reading at CML-4: 6.1 mm (min allowable 6.5 mm) — scanned report p.1",
            doc["id"], 1, meera["id"], j([{"at": now_iso(), "event": "DETECTED", "by": "OCR pipeline"}]), now_iso()))
    refresh_alert_notifications()


def refresh_alert_notifications() -> None:
    today = date.today()
    soon = (today + timedelta(days=7)).isoformat()
    rows = q("""SELECT l.*, a.name, a.owner_department FROM ledger_items l JOIN assets a ON a.tag=l.tag
                WHERE l.expires_on <= ? ORDER BY l.expires_on""", (soon,))
    users = q("SELECT id, department, roles_json FROM users")
    for r in rows:
        days = (date.fromisoformat(r["expires_on"]) - today).days
        title = (f"{r['tag']} {r['type']} EXPIRED {-days} day(s) ago" if days < 0 else f"{r['tag']} {r['type']} expires in {days} day(s)")
        for u in users:
            if u["department"] in (r["owner_department"], "HSE", "Instrumentation") or "plant_manager" in u["roles_json"] or "admin" in u["roles_json"]:
                if not q1("SELECT 1 FROM notifications WHERE user_id=? AND title=?", (u["id"], title)):
                    ex("INSERT INTO notifications(id, user_id, kind, title, body, link, created_at) VALUES(?,?,?,?,?,?,?)",
                       (new_id(), u["id"], "expiry", title, f"{r['name']} · ref {r['ref_no']} · due {r['expires_on']}", f"/assets?q={r['tag']}", now_iso()))
