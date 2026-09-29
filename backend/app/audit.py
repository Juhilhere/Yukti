"""Tamper-evident, hash-chained, append-only audit log."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from .db import db, now_iso, q, q1

GENESIS = "0" * 64


def _canon(d: dict[str, Any]) -> str:
    return json.dumps(d, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def write(actor: str, event: str, entity: str = "", detail: dict[str, Any] | None = None) -> None:
    """Append one audit record. Uses its own short transaction (BEGIN IMMEDIATE serialises writers)."""
    c = db()
    in_tx = c.in_transaction
    if not in_tx:
        c.execute("BEGIN IMMEDIATE")
    try:
        last = c.execute("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1").fetchone()
        prev = last["hash"] if last else GENESIS
        seq = (last["seq"] + 1) if last else 1
        at = now_iso()
        body = {"seq": seq, "at": at, "actor": actor, "event": event, "entity": entity, "detail": detail or {}}
        h = hashlib.sha256((prev + _canon(body)).encode()).hexdigest()
        c.execute(
            "INSERT INTO audit_log(seq, at, actor, event, entity, detail_json, prev_hash, hash) VALUES(?,?,?,?,?,?,?,?)",
            (seq, at, actor, event, entity, _canon(detail or {}), prev, h),
        )
        if not in_tx:
            c.execute("COMMIT")
    except Exception:
        if not in_tx:
            c.execute("ROLLBACK")
        raise


def verify() -> dict[str, Any]:
    prev = GENESIS
    count = 0
    for r in q("SELECT * FROM audit_log ORDER BY seq"):
        body = {"seq": r["seq"], "at": r["at"], "actor": r["actor"], "event": r["event"], "entity": r["entity"],
                "detail": json.loads(r["detail_json"] or "{}")}
        h = hashlib.sha256((prev + _canon(body)).encode()).hexdigest()
        if r["prev_hash"] != prev or r["hash"] != h:
            return {"ok": False, "count": count, "broken_at": r["seq"], "head": prev}
        prev = h
        count += 1
    return {"ok": True, "count": count, "head": prev}


def head() -> str:
    r = q1("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1")
    return r["hash"] if r else GENESIS
