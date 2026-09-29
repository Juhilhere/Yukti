"""Public-domain MRPL intelligence: researched facts (with source URLs) stored offline, served to the UI,
seeded as the real department structure, and ingested as PUBLIC citable documents for chat."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from . import rag
from .config import DATA
from .db import ex, new_id, q, q1

MRPL_DIR = DATA / "mrpl"
TOPICS = ["corporate", "refinery", "products", "finance_esg"]
TITLES = {
    "corporate": ("MRPL-PUB-CORP", "MRPL public briefing — Corporate profile, organisation & leadership"),
    "refinery": ("MRPL-PUB-REF", "MRPL public briefing — Refinery configuration, process units & operations"),
    "products": ("MRPL-PUB-PROD", "MRPL public briefing — Products, specifications & marketing"),
    "finance_esg": ("MRPL-PUB-FIN", "MRPL public briefing — Financials, sustainability, digital & news"),
}


def load() -> dict[str, Any]:
    out: dict[str, Any] = {"retrieved_on": None}
    for t in TOPICS:
        p = MRPL_DIR / f"{t}.json"
        if p.exists():
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
                out[t] = d
                out["retrieved_on"] = out["retrieved_on"] or d.get("retrieved_on")
            except Exception:
                pass
    urls: set[str] = set()

    def walk(x: Any) -> None:
        if isinstance(x, dict):
            for k, v in x.items():
                if k in ("source_url", "evidence_url") and isinstance(v, str) and v.startswith("http"):
                    urls.add(v)
                else:
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(out)
    out["source_count"] = len(urls)
    out["source_domains"] = sorted({urlparse(u).netloc for u in urls})
    return out


def _approver_username(name: str, group: str) -> str:
    n = f"{name} {group}".lower()
    if re.search(r"audit|vigilance", n):  # independent functions never report to the departments they check
        return "ramesh.pm"
    if re.search(r"financ|account|treasur|tax|investor|secretar", n):
        return "kavita.fm"
    if re.search(r"electric|instrument", n):
        return "suresh.em"
    return "ramesh.pm"


def ensure_departments() -> None:
    cols = {r["name"] for r in q("PRAGMA table_info(departments)")}
    for c in ("grp", "description", "short_code", "evidence_url"):
        if c not in cols:
            ex(f"ALTER TABLE departments ADD COLUMN {c} TEXT")
    corp = load().get("corporate") or {}
    for d in corp.get("departments", []):
        name = (d.get("name") or "").strip()
        if not name:
            continue
        mgr = q1("SELECT id FROM users WHERE username=?", (_approver_username(name, d.get("group", "")),))
        if q1("SELECT 1 FROM departments WHERE code=?", (name,)):
            ex("UPDATE departments SET grp=?, description=?, short_code=?, evidence_url=? WHERE code=?",
               (d.get("group"), d.get("description"), d.get("code"), d.get("evidence_url"), name))
        else:
            ex("INSERT INTO departments(id, code, name, manager_user_id, grp, description, short_code, evidence_url) VALUES(?,?,?,?,?,?,?,?)",
               (new_id(), name, name, mgr["id"] if mgr else None, d.get("group"), d.get("description"), d.get("code"), d.get("evidence_url")))
    # internal (demo) departments keep working; give them a group
    for r in q("SELECT code FROM departments WHERE grp IS NULL"):
        ex("UPDATE departments SET grp='Other' WHERE code=?", (r["code"],))


def departments() -> list[dict[str, Any]]:
    rows = q("""SELECT d.code, d.name, d.grp, d.description, d.short_code, d.evidence_url, u.display_name manager_name
                FROM departments d LEFT JOIN users u ON u.id=d.manager_user_id ORDER BY d.grp, d.name""")
    return [{"code": r["short_code"] or r["code"], "name": r["name"], "group": r["grp"] or "Other",
             "description": r["description"] or "", "manager_name": r["manager_name"], "evidence_url": r["evidence_url"]} for r in rows]


def ensure_public_docs() -> int:
    """Ingest each researched briefing (.md) as a PUBLIC document so chat can cite it. Idempotent by sha256."""
    n = 0
    for t in TOPICS:
        p = MRPL_DIR / f"{t}.md"
        if not p.exists():
            continue
        doc_number, title = TITLES[t]
        data = p.read_bytes()
        import hashlib
        sha = hashlib.sha256(data).hexdigest()
        cur = q1("SELECT id, sha256 FROM documents WHERE doc_number=?", (doc_number,))
        if cur and cur["sha256"] == sha:
            continue
        if cur:
            for c in q("SELECT id FROM chunks WHERE document_id=?", (cur["id"],)):
                ex("DELETE FROM chunks_fts WHERE chunk_id=?", (c["id"],))
            ex("DELETE FROM documents WHERE id=?", (cur["id"],))
        meta = {"title": title, "doc_number": doc_number, "revision": (load().get("retrieved_on") or "2026-09-29"),
                "status": "CURRENT", "doc_type": "public_briefing", "department": "Corporate Branding & Corporate Communication",
                "classification": 0, "effective_date": load().get("retrieved_on"), "asset_tags": [], "is_public": 1}
        did = rag.create_document(meta, f"{doc_number}.txt", data, "system")
        rag.ingest(did, None, "system")
        n += 1
    return n
