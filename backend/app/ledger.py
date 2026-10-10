"""Digital asset ledger: everything purchased or installed, and the alerts before anything lapses.

Each ledger entry records vendor, serial number, location, owner, certificate, inspection interval, warranty and expiry.
A fire extinguisher, a calibration record, a pressure-vessel inspection, a safety device, a spare with a shelf life or a
software licence raises an alert before it expires; each category has its own lead time (an entry may set its own).
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from .db import ex, new_id, now_iso, q, q1

CATEGORIES: dict[str, dict[str, Any]] = {
    "fire_extinguisher": {"label": "Fire extinguisher", "alert_days": 30, "interval_months": 12},
    "calibration": {"label": "Calibration record", "alert_days": 30, "interval_months": 12},
    "pressure_vessel_inspection": {"label": "Pressure-vessel inspection", "alert_days": 60, "interval_months": 24},
    "safety_device": {"label": "Safety device (PSV, gas detector, SCBA)", "alert_days": 30, "interval_months": 12},
    "spare": {"label": "Spare part (shelf life)", "alert_days": 45, "interval_months": None},
    "licence": {"label": "Licence or statutory permit", "alert_days": 45, "interval_months": 12},
    "certificate": {"label": "Certificate", "alert_days": 30, "interval_months": 12},
    "warranty": {"label": "Warranty", "alert_days": 30, "interval_months": None},
}
DEFAULT_ALERT_DAYS = 30


def guess_category(item_type: str | None) -> str:
    t = (item_type or "").lower()
    for key, words in (("fire_extinguisher", ("extinguisher",)), ("calibration", ("calib",)),
                       ("pressure_vessel_inspection", ("pressure vessel", "pv inspection", "ut ", "thickness", "statutory inspection")),
                       ("safety_device", ("psv", "relief", "detector", "scba", "safety")), ("licence", ("licen", "permit", "peso")),
                       ("warranty", ("warrant",)), ("spare", ("spare", "shelf"))):
        if any(w.lower() in t for w in words):
            return key
    return "certificate"


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    y += d.year
    m += 1
    import calendar
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def alert_days(it: dict[str, Any]) -> int:
    if it.get("alert_days"):
        return int(it["alert_days"])
    return int(CATEGORIES.get(it.get("category") or guess_category(it.get("type")), {}).get("alert_days") or DEFAULT_ALERT_DAYS)


def item_out(it: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    dl = (date.fromisoformat(it["expires_on"]) - today).days if it.get("expires_on") else None
    lead = alert_days(it)
    st = "expired" if dl is not None and dl < 0 else "amber" if dl is not None and dl <= lead else "green"
    wl = (date.fromisoformat(it["warranty_until"]) - today).days if it.get("warranty_until") else None
    cat = it.get("category") or guess_category(it.get("type"))
    return {"id": it.get("id"), "type": it["type"], "category": cat, "category_label": CATEGORIES.get(cat, {}).get("label", cat),
            "ref_no": it.get("ref_no"), "issued_on": it.get("issued_on"), "expires_on": it.get("expires_on"), "days_left": dl,
            "status": st, "alert_days": lead, "vendor": it.get("vendor"), "serial": it.get("serial"), "location": it.get("location"),
            "owner": it.get("owner"), "certificate": it.get("certificate"), "interval_months": it.get("interval_months"),
            "warranty_until": it.get("warranty_until"), "warranty_days_left": wl}


def items(tag: str) -> list[dict[str, Any]]:
    return [item_out(it) for it in q("SELECT * FROM ledger_items WHERE tag=? ORDER BY expires_on", (tag,))]


def due_items(horizon_days: int | None = None) -> list[dict[str, Any]]:
    """Entries whose expiry or warranty end falls inside their alert window (or the given horizon), soonest first."""
    today = date.today()
    out = []
    for r in q("""SELECT l.*, a.name, a.unit, a.owner_department FROM ledger_items l JOIN assets a ON a.tag=l.tag
                  ORDER BY l.expires_on"""):
        it = item_out(r, today)
        window = horizon_days if horizon_days is not None else it["alert_days"]
        hit_exp = it["days_left"] is not None and it["days_left"] <= window
        hit_war = it["warranty_days_left"] is not None and 0 <= it["warranty_days_left"] <= window
        if hit_exp or hit_war:
            out.append({**it, "tag": r["tag"], "name": r["name"], "unit": r["unit"], "owner_department": r["owner_department"],
                        "what": "expiry" if hit_exp else "warranty"})
    return out


def validate_item(body: dict[str, Any]) -> dict[str, Any]:
    cat = body.get("category") or guess_category(body.get("type"))
    if cat not in CATEGORIES:
        raise ValueError(f"Unknown ledger category '{cat}'.")
    typ = str(body.get("type") or CATEGORIES[cat]["label"]).strip()[:120]
    out: dict[str, Any] = {"category": cat, "type": typ}
    for k in ("ref_no", "vendor", "serial", "location", "owner", "certificate"):
        v = body.get(k)
        out[k] = str(v).strip()[:200] if v not in (None, "") else None
    for k in ("issued_on", "expires_on", "warranty_until"):
        v = body.get(k)
        if v in (None, ""):
            out[k] = None
            continue
        try:
            out[k] = date.fromisoformat(str(v)[:10]).isoformat()
        except ValueError:
            raise ValueError(f"{k}: '{v}' is not a date (YYYY-MM-DD).")
    for k in ("interval_months", "alert_days"):
        v = body.get(k)
        if v in (None, ""):
            out[k] = None
            continue
        try:
            n = int(v)
        except (TypeError, ValueError):
            raise ValueError(f"{k} must be a whole number.")
        if not 1 <= n <= (240 if k == "interval_months" else 365):
            raise ValueError(f"{k} is out of range.")
        out[k] = n
    if out["interval_months"] is None:
        out["interval_months"] = CATEGORIES[cat]["interval_months"]
    if not out["expires_on"] and out["issued_on"] and out["interval_months"]:  # next due date from the inspection interval
        out["expires_on"] = add_months(date.fromisoformat(out["issued_on"]), int(out["interval_months"])).isoformat()
    if not out["expires_on"] and not out["warranty_until"]:
        raise ValueError("Give an expiry date, an issue date with an inspection interval, or a warranty end date.")
    return out


def add_item(tag: str, body: dict[str, Any], actor: str) -> dict[str, Any]:
    it = validate_item(body)
    iid = new_id()
    ex("""INSERT INTO ledger_items(id, tag, type, ref_no, issued_on, expires_on, category, vendor, serial, location, owner, certificate,
          interval_months, warranty_until, alert_days, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
       (iid, tag, it["type"], it["ref_no"], it["issued_on"], it["expires_on"], it["category"], it["vendor"], it["serial"],
        it["location"], it["owner"], it["certificate"], it["interval_months"], it["warranty_until"], it["alert_days"], actor, now_iso()))
    from . import graph
    graph.index_records()
    return item_out(q1("SELECT * FROM ledger_items WHERE id=?", (iid,)))


def renew(iid: str, body: dict[str, Any]) -> dict[str, Any]:
    """Record a new inspection / certificate: the next due date follows from the interval unless given."""
    it = q1("SELECT * FROM ledger_items WHERE id=?", (iid,))
    if not it:
        raise LookupError("Ledger entry not found.")
    issued = str(body.get("issued_on") or date.today().isoformat())[:10]
    try:
        d0 = date.fromisoformat(issued)
    except ValueError:
        raise ValueError(f"issued_on: '{issued}' is not a date (YYYY-MM-DD).")
    exp = body.get("expires_on")
    if not exp:
        months = int(it.get("interval_months") or CATEGORIES.get(it.get("category") or "", {}).get("interval_months") or 12)
        exp = add_months(d0, months).isoformat()
    ex("UPDATE ledger_items SET issued_on=?, expires_on=?, ref_no=COALESCE(?, ref_no), certificate=COALESCE(?, certificate) WHERE id=?",
       (d0.isoformat(), str(exp)[:10], body.get("ref_no") or None, body.get("certificate") or None, iid))
    return item_out(q1("SELECT * FROM ledger_items WHERE id=?", (iid,)))


def expiring_for(subject: Any, days: int = 60) -> list[dict[str, Any]]:
    """What the analytics worker answers "what expires soon?" with: entries visible to this person, soonest first."""
    from . import scope
    return [r for r in due_items(days) if scope.asset_visible(subject, {"tag": r["tag"], "unit": r["unit"],
                                                                         "owner_department": r["owner_department"]})]


def register_asset(body: dict[str, Any]) -> dict[str, Any]:
    tag = str(body.get("tag") or "").strip().upper()
    if not tag or len(tag) > 40:
        raise ValueError("Asset tag is required (at most 40 characters).")
    if q1("SELECT 1 FROM assets WHERE tag=?", (tag,)):
        raise FileExistsError(f"Asset {tag} already exists.")
    name = str(body.get("name") or "").strip()
    if not name:
        raise ValueError("Asset name is required.")
    vals = {k: (str(body.get(k)).strip()[:200] if body.get(k) not in (None, "") else None)
            for k in ("unit", "class", "vendor", "model", "serial", "location", "owner_department", "criticality")}
    ex("""INSERT INTO assets(tag, name, unit, class, vendor, model, serial, location, owner_department, criticality, specs_json, is_example)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,0)""",
       (tag, name[:200], vals["unit"], vals["class"], vals["vendor"], vals["model"], vals["serial"], vals["location"],
        vals["owner_department"], vals["criticality"], "{}"))
    ex("INSERT OR IGNORE INTO tag_alias(alias, tag) VALUES(?,?)", (tag, tag))
    return q1("SELECT * FROM assets WHERE tag=?", (tag,)) or {}


def next_window(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()
