"""Live checks of the workbench features on a running server with a model loaded (demonstration accounts):
    cd backend && uv run python tests/live/workbench_live.py
Kept separate from e2e_live.py. Covers the durable queue, hot KV reuse, cited deliverables drafted by the model, scan to
finding, the plan scenario card and the Performance Engine profiles."""
import json
import os
import sys
import time

import httpx

B = os.environ.get("YUKTI_TEST_URL", "http://127.0.0.1:8000")
FAILS: list[str] = []


def check(name: str, cond: bool, detail: object = "") -> None:
    print(("  PASS " if cond else "  FAIL ") + name + ("" if cond else f"  -> {str(detail)[:300]}"))
    if not cond:
        FAILS.append(name)


def session(user: str, pw: str) -> httpx.Client:
    c = httpx.Client(base_url=B, timeout=600)
    r = c.post("/api/auth/login", json={"username": user, "password": pw})
    if r.status_code != 200:
        sys.exit(f"login {user} failed: {r.text}")
    c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    return c


def ask(c: httpx.Client, chat_id: str, text: str) -> dict:
    ev: dict = {}
    with c.stream("POST", f"/api/chats/{chat_id}/messages", json={"content": text, "use_knowledge": True}) as r:
        name = None
        for line in r.iter_lines():
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:") and name != "token":
                ev[name] = json.loads(line[5:])
    return ev


def wait_task(c: httpx.Client, tid: str, timeout: float = 600) -> dict:
    end = time.time() + timeout
    while time.time() < end:
        t = c.get(f"/api/tasks/{tid}").json()
        if t["status"] in ("done", "error", "waiting_review", "interrupted"):
            return t
        time.sleep(1.5)
    return t


while not httpx.get(B + "/api/health", timeout=5).json().get("ready"):
    time.sleep(2)
ravi, ramesh, arjun, admin = (session("ravi.e", "Ravi@2026"), session("ramesh.pm", "Ramesh@2026"),
                              session("arjun.pl", "Arjun@2026"), session("admin", "Admin@2026"))

print("== queue, worker and hot KV")
chat = ravi.post("/api/chats", json={}).json()
e1 = ask(ravi, chat["id"], "Pump A2 tripped. Give me its ratings, wiring and isolation steps.")
check("task event with a worker", e1.get("task", {}).get("worker") in ("small_llm", "reasoning"), e1.get("task"))
check("answer finished", "done" in e1, e1.get("error"))
e2 = ask(ravi, chat["id"], "And what is its open work order history?")
cps = ravi.get(f"/api/chats/{chat['id']}/checkpoints").json()
check("two checkpoints", len(cps) == 2, cps)
check("second turn reuses the chat's hot KV slot", len(cps) == 2 and cps[1]["kv"]["state"] in ("hot", "restored"), cps[-1:])
check("cached prompt tokens reported", len(cps) == 2 and (cps[1]["kv"].get("cached_tokens") or 0) > 0, cps[-1:])
src = (e1.get("retrieval") or {}).get("sources") or []
check("sources carry locator, timestamp, confidence", bool(src) and all({"locator", "timestamp", "confidence"} <= set(s) for s in src))

print("== workbench")
t = wait_task(ravi, ravi.post("/api/work", json={"deliverable": "approval_note",
                                                  "goal": "Approval note to replace the A2 mechanical seal with a dual cartridge"}).json()["id"])
check("approval note drafted by the model", t["status"] == "done" and t["result"].get("model"), t.get("error"))
check("draft cites sources", bool((t["result"].get("citations") or {}).get("cited")), t["result"].get("citations"))
check("no unknown citations", not (t["result"].get("citations") or {}).get("unknown"), t["result"].get("citations"))
t = wait_task(ravi, ravi.post("/api/work", json={"deliverable": "pptx", "goal": "Slides: A2 trip troubleshooting summary"}).json()["id"])
check("slide deck delivered", t["status"] == "done" and t["files"] and t["files"][0]["file_name"].endswith(".pptx"), t.get("error"))
t = wait_task(ravi, ravi.post("/api/work", json={"deliverable": "code", "goal": "Python: mean and max of 7.9, 7.1 and 6.1"}).json()["id"])
check("coder writes code (not run)", t["status"] == "done" and "print" in (t["result"].get("code") or ""), t["result"])

print("== scan to finding")
docs = {d["doc_number"]: d for d in ramesh.get("/api/documents").json()}
t = wait_task(ramesh, ramesh.post(f"/api/documents/{docs['DV-CAL-25-118']['id']}/scan-findings").json()["id"])
steps = {s["name"]: s for s in t["steps"]}
check("vision model looked at the scan", steps.get("Vision model: stamps, layout, symbols, markings", {}).get("status") == "done", steps)
check("certificate tag read", t["result"].get("tag") == "PSV-118", t["result"].get("tag"))

print("== planning")
card = arjun.post("/api/production/plan", json={})
check("plan answers (card or a clear 422)", card.status_code in (200, 422), card.text[:200])
if card.status_code == 200:
    check("LLM explanation uses only optimizer numbers", "withheld" not in card.json()["explanation"], card.json()["explanation"])

print("== Performance Engine")
prof = admin.get("/api/admin/profiles").json()
check("a profile is recommended for the loaded model", bool(prof.get("recommended")), prof)
v = admin.post(f"/api/admin/profiles/{prof.get('active') or prof.get('recommended')}/validate")
check("profile validated on this server", v.status_code == 200 and v.json()["tok_per_s_median"] > 0, v.text[:200])

print(f"\n{'ALL PASSED' if not FAILS else f'{len(FAILS)} FAILED: ' + ', '.join(FAILS)}")
sys.exit(1 if FAILS else 0)
