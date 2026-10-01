"""Seeding (idempotent).

What is seeded — and what is NOT:
- Employees: fictional demo accounts (employee data may be generated), mapped onto MRPL's real, publicly listed departments.
- MRPL public intelligence: loaded by app.mrpl (real, cited).
- EXAMPLE documents: ~15 sample plant documents written by Team UniMinds, every page watermarked
  "EXAMPLE – prepared by Team UniMinds – NOT MRPL DATA"; flagged is_example in the DB and in the UI.
- Only the assets / work orders / facts that those example documents themselves describe are loaded (also flagged EXAMPLE).
- Nothing else: no invented asset register, contacts, production data, presets or performance numbers.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

from . import audit, rag
from .auth import hash_password
from .config import CLEARANCE_BY_LABEL, CORPUS, DATA
from .db import ex, j, new_id, now_iso, q, q1, uj

STRUCT = DATA / "structured"

# Internal example-corpus department names  →  MRPL's real department names (from mrpl.co.in / annual report)
DEPT_MAP = {
    "Electrical": "Electrical Maintenance", "Mechanical": "Mechanical Maintenance", "Instrumentation": "Instrumentation Maintenance",
    "Operations": "Operations (Production)", "Utilities": "Captive Power Plants & Utilities", "HSE": "Health, Safety & Environment",
    "Finance": "Finance & Accounts", "Management": "MD Office", "Planning": "Production Planning & Quality Control (PP & QC)",
    "Audit": "Internal Audit", "IT": "Information Systems (IT/SAP)",
}

PERSONAS = [
    # username, display, post, real department, clearance, roles, asset scopes (plant units), password
    ("ravi.e", "Ravi Easwaran", "Senior Electrician (Shift)", "Electrical Maintenance", 1, ["engineer"], ["CDU-1", "VDU-1"], "Ravi@2026"),
    ("anil.u", "Anil Shetty", "Boiler Engineer", "Captive Power Plants & Utilities", 1, ["engineer"], ["UTIL"], "Anil@2026"),
    ("suresh.em", "Suresh Rao", "HOD — Electrical Maintenance", "Electrical Maintenance", 2, ["dept_manager", "approver:electrical", "engineer"], ["*"], "Suresh@2026"),
    ("kavita.fm", "Kavita Nair", "HOD — Finance & Accounts", "Finance & Accounts", 3, ["dept_manager", "approver:finance"], [], "Kavita@2026"),
    ("meera.me", "Meera Pai", "Engineer — Static Equipment", "Mechanical Maintenance", 1, ["engineer"], ["CDU-1", "HCU", "UTIL"], "Meera@2026"),
    ("priya.hse", "Priya D'Souza", "HSE Officer", "Health, Safety & Environment", 2, ["hse"], ["*"], "Priya@2026"),
    ("vikram.op", "Vikram Kulkarni", "Process Engineer — Amine / SRU", "Process Engineering", 2, ["engineer", "process"], ["SRU", "CDU-1"], "Vikram@2026"),
    ("arjun.pl", "Arjun Hegde", "Production Planner", "Production Planning & Quality Control (PP & QC)", 1, ["planner"], [], "Arjun@2026"),
    ("deepa.au", "Deepa Menon", "Internal Auditor", "Internal Audit", 3, ["auditor"], [], "Deepa@2026"),
    ("ramesh.pm", "Ramesh Bhat", "Chief General Manager — Refinery", "Operations (Production)", 3, ["plant_manager", "dept_manager"], ["*"], "Ramesh@2026"),
    ("rajesh.mm", "Rajesh Shenoy", "HOD — Mechanical Maintenance", "Mechanical Maintenance", 2, ["dept_manager", "approver:mechanical", "engineer"], ["*"], "Rajesh@2026"),
    ("sunita.hse", "Sunita Bhandary", "HOD — Health, Safety & Environment", "Health, Safety & Environment", 2, ["dept_manager", "hse"], ["*"], "Sunita@2026"),
    ("contractor.x", "Vendor Technician", "Contract technician (Mechanical)", "Mechanical Maintenance", 0, ["contractor"], ["CDU-1"], "Vendor@2026"),
    ("director.md", "Kavya Rao", "Managing Director (fictional demo account)", "MD Office", 4, ["executive"], ["*"], "Kavya@2026"),
    ("admin", "Yukti Administrator", "Platform Administrator", "Information Systems (IT/SAP)", 3, ["admin"], [], "Admin@2026"),
]
ON_CALL = {"ravi.e", "suresh.em", "meera.me"}
MANAGERS = {"Electrical Maintenance": "suresh.em", "Instrumentation Maintenance": "suresh.em", "Finance & Accounts": "kavita.fm",
            "Internal Audit": "ramesh.pm", "Captive Power Plants & Utilities": "ramesh.pm", "Mechanical Maintenance": "rajesh.mm",
            "Operations (Production)": "ramesh.pm", "Health, Safety & Environment": "sunita.hse", "Process Engineering": "ramesh.pm"}

# Example documents kept (plant documents authored by Team UniMinds for demonstration)
EXAMPLE_FILES = [
    "A2_datasheet_rev1.pdf", "SOP-EL-014_rev2.docx", "SOP-EL-014_rev3.docx", "PID-CDU-03_revB.pdf", "PID-CDU-03_revC.pdf",
    "SLD-MCC-2_revB.pdf", "SLD-MCC-2_revC.pdf", "A2_troubleshooting_guide.pdf", "inspection_E-310_scan.pdf",
    "inspection_PSV-118_scan.png", "FIN-AUD-2026-Q2_boiler_fuel_cost.pdf", "MSDS_MDEA_amine.pdf", "Process_manual_amine_unit.pdf",
    "shift_log_2026-09-29.txt", "work_orders_A2.xlsx",
]


def seeded() -> bool:
    return bool(q1("SELECT 1 FROM users LIMIT 1"))


# Accounts that exist ONLY in demonstration mode. The top-management sample account sees company-level information; a
# real installation must never contain such an account with a password that is printed in the documentation.
DEMO_ONLY = {"director.md"}
TOP_MANAGEMENT_NOTICE = "Assign the Top management role to the people who may see company information"
TOP_MANAGEMENT_NOTICE_BODY = ("Nobody has the Top management role yet, so company-level information (finances and company-wide "
                              "figures) is hidden from everyone. Open Administration > Users to assign it.")


def _insert_persona(p: tuple, demo: bool) -> None:
    u, name, post, dept, cl, roles, scopes, pw = p
    # outside demonstration mode the well-known starting passwords must be changed at first login
    ex("""INSERT INTO users(id, username, display_name, post, department, clearance, roles_json, asset_scopes_json,
          password_hash, demo_password, must_change_password, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
       (new_id(), u, name, post, dept, cl, j(roles), j(scopes), hash_password(pw), pw if demo else None,
        0 if demo else 1, now_iso()))


def ensure_top_management() -> None:
    """Run at every start. If nobody holds the `executive` (Top management) role - an installation made before the role
    existed, or a production installation - then: demonstration mode gets the fictional sample account; a production
    installation gets NO account (never one with a published password): the administrators are told to assign the role."""
    from . import journal
    from .config import DEMO_MODE
    users = q("SELECT id, username, roles_json FROM users")
    if not users or any("executive" in uj(u["roles_json"], []) for u in users):
        return
    if DEMO_MODE:
        p = next(x for x in PERSONAS if x[0] == "director.md")
        if not any(u["username"] == p[0] for u in users):
            _insert_persona(p, True)
            audit.write("system", "seed.demo_account_added", f"user:{p[0]}", {"roles": p[5]})
            journal.event("seed", "demonstration account for top management added", username=p[0])
        return
    journal.warn("seed", "nobody has the Top management role: company-level information is hidden from everyone until an "
                         "administrator assigns it (Administration > Users)")
    for u in users:
        if "admin" in uj(u["roles_json"], []) and not q1("SELECT 1 FROM notifications WHERE user_id=? AND title=?",
                                                         (u["id"], TOP_MANAGEMENT_NOTICE)):
            ex("INSERT INTO notifications(id, user_id, kind, title, body, link, created_at) VALUES(?,?,?,?,?,?,?)",
               (new_id(), u["id"], "admin_task", TOP_MANAGEMENT_NOTICE, TOP_MANAGEMENT_NOTICE_BODY, "/admin/users", now_iso()))


def run(ingest: bool = True) -> None:
    if seeded():
        return
    from .config import DEMO_MODE
    personas = [p for p in PERSONAS if DEMO_MODE or p[0] not in DEMO_ONLY]
    for p in personas:
        _insert_persona(p, DEMO_MODE)
    for dept, mgr in MANAGERS.items():
        uid = q1("SELECT id FROM users WHERE username=?", (mgr,))["id"]
        ex("INSERT OR IGNORE INTO departments(id, code, name, manager_user_id) VALUES(?,?,?,?)", (new_id(), dept, dept, uid))
    # on-call contacts are the employees themselves (no invented directory)
    for u in personas:
        ex("INSERT INTO contacts(id, name, dept, role, ext, on_call) VALUES(?,?,?,?,?,?)",
           (new_id(), u[1], u[3], u[2], "", int(u[0] in ON_CALL)))
    kept_tags = _example_tags()
    assets = json.loads((STRUCT / "assets.json").read_text(encoding="utf-8"))
    for a in assets:
        if a["tag"] not in kept_tags:
            continue
        ex("""INSERT OR REPLACE INTO assets(tag, name, unit, class, vendor, model, serial, location, owner_department, criticality, specs_json, is_example)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,1)""",
           (a["tag"], a["name"], a["unit"], a["class"], a.get("vendor"), a.get("model"), a.get("serial"), a.get("location"),
            DEPT_MAP.get(a.get("owner_department"), a.get("owner_department")), a.get("criticality"), j(a.get("specs", {}))))
        for al in {a["tag"], *a.get("specs", {}).get("aliases", [])}:
            ex("INSERT OR IGNORE INTO tag_alias(alias, tag) VALUES(?,?)", (al, a["tag"]))
        for it in a.get("items", []):
            ex("INSERT INTO ledger_items(id, tag, type, ref_no, issued_on, expires_on) VALUES(?,?,?,?,?,?)",
               (new_id(), a["tag"], it["type"], it.get("ref_no"), it.get("issued_on"), it.get("expires_on")))
    for extra in ["MCC-2-F07", "XV-2041", "XV-2042", "XV-2043", "FIC-101", "C-2F07-01"]:
        ex("INSERT OR IGNORE INTO tag_alias(alias, tag) VALUES(?,?)", (extra, extra))
    for w in json.loads((STRUCT / "work_orders.json").read_text(encoding="utf-8")):
        if w["tag"] in ("A2", "A2B", "M-A2"):  # only the work orders in the example WO export
            ex("INSERT OR REPLACE INTO work_orders VALUES(?,?,?,?,?,?,?,?,?,?)",
               (w["wo_no"], w["tag"], w["type"], w["opened_at"], w.get("closed_at"), w.get("failure_code"), w.get("cause"),
                w.get("action"), w.get("technician"), w["status"]))
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
    audit.write("system", "seed.completed", "demo", {"employees": len(personas), "example_documents": len(EXAMPLE_FILES)})
    if ingest:
        ingest_examples()
        seed_workflows()


def _manifest() -> list[dict]:
    return json.loads((CORPUS / "manifest.json").read_text(encoding="utf-8"))["documents"]


def _example_tags() -> set[str]:
    tags: set[str] = set()
    for d in _manifest():
        if d["file"] in EXAMPLE_FILES:
            tags.update(d.get("asset_tags", []))
    return tags


def ingest_examples(progress=None) -> None:  # type: ignore[no-untyped-def]
    todo = [d for d in _manifest() if d["file"] in EXAMPLE_FILES and (CORPUS / d["file"]).exists()]
    for i, d in enumerate(todo, start=1):
        if progress:
            progress(i - 1, len(todo), d.get("title") or d["file"])
        p = CORPUS / d["file"]
        if q1("SELECT 1 FROM documents WHERE file_name=? AND is_example=1 AND pages>0", (d["file"],)):
            continue  # already ingested (resumable first start)
        stale = q1("SELECT id FROM documents WHERE file_name=? AND is_example=1", (d["file"],))
        if stale:  # interrupted during a previous start: remove the half-ingested copy
            for c in q("SELECT id FROM chunks WHERE document_id=?", (stale["id"],)):
                ex("DELETE FROM chunks_fts WHERE chunk_id=?", (c["id"],))
            ex("DELETE FROM documents WHERE id=?", (stale["id"],))
        meta = {
            "title": "[EXAMPLE] " + (d.get("title") or p.stem), "doc_number": d.get("doc_number"), "revision": d.get("revision") or "",
            "status": d.get("status", "CURRENT"), "doc_type": d.get("doc_type", "other"),
            "department": DEPT_MAP.get(d.get("department", "Operations"), d.get("department")),
            "classification": CLEARANCE_BY_LABEL.get(d.get("classification", "INTERNAL"), 1),
            "effective_date": d.get("effective_date"), "supersedes": d.get("supersedes") if isinstance(d.get("supersedes"), str) else None,
            "asset_tags": d.get("asset_tags", []), "is_example": 1,
        }
        did = rag.create_document(meta, d["file"], p, "system")
        rag.ingest(did, None, "system")


def seed_workflows() -> None:
    doc = q1("SELECT id FROM documents WHERE doc_number='UT-E310-2026-07'")
    meera = q1("SELECT id FROM users WHERE username='rajesh.mm'")  # approver: HOD of the discipline
    if doc and meera and not q1("SELECT 1 FROM findings"):
        ex("""INSERT INTO findings(id, title, tag, discipline, severity, state, due_date, evidence, source_document_id, page, approver_id,
              history_json, created_at, is_example) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)""",
           (new_id(), "[EXAMPLE] E-310 shell wall thickness 6.1 mm below minimum 6.5 mm", "E-310", "Mechanical", "high", "PENDING",
            (date.today() + timedelta(days=7)).isoformat(), "UT reading at CML-4: 6.1 mm (min allowable 6.5 mm) — example scanned report p.1",
            doc["id"], 1, meera["id"], j([{"at": now_iso(), "event": "DETECTED", "by": "OCR pipeline (example document)"}]), now_iso()))
    refresh_alert_notifications()


def refresh_alert_notifications() -> None:
    today = date.today()
    soon = (today + timedelta(days=7)).isoformat()
    rows = q("""SELECT l.*, a.name, a.owner_department FROM ledger_items l JOIN assets a ON a.tag=l.tag
                WHERE l.expires_on <= ? ORDER BY l.expires_on""", (soon,))
    users = q("SELECT id, department, roles_json FROM users")
    for r in rows:
        days = (date.fromisoformat(r["expires_on"]) - today).days
        title = (f"[EXAMPLE] {r['tag']} {r['type']} EXPIRED {-days} day(s) ago" if days < 0
                 else f"[EXAMPLE] {r['tag']} {r['type']} expires in {days} day(s)")
        for u in users:
            if u["department"] in (r["owner_department"], "Health, Safety & Environment", "Instrumentation Maintenance") \
                    or "plant_manager" in u["roles_json"] or "admin" in u["roles_json"]:
                if not q1("SELECT 1 FROM notifications WHERE user_id=? AND title=?", (u["id"], title)):
                    ex("INSERT INTO notifications(id, user_id, kind, title, body, link, created_at) VALUES(?,?,?,?,?,?,?)",
                       (new_id(), u["id"], "expiry", title, f"{r['name']} · ref {r['ref_no']} · due {r['expires_on']}",
                        f"/assets?q={r['tag']}", now_iso()))
