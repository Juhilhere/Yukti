"""One-off patch of app/main.py for v0.2."""
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "app" / "main.py"
s = p.read_text(encoding="utf-8")


def rep(old: str, new: str, count: int = 1) -> None:
    global s
    assert old in s, f"anchor not found: {old[:80]!r}"
    s = s.replace(old, new, count)


rep("from . import audit, chat, engine, laya, mrpl, production, rag, seed",
    "from . import admin, audit, chat, engine, laya, mrpl, production, rag, seed")
rep("app.include_router(auth_router)", "app.include_router(auth_router)\napp.include_router(admin.router)")
rep('''def startup() -> None:
    init_db()''', '''def startup() -> None:
    if admin.apply_pending_restore():
        engine.log("Restored database and documents from staged backup.")
    init_db()''')
# autoload honours organisation AI settings
rep('''    threading.Thread(target=engine.autoload_default, daemon=True).start()''', '''    ai = admin.ai_settings()
    if ai.get("autoload", True):
        if ai.get("default_model_id"):
            threading.Thread(target=engine.load, args=(ai.get("default_engine") or "llamacpp", ai["default_model_id"],
                                                        ai.get("default_load_config") or {}), daemon=True).start()
        else:
            threading.Thread(target=engine.autoload_default, daemon=True).start()''')
# admin-only engine / model routes
rep('''async def engines(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    return''', '''async def engines(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ctx.require("models.manage")
    return''')
rep('''async def models(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ms = engine.scan_models()''', '''async def models(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ctx.require("models.manage")
    ms = engine.scan_models()''')
rep('''    ctx.require("models.manage") if not DEMO_MODE else None
    res = engine.load(''', '''    ctx.require("models.manage")
    res = engine.load(''')
rep('''def unload_model(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    engine.unload()''', '''def unload_model(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
    engine.unload()''')
rep('''def params_schema(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    return''', '''def params_schema(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("ai.settings")
    return''')
rep('''def command_preview(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
''', '''def command_preview(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("models.manage")
''')
rep('''def presets(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    rows''', '''def presets(ctx: Ctx = Depends(current)) -> list[dict[str, Any]]:
    ctx.require("ai.settings")
    rows''')
rep('''def create_preset(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    pid''', '''def create_preset(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("ai.settings")
    pid''')
# loaded model: employees see only name/status
rep('''def loaded(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    return engine.state.public()''', '''def loaded(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    pub = engine.state.public()
    if "models.manage" not in ctx.perms:
        return {k: pub[k] for k in ("status", "engine", "model_name")}
    return pub''')
# chat: organisation settings for non-admins
rep('''    pred = body.get("prediction") or uj(c["prediction_json"], {})
    sp = body.get("system_prompt") if body.get("system_prompt") is not None else c["system_prompt"]
    if body.get("prediction") is not None or body.get("system_prompt") is not None:
        ex("UPDATE chats SET prediction_json=?, system_prompt=? WHERE id=?", (j(pred), sp or "", cid))''', '''    org = admin.ai_settings()
    if "ai.settings" in ctx.perms:  # admins may override per chat (testing)
        pred = {**org["prediction"], **(body.get("prediction") or uj(c["prediction_json"], {}))}
        sp = body.get("system_prompt") if body.get("system_prompt") is not None else (c["system_prompt"] or org["system_prompt"])
        if body.get("prediction") is not None or body.get("system_prompt") is not None:
            ex("UPDATE chats SET prediction_json=?, system_prompt=? WHERE id=?", (j(body.get("prediction") or {}), sp or "", cid))
    else:  # employees always use organisation settings
        pred, sp = org["prediction"], org["system_prompt"]''')
rep('''    pred = body.get("prediction") or uj(c["prediction_json"], {})
    return _sse_response(chat.run_turn(ctx, cid, last_user["content"], c["system_prompt"], pred''', '''    org = admin.ai_settings()
    if "ai.settings" in ctx.perms:
        pred, spr = {**org["prediction"], **(body.get("prediction") or uj(c["prediction_json"], {}))}, (c["system_prompt"] or org["system_prompt"])
    else:
        pred, spr = org["prediction"], org["system_prompt"]
    return _sse_response(chat.run_turn(ctx, cid, last_user["content"], spr, pred''')
rep('''            "prediction": {**DEFAULT_PREDICTION, **uj(c["prediction_json"], {})}, "messages": [chat.message_out(m) for m in msgs],''',
    '''            "prediction": ({**admin.ai_settings()["prediction"], **uj(c["prediction_json"], {})} if "ai.settings" in ctx.perms else {}),
            "messages": [chat.message_out(m) for m in msgs],''')
# documents: provenance flags
rep('''            "file_name": d["file_name"], "effective_date": d["effective_date"]}''', '''            "file_name": d["file_name"], "effective_date": d["effective_date"], "is_example": bool(d.get("is_example")),
            "is_public": bool(d.get("is_public")), "source_url": d.get("source_url")}''')
# assets: example flag
rep('''                    "items": items, "nearest_days": min(''', '''                    "is_example": bool(a.get("is_example")), "items": items, "nearest_days": min(''')
# findings workflow
rep('''def _finding_out(f: dict[str, Any]) -> dict[str, Any]:
    a = user_by_id(f["approver_id"]) or {}
    return {**{k: f[k] for k in ("id", "title", "tag", "discipline", "severity", "state", "due_date", "evidence", "source_document_id", "page", "created_at")},
            "approver_name": a.get("display_name"), "history": uj(f["history_json"], [])}''', '''def _is_discipline_approver(f: dict[str, Any], ctx: Ctx) -> bool:
    return (f"approver:{(f['discipline'] or '').lower()}" in ctx.subject.roles or f["approver_id"] == ctx.user["id"]
            or "plant_manager" in ctx.subject.roles or "admin" in ctx.subject.roles)


def _allowed_actions(f: dict[str, Any], ctx: Ctx) -> list[str]:
    st = f["state"]
    appr = _is_discipline_approver(f, ctx)
    acts: list[str] = []
    if st in ("PENDING", "ESCALATED"):
        acts += ["acknowledge"] if appr or "findings.view" in ctx.perms else []
        acts += ["approve", "reject"] if appr else []
        acts += ["escalate"] if appr or "findings.view" in ctx.perms else []
    elif st == "ACKNOWLEDGED":
        acts += ["approve", "reject", "escalate"] if appr else (["escalate"] if "findings.view" in ctx.perms else [])
    if "findings.view" in ctx.perms or appr:
        acts.append("note")
    return acts


def _finding_out(f: dict[str, Any], ctx: Ctx) -> dict[str, Any]:
    a = user_by_id(f["approver_id"]) or {}
    return {**{k: f[k] for k in ("id", "title", "tag", "discipline", "severity", "state", "due_date", "evidence", "source_document_id", "page", "created_at")},
            "approver_name": a.get("display_name"), "history": uj(f["history_json"], []), "is_example": bool(f.get("is_example")),
            "discipline_approver": _is_discipline_approver(f, ctx), "allowed_actions": _allowed_actions(f, ctx)}''')
rep('''    return [_finding_out(f) for f in q("SELECT * FROM findings ORDER BY created_at DESC")]''',
    '''    if "findings.view" not in ctx.perms and "inbox" not in ctx.perms:
        return []
    return [_finding_out(f, ctx) for f in q("SELECT * FROM findings ORDER BY created_at DESC")]''')
rep('''    act = body.get("action")
    trans = {"acknowledge": ("PENDING", "ACKNOWLEDGED"), "approve": ("ACKNOWLEDGED", "APPROVED"), "reject": ("ACKNOWLEDGED", "REJECTED"),
             "escalate": (None, "ESCALATED")}
    if act not in trans:
        raise err(422, "invalid", "Unknown action")
    frm, to = trans[act]
    if act in ("approve", "reject"):
        ctx.require("findings.approve")
    if frm and f["state"] not in (frm, "ESCALATED"):
        raise err(409, "conflict", f"Cannot {act} a finding in state {f['state']}")
    hist = uj(f["history_json"], [])
    hist.append({"at": now_iso(), "event": to, "by": ctx.user["display_name"], "note": body.get("note", "")})''', '''    act = body.get("action")
    if act not in _allowed_actions(f, ctx):
        raise err(403, "policy_denied", f"'{act}' is not allowed for you on a finding in state {f['state']}.")
    to = {"acknowledge": "ACKNOWLEDGED", "approve": "APPROVED", "reject": "REJECTED", "escalate": "ESCALATED", "note": f["state"]}[act]
    hist = uj(f["history_json"], [])
    hist.append({"at": now_iso(), "event": "NOTE" if act == "note" else to, "by": ctx.user["display_name"], "note": body.get("note", "")})''')
rep('''    return _finding_out(q1("SELECT * FROM findings WHERE id=?", (fid,)))''', '''    return _finding_out(q1("SELECT * FROM findings WHERE id=?", (fid,)), ctx)''')
# production endpoints
start = s.index('@app.get("/api/production/overview")')
end = s.index("# ------------------------------------------------------------------ MRPL public intelligence")
s = s[:start] + '''@app.get("/api/production/overview")
def prod_overview(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("production.view")
    return production.overview()


@app.get("/api/production/model")
def prod_model(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("production.view")
    return production.get_model()


@app.put("/api/production/model")
def prod_model_put(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("production.edit")
    m = production.save_model(body, ctx.actor)
    audit.write(ctx.actor, "production.model.saved", "production_model", {"complete": m["complete"], "missing": len(m["missing"])})
    return m


@app.post("/api/production/scenario")
async def prod_scenario(body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    ctx.require("production.view")
    res = production.solve(body)
    if res.get("error"):
        raise HTTPException(status_code=422, detail={"code": "model_incomplete", "message": "The plant model is incomplete.", "missing": res["missing"]})
    top = sorted(res["delta_pct"].items(), key=lambda kv: -abs(kv[1]))[:5]
    facts = (f"Monthly margin baseline US$ {res['margin_usd']['baseline']:,.0f} vs scenario US$ {res['margin_usd']['scenario']:,.0f}. "
             "Largest product changes: " + ", ".join(f"{k} {v:+.1f}%" for k, v in top) + ". Binding: " + (", ".join(res["binding"]) or "none") + ".")
    explanation = facts
    if engine.state.status == "ready":
        try:
            import re as _re
            txt = await asyncio.wait_for(engine.complete_once([
                {"role": "system", "content": "Explain these refinery planning LP results to planners in 4 short bullet points. Use ONLY the numbers given. End with: 'Planners decide.'"},
                {"role": "user", "content": facts}]), timeout=40)
            ok = all(n in facts for n in _re.findall(r"\\d+(?:\\.\\d+)?", txt.replace(",", "")) if n not in ("4",))
            explanation = txt if ok else facts + " (LLM wording withheld: it contained numbers not in the optimizer output.)"
        except Exception:
            pass
    res["explanation"] = explanation
    audit.write(ctx.actor, "production.scenario", "scenario", {"inputs": body, "margin_usd": res["margin_usd"]})
    return res


''' + s[end:]
# laya stats: measured baseline only
rep('''def laya_stats(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    return laya.get().stats()''', '''def laya_stats(ctx: Ctx = Depends(current)) -> dict[str, Any]:
    st = laya.get().stats()
    bench = admin.get_setting("laya_benchmark")
    st["baseline_llm_router_ms"] = bench.get("llm_router_avg_ms") if bench else None
    st["benchmark"] = bench
    return st''')
# remove old admin users route (now in admin.router)
start = s.index('@app.get("/api/admin/users")')
end = s.index('@app.get("/api/admin/policies")')
s = s[:start] + s[end:]
# feedback + audit export
rep('''@app.get("/api/audit/verify")''', '''@app.post("/api/messages/{mid}/feedback")
def message_feedback(mid: str, body: dict[str, Any], ctx: Ctx = Depends(current)) -> dict[str, Any]:
    m = q1("SELECT m.id FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=? AND c.user_id=?", (mid, ctx.user["id"]))
    if not m:
        raise err(404, "not_found", "Message not found")
    rating = 1 if int(body.get("rating", 1)) > 0 else -1
    ex("DELETE FROM feedback WHERE message_id=? AND user_id=?", (mid, ctx.user["id"]))
    ex("INSERT INTO feedback(id, message_id, user_id, rating, comment, created_at) VALUES(?,?,?,?,?,?)",
       (new_id(), mid, ctx.user["id"], rating, str(body.get("comment", ""))[:2000], now_iso()))
    audit.write(ctx.actor, "chat.feedback", f"message:{mid}", {"rating": rating})
    return {"ok": True}


@app.get("/api/audit/export")
def audit_export(request: Request, ctx: Ctx = Depends(current)):  # type: ignore[no-untyped-def]
    ctx.require("audit.view")
    import csv
    import io
    fmt = request.query_params.get("format", "csv")
    rows = q("SELECT seq, at, actor, event, entity, detail_json, prev_hash, hash FROM audit_log ORDER BY seq")
    audit.write(ctx.actor, "audit.exported", "audit", {"format": fmt, "records": len(rows)})
    if fmt == "jsonl":
        import json as _json
        body = "\\n".join(_json.dumps(r, ensure_ascii=False) for r in rows)
        return StreamingResponse(iter([body]), media_type="application/x-ndjson",
                                 headers={"Content-Disposition": "attachment; filename=yukti_audit.jsonl"})
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["seq", "at", "actor", "event", "entity", "detail_json", "prev_hash", "hash"])
    w.writeheader()
    w.writerows(rows)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=yukti_audit.csv"})


@app.get("/api/audit/verify")''')
p.write_text(s, encoding="utf-8")
print("main.py patched")
