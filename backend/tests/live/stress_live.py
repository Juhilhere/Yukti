"""Stress / fault-injection test for a running Yukti server.

Scenarios: concurrent chats from several users, clients aborting mid-stream, concurrent document uploads
(digital + scanned), model reload during chats, llama-server killed mid-session (recovery), login storm.
Run (server must be running):  cd backend && uv run python tests/live/stress_live.py
"""
import concurrent.futures as cf
import json
import os
import random
import subprocess
import threading
import time

import httpx
import psutil

B = "http://127.0.0.1:8000"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
PROBLEMS: list[str] = []
LOCK = threading.Lock()


def problem(msg: str) -> None:
    with LOCK:
        PROBLEMS.append(msg)
    print("  PROBLEM:", msg[:300])


def session(u: str, p: str) -> httpx.Client:
    c = httpx.Client(base_url=B, timeout=180)
    r = c.post("/api/auth/login", json={"username": u, "password": p})
    r.raise_for_status()
    c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    return c


def chat(c: httpx.Client, text: str, abort_after_tokens: int | None = None) -> str:
    ch = c.post("/api/chats", json={}).json()
    ev: dict = {}
    n = 0
    try:
        with c.stream("POST", f"/api/chats/{ch['id']}/messages", json={"content": text, "use_knowledge": True}) as r:
            if r.status_code != 200:
                problem(f"chat HTTP {r.status_code}: {r.read()[:200]!r}")
                return "http"
            name = None
            for line in r.iter_lines():
                if line.startswith("event:"):
                    name = line[6:].strip()
                elif line.startswith("data:"):
                    if name == "token":
                        n += 1
                        if abort_after_tokens and n >= abort_after_tokens:
                            return "aborted"
                    else:
                        ev[name] = json.loads(line[5:])
    except Exception as e:  # noqa: BLE001
        problem(f"chat exception: {e!r}")
        return "exception"
    if "error" in ev:
        return "error:" + ev["error"].get("code", "?")
    return "ok" if "done" in ev else "incomplete"


def server_proc() -> psutil.Process | None:
    for p in psutil.process_iter(["name", "cmdline"]):
        try:
            cmd = " ".join(p.info["cmdline"] or [])
            if (p.info["name"] or "").lower() == "yukti-server.exe" or ("uvicorn" in cmd and "app.main:app" in cmd and "python" in (p.info["name"] or "").lower()):
                return p
        except Exception:  # noqa: BLE001
            pass
    return None


def alive() -> bool:
    try:
        return httpx.get(B + "/api/health", timeout=5).status_code == 200
    except Exception:  # noqa: BLE001
        return False


def mem_mb() -> int:
    p = server_proc()
    try:
        return int(p.memory_info().rss / 2**20) if p else -1
    except Exception:  # noqa: BLE001
        return -1


QUESTIONS = ["A2 tripped at 02:15 - give me the isolation and restart dossier", "Who is the managing director of MRPL?",
             "What lean MDEA amine concentration should we run?", "Which certificates expire in the next 30 days?",
             "Summarise the night shift log", "What is the overload relay setting for M-A2?"]
USERS = [("ravi.e", "Ravi@2026"), ("vikram.op", "Vikram@2026"), ("meera.me", "Meera@2026"), ("priya.hse", "Priya@2026")]

print("baseline memory MB:", mem_mb())
sessions = [session(u, p) for u, p in USERS]
admin = session("admin", "Admin@2026")

print("== 1. 12 concurrent chats (4 users x 3) + 4 aborted mid-stream")
with cf.ThreadPoolExecutor(16) as ex:
    futs = [ex.submit(chat, sessions[i % 4], random.choice(QUESTIONS)) for i in range(12)]
    futs += [ex.submit(chat, sessions[i % 4], QUESTIONS[0], 3) for i in range(4)]
    res = [f.result() for f in futs]
print("  results:", {r: res.count(r) for r in set(res)}, "| alive:", alive(), "| mem MB:", mem_mb())
if not alive():
    problem("server died during concurrent chats")

print("== 2. concurrent uploads (HOD) x4 incl. scanned PDF, while chatting")
hod = session("rajesh.mm", "Rajesh@2026")
files = [os.path.join(ROOT, "data", "corpus", f) for f in ("inspection_E-310_scan.pdf", "A2_troubleshooting_guide.pdf", "inspection_E-310_scan.pdf", "A2_datasheet_rev1.pdf")]


def upload(i: int, path: str) -> str:
    c = session("rajesh.mm", "Rajesh@2026")
    with open(path, "rb") as fh:
        r = c.post("/api/documents", files={"file": (f"stress{i}_" + os.path.basename(path), fh.read(), "application/pdf")},
                   data={"doc_type": "manual", "classification": "INTERNAL", "title": f"Stress upload {i}"})
    if r.status_code != 200:
        problem(f"upload HTTP {r.status_code} {r.text[:200]}")
        return "http"
    jid = r.json()["job_id"]
    for _ in range(180):
        j = c.get(f"/api/jobs/{jid}").json()
        if j["status"] in ("done", "error"):
            if j["status"] == "error":
                problem(f"ingest error: {j.get('error')}")
            return j["status"]
        time.sleep(1)
    problem("ingest timeout")
    return "timeout"


with cf.ThreadPoolExecutor(8) as ex:
    ups = [ex.submit(upload, i, f) for i, f in enumerate(files)]
    chats = [ex.submit(chat, sessions[i % 4], random.choice(QUESTIONS)) for i in range(4)]
    print("  uploads:", [u.result() for u in ups], "| chats:", [c.result() for c in chats], "| alive:", alive(), "| mem MB:", mem_mb())
if not alive():
    problem("server died during concurrent uploads")

print("== 3. model reload while chats are streaming")
mid = [m for m in admin.get("/api/models").json() if m["source"] != "engine"][0]["id"]
with cf.ThreadPoolExecutor(6) as ex:
    cs = [ex.submit(chat, sessions[i % 4], QUESTIONS[1]) for i in range(3)]
    time.sleep(1.5)
    admin.post("/api/models/load", json={"engine": "llamacpp", "model_id": mid, "load_config": {"ctx_size": 8192, "parallel": 2}})
    res = [c.result() for c in cs]
for _ in range(120):
    if admin.get("/api/models/loaded").json()["status"] in ("ready", "error"):
        break
    time.sleep(1)
print("  chats during reload:", res, "| engine:", admin.get("/api/models/loaded").json()["status"], "| alive:", alive())
r = chat(sessions[0], QUESTIONS[1])
print("  chat after reload:", r)
if r != "ok":
    problem(f"chat after reload failed: {r}")

print("== 4. llama-server killed mid-session (crash recovery)")
for p in psutil.process_iter(["name"]):
    if (p.info["name"] or "").lower().startswith("llama-server"):
        p.kill()
time.sleep(3)
st = admin.get("/api/models/loaded").json()["status"]
r1 = chat(sessions[0], QUESTIONS[1])
print("  engine status right after kill:", st, "| chat:", r1)
for _ in range(90):
    if admin.get("/api/models/loaded").json()["status"] == "ready":
        break
    time.sleep(1)
r2 = chat(sessions[0], QUESTIONS[1])
print("  engine after wait:", admin.get("/api/models/loaded").json()["status"], "| chat:", r2)
if r2 != "ok":
    problem(f"engine did not recover after llama-server crash (chat: {r2})")

print("== 5. login storm (60 logins, 10 threads) + bad passwords")
with cf.ThreadPoolExecutor(10) as ex:
    codes = list(ex.map(lambda i: httpx.post(B + "/api/auth/login", json={"username": "priya.hse", "password": "Priya@2026" if i % 5 else "wrong"},
                                              timeout=60).status_code, range(60)))
print("  status codes:", {c: codes.count(c) for c in set(codes)}, "| alive:", alive())
if any(c >= 500 for c in codes):
    problem("5xx during login storm")

print("== 6. usage/audit endpoints under load")
for _ in range(5):
    for path in ("/api/admin/usage", "/api/audit?limit=500", "/api/audit/verify", "/api/company", "/api/documents"):
        r = admin.get(path)
        if r.status_code >= 500:
            problem(f"{path} -> {r.status_code}")
print("  final alive:", alive(), "| mem MB:", mem_mb())
print("\nRESULT:", "NO PROBLEMS" if not PROBLEMS else f"{len(PROBLEMS)} PROBLEMS")
for p in PROBLEMS:
    print(" -", p[:300])
