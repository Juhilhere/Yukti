"""Durable work queue: Laya chooses the path, the queue hands the task to the right specialist worker.

Every routed request becomes a row in `tasks` before any work starts, so the work survives a server restart:
- chat turns run inline (the answer streams to the person) but are still recorded as tasks with their worker, steps
  and outcome;
- background work (workbench deliverables, scan-to-finding) is queued and picked up by a dispatcher thread with a
  small concurrency limit per worker. Tasks that were running when the server stopped are queued again (at most
  MAX_ATTEMPTS times); a chat turn that was cut off is marked `interrupted`.

Workers (what each one is for, and which model serves it, is shown to administrators):
  policy     deterministic policy engine: denials, off-topic and need-to-know answers, no model at all
  small_llm  small quantized LLM: search answers and summaries (the loaded chat model)
  ocr_vlm    OCR + vision-language model: scans, photos, drawings
  analytics  deterministic analytics engine: forecasts, the HiGHS optimizer, expiry and ledger queries
  reasoning  reasoning model (27B class when the administrator assigns one): difficult synthesis
  coder      coding model; code only runs in the sandbox
  workflow   workflow engine: access requests, approvals, escalations
"""
from __future__ import annotations

import asyncio
import inspect
import os
import re
import threading
import time
from typing import Any, Callable

from .db import ex, get_setting, j, new_id, now_iso, q, q1, uj

WORKERS: dict[str, dict[str, Any]] = {
    "policy": {"label": "Policy engine (no model)", "concurrency": 8,
               "purpose": "Guardrail denials, off-topic and need-to-know answers without calling a model."},
    "small_llm": {"label": "Small quantized LLM", "concurrency": 2,
                  "purpose": "Cited answers from retrieved documents, search results and summaries."},
    "ocr_vlm": {"label": "OCR + vision-language model", "concurrency": 1,
                "purpose": "Scanned reports, photos, stamps, layouts and drawing symbols."},
    "analytics": {"label": "Deterministic analytics engine", "concurrency": 2,
                  "purpose": "Demand forecasts, the HiGHS optimizer, asset ledger and expiry queries."},
    "reasoning": {"label": "Reasoning model (27B class)", "concurrency": 1,
                  "purpose": "Difficult synthesis: conflicting sources, root cause, comparisons."},
    "coder": {"label": "Sandboxed coding model", "concurrency": 1,
              "purpose": "Scripts, SQL and calculations; code runs only inside the sandbox."},
    "workflow": {"label": "Workflow engine", "concurrency": 4,
                 "purpose": "Access requests, approval notes, approver lanes, escalation and follow-up."},
}

# Laya's intent -> worker. The decision layer chooses the path; the queue executes it.
INTENT_WORKER = {
    "asset_dossier": "small_llm", "procedure_lookup": "small_llm", "general_chat": "small_llm", "smalltalk": "small_llm",
    "company_info": "small_llm", "finding_review": "small_llm", "doc_ingest": "ocr_vlm", "asset_expiry": "analytics",
    "production_scenario": "analytics", "code_task": "coder", "access_request": "workflow", "process_chemistry": "small_llm",
    "off_topic": "policy",
}
# words that ask for synthesis rather than lookup
_SYNTHESIS = re.compile(r"\b(why|root cause|analy[sz]e|analysis|compare|comparison|trade-?off|recommend|reconcile|"
                        r"evaluate|assess|implications?|investigat\w*)\b", re.I)

MAX_ATTEMPTS = 3
_HANDLERS: dict[str, Callable[[dict[str, Any]], Any]] = {}
_RUNNING: dict[str, int] = {}
_LOCK = threading.Lock()
_WAKE = threading.Event()
_STARTED = False


def select_worker(route: dict[str, Any], has_images: bool = False, text: str = "") -> str:
    """Typed decision -> worker. Images always go to OCR + VLM; synthesis questions with high urgency or a low-confidence
    route go to the reasoning worker; everything else follows Laya's intent."""
    if has_images:
        return "ocr_vlm"
    w = INTENT_WORKER.get(str(route.get("intent")), "small_llm")
    if w == "small_llm" and _SYNTHESIS.search(text or "") and (route.get("intent") in ("asset_dossier", "finding_review", "general_chat",
                                                                                       "procedure_lookup")):
        return "reasoning"
    return w


def worker_models() -> dict[str, Any]:
    """Which model the administrator assigned to each worker (Admin → AI settings). Empty = the loaded chat model."""
    return (get_setting("ai_settings", {}) or {}).get("worker_models") or {}


def served_by(worker: str) -> dict[str, Any]:
    """The model that actually serves a worker right now, and whether that is the one assigned to it.

    Only one llama.cpp model is resident at a time on a single GPU, so a worker whose assigned model is not the loaded
    one is served by the loaded model with that worker's settings (stated, never hidden)."""
    from . import engine
    if worker in ("policy", "analytics", "workflow"):
        return {"model": "deterministic", "assigned": None, "fallback": False}
    want = (worker_models().get(worker) or {}).get("model_id")
    loaded = engine.state.model_id
    return {"model": engine.state.model_name or "", "assigned": want or None,
            "fallback": bool(want and loaded and want != loaded)}


# prediction settings each worker adds on top of the organisation's AI settings
WORKER_PREDICTION: dict[str, dict[str, Any]] = {
    "small_llm": {},
    "ocr_vlm": {"temperature": 0.2},
    "reasoning": {"enable_thinking": "on", "temperature": 0.3},
    "coder": {"temperature": 0.1},
}


def prediction_for(worker: str, base: dict[str, Any] | None) -> dict[str, Any]:
    over = {**WORKER_PREDICTION.get(worker, {}), **((worker_models().get(worker) or {}).get("prediction") or {})}
    return {**(base or {}), **over}


# ------------------------------------------------------------------ tasks
def create(kind: str, worker: str, user_id: str | None, *, payload: dict[str, Any] | None = None, chat_id: str | None = None,
           title: str = "", route: dict[str, Any] | None = None, status: str = "queued", steps: list[str] | None = None) -> str:
    tid = new_id()
    ex("""INSERT INTO tasks(id, kind, worker, status, user_id, chat_id, title, route_json, payload_json, steps_json, created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
       (tid, kind, worker, status, user_id, chat_id, title[:200], j(route or {}), j(payload or {}),
        j([{"name": s, "status": "pending", "detail": ""} for s in (steps or [])]), now_iso()))
    if status == "running":
        ex("UPDATE tasks SET started_at=?, attempts=attempts+1 WHERE id=?", (now_iso(), tid))
    return tid


def get(tid: str) -> dict[str, Any] | None:
    return q1("SELECT * FROM tasks WHERE id=?", (tid,))


def step(tid: str, name: str, status: str, detail: str = "", **extra: Any) -> None:
    """Mark one step of a task (created on first use, so handlers may add steps as they plan)."""
    r = q1("SELECT steps_json FROM tasks WHERE id=?", (tid,))
    if not r:
        return
    steps = uj(r["steps_json"], [])
    s = next((x for x in steps if x["name"] == name), None)
    if s is None:
        s = {"name": name, "status": "pending", "detail": ""}
        steps.append(s)
    if status == "running":
        s["t0"] = time.time()
    if status in ("done", "error", "skipped") and s.get("t0"):
        s["ms"] = round((time.time() - s.pop("t0")) * 1000)
    s.update(status=status, detail=str(detail)[:500], **extra)
    ex("UPDATE tasks SET steps_json=? WHERE id=?", (j(steps), tid))


def finish(tid: str, result: dict[str, Any] | None = None, error: str | None = None, status: str | None = None,
           served: str | None = None) -> None:
    st = status or ("error" if error else "done")
    ex("UPDATE tasks SET status=?, result_json=?, error=?, finished_at=?, served_by=COALESCE(?, served_by) WHERE id=?",
       (st, j(result or {}), error, now_iso(), served, tid))


def task_out(t: dict[str, Any]) -> dict[str, Any]:
    steps = [{k: v for k, v in s.items() if k != "t0"} for s in uj(t.get("steps_json"), [])]
    return {"id": t["id"], "kind": t["kind"], "worker": t["worker"], "worker_label": WORKERS.get(t["worker"], {}).get("label", t["worker"]),
            "status": t["status"], "title": t["title"], "chat_id": t["chat_id"], "steps": steps,
            "result": uj(t.get("result_json"), {}), "error": t["error"], "attempts": t["attempts"], "served_by": t["served_by"],
            "created_at": t["created_at"], "started_at": t["started_at"], "finished_at": t["finished_at"],
            "route": uj(t.get("route_json"), {})}


def stats() -> dict[str, Any]:
    rows = q("SELECT worker, status, COUNT(*) n FROM tasks GROUP BY worker, status")
    by: dict[str, dict[str, int]] = {w: {} for w in WORKERS}
    for r in rows:
        by.setdefault(r["worker"], {})[r["status"]] = r["n"]
    return {"workers": [{"id": w, **{k: v for k, v in meta.items()}, "counts": by.get(w, {}), "served_by": served_by(w),
                         "running": _RUNNING.get(w, 0)} for w, meta in WORKERS.items()]}


# ------------------------------------------------------------------ background dispatcher
def register(kind: str, handler: Callable[[dict[str, Any]], Any]) -> None:
    """Handler for a background task kind; may be a coroutine function. It returns the task result (a dict)."""
    _HANDLERS[kind] = handler


def submit(kind: str, worker: str, user_id: str | None, *, payload: dict[str, Any], title: str = "",
           route: dict[str, Any] | None = None, steps: list[str] | None = None) -> str:
    tid = create(kind, worker, user_id, payload=payload, title=title, route=route, steps=steps)
    if os.environ.get("YUKTI_SYNC_STARTUP") == "1":  # tests: deterministic, run now
        _run(get(tid) or {})
    else:
        _ensure_dispatcher()
        _WAKE.set()
    return tid


def _run(t: dict[str, Any]) -> None:
    """Run one task (already claimed: its status is set to running here, never by two callers)."""
    h = _HANDLERS.get(t.get("kind", ""))
    tid = t["id"]
    if not h:
        finish(tid, error=f"No worker handles task kind '{t.get('kind')}'.")
        return
    ex("UPDATE tasks SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", (now_iso(), tid))
    try:
        res = h(get(tid) or t)
        if inspect.isawaitable(res):
            res = asyncio.run(res)
        cur = get(tid) or {}
        if cur.get("status") == "running":  # the handler may have finished the task itself (e.g. waiting for review)
            finish(tid, res if isinstance(res, dict) else {"value": res})
    except Exception as e:  # noqa: BLE001
        from . import journal
        ref = journal.error("queue", f"task {t.get('kind')} failed", e)
        finish(tid, error=f"{type(e).__name__}: {str(e)[:300]} ({ref})")


def _claim() -> dict[str, Any] | None:
    with _LOCK:
        for t in q("SELECT * FROM tasks WHERE status='queued' ORDER BY created_at LIMIT 50"):
            w = t["worker"]
            if _RUNNING.get(w, 0) >= int(WORKERS.get(w, {}).get("concurrency", 1)):
                continue
            cur = ex("UPDATE tasks SET status='running' WHERE id=? AND status='queued'", (t["id"],))
            if cur.rowcount:
                _RUNNING[w] = _RUNNING.get(w, 0) + 1
                return t
    return None


def _worker_thread(t: dict[str, Any]) -> None:
    try:
        _run(t)
    finally:
        with _LOCK:
            _RUNNING[t["worker"]] = max(0, _RUNNING.get(t["worker"], 1) - 1)
        _WAKE.set()


def _dispatch_loop() -> None:
    while True:
        _WAKE.wait(timeout=5)
        _WAKE.clear()
        while True:
            t = _claim()
            if not t:
                break
            threading.Thread(target=_worker_thread, args=(t,), daemon=True, name=f"task-{t['worker']}").start()


def _ensure_dispatcher() -> None:
    global _STARTED
    with _LOCK:
        if _STARTED:
            return
        _STARTED = True
    threading.Thread(target=_dispatch_loop, daemon=True, name="work-queue").start()


def recover() -> dict[str, int]:
    """At startup: background tasks that were running are queued again (bounded); interrupted chat turns are marked."""
    requeued = interrupted = failed = 0
    for t in q("SELECT id, kind, attempts FROM tasks WHERE status IN ('running','queued')"):
        if t["kind"] == "chat":
            ex("UPDATE tasks SET status='interrupted', finished_at=?, error='Interrupted by a server restart.' WHERE id=?", (now_iso(), t["id"]))
            interrupted += 1
        elif int(t["attempts"] or 0) >= MAX_ATTEMPTS:
            ex("UPDATE tasks SET status='error', finished_at=?, error='Stopped after repeated server restarts.' WHERE id=?", (now_iso(), t["id"]))
            failed += 1
        else:
            ex("UPDATE tasks SET status='queued' WHERE id=?", (t["id"],))
            requeued += 1
    if requeued and os.environ.get("YUKTI_SYNC_STARTUP") != "1":
        _ensure_dispatcher()
        _WAKE.set()
    return {"requeued": requeued, "interrupted": interrupted, "failed": failed}
