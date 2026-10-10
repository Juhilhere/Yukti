"""Approver lanes, escalation and follow-up for findings and approval notes.

Electrical, mechanical, HSE, procurement, finance and management decisions have different approvers. A finding goes to
its lane's approver; Yukti tracks acknowledgement, escalates when nobody acknowledges in time, and follows up when the
due date passes. Escalation climbs: lane approver -> department HOD -> refinery management -> top management.
"""
from __future__ import annotations

import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .db import ex, j, now_iso, q, q1, uj

LANES: dict[str, dict[str, str]] = {
    "electrical": {"label": "Electrical", "department": "Electrical Maintenance"},
    "mechanical": {"label": "Mechanical", "department": "Mechanical Maintenance"},
    "hse": {"label": "HSE", "department": "Health, Safety & Environment"},
    "procurement": {"label": "Procurement", "department": "Materials Management"},
    "finance": {"label": "Finance", "department": "Finance & Accounts"},
    "management": {"label": "Management", "department": "MD Office"},
}
# disciplines without a lane of their own are decided by their department's HOD
DISCIPLINE_LANE = {"electrical": "electrical", "instrumentation": "electrical", "mechanical": "mechanical", "static": "mechanical",
                   "rotating": "mechanical", "hse": "hse", "safety": "hse", "fire": "hse", "procurement": "procurement",
                   "stores": "procurement", "finance": "finance", "commercial": "finance", "management": "management"}
ACK_HOURS = {"high": 24, "medium": 72, "low": 168}


def lane_for(discipline: str | None) -> str:
    return DISCIPLINE_LANE.get((discipline or "").lower(), (discipline or "management").lower())


def _active_users() -> list[dict[str, Any]]:
    return q("SELECT id, username, display_name, department, roles_json FROM users WHERE status='active' ORDER BY created_at")


def approver_for(lane: str, department: str | None = None) -> str | None:
    """The lane's approver: a holder of approver:<lane> (in the department first), else the department HOD, else management."""
    users = _active_users()
    role = f"approver:{lane}"
    dept = department or LANES.get(lane, {}).get("department")
    hit = next((u for u in users if role in uj(u["roles_json"], []) and u["department"] == dept), None) \
        or next((u for u in users if role in uj(u["roles_json"], [])), None)
    if hit:
        return hit["id"]
    d = q1("SELECT manager_user_id FROM departments WHERE code=?", (dept,)) if dept else None
    if d and d["manager_user_id"]:
        return d["manager_user_id"]
    return management()


def management() -> str | None:
    for u in _active_users():
        if "plant_manager" in uj(u["roles_json"], []):
            return u["id"]
    return None


def top_management() -> str | None:
    for u in _active_users():
        r = uj(u["roles_json"], [])
        if "approver:management" in r or "executive" in r:
            return u["id"]
    return None


def next_approver(current_id: str | None, department: str | None) -> str | None:
    """One level up the chain (department HOD -> refinery management -> top management) from whoever holds it now."""
    hod = (q1("SELECT manager_user_id FROM departments WHERE code=?", (department,)) or {}).get("manager_user_id") if department else None
    chain = [u for u in (hod, management(), top_management()) if u]
    start = chain.index(current_id) + 1 if current_id in chain else 0
    return next((u for u in chain[start:] if u != current_id), current_id)


def _hours_since(iso: str | None) -> float:
    if not iso:
        return 1e9
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds() / 3600
    except ValueError:
        return 1e9


def follow_up(now: date | None = None) -> dict[str, int]:
    """Escalate unacknowledged findings past their acknowledgement time; remind about overdue ones (at most daily)."""
    from .auth import notify
    from . import audit
    today = now or date.today()
    escalated = reminded = 0
    for f in q("SELECT * FROM findings WHERE state IN ('PENDING','ACKNOWLEDGED','ESCALATED')"):
        hist = uj(f["history_json"], [])
        if f["state"] == "PENDING" and _hours_since(f["created_at"]) > ACK_HOURS.get((f["severity"] or "medium").lower(), 72) \
                and not any(h.get("event") == "AUTO-ESCALATED" for h in hist):
            to = next_approver(f["approver_id"], f.get("owner_department"))
            if to and to != f["approver_id"]:
                hist.append({"at": now_iso(), "event": "AUTO-ESCALATED", "by": "Yukti follow-up",
                             "note": f"Not acknowledged within {ACK_HOURS.get((f['severity'] or 'medium').lower(), 72)} h"})
                ex("UPDATE findings SET state='ESCALATED', approver_id=?, history_json=?, last_follow_up_at=? WHERE id=?",
                   (to, j(hist), now_iso(), f["id"]))
                notify(to, "escalation", f"Escalated finding: {f['title']}", "Not acknowledged in time by the lane approver.", "/inbox")
                audit.write("system", "finding.auto_escalated", f"finding:{f['id']}", {"to": to})
                escalated += 1
                continue
        if f["due_date"] and f["due_date"] < today.isoformat() and _hours_since(f.get("last_follow_up_at")) >= 24:
            for uid in {f["approver_id"], (q1("SELECT manager_user_id FROM departments WHERE code=?", (f.get("owner_department"),)) or {}).get("manager_user_id")}:
                if uid:
                    notify(uid, "follow_up", f"Overdue finding: {f['title']}", f"Due {f['due_date']}. Decide or escalate.", "/inbox")
            ex("UPDATE findings SET last_follow_up_at=? WHERE id=?", (now_iso(), f["id"]))
            audit.write("system", "finding.follow_up", f"finding:{f['id']}", {"due_date": f["due_date"]})
            reminded += 1
    return {"escalated": escalated, "reminded": reminded}


def start_sweeper(interval_s: int = 3600) -> None:
    def loop() -> None:
        while True:
            try:
                follow_up()
            except Exception as e:  # noqa: BLE001
                from . import journal
                journal.swallowed("lanes", "finding follow-up", e)
            time.sleep(interval_s)
    threading.Thread(target=loop, daemon=True, name="finding-follow-up").start()


def due_in(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()
