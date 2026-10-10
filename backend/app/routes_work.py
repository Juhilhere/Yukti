"""HTTP API for the workbench, the work queue, scan-to-finding review, the Performance Engine, the knowledge graph,
dense vectors, the isolated research layer and the production plan."""
from __future__ import annotations

import asyncio
import re
from typing import Any

from fastapi import APIRouter, Depends

from . import audit, engine, graph, kvcache, perf_profiles, production, rag, research, sandbox, scan_findings, vectors, workbench, workqueue
from .auth import Ctx, current, err
from .db import q, q1
from .i18n import answer_language_instruction, tr, tr_list

router = APIRouter(prefix="/api", tags=["workbench"])


# ------------------------------------------------------------------ tasks (durable queue)
def _task_visible(t: dict[str, Any] | None, ctx: Ctx) -> bool:
    return bool(t) and (t["user_id"] == ctx.user["id"] or "queue.view" in ctx.perms)


@router.get("/tasks")
def my_tasks(kind: str | None = None, ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    rows = q("SELECT * FROM tasks WHERE user_id=? AND (? IS NULL OR kind=?) ORDER BY created_at DESC LIMIT 100",
             (ctx.user["id"], kind, kind))
    return [workqueue.task_out(t) for t in rows]


@router.get("/tasks/{tid}")
def task(tid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    t = workqueue.get(tid)
    if not _task_visible(t, ctx):
        raise err(404, "not_found", "Task not found")
    out = workqueue.task_out(t)  # type: ignore[arg-type]
    if t["user_id"] != ctx.user["id"]:  # queue overseers see how the work ran, never what it contains
        out.update(title=out["kind"], result={}, route={}, steps=[{k: x[k] for k in ("name", "status") if k in x} for x in out["steps"]],
                   files=[])
        return out
    out["files"] = [{**r, "url": f"/api/reports/{r['id']}/file"} for r in
                    q("SELECT id, kind, file_name, sha256, title, created_at FROM reports WHERE task_id=? ORDER BY created_at", (tid,))]
    return out


@router.get("/admin/queue")
def queue_stats(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("queue.view")
    recent = [workqueue.task_out(t) for t in q("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50")]
    for t in recent:  # the queue view shows the work, not what people asked or what came back
        t["title"] = t["kind"]
        t.pop("result", None)
        t["route"] = {k: t["route"].get(k) for k in ("intent", "worker", "confidence")}
        t["steps"] = [{k: x[k] for k in ("name", "status", "ms") if k in x} for x in t["steps"]]
    return {**workqueue.stats(), "recent": recent, "kv": kvcache.hot.stats()}


@router.get("/chats/{cid}/checkpoints")
def chat_checkpoints(cid: str, ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    if not q1("SELECT 1 FROM chats WHERE id=? AND user_id=?", (cid, ctx.user["id"])):
        raise err(404, "not_found", "Chat not found")
    return kvcache.checkpoints(cid)


# ------------------------------------------------------------------ workbench
@router.get("/work/options")
def work_options(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    return {"deliverables": [{"id": k, "label": tr(v)} for k, v in workbench.DELIVERABLES.items()],
            "sandbox": {"imports": sorted(sandbox.ALLOWED_IMPORTS), "timeout_s": sandbox.TIMEOUT_S}}


@router.post("/work")
def create_work(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("work.create")
    try:
        tid = workbench.submit(ctx, body)
    except ValueError as e:
        raise err(422, "invalid", str(e))
    return task(tid, ctx)


# ------------------------------------------------------------------ scan to finding
@router.post("/documents/{did}/scan-findings")
def scan_document(did: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    """Run the scan-to-finding pipeline on a scanned report the person may read."""
    if "scan.review" not in ctx.perms and "documents.upload" not in ctx.perms:
        raise err(403, "policy_denied", "Inspectors, engineers, HSE and heads of department can process scanned reports.")
    d = q1("SELECT * FROM documents WHERE id=?", (did,))
    if not d or not rag.can_read(ctx.subject, d):
        raise err(404, "not_found", "Document not found")
    tid = workqueue.submit("scan_to_finding", "ocr_vlm", ctx.user["id"], payload={"document_id": did},
                           title=f"Scan to finding: {d['doc_number'] or d['title']}", steps=scan_findings.STEPS)
    audit.write(ctx.actor, "scan.submitted", f"document:{did}", {"task": tid})
    return task(tid, ctx)


def _review_visible(it: dict[str, Any], ctx: Ctx) -> bool:
    f = q1("SELECT * FROM findings WHERE id=?", (it["finding_id"],))
    if not f or "scan.review" not in ctx.perms:
        return False
    d = q1("SELECT * FROM documents WHERE id=?", (it["document_id"],))
    return bool(d) and rag.can_read(ctx.subject, d) and (f.get("owner_department") == ctx.user["department"]
                                                         or ctx.user["id"] in scan_findings.heads_of(f.get("owner_department"))
                                                         or bool({"plant_manager", "hse"} & set(ctx.subject.roles)))


@router.get("/review-items")
def review_items(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    if "scan.review" not in ctx.perms:
        return []
    from .db import uj
    out = []
    for it in q("SELECT r.*, f.title finding_title, f.tag FROM review_items r JOIN findings f ON f.id=r.finding_id "
                "WHERE r.state='OPEN' ORDER BY r.created_at"):
        if _review_visible(it, ctx):
            out.append({k: it[k] for k in ("id", "document_id", "finding_id", "finding_title", "tag", "field", "value", "expected",
                                           "reason", "confidence", "created_at")} | {"region": uj(it["region_json"], None)})
    return out


@router.post("/review-items/{iid}")
def resolve_review(iid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    it = q1("SELECT * FROM review_items WHERE id=?", (iid,))
    if not it or not _review_visible(it, ctx):
        raise err(404, "not_found", "Review item not found")
    try:
        return scan_findings.resolve(iid, ctx, str(body.get("resolution") or ""), body.get("value"))
    except LookupError as e:
        raise err(409, "conflict", str(e))
    except ValueError as e:
        raise err(422, "invalid", str(e))


# ------------------------------------------------------------------ Performance Engine
@router.get("/admin/profiles")
def profiles(model_id: str | None = None, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    m = engine.model_by_id(model_id) if model_id else (engine.model_by_id(engine.state.model_id) if engine.state.model_id else None)
    out = perf_profiles.listing(m)
    out["active"] = (engine.state.load_config or {}).get("profile")
    return out


@router.post("/admin/profiles/{pid}/validate")
async def validate_profile(pid: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    try:
        rec = await perf_profiles.validate(pid, ctx.actor)
    except ValueError as e:
        raise err(404, "not_found", str(e))
    except RuntimeError as e:
        raise err(409, "conflict", str(e))
    audit.write(ctx.actor, "profile.validated", f"profile:{pid}", {k: rec[k] for k in ("model", "tok_per_s_median", "ttft_ms_median")})
    return rec


@router.get("/admin/kv")
def kv_stats(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    return {**kvcache.hot.stats(), "settings": kvcache.settings(),
            "kv_type": (engine.state.load_config or {}).get("cache_type_k"), "ctx_per_slot": engine.context_tokens()}


# ------------------------------------------------------------------ knowledge graph and vectors
@router.get("/admin/retrieval")
def retrieval_status(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("admin")
    return {"graph": graph.stats(), "vectors": vectors.status(),
            "channels": ["BM25 keywords (SQLite FTS5)", "asset tags", "document metadata", "knowledge-graph links",
                         "dense vectors (BGE-M3, when installed)", "structured facts"]}


@router.post("/admin/graph/rebuild")
def rebuild_graph(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("admin")
    n = graph.rebuild()
    audit.write(ctx.actor, "graph.rebuilt", "kg", {"edges": n})
    return graph.stats()


@router.get("/assets/{tag}/graph")
def asset_graph(tag: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    """The asset's links, limited to what this person may see (documents by policy)."""
    from . import scope
    a = q1("SELECT * FROM assets WHERE tag=?", (tag,))
    if not a or not scope.asset_visible(ctx.subject, a):
        raise err(404, "not_found", "Asset not found")
    out = []
    for e in graph.neighbours(graph.asset_node(tag)):
        other = e["dst"] if e["src"] == graph.asset_node(tag) else e["src"]
        if other.startswith("doc:"):
            d = q1("SELECT id, doc_number, revision, title, status FROM documents WHERE id=?", (other[4:],))
            full = q1("SELECT * FROM documents WHERE id=?", (other[4:],))
            if not d or not rag.can_read(ctx.subject, full):
                continue
            out.append({"rel": e["rel"], "kind": "document", **d})
        elif other.startswith("asset:"):
            b = q1("SELECT * FROM assets WHERE tag=?", (other[6:],))
            if b and scope.asset_visible(ctx.subject, b):
                out.append({"rel": e["rel"], "kind": "asset", "tag": b["tag"], "title": b["name"]})
        else:
            out.append({"rel": e["rel"], "kind": other.split(":", 1)[0], "id": other.split(":", 1)[1]})
    return {"tag": tag, "links": out}


# ------------------------------------------------------------------ isolated research layer
@router.get("/admin/research")
def research_config(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("research.manage")
    return {**research.config(), **research.status()}


@router.put("/admin/research")
def research_save(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("research.manage")
    try:
        c = research.save_config(body, ctx.actor)
    except ValueError as e:
        raise err(422, "invalid", str(e))
    audit.write(ctx.actor, "research.configured", "research_layer", {"enabled": c["enabled"], "model": c["model_id"] or c["url"]})
    return {**c, **research.status()}


@router.post("/admin/research/{action}")
def research_control(action: str, ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("research.manage")
    if action == "start":
        st = research.start(ctx.actor)
    elif action == "stop":
        research.stop()
        st = research.status()
    else:
        raise err(404, "not_found", "Unknown action")
    audit.write(ctx.actor, f"research.{action}", "research_layer", {"status": st["status"]})
    return st


@router.get("/research/status")
def research_status(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("research.use")
    return research.status()


@router.post("/research/ask")
async def research_ask(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("research.use")
    text = str(body.get("question") or "").strip()
    if len(text) < 3:
        raise err(422, "invalid", "Write a question.")
    try:
        out = await research.ask(ctx.subject, text)
    except PermissionError as e:
        raise err(403, "policy_denied", str(e))
    except RuntimeError as e:
        raise err(409, "conflict", str(e))
    audit.write(ctx.actor, "research.ask", "research_layer", {"question_sha": research.fingerprint(text), "model": out["model"]})
    return {**out, "label": tr(out["label"])}


# ------------------------------------------------------------------ production plan (forecast + optimizer + LLM explanation)
async def explain(facts: str) -> str:
    """The LLM explains the optimizer's numbers in plain words; wording with any number that is not in the result is withheld."""
    if engine.state.status != "ready":
        return tr(facts)
    try:
        txt = await asyncio.wait_for(engine.complete_once([
            {"role": "system", "content": "Explain these refinery planning results to planners in 4 short bullet points. Use ONLY the numbers given. "
             "End with: 'Planners decide.'" + (" " + answer_language_instruction() if answer_language_instruction() else "")},
            {"role": "user", "content": facts}]), timeout=40)
    except Exception as e:  # noqa: BLE001
        return tr(facts) + " " + tr(f"(AI wording unavailable: {str(e)[:160]})")
    plain = facts.replace(",", "")
    nums = [n for n in re.findall(r"\d+(?:\.\d+)?", txt.replace(",", "")) if n not in ("4",)]
    if not txt.strip():
        return tr(facts)
    if all(n in plain for n in nums):
        return txt
    return tr(facts) + " " + tr("(AI wording withheld: it contained numbers that are not in the optimizer output.)")


@router.get("/production/forecast")
def prod_forecast(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("production.view")
    from .forecast import forecast_model
    return {"forecast": forecast_model(production.get_model(), 1)}


@router.post("/production/plan")
async def prod_plan(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("production.view")
    res = production.plan(body)
    if res.get("error"):
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail={"code": "model_incomplete" if res["error"] == "model_incomplete" else "infeasible",
                                                     "message": tr("The plant model is incomplete." if res["error"] == "model_incomplete"
                                                                   else "No feasible plan with these limits."),
                                                     "missing": tr_list(res["missing"])})
    ev = res["expected_value"]
    top = res["proposal"][:5]
    facts = (f"Expected monthly margin US$ {ev['margin_usd']:,.0f} vs baseline US$ {ev['baseline_margin_usd']:,.0f} "
             f"(change US$ {ev['delta_usd']:,.0f}). Proposed changes: "
             + (", ".join(f"{p['product']} {p['change_pct']:+.1f}%" for p in top) or "none")
             + ". Alternatives: " + ("; ".join(f"{a['case']} demand margin US$ {a['margin_usd']:,.0f}" for a in res["alternatives"]) or "none")
             + ". Binding: " + (", ".join(res["binding"]) or "none") + ".")
    res["explanation"] = await explain(facts)
    res["assumptions"] = tr_list(res["assumptions"])
    res["decision"] = tr(res["decision"])
    audit.write(ctx.actor, "production.plan", "scenario", {"inputs": body, "expected_margin_usd": ev["margin_usd"],
                                                           "proposal": [(p["product"], p["change_pct"]) for p in top]})
    return res
