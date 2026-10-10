"""Knowledge graph: links between assets, documents, procedures and plant records (graph-aware retrieval).

Edges are derived from the plant's own data, never guessed:
  asset    --documented_in-->  document   (asset tags of the document)
  asset    --procedure-->      document   (an SOP / troubleshooting guide tagged with the asset)
  document --supersedes-->     document   (an older revision of the same document number)
  document --references-->     document   (another document's number is written in its text, e.g. "per SOP-EL-014")
  asset    --related-->        asset      (both tags are named in the same passage, e.g. pump A2 and its feeder MCC-2-F07)
  asset    --work_order-->     wo:<no>    (CMMS)
  asset    --finding-->        finding:<id>
  asset    --ledger-->         ledger:<id>

Retrieval uses the graph after the policy check, never instead of it: a linked document is only added to the evidence
when the person may cite it.
"""
from __future__ import annotations

import re
from typing import Any

from .db import ex, q, uj

_DOCNUM = re.compile(r"\b([A-Z]{2,6}(?:-[A-Z0-9]{1,8}){1,4})\b")


def _add(src: str, rel: str, dst: str, source: str) -> None:
    if src and dst and src != dst:
        ex("INSERT OR IGNORE INTO kg_edges(src, rel, dst, source) VALUES(?,?,?,?)", (src, rel, dst, source))


def asset_node(tag: str) -> str:
    return f"asset:{tag}"


def doc_node(did: str) -> str:
    return f"doc:{did}"


def index_document(did: str) -> int:
    """(Re)build the edges of one document. Returns the number of edges it now has."""
    d = (q("SELECT * FROM documents WHERE id=?", (did,)) or [None])[0]
    if not d:
        return 0
    ex("DELETE FROM kg_edges WHERE source=?", (f"document:{did}",))
    src = f"document:{did}"
    tags = uj(d["asset_tags_json"], [])
    for t in tags:
        _add(asset_node(t), "documented_in", doc_node(did), src)
        if d["doc_type"] in ("SOP", "troubleshooting_guide"):
            _add(asset_node(t), "procedure", doc_node(did), src)
    if d["doc_number"]:
        for o in q("SELECT id, revision, status FROM documents WHERE doc_number=? AND id<>?", (d["doc_number"], did)):
            if d["status"] == "CURRENT" and o["status"] == "SUPERSEDED":
                _add(doc_node(did), "supersedes", doc_node(o["id"]), src)
            elif d["status"] == "SUPERSEDED" and o["status"] == "CURRENT":
                _add(doc_node(o["id"]), "supersedes", doc_node(did), src)
    numbers = {r["doc_number"]: r["id"] for r in q("SELECT doc_number, id FROM documents WHERE doc_number IS NOT NULL AND doc_number<>'' "
                                                     "AND status='CURRENT'")}
    for c in q("SELECT text, tags FROM chunks WHERE document_id=?", (did,)):
        for m in set(_DOCNUM.findall(c["text"] or "")):
            ref = numbers.get(m) or next((v for k, v in numbers.items() if k.startswith(m + "-") or m.startswith(k)), None)
            if ref and ref != did:
                _add(doc_node(did), "references", doc_node(ref), src)
        ctags = [t for t in (c["tags"] or "").split() if t]
        for a in ctags:
            for b in ctags:
                if a < b:
                    _add(asset_node(a), "related", asset_node(b), src)
                    _add(asset_node(b), "related", asset_node(a), src)
    return q("SELECT COUNT(*) n FROM kg_edges WHERE source=?", (src,))[0]["n"]


def index_records() -> None:
    """Edges from structured records: CMMS work orders, findings and the asset ledger."""
    ex("DELETE FROM kg_edges WHERE source='records'")
    for w in q("SELECT wo_no, tag FROM work_orders"):
        _add(asset_node(w["tag"]), "work_order", f"wo:{w['wo_no']}", "records")
    for f in q("SELECT id, tag, source_document_id, procedure_doc_id FROM findings"):
        _add(asset_node(f["tag"]), "finding", f"finding:{f['id']}", "records")
        if f["source_document_id"]:
            _add(f"finding:{f['id']}", "evidence", doc_node(f["source_document_id"]), "records")
        if f.get("procedure_doc_id"):
            _add(f"finding:{f['id']}", "procedure", doc_node(f["procedure_doc_id"]), "records")
    for li in q("SELECT id, tag FROM ledger_items"):
        _add(asset_node(li["tag"]), "ledger", f"ledger:{li['id']}", "records")


def rebuild() -> int:
    for d in q("SELECT id FROM documents"):
        index_document(d["id"])
    index_records()
    return q("SELECT COUNT(*) n FROM kg_edges")[0]["n"]


def neighbours(node: str, rels: tuple[str, ...] | None = None) -> list[dict[str, str]]:
    rows = q("SELECT src, rel, dst FROM kg_edges WHERE src=? OR dst=?", (node, node))
    return [r for r in rows if rels is None or r["rel"] in rels]


def linked_documents(tags: list[str]) -> dict[str, list[str]]:
    """Documents one hop from the asset tags, and documents those documents reference: {document_id: [why, ...]}.
    Related assets (named together in a passage) contribute their own documents at the second hop."""
    out: dict[str, list[str]] = {}

    def note(did: str, why: str) -> None:
        out.setdefault(did, [])
        if why not in out[did]:
            out[did].append(why)

    related = set()
    for t in tags:
        for e in neighbours(asset_node(t), ("documented_in", "procedure", "related")):
            if e["rel"] == "related" and e["src"] == asset_node(t):
                related.add(e["dst"][6:])
            elif e["dst"].startswith("doc:"):
                note(e["dst"][4:], f"{e['rel'].replace('_', ' ')} {t}")
    for did in list(out):
        for e in neighbours(doc_node(did), ("references",)):
            if e["src"] == doc_node(did):
                note(e["dst"][4:], "referenced by a linked document")
    for t in sorted(related - set(tags))[:4]:
        for e in neighbours(asset_node(t), ("documented_in",)):
            note(e["dst"][4:], f"documents {t} (related to {', '.join(tags)})")
    return out


def related_tags(tags: list[str]) -> list[str]:
    rel = {e["dst"][6:] for t in tags for e in neighbours(asset_node(t), ("related",)) if e["src"] == asset_node(t)}
    return sorted(rel - set(tags))


def stats() -> dict[str, Any]:
    by = {r["rel"]: r["n"] for r in q("SELECT rel, COUNT(*) n FROM kg_edges GROUP BY rel")}
    return {"edges": sum(by.values()), "by_relation": by}
