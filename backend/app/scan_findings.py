"""Scan to finding: a scanned inspection report becomes a verified finding, an approval note and an approver's task.

1. OCR reads text, tables, dates, serial numbers and equipment tags, with the position of every line on the page.
2. A vision-language model (when one is loaded) looks at what OCR cannot read: stamps, signatures, layout, drawing
   symbols and safety markings.
3. Fields are extracted (report number, dates, tag, serial, make/model, thickness readings, valve pressures, results).
4. A verification step compares them with the asset master (tag, unit, serial, model, design limits, ledger due date).
5. Low-confidence fields and mismatches go to a human reviewer before anything is raised.
6. The finding is linked to the asset, the applicable procedure, the discipline owner, a due date and the evidence
   region on the page; Yukti drafts the approval note (.docx) and routes it to the lane's approver.

Nothing is guessed: when a value cannot be read, it is asked for, not invented.
"""
from __future__ import annotations

import base64
import io
import json
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from . import audit, deliverables, graph, lanes, rag, workqueue
from .db import ex, j, new_id, now_iso, q, q1, uj

REVIEW_BELOW = 0.90          # OCR confidence under which a field that matters is checked by a person
DUE_DAYS = {"high": 7, "medium": 30, "low": 90}
OWNER_DISCIPLINE = {"Mechanical Maintenance": "mechanical", "Electrical Maintenance": "electrical",
                    "Instrumentation Maintenance": "instrumentation", "Health, Safety & Environment": "hse",
                    "Operations (Production)": "operations", "Process Engineering": "process",
                    "Captive Power Plants & Utilities": "utilities"}
STEPS = ["OCR: text, tables, dates, serials, tags", "Vision model: stamps, layout, symbols, markings", "Extract fields",
         "Verify against the asset master", "Human review of uncertain fields", "Raise finding with evidence region",
         "Draft approval note", "Route to approver lane"]


# ------------------------------------------------------------------ OCR with positions
def page_images(doc: dict[str, Any], max_pages: int = 6) -> list[tuple[int, Any]]:
    from PIL import Image
    path = Path(doc["file_path"])
    if path.suffix.lower() == ".pdf":
        import pypdfium2 as pdfium
        with rag._PDFIUM_LOCK:
            pdf = pdfium.PdfDocument(str(path))
            return [(i + 1, pdf[i].render(scale=2.2).to_pil().convert("RGB")) for i in range(min(len(pdf), max_pages))]
    im = Image.open(path)
    return [(1, im.convert("RGB"))]


def ocr_rows(img: Any) -> list[dict[str, Any]]:
    """OCR boxes grouped into lines (scans are often skewed: a box joins a line when it is close to the line's last box)."""
    import numpy as np
    with rag._OCR_LOCK:
        res, _ = rag.ocr_engine()(np.array(img))
    if not res:
        return []
    w, h = img.size
    tol = 0.009 * h
    boxes = sorted(({"x0": min(p[0] for p in b), "y0": min(p[1] for p in b), "x1": max(p[0] for p in b), "y1": max(p[1] for p in b),
                     "text": str(t), "conf": float(s)} for b, t, s in res), key=lambda b: b["y0"])
    rows: list[list[dict[str, Any]]] = []
    for b in boxes:
        if rows and b["y0"] - rows[-1][-1]["y0"] <= tol:
            rows[-1].append(b)
        else:
            rows.append([b])
    out = []
    for r in rows:
        r.sort(key=lambda b: b["x0"])
        x0, y0, x1, y1 = min(b["x0"] for b in r), min(b["y0"] for b in r), max(b["x1"] for b in r), max(b["y1"] for b in r)
        out.append({"cells": [b["text"] for b in r], "text": " ".join(b["text"] for b in r), "conf": min(b["conf"] for b in r),
                    "region": {"x": round(x0 / w, 4), "y": round(y0 / h, 4), "w": round((x1 - x0) / w, 4), "h": round((y1 - y0) / h, 4)}})
    return out


def _norm(s: str) -> str:
    return re.sub(r"[\s_]+", "", s).lower().replace("（", "(").replace("）", ")")


def _num(s: str | None) -> float | None:
    m = re.search(r"-?\d+(?:\.\d+)?", s or "")
    return float(m.group(0)) if m else None


# ------------------------------------------------------------------ field extraction
LABELS = [  # field, normalised label pattern (spaces removed), value pattern
    ("tag_no", r"^(?:tagno|equipmenttag|tag)[:.]?", r"([A-Z]{1,4}-?[0-9]{1,4}[A-Z]?)"),
    ("equipment", r"^equipment[:.]?", r"([A-Z]{1,4}-?[0-9]{1,4}[A-Z]?)"),
    ("report_no", r"(?:reportno|certificateno)[:.]?", r"([A-Z0-9][A-Z0-9/\-.]{3,})"),
    ("inspection_date", r"(?:dateofsurvey|dateofinspection|calibrationdate|inspectiondate)[:.]?", r"(\d{4}-\d{2}-\d{2})"),
    ("next_due", r"(?:nextduedate|nextdue|duedate)[:.]?", r"(\d{4}-\d{2}-\d{2})"),
    ("serial", r"(?:serialno|serialnumber|sr\.?no)[:.]?", r"([A-Z0-9][A-Z0-9\-]{3,})"),
    ("make_model", r"make/?model[:.]?", r"(.{3,})"),
    ("nominal_mm", r"nominalthickness[:.]?", r"(\d+(?:\.\d+)?)"),
    ("min_required_mm", r"minimum(?:required)?thickness[:.]?", r"(\d+(?:\.\d+)?)"),
    ("set_pressure_barg", r"setpressure(?:\(cdtp\))?[:.]?", r"(\d+(?:\.\d+)?)"),
    ("pop_pressure_barg", r"poppressure(?:observed)?[:.]?", r"(\d+(?:\.\d+)?)"),
    ("reseat_pressure_barg", r"reseatpressure[:.]?", r"(\d+(?:\.\d+)?)"),
    ("seat_leakage", r"seatleakage(?:test)?[:.]?", r"(.{3,})"),
    ("inspector", r"(?:inspector|testedby)[:.]?", r"(.{3,})"),
    ("unit", r"(?:customer|exampleplant|plant)[:.\-]?", r".*?((?:CDU|VDU|HCU|SRU|NHT|CCR|UTIL)-?\d*)"),
]


def extract_fields(rows: list[dict[str, Any]], page_no: int) -> dict[str, Any]:
    """Labelled values and thickness-table rows. A label and its value may be two boxes of one line (`: value`)."""
    fields: dict[str, dict[str, Any]] = {}
    tml: list[dict[str, Any]] = []
    for r in rows:
        line = " ".join(r["cells"])
        flat = _norm(line)
        for name, lab, val in LABELS:
            if name in fields:
                continue
            m = re.search(lab, flat)
            if not m:
                continue
            # value from the original text after the label (keeps spaces in names), else from the flattened text
            rest_flat = flat[m.end():].lstrip(":.- ")
            rest_raw = re.split(r":", line, maxsplit=1)[1].strip() if ":" in line else line
            if name in ("report_no", "inspection_date", "next_due", "serial", "tag_no", "equipment"):
                mv = re.search(val, rest_flat.upper()) or re.search(val, rest_raw.upper())
                v = mv.group(1) if mv else None
                if v and name == "report_no":
                    v = v.split("DATE")[0]
            elif name in ("make_model", "seat_leakage", "inspector"):
                v = rest_raw.split("  ")[0].strip(" :") or None
            elif name == "unit":
                mv = re.search(val, line, re.I)
                v = mv.group(1).upper() if mv else None
            else:
                mv = re.search(val, rest_flat)
                v = mv.group(1) if mv else None
            if v:
                fields[name] = {"value": v.strip(), "confidence": round(r["conf"], 3), "region": r["region"], "page": page_no}
        if re.match(r"tml-?\d+", flat) and len(r["cells"]) >= 4:
            nums = [c for c in r["cells"][1:] if re.fullmatch(r"\d+(?:\.\d+)?", c.strip())]
            remark = r["cells"][-1] if not re.fullmatch(r"\d+(?:\.\d+)?", r["cells"][-1].strip()) else ""
            loc = next((c for c in r["cells"][1:] if not re.fullmatch(r"\d+(?:\.\d+)?", c.strip()) and c != remark), "")
            if len(nums) >= 1:
                tml.append({"point": re.sub(r"(?i)^tml-?", "TML-", r["cells"][0]).upper(), "location": loc,
                            "previous_mm": float(nums[0]) if len(nums) > 1 else None, "current_mm": float(nums[-1]),
                            "remark": remark, "confidence": round(r["conf"], 3), "region": r["region"], "page": page_no})
    return {"fields": fields, "tml": tml}


def _tags(text: str) -> list[str]:
    return rag.detect_tags(text)


# ------------------------------------------------------------------ vision model
async def look(img: Any) -> dict[str, Any]:
    """What OCR cannot read, from the vision model: stamps, signatures, markings, symbols. Skipped without one."""
    from . import engine
    if not engine.vision_ready():
        return {"used": False, "note": "No vision model is loaded: OCR only (stamps and markings not checked)."}
    im = img.copy()
    im.thumbnail((1280, 1280))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    prompt = ("This is a scanned industrial inspection document. Reply with JSON only: "
              '{"stamps": [text of each stamp], "signature_present": true/false, "handwriting": [legible handwritten notes], '
              '"safety_markings": [..], "drawing_symbols": [..], "photographs": true/false, "layout": "short description"}. '
              "Report only what is visible; use empty lists when there is nothing.")
    try:
        txt = await engine.complete_once([{"role": "user", "content": prompt, "images": [base64.b64encode(buf.getvalue()).decode()]}],
                                         {"temperature": 0, "max_tokens": 300})
        m = re.search(r"\{.*\}", txt, re.S)
        data = json.loads(m.group(0)) if m else {}
        return {"used": True, "model": engine.state.model_name, **{k: data.get(k) for k in
                ("stamps", "signature_present", "handwriting", "safety_markings", "drawing_symbols", "photographs", "layout")}}
    except Exception as e:  # noqa: BLE001
        return {"used": False, "note": f"Vision model did not return a usable reading ({type(e).__name__})."}


# ------------------------------------------------------------------ verification and finding rules
def verify(fields: dict[str, Any], tml: list[dict[str, Any]], asset: dict[str, Any] | None, tag: str | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def add(check: str, ok: bool | None, detail: str, field: str | None = None, expected: Any = None) -> None:
        out.append({"check": check, "result": "match" if ok else ("not checked" if ok is None else "MISMATCH"), "detail": detail,
                    "field": field, "expected": expected})

    if not tag:
        add("Equipment tag", False, "No known equipment tag is readable on the scan.", "tag")
        return out
    add("Equipment tag in asset master", bool(asset), f"{tag} {'found' if asset else 'not in the asset master'}", "tag")
    if not asset:
        return out
    specs = uj(asset.get("specs_json"), {})
    if "unit" in fields:
        add("Plant unit", fields["unit"]["value"] == (asset.get("unit") or ""), f"scan {fields['unit']['value']} / master {asset.get('unit')}",
            "unit", asset.get("unit"))
    if "serial" in fields:
        add("Serial number", _norm(fields["serial"]["value"]) == _norm(asset.get("serial") or ""),
            f"scan {fields['serial']['value']} / master {asset.get('serial')}", "serial", asset.get("serial"))
    if "make_model" in fields:
        mm = _norm(fields["make_model"]["value"])
        vendor_ok = bool(asset.get("vendor")) and _norm(asset["vendor"]) in mm
        model_ok = bool(asset.get("model")) and _norm(asset["model"]) in mm
        add("Make / model", vendor_ok and model_ok,
            f"scan '{fields['make_model']['value']}' / master {asset.get('vendor')} {asset.get('model')}"
            + ("" if model_ok else " (model differs)"), "make_model", f"{asset.get('vendor')} {asset.get('model')}")
    if "min_required_mm" in fields and specs.get("shell_min_thk_mm") is not None:
        add("Minimum thickness (design)", abs(float(fields["min_required_mm"]["value"]) - float(specs["shell_min_thk_mm"])) < 1e-6,
            f"scan {fields['min_required_mm']['value']} mm / master {specs['shell_min_thk_mm']} mm", "min_required_mm", specs["shell_min_thk_mm"])
    if "set_pressure_barg" in fields and specs.get("set_pressure_barg") is not None:
        add("Set pressure (design)", abs(float(fields["set_pressure_barg"]["value"]) - float(specs["set_pressure_barg"])) < 1e-6,
            f"scan {fields['set_pressure_barg']['value']} barg / master {specs['set_pressure_barg']} barg", "set_pressure_barg",
            specs["set_pressure_barg"])
    if "next_due" in fields:
        led = q1("SELECT * FROM ledger_items WHERE tag=? AND (category='calibration' OR lower(type) LIKE '%calib%') ORDER BY expires_on DESC",
                 (tag,))
        if led:
            add("Ledger due date", led["expires_on"] == fields["next_due"]["value"],
                f"scan {fields['next_due']['value']} / ledger {led['expires_on']}", "next_due", led["expires_on"])
    return out


def detect(fields: dict[str, Any], tml: list[dict[str, Any]], tag: str, today: date | None = None) -> dict[str, Any] | None:
    """The most severe finding on the report, or None. Rules are deterministic; the reading is quoted, never rephrased."""
    today = today or date.today()
    minreq = _num((fields.get("min_required_mm") or {}).get("value"))
    if minreq is not None and tml:
        below = [t for t in tml if t["current_mm"] < minreq]
        if below:
            w = min(below, key=lambda t: t["current_mm"])
            return {"title": f"{tag} wall thickness {w['current_mm']} mm below minimum {minreq} mm at {w['point']}",
                    "severity": "high", "evidence": f"{w['point']} ({w['location']}): {w['current_mm']} mm, minimum required {minreq} mm"
                    + (f", previous {w['previous_mm']} mm" if w.get("previous_mm") is not None else ""),
                    "region": w["region"], "page": w["page"], "basis": [w]}
        watch = [t for t in tml if re.search(r"monitor", t.get("remark") or "", re.I)]
        if watch:
            w = watch[0]
            return {"title": f"{tag} wall thickness to monitor at {w['point']} ({w['current_mm']} mm)", "severity": "low",
                    "evidence": f"{w['point']}: {w['current_mm']} mm, remark '{w['remark']}'", "region": w["region"], "page": w["page"], "basis": [w]}
    leak = fields.get("seat_leakage")
    if leak and re.search(r"fail|leak(?:ing|s)\b|reject", leak["value"], re.I) and not re.search(r"pass", leak["value"], re.I):
        return {"title": f"{tag} seat leakage test failed", "severity": "high", "evidence": f"Seat leakage test: {leak['value']}",
                "region": leak["region"], "page": leak["page"], "basis": [leak]}
    sp, pop = _num((fields.get("set_pressure_barg") or {}).get("value")), _num((fields.get("pop_pressure_barg") or {}).get("value"))
    if sp and pop and abs(pop - sp) / sp > 0.03:
        f = fields["pop_pressure_barg"]
        return {"title": f"{tag} popped at {pop} barg, {abs(pop - sp) / sp:.0%} from set pressure {sp} barg", "severity": "high",
                "evidence": f"Set {sp} barg, pop {pop} barg (tolerance ±3%)", "region": f["region"], "page": f["page"], "basis": [f]}
    nd = fields.get("next_due")
    if nd:
        try:
            due = date.fromisoformat(nd["value"])
        except ValueError:
            due = None
        if due and due < today:
            return {"title": f"{tag} calibration overdue since {due.isoformat()}", "severity": "high",
                    "evidence": f"Next due date on the certificate: {due.isoformat()}", "region": nd["region"], "page": nd["page"], "basis": [nd]}
        if due and (due - today).days <= 30:
            return {"title": f"{tag} calibration due on {due.isoformat()}", "severity": "medium",
                    "evidence": f"Next due date on the certificate: {due.isoformat()}", "region": nd["region"], "page": nd["page"], "basis": [nd]}
    return None


def procedure_for(tag: str, department: str | None) -> dict[str, Any] | None:
    """The applicable procedure: an SOP linked to the asset in the knowledge graph, else a current SOP of the department."""
    for e in graph.neighbours(graph.asset_node(tag), ("procedure",)):
        d = q1("SELECT id, doc_number, revision, title, status FROM documents WHERE id=? AND status='CURRENT'", (e["dst"][4:],))
        if d:
            return d
    if department:
        return q1("SELECT id, doc_number, revision, title, status FROM documents WHERE doc_type='SOP' AND status='CURRENT' AND department=? "
                  "ORDER BY created_at DESC", (department,))
    return None


# ------------------------------------------------------------------ the task
async def run(task: dict[str, Any]) -> dict[str, Any]:
    from .auth import subject_for
    tid = task["id"]
    p = uj(task["payload_json"], {})
    user = q1("SELECT * FROM users WHERE id=?", (task["user_id"],))
    doc = q1("SELECT * FROM documents WHERE id=?", (p.get("document_id"),))
    if not user or not doc or not rag.can_read(subject_for(user), doc):
        raise PermissionError("The document is not available to the person who asked.")

    workqueue.step(tid, STEPS[0], "running")
    pages = page_images(doc)
    rows_by_page = [(n, ocr_rows(img)) for n, img in pages]
    text = "\n".join(r["text"] for _, rows in rows_by_page for r in rows)
    n_lines = sum(len(r) for _, r in rows_by_page)
    workqueue.step(tid, STEPS[0], "done", f"{len(pages)} page(s), {n_lines} lines read")

    workqueue.step(tid, STEPS[1], "running")
    vision = await look(pages[0][1]) if pages else {"used": False}
    workqueue.step(tid, STEPS[1], "done" if vision.get("used") else "skipped",
                   ("stamps: " + ", ".join(vision.get("stamps") or []) or "no stamps") if vision.get("used") else vision.get("note", ""))

    workqueue.step(tid, STEPS[2], "running")
    fields: dict[str, Any] = {}
    tml: list[dict[str, Any]] = []
    for n, rows in rows_by_page:
        ex_ = extract_fields(rows, n)
        for k, v in ex_["fields"].items():
            fields.setdefault(k, v)
        tml += ex_["tml"]
    known = [t for t in uj(doc["asset_tags_json"], []) if q1("SELECT 1 FROM assets WHERE tag=?", (t,))]
    seen = [t for t in _tags(text) if q1("SELECT 1 FROM assets WHERE tag=?", (t,))]
    # the tag the report itself names ("Tag No", "Equipment") first; then one the document is filed under; then any tag read
    named = [rag.detect_tags((fields.get(k) or {}).get("value", "")) for k in ("tag_no", "equipment")]
    named_tags = [t for ts in named for t in ts if q1("SELECT 1 FROM assets WHERE tag=?", (t,))]
    tag = (named_tags[0] if named_tags else None) or next((t for t in seen if t in known), None) or \
        (seen[0] if seen else (known[0] if known else None))
    workqueue.step(tid, STEPS[2], "done", f"{len(fields)} fields, {len(tml)} thickness readings, tag {tag or 'not found'}")

    workqueue.step(tid, STEPS[3], "running")
    asset = q1("SELECT * FROM assets WHERE tag=?", (tag,)) if tag else None
    checks = verify(fields, tml, asset, tag)
    bad = [c for c in checks if c["result"] == "MISMATCH"]
    workqueue.step(tid, STEPS[3], "done", f"{len(checks) - len(bad)} match, {len(bad)} mismatch")

    draft = detect(fields, tml, tag) if tag else None
    result: dict[str, Any] = {"document_id": doc["id"], "tag": tag, "fields": {k: v["value"] for k, v in fields.items()},
                              "field_confidence": {k: v["confidence"] for k, v in fields.items()}, "thickness": tml,
                              "checks": checks, "vision": vision}
    if not draft:
        for s in STEPS[4:]:
            workqueue.step(tid, s, "skipped", "No finding on this report.")
        result["finding"] = None
        audit.write(f"user:{user['username']}", "scan.processed", f"document:{doc['id']}", {"tag": tag, "finding": False, "task": tid})
        return result

    existing = q1("SELECT id, state FROM findings WHERE source_document_id=? AND tag=? AND state NOT IN ('REJECTED','DISMISSED')", (doc["id"], tag))
    if existing:
        for s in STEPS[4:]:
            workqueue.step(tid, s, "skipped", "A finding from this report is already open.")
        result["finding"] = {"id": existing["id"], "state": existing["state"], "duplicate": True}
        return result

    owner = (asset or {}).get("owner_department") or doc["department"]
    discipline = OWNER_DISCIPLINE.get(owner, "mechanical")
    lane = lanes.lane_for(discipline)
    proc = procedure_for(tag, owner)
    fid = new_id()
    review: list[dict[str, Any]] = []
    for name, f in fields.items():
        used = name in ("min_required_mm", "set_pressure_barg", "pop_pressure_barg", "next_due", "seat_leakage", "serial")
        if used and f["confidence"] < REVIEW_BELOW:
            review.append({"field": name, "value": f["value"], "expected": None, "reason": f"OCR confidence {f['confidence']:.2f}",
                           "confidence": f["confidence"], "region": f["region"]})
    for b in draft.get("basis") or []:
        if b.get("confidence", 1) < REVIEW_BELOW and "point" in b:
            review.append({"field": f"reading {b['point']}", "value": f"{b['current_mm']} mm", "expected": None,
                           "reason": f"OCR confidence {b['confidence']:.2f}", "confidence": b["confidence"], "region": b["region"]})
    for c in bad:
        f = fields.get(c.get("field") or "") or {}
        review.append({"field": c["check"], "value": f.get("value"), "expected": c.get("expected"), "reason": c["detail"],
                       "confidence": f.get("confidence"), "region": f.get("region")})
    hist = [{"at": now_iso(), "event": "DETECTED", "by": f"Scan pipeline (task {tid[:8]}) for {user['display_name']}"}]
    ex("""INSERT INTO findings(id, title, tag, discipline, severity, state, due_date, evidence, source_document_id, page, approver_id,
          history_json, created_at, is_example, lane, owner_department, procedure_doc_id, evidence_region_json, verification_json)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
       (fid, ("[EXAMPLE] " if doc["is_example"] else "") + draft["title"], tag, discipline.title(), draft["severity"],
        "DRAFT" if review else "PENDING", (date.today() + timedelta(days=DUE_DAYS[draft["severity"]])).isoformat(), draft["evidence"],
        doc["id"], draft["page"], None, j(hist), now_iso(), int(doc["is_example"] or 0), lane, owner, (proc or {}).get("id"),
        j({**draft["region"], "page": draft["page"]}), j(checks)))
    workqueue.step(tid, STEPS[5], "done", draft["title"])
    result["finding"] = {"id": fid, "title": draft["title"], "severity": draft["severity"], "lane": lane, "review_items": len(review)}
    audit.write(f"user:{user['username']}", "scan.finding_detected", f"finding:{fid}",
                {"document": doc["id"], "tag": tag, "severity": draft["severity"], "review_items": len(review), "task": tid})
    if review:
        for r in review:
            ex("""INSERT INTO review_items(id, document_id, finding_id, field, value, expected, reason, confidence, region_json, state, created_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
               (new_id(), doc["id"], fid, r["field"], None if r["value"] is None else str(r["value"]),
                None if r["expected"] is None else str(r["expected"]), r["reason"], r["confidence"], j(r["region"]), "OPEN", now_iso()))
        workqueue.step(tid, STEPS[4], "done", f"{len(review)} field(s) sent to a reviewer")
        from .auth import notify
        for uid in _reviewers(owner):
            notify(uid, "review", f"Scan needs review: {tag}", f"{len(review)} field(s) to check before the finding is raised.", "/inbox?tab=review")
        for s in STEPS[6:]:
            workqueue.step(tid, s, "pending", "Waiting for the human review.")
        result["waiting_review"] = True
        workqueue.finish(tid, result, status="waiting_review")
        return result
    workqueue.step(tid, STEPS[4], "skipped", "Every field that matters was read with high confidence and matches the asset master.")
    result["finding"].update(finalize(fid, f"user:{user['username']}", user["display_name"], tid))
    return result


def heads_of(department: str | None) -> set[str]:
    d = q1("SELECT manager_user_id FROM departments WHERE code=?", (department,)) if department else None
    return {d["manager_user_id"]} if d and d["manager_user_id"] else set()


def _reviewers(department: str) -> list[str]:
    """People who check uncertain fields: reviewers of the owning department, its HOD, and refinery management."""
    from .auth import permissions
    out = []
    heads = heads_of(department)
    for u in q("SELECT id, department, roles_json FROM users WHERE status='active'"):
        perms = permissions(uj(u["roles_json"], []))
        if "scan.review" in perms and (u["department"] == department or u["id"] in heads or "plant_manager" in uj(u["roles_json"], [])):
            out.append(u["id"])
    return out


def finalize(fid: str, actor: str, prepared_by: str, task_id: str | None = None) -> dict[str, Any]:
    """Reviewed (or nothing to review): route to the lane approver with a drafted approval note."""
    from .auth import notify
    f = q1("SELECT * FROM findings WHERE id=?", (fid,))
    approver_id = lanes.approver_for(f["lane"] or lanes.lane_for(f["discipline"]), f["owner_department"])
    asset = q1("SELECT * FROM assets WHERE tag=?", (f["tag"],))
    source = q1("SELECT * FROM documents WHERE id=?", (f["source_document_id"],)) if f["source_document_id"] else None
    proc = q1("SELECT * FROM documents WHERE id=?", (f["procedure_doc_id"],)) if f["procedure_doc_id"] else None
    approver = q1("SELECT * FROM users WHERE id=?", (approver_id,)) if approver_id else None
    region = uj(f["evidence_region_json"], None)
    if region and "confidence" not in region:
        region = {**region, "confidence": "see review"}
    if task_id:
        workqueue.step(task_id, STEPS[6], "running")
    path = deliverables.approval_note({**f}, asset, source, proc, approver, lanes.LANES.get(f["lane"] or "", {}).get("label", f["lane"] or ""),
                                      region, uj(f["verification_json"], []), prepared_by)
    rep = deliverables.record(path, "approval_note", approver_id or "", f"Approval note — {f['title']}", task_id)
    hist = uj(f["history_json"], [])
    hist.append({"at": now_iso(), "event": "ROUTED", "by": "Yukti", "note": f"Approval note drafted; routed to the {f['lane']} lane"})
    ex("UPDATE findings SET state='PENDING', approver_id=?, note_report_id=?, history_json=? WHERE id=?",
       (approver_id, rep["id"], j(hist), fid))
    if task_id:
        workqueue.step(task_id, STEPS[6], "done", rep["file_name"])
        workqueue.step(task_id, STEPS[7], "done", (approver or {}).get("display_name") or "no approver configured")
        ex("UPDATE tasks SET status='done', finished_at=? WHERE id=? AND status='waiting_review'", (now_iso(), task_id))
    if approver_id:
        notify(approver_id, "finding", f"Finding for approval: {f['title']}", f"Lane: {f['lane']}. Due {f['due_date']}.", "/inbox")
    graph.index_records()
    audit.write(actor, "finding.routed", f"finding:{fid}", {"lane": f["lane"], "approver": approver_id, "note_sha256": rep["sha256"]})
    return {"state": "PENDING", "approver": (approver or {}).get("display_name"), "note": rep}


def resolve(item_id: str, ctx: Any, resolution: str, value: str | None) -> dict[str, Any]:
    """A reviewer confirms, corrects or dismisses one field. When nothing is left open, the finding is routed."""
    it = q1("SELECT * FROM review_items WHERE id=?", (item_id,))
    if not it or it["state"] != "OPEN":
        raise LookupError("Review item not found or already decided.")
    if resolution not in ("confirm", "correct", "dismiss"):
        raise ValueError("Resolution must be confirm, correct or dismiss.")
    if resolution == "correct" and not (value or "").strip():
        raise ValueError("Enter the corrected value.")
    ex("UPDATE review_items SET state=?, reviewer_id=?, resolution=?, decided_at=?, value=COALESCE(?, value) WHERE id=?",
       ("DISMISSED" if resolution == "dismiss" else "RESOLVED", ctx.user["id"], resolution, now_iso(),
        value.strip() if resolution == "correct" and value else None, item_id))
    f = q1("SELECT * FROM findings WHERE id=?", (it["finding_id"],))
    hist = uj(f["history_json"], [])
    hist.append({"at": now_iso(), "event": "REVIEWED", "by": ctx.user["display_name"],
                 "note": f"{it['field']}: {resolution}" + (f" -> {value}" if resolution == "correct" else "")})
    ex("UPDATE findings SET history_json=? WHERE id=?", (j(hist), f["id"]))
    out: dict[str, Any] = {"finding_id": f["id"], "state": f["state"]}
    if resolution == "dismiss" and it["field"].startswith(("reading", "min_required", "set_pressure", "pop_pressure", "next_due", "seat_leakage")):
        # the value the finding rests on was misread: the finding itself is withdrawn
        ex("UPDATE findings SET state='DISMISSED' WHERE id=?", (f["id"],))
        ex("UPDATE review_items SET state='DISMISSED', decided_at=? WHERE finding_id=? AND state='OPEN'", (now_iso(), f["id"]))
        out["state"] = "DISMISSED"
    elif not q1("SELECT 1 FROM review_items WHERE finding_id=? AND state='OPEN'", (f["id"],)) and f["state"] == "DRAFT":
        task = q1("SELECT id FROM tasks WHERE kind='scan_to_finding' AND result_json LIKE ? ORDER BY created_at DESC", (f"%{f['id']}%",))
        out.update(finalize(f["id"], ctx.actor, ctx.user["display_name"], task["id"] if task else None))
    audit.write(ctx.actor, "scan.reviewed", f"review_item:{item_id}", {"resolution": resolution, "finding": f["id"]})
    return out


workqueue.register("scan_to_finding", run)
