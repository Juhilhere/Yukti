from pathlib import Path

root = Path(__file__).resolve().parents[1] / "app"
p = root / "chat.py"
s = p.read_text(encoding="utf-8")


def rep(old: str, new: str) -> None:
    global s
    assert old in s, old[:80]
    s = s.replace(old, new, 1)


rep('''def history_messages(''', '''def _record(ctx: Ctx, route: dict[str, Any], stats: dict[str, Any] | None, error: str | None = None, denied: int = 0) -> None:
    st = stats or {}
    ex("""INSERT INTO answer_stats(at, user_id, department, intent, engine, model, tokens_in, tokens_out, tok_per_s, ttft_ms, total_ms, error, denied)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
       (now_iso(), ctx.user["id"], ctx.user["department"], route.get("intent"), st.get("engine"), st.get("model_name"),
        st.get("tokens_in"), st.get("tokens_out"), st.get("tok_per_s"), st.get("ttft_ms"), st.get("total_ms"), error, denied))


def history_messages(''')
rep('''            yield _sse("error", {"code": ev["code"], "message": ev["message"]})
            audit.write(ctx.actor, "chat.error", f"chat:{chat_id}", {"code": ev["code"]})
            return''', '''            yield _sse("error", {"code": ev["code"], "message": ev["message"]})
            audit.write(ctx.actor, "chat.error", f"chat:{chat_id}", {"code": ev["code"]})
            _record(ctx, route, None, ev["code"])
            return''')
rep('''    meta["stats"] = stats
    mid = new_id()''', '''    meta["stats"] = stats
    _record(ctx, route, stats, None, int((meta.get("denied") or {}).get("count", 0)))
    mid = new_id()''')
p.write_text(s, encoding="utf-8")

p = root / "laya.py"
s = p.read_text(encoding="utf-8")
rep('''                "by_intent": by, "model_version": f"{VERSION}+{self.runtime}",
                "baseline_llm_router_ms": 650}''', '''                "by_intent": by, "model_version": f"{VERSION}+{self.runtime}"}''')
p.write_text(s, encoding="utf-8")
print("chat/laya patched")
