"""Agentic workbench: plans multi-step work with local tools and delivers real files.

A request ("draft an approval note for replacing the A2 motor bearings", "make a slide deck on E-310 findings",
"calculate the A2 motor full-load current", "export A2 work orders to Excel") becomes a plan of tool calls, run as one
durable task on the queue. Each tool call is checked by the policy engine for the person who asked, recorded as a step
and written to the audit log. Tools:

  search_documents   hybrid retrieval, policy-filtered (only what this person may cite)
  read_facts         structured asset facts: KNOWN / MISSING / CONFLICTING
  read_spreadsheet   rows of an authorised Excel document
  read_records       work orders and ledger entries of an asset (same department / unit rules as documents)
  calculate          arithmetic with every step shown (no code involved)
  run_code           Python in the sandbox (sandbox.py), only when the person asks to run it
  draft_text         the local LLM writes from the evidence it is given (cited); without a model, an extractive draft
  write_docx / write_xlsx / write_pptx   the deliverable file

The LLM never decides what it may read or do: the plan comes from the request and Laya's typed decision, and every
tool call goes through the policy engine first.
"""
from __future__ import annotations

import ast
import math
import re
from typing import Any

from . import audit, deliverables, laya, rag, workqueue
from .db import q, q1, uj
from .policy import pdp

DELIVERABLES = {"docx": "Word document", "pptx": "PowerPoint deck", "xlsx": "Excel workbook", "approval_note": "Approval note (.docx)",
                "calc": "Calculation with steps", "code": "Code (sandbox)", "answer": "Cited answer"}
TOOL_CLASS = {"search_documents": "read", "read_facts": "read", "read_spreadsheet": "read", "read_records": "read",
              "calculate": "compute", "run_code": "execute_code", "draft_text": "compute", "write_docx": "write_file",
              "write_xlsx": "write_file", "write_pptx": "write_file"}


class ToolDenied(PermissionError):
    pass


def _authorize(subject: Any, tool: str) -> None:
    d = pdp.decide(subject, "use", {"type": "tool", "tool": tool, "tool_class": TOOL_CLASS[tool]})
    if not d.allowed:
        raise ToolDenied(f"{tool}: {d.reason} ({', '.join(d.matched)})")


# ------------------------------------------------------------------ calculate (steps shown)
_FUNCS = {n: getattr(math, n) for n in ("sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "log", "log10", "exp", "pi", "e",
                                         "floor", "ceil", "radians", "degrees", "hypot")}
_FUNCS.update({"abs": abs, "min": min, "max": max, "round": round})


def calculate(text: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    """Lines of `name = expression` (or a bare expression), evaluated in order. Each step shows the expression, the
    values substituted into it and the result. Units in [brackets] after a line are carried along as labels."""
    from simpleeval import EvalWithCompoundTypes
    names: dict[str, Any] = {k: float(v) for k, v in (variables or {}).items()}
    names.update({k: v for k, v in _FUNCS.items() if not callable(v)})
    ev = EvalWithCompoundTypes(names=names, functions={k: v for k, v in _FUNCS.items() if callable(v)})
    steps: list[dict[str, Any]] = []
    for i, raw in enumerate(l for l in re.split(r"[\n;]+", text or "") if l.strip()):
        unit = ""
        m = re.search(r"\[(.{1,20})\]\s*$", raw)
        if m:
            unit, raw = m.group(1), raw[:m.start()]
        name, expr = (raw.split("=", 1) if "=" in raw and "==" not in raw else (f"r{i + 1}", raw))
        name, expr = name.strip(), expr.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,40}", name):
            raise ValueError(f"'{name}' is not a valid name for a result.")
        try:
            used = sorted({n.id for n in ast.walk(ast.parse(expr, mode="eval")) if isinstance(n, ast.Name) and n.id in ev.names
                           and not callable(ev.names[n.id])})
            value = ev.eval(expr)
        except Exception as e:  # noqa: BLE001
            raise ValueError(f"Step {i + 1} ({raw.strip()}): {type(e).__name__}: {e}")
        subst = expr
        for n in sorted(used, key=len, reverse=True):
            subst = re.sub(rf"\b{re.escape(n)}\b", f"{ev.names[n]:g}" if isinstance(ev.names[n], (int, float)) else str(ev.names[n]), subst)
        if not isinstance(value, (int, float)):
            raise ValueError(f"Step {i + 1} does not produce a number.")
        ev.names[name] = float(value)
        steps.append({"n": i + 1, "name": name, "expression": expr, "substituted": subst, "value": round(float(value), 6), "unit": unit})
    if not steps:
        raise ValueError("Write at least one calculation, e.g. I = P / (sqrt(3) * V * pf) [A].")
    return {"steps": steps, "result": steps[-1], "inputs": variables or {}}


# ------------------------------------------------------------------ evidence tools
def search_documents(subject: Any, text: str, intent: str | None, k: int = 6) -> dict[str, Any]:
    _authorize(subject, "search_documents")
    return rag.retrieve(subject, text, k=k, intent=intent)


def read_facts(subject: Any, tag: str) -> list[dict[str, Any]]:
    _authorize(subject, "read_facts")
    return rag.dossier_facts(subject, tag)


def read_records(subject: Any, tag: str) -> dict[str, Any]:
    from . import ledger, scope
    _authorize(subject, "read_records")
    a = q1("SELECT * FROM assets WHERE tag=?", (tag,))
    if not a or not scope.asset_visible(subject, a):
        return {"asset": None, "work_orders": [], "ledger": []}
    wos = q("SELECT * FROM work_orders WHERE tag=? ORDER BY opened_at DESC", (tag,)) if scope.record_readable(subject, a, "work_order_export") else []
    return {"asset": {k: a[k] for k in ("tag", "name", "unit", "class", "vendor", "model", "serial", "location", "owner_department")},
            "work_orders": wos, "ledger": ledger.items(tag)}


def read_spreadsheet(subject: Any, document_id: str, limit: int = 500) -> dict[str, Any]:
    _authorize(subject, "read_spreadsheet")
    d = q1("SELECT * FROM documents WHERE id=?", (document_id,))
    if not d or not rag.can_read(subject, d, "cite"):
        raise ToolDenied("read_spreadsheet: this document is not available to you.")
    if not str(d["file_name"]).lower().endswith((".xlsx", ".xlsm")):
        raise ValueError("Not an Excel document.")
    import openpyxl
    wb = openpyxl.load_workbook(d["file_path"], read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = [["" if v is None else v for v in r] for r in ws.iter_rows(values_only=True)][: limit + 1]
    return {"document": f"{d['doc_number'] or d['title']} rev {d['revision']}", "header": rows[0] if rows else [], "rows": rows[1:]}


# ------------------------------------------------------------------ drafting
def _sources_block(sources: list[dict[str, Any]]) -> str:
    return "\n".join(f"<doc id=\"{s['id']}\" ref=\"{s['doc_number']} rev {s['revision']} ({s['status']}) {s['locator']}\">\n"
                     f"{s['_text'][:1200]}\n</doc>" for s in sources)


def _facts_text(facts: list[dict[str, Any]]) -> str:
    out = []
    for i, f in enumerate(facts, 1):
        v = f["value"] if f["status"] != "MISSING" else "MISSING"
        out.append(f"[F{i}] {f['slot']}.{f['attribute']}: {v} ({f['status']})")
    return "\n".join(out)


FORMAT_RULES = {
    "docx": "Write a short technical document. Use '## ' for section headings and '- ' for bullet points.",
    "approval_note": ("Write the body of an approval note with exactly these sections: '## Background', '## Proposal', "
                      "'## Justification', '## Safety and risk', '## Cost and materials'. Say MISSING where the evidence has no value."),
    "pptx": "Write a slide deck of 4 to 7 slides. Each slide starts with '## ' and its title, followed by 3 to 5 '- ' bullet points.",
    "answer": "Answer in short paragraphs and bullet points.",
}


async def draft_text(subject: Any, goal: str, kind: str, sources: list[dict[str, Any]], facts: list[dict[str, Any]],
                     worker: str) -> dict[str, Any]:
    """The local LLM drafts from the evidence (cited). Without a loaded model: an extractive draft that says so."""
    from . import engine
    _authorize(subject, "draft_text")
    if engine.state.status != "ready":
        secs = [{"heading": "Evidence (no model loaded: extractive draft)",
                 "bullets": [f"[{s['id']}] {s['doc_number']} rev {s['revision']} {s['locator']}: {s['snippet'][:280]}" for s in sources]
                 or ["No authorised documents matched."]}]
        if facts:
            secs.append({"heading": "Facts", "bullets": [f"{f['slot']}.{f['attribute']}: {f['value'] or 'MISSING'} ({f['status']})" for f in facts]})
        return {"sections": secs, "model": None, "markdown": ""}
    system = ("You are Yukti, the on-premise workbench of a refinery. Use ONLY the CONTEXT and FACTS. Cite every factual sentence "
              "with its id like [S1] or [F2]. Never invent values; write MISSING when the evidence has none. You are advisory only. "
              + FORMAT_RULES.get(kind, FORMAT_RULES["docx"]))
    user = f"CONTEXT:\n{_sources_block(sources) or '(none)'}\n\nFACTS:\n{_facts_text(facts) or '(none)'}\n\nTASK: {goal}"
    pred = workqueue.prediction_for(worker, {"temperature": 0.2, "max_tokens": 1400})
    md = await engine.complete_once([{"role": "system", "content": system}, {"role": "user", "content": user}], pred)
    return {"sections": markdown_sections(md), "model": engine.state.model_name, "markdown": md}


def markdown_sections(md: str) -> list[dict[str, Any]]:
    secs: list[dict[str, Any]] = []
    cur: dict[str, Any] = {"heading": "", "paragraphs": [], "bullets": []}
    for line in (md or "").splitlines():
        s = line.strip()
        if not s:
            continue
        m = re.match(r"^#{1,4}\s+(.*)", s)
        if m:
            if cur["heading"] or cur["paragraphs"] or cur["bullets"]:
                secs.append(cur)
            cur = {"heading": m.group(1).strip("* "), "paragraphs": [], "bullets": []}
        elif re.match(r"^([-*•]|\d+[.)])\s+", s):
            cur["bullets"].append(re.sub(r"^([-*•]|\d+[.)])\s+", "", s).replace("**", ""))
        else:
            cur["paragraphs"].append(s.replace("**", ""))
    if cur["heading"] or cur["paragraphs"] or cur["bullets"]:
        secs.append(cur)
    return secs


def _source_rows(sources: list[dict[str, Any]]) -> list[list[Any]]:
    return [["ID", "Document", "Revision", "Status", "Page / record", "Date", "Confidence"]] + [
        [s["id"], f"{s['doc_number']} — {s['title']}", s["revision"], s["status"], s["locator"], s.get("timestamp"), s.get("confidence")]
        for s in sources]


# ------------------------------------------------------------------ planning
def plan(goal: str, deliverable: str, tag: str | None, has_code: bool) -> list[str]:
    steps = ["Authorize request"]
    if deliverable == "calc":
        return steps + ["calculate", "write_xlsx"]
    if deliverable == "code":
        return steps + (["run_code"] if has_code else ["draft_text"])
    steps += ["search_documents"]
    if tag:
        steps += ["read_facts", "read_records"]
    if deliverable == "xlsx":
        return steps + ["read_spreadsheet", "write_xlsx"]
    steps += ["draft_text"]
    steps += {"pptx": ["write_pptx"], "answer": []}.get(deliverable, ["write_docx"])
    return steps


def submit(ctx: Any, body: dict[str, Any]) -> str:
    goal = " ".join(str(body.get("goal") or "").split())[:2000]
    deliverable = body.get("deliverable") or "docx"
    if deliverable not in DELIVERABLES:
        raise ValueError(f"Unknown deliverable '{deliverable}'.")
    if len(goal) < 4 and not body.get("code") and not body.get("calculation"):
        raise ValueError("Describe the work in a sentence.")
    route = laya.get().classify(goal or deliverable)
    tag = (body.get("tag") or "").strip().upper() or next(iter(rag.detect_tags(goal)), None)
    worker = {"calc": "analytics", "code": "coder", "xlsx": "analytics"}.get(deliverable) or (
        route.get("worker") if route.get("worker") in ("small_llm", "reasoning") else "small_llm")
    steps = plan(goal, deliverable, tag, bool(body.get("code")))
    payload = {"goal": goal, "deliverable": deliverable, "tag": tag, "code": body.get("code"), "calculation": body.get("calculation"),
               "variables": body.get("variables") or {}, "document_id": body.get("document_id"), "run": bool(body.get("run"))}
    title = f"{DELIVERABLES[deliverable]}: {goal[:80] or deliverable}"
    tid = workqueue.submit("workbench", worker, ctx.user["id"], payload=payload, title=title, route=route, steps=steps)
    audit.write(ctx.actor, "work.submitted", f"task:{tid}", {"deliverable": deliverable, "worker": worker, "intent": route.get("intent")})
    return tid


async def run(task: dict[str, Any]) -> dict[str, Any]:
    from .auth import subject_for
    tid = task["id"]
    p = uj(task["payload_json"], {})
    route = uj(task["route_json"], {})
    user = q1("SELECT * FROM users WHERE id=?", (task["user_id"],))
    if not user or user["status"] != "active":
        raise PermissionError("The person who asked is no longer active.")
    s = subject_for(user)  # rights at the time the work runs (a grant may have expired meanwhile)
    actor = f"user:{user['username']}"
    kind, goal, tag = p["deliverable"], p["goal"], p.get("tag")
    tools: list[dict[str, Any]] = []

    def call(name: str, status: str, detail: str = "") -> None:
        workqueue.step(tid, name, status, detail)
        if status in ("done", "error"):
            tools.append({"tool": name, "status": status, "detail": detail[:200]})
            audit.write(actor, "tool.call", f"task:{tid}", {"tool": name, "status": status})

    workqueue.step(tid, "Authorize request", "done", f"{user['display_name']} · clearance {user['clearance']} · intent {route.get('intent')}")
    result: dict[str, Any] = {"deliverable": kind, "files": [], "tools": tools}

    if kind == "calc":
        call("calculate", "running")
        _authorize(s, "calculate")
        calc = calculate(p.get("calculation") or goal, p.get("variables"))
        call("calculate", "done", f"{len(calc['steps'])} step(s); result {calc['result']['name']} = {calc['result']['value']:g} {calc['result']['unit']}")
        call("write_xlsx", "running")
        _authorize(s, "write_xlsx")
        rows = [[st["n"], st["name"], st["expression"], st["substituted"], st["value"], st["unit"]] for st in calc["steps"]]
        path = deliverables.xlsx_file(f"Calculation — {goal[:60]}", [
            {"name": "Steps", "header": ["Step", "Result", "Expression", "With values", "Value", "Unit"], "rows": rows,
             "notes": ["Inputs: " + ", ".join(f"{k} = {v}" for k, v in (p.get("variables") or {}).items()) or "Inputs: none"]}],
            stem="calculation")
        f = deliverables.record(path, "workbench", user["id"], f"Calculation — {goal[:80]}", tid)
        call("write_xlsx", "done", f["file_name"])
        result.update(calculation=calc, files=[f])
        return result

    if kind == "code":
        if p.get("code") and p.get("run"):
            from . import sandbox
            call("run_code", "running")
            _authorize(s, "run_code")
            out = sandbox.run(str(p["code"]))
            files = []
            for fi in out["files"][:10]:
                from pathlib import Path
                files.append(deliverables.record(Path(fi["path"]), "sandbox_output", user["id"], fi["name"], tid))
            call("run_code", "done" if out["exit_code"] == 0 else "error",
                 f"exit {out['exit_code']} in {out['ms']} ms" + (" (time limit)" if out["timed_out"] else ""))
            audit.write(actor, "sandbox.run", f"task:{tid}", {"exit_code": out["exit_code"], "ms": out["ms"], "files": len(files)})
            result.update(run={k: out[k] for k in ("exit_code", "timed_out", "ms", "stdout", "stderr")}, files=files, code=p["code"])
            return result
        call("draft_text", "running")
        d = await draft_text(s, goal + "\nWrite one Python script. Use only math, statistics, numpy, pandas or openpyxl. "
                             "Put the code in a single ```python block.", "answer", [], [], "coder")
        code = re.search(r"```(?:python)?\n(.*?)```", d["markdown"] or "", re.S)
        call("draft_text", "done", "code written; it runs only when you press Run in the sandbox" if code else "no code produced")
        result.update(code=code.group(1) if code else "", explanation=d["markdown"], model=d["model"])
        return result

    call("search_documents", "running")
    ret = search_documents(s, goal + (f" {tag}" if tag else ""), route.get("intent"))
    sources = ret["sources"]
    call("search_documents", "done", f"{len(sources)} authorised source(s), {ret['denied']['count']} withheld")
    facts: list[dict[str, Any]] = []
    records: dict[str, Any] = {}
    if tag:
        call("read_facts", "running")
        facts = read_facts(s, tag) if q1("SELECT 1 FROM facts WHERE asset_tag=?", (tag,)) else []
        call("read_facts", "done", f"{len(facts)} fact(s) for {tag}")
        call("read_records", "running")
        records = read_records(s, tag)
        call("read_records", "done", f"{len(records.get('work_orders') or [])} work order(s), {len(records.get('ledger') or [])} ledger entr(ies)")

    pub_sources = [{k: v for k, v in x.items() if not k.startswith("_")} for x in sources]
    result.update(sources=pub_sources, denied=ret["denied"], facts=facts)

    if kind == "xlsx":
        call("read_spreadsheet", "running")
        sheets = []
        xl = [x for x in sources if str(x.get("doc_type")) in ("work_order_export", "asset_register")
              or str(q1("SELECT file_name FROM documents WHERE id=?", (x["document_id"],))["file_name"]).lower().endswith(".xlsx")]
        if p.get("document_id"):
            xl = [{"document_id": p["document_id"]}]
        xl = list({x["document_id"]: x for x in xl}.values())  # each spreadsheet once
        for x in xl[:2]:
            try:
                t = read_spreadsheet(s, x["document_id"])
                sheets.append({"name": t["document"][:28], "header": t["header"], "rows": t["rows"]})
            except (ToolDenied, ValueError):
                continue
        if records.get("work_orders"):
            wo = records["work_orders"]
            keys = ["wo_no", "type", "opened_at", "closed_at", "failure_code", "cause", "action", "status"]
            sheets.append({"name": f"{tag} work orders", "header": keys, "rows": [[w.get(k) for k in keys] for w in wo]})
        if records.get("ledger"):
            keys = ["category_label", "type", "ref_no", "issued_on", "expires_on", "days_left", "status", "vendor", "serial", "warranty_until"]
            sheets.append({"name": f"{tag} ledger", "header": keys, "rows": [[i.get(k) for k in keys] for i in records["ledger"]]})
        if facts:
            sheets.append({"name": f"{tag} facts", "header": ["Slot", "Attribute", "Value", "Status", "Note"],
                           "rows": [[f["slot"], f["attribute"], f["value"], f["status"], f["note"]] for f in facts]})
        sheets.append({"name": "Sources", "header": _source_rows(pub_sources)[0], "rows": _source_rows(pub_sources)[1:]})
        call("read_spreadsheet", "done", f"{len(sheets)} sheet(s)")
        call("write_xlsx", "running")
        _authorize(s, "write_xlsx")
        path = deliverables.xlsx_file(goal[:80] or "Yukti export", sheets, stem=f"export_{tag or 'yukti'}")
        f = deliverables.record(path, "workbench", user["id"], goal[:120] or "Excel export", tid)
        call("write_xlsx", "done", f["file_name"])
        result["files"] = [f]
        return result

    call("draft_text", "running")
    d = await draft_text(s, goal, kind, sources, facts, task["worker"])
    call("draft_text", "done", f"drafted by {d['model']}" if d["model"] else "no model loaded: extractive draft from the evidence")
    secs = d["sections"]
    cited = sorted(set(re.findall(r"\[(S\d+|F\d+)\]", d["markdown"] or "")))
    valid = {x["id"] for x in sources} | {f"F{i}" for i in range(1, len(facts) + 1)}
    result.update(draft=d["markdown"], model=d["model"], citations={"cited": cited, "unknown": [c for c in cited if c not in valid]})
    if kind == "answer":
        return result
    src_section = {"heading": "Sources", "table": _source_rows(pub_sources)} if pub_sources else {"heading": "Sources", "paragraphs": ["No authorised documents matched."]}
    if kind == "pptx":
        call("write_pptx", "running")
        _authorize(s, "write_pptx")
        slides = [{"title": x["heading"] or "Summary", "bullets": (x["bullets"] or x["paragraphs"])[:6]} for x in secs][:10]
        slides.append({"title": "Sources", "table": [r[:5] for r in _source_rows(pub_sources)][:9]} if pub_sources
                      else {"title": "Sources", "bullets": ["No authorised documents matched."]})
        path = deliverables.pptx_file(goal[:90], slides, stem=f"deck_{tag or 'yukti'}")
        f = deliverables.record(path, "workbench", user["id"], goal[:120], tid)
        call("write_pptx", "done", f["file_name"])
    else:
        call("write_docx", "running")
        _authorize(s, "write_docx")
        if kind == "approval_note":
            from . import lanes
            lane = lanes.lane_for(re.sub(r"\s.*", "", str(route.get("department") or "")).lower())
            appr = q1("SELECT display_name FROM users WHERE id=?", (lanes.approver_for(lane),)) or {}
            secs = [{"heading": "Subject", "paragraphs": [goal]}] + secs + [
                {"heading": "Approval route", "paragraphs": [f"Lane: {lanes.LANES.get(lane, {}).get('label', lane)}. "
                                                             f"Approver: {appr.get('display_name') or 'to be assigned'}."]},
                {"heading": "Sign-off", "table": [["Role", "Name", "Signature", "Date"], ["Prepared by", user["display_name"], "", ""],
                                                  ["Reviewed by", "", "", ""], ["Approved by", appr.get("display_name") or "", "", ""]]}]
        path = deliverables.docx_file(goal[:90] if kind != "approval_note" else f"Approval note — {goal[:70]}", secs + [src_section],
                                      stem=("approval_note_" if kind == "approval_note" else "document_") + (tag or "yukti"))
        f = deliverables.record(path, "approval_note" if kind == "approval_note" else "workbench", user["id"], goal[:120], tid)
        call("write_docx", "done", f["file_name"])
    result["files"] = [f]
    return result


workqueue.register("workbench", run)
