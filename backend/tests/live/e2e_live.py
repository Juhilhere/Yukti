"""End-to-end API test for Yukti v0.2 — run against a live server:  cd backend && uv run python tests/live/e2e_live.py"""
import json
import os
import sys
import time

import httpx

B = os.environ.get("YUKTI_TEST_URL", "http://127.0.0.1:8000")
FAILS: list[str] = []

def wait_ready(timeout: float = 900) -> None:
    """Block until /api/health reports ready (knowledge prepared and, if autoloaded, the model up)."""
    end, last = time.time() + timeout, ""
    while time.time() < end:
        try:
            h = httpx.get(B + "/api/health", timeout=5).json()
            if h.get("ready"):
                return
            if h.get("stage") != last:
                last = h.get("stage", "")
                print(f"  waiting: {last} {h.get('progress') or ''}")
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2)
    sys.exit("server did not become ready")



def check(name: str, cond: bool, detail: object = "") -> None:
    print(("  PASS " if cond else "  FAIL ") + name + ("" if cond else f"  -> {str(detail)[:300]}"))
    if not cond:
        FAILS.append(name)


def session(user: str, pw: str, totp: str | None = None) -> httpx.Client:
    c = httpx.Client(base_url=B, timeout=300)
    body = {"username": user, "password": pw}
    if totp:
        body["totp"] = totp
    r = c.post("/api/auth/login", json=body)
    if r.status_code == 200:
        c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    c.last_login = r  # type: ignore[attr-defined]
    return c


def ask(c: httpx.Client, text: str) -> tuple[dict, str]:
    chat = c.post("/api/chats", json={}).json()
    ev: dict = {}
    toks: list[str] = []
    with c.stream("POST", f"/api/chats/{chat['id']}/messages", json={"content": text, "use_knowledge": True,
                                                                       "prediction": {"temperature": 1.9}}) as r:
        name = None
        for line in r.iter_lines():
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                d = json.loads(line[5:])
                if name == "token":
                    toks.append(d["t"])
                else:
                    ev[name] = d
    ev["_chat"] = chat["id"]
    return ev, "".join(toks)


wait_ready()
print("== admin basics")
a = session("admin", "Admin@2026")
check("admin login", a.last_login.status_code == 200, a.last_login.text)
me = a.get("/api/auth/me").json()
for p in ("users.manage", "ai.settings", "usage.view", "backup.manage", "models.manage"):
    check(f"admin has {p}", p in me["permissions"])
check("departments >= 40", len(a.get("/api/departments").json()) >= 40)
roles = a.get("/api/admin/roles").json()
check("roles listed", len(roles) >= 8)
r = a.post("/api/admin/users", json={"username": "test.user", "display_name": "Test User", "post": "Engineer", "department": "Process Engineering",
                                     "clearance": 1, "roles": ["engineer"], "asset_scopes": ["CDU-1"]})
check("create user", r.status_code == 200, r.text)
temp = r.json().get("temp_password", "")
uid = r.json().get("user", {}).get("id")
check("duplicate user rejected", a.post("/api/admin/users", json={"username": "test.user", "display_name": "Dup", "department": "Process Engineering"}).status_code == 409)
check("user without display name rejected", a.post("/api/admin/users", json={"username": "x.noname", "department": "Process Engineering"}).status_code == 422)
check("unknown department rejected", a.post("/api/admin/users", json={"username": "x.y", "department": "Nope"}).status_code == 422)
t = session("test.user", temp)
check("new user login", t.last_login.status_code == 200)
check("forced password change blocks APIs", t.get("/api/chats").status_code == 403)
check("weak password rejected", t.post("/api/auth/password", json={"current_password": temp, "new_password": "short"}).status_code == 400)
check("password change ok", t.post("/api/auth/password", json={"current_password": temp, "new_password": "NewPassword2026x"}).status_code == 200)
check("APIs work after change", t.get("/api/chats").status_code == 200)
check("employee cannot see params schema", t.get("/api/params/schema").status_code == 403)
check("employee cannot load models", t.post("/api/models/load", json={"model_id": "x"}).status_code == 403)
check("employee cannot see engines", t.get("/api/engines").status_code == 403)
lm = t.get("/api/models/loaded").json()
check("employee sees only model name/status", set(lm) <= {"status", "engine", "model_name", "vision"}, lm)
check("disable user", a.patch(f"/api/admin/users/{uid}", json={"status": "disabled"}).json().get("status") == "disabled")
check("disabled user session revoked", t.get("/api/auth/me").status_code == 401)
check("disabled user cannot login", session("test.user", "NewPassword2026x").last_login.status_code == 403)
a.patch(f"/api/admin/users/{uid}", json={"status": "active"})
rp = a.post(f"/api/admin/users/{uid}/reset-password").json()
check("reset password", bool(rp.get("temp_password")))
check("admin cannot disable self", a.patch(f"/api/admin/users/{me['user']['id']}", json={"status": "disabled"}).status_code == 400)
csv_body = "username,display_name,post,department,clearance,roles,asset_scopes\nimp.one,Imp One,Engineer,Process Engineering,1,engineer,CDU-1\nimp.bad,Bad,Eng,Nowhere,1,engineer,\n"
imp = a.post("/api/admin/users/import", files={"file": ("u.csv", csv_body, "text/csv")}).json()
check("CSV import created 1, error 1", len(imp["created"]) == 1 and len(imp["errors"]) == 1, imp)
check("CSV template", "username" in a.get("/api/admin/users/template.csv").text)

print("== MFA")
import pyotp  # noqa: E402

en = a.post("/api/auth/mfa/enroll").json()
check("mfa enroll returns svg", en.get("qr_svg", "").startswith("<?xml") or "<svg" in en.get("qr_svg", ""))
ver = a.post("/api/auth/mfa/verify", json={"code": pyotp.TOTP(en["secret"]).now()})
check("mfa verify", ver.status_code == 200 and len(ver.json().get("recovery_codes", [])) == 10, ver.text)
check("login without totp -> mfa_required", session("admin", "Admin@2026").last_login.json()["detail"]["code"] == "mfa_required")
time.sleep(31)
a2 = session("admin", "Admin@2026", pyotp.TOTP(en["secret"]).now())
check("login with totp", a2.last_login.status_code == 200, a2.last_login.text)
check("mfa disable needs a code", a2.post("/api/auth/mfa/disable", json={"password": "Admin@2026"}).status_code == 400)
check("mfa disable with recovery code", a2.post("/api/auth/mfa/disable", json={"password": "Admin@2026", "code": ver.json()["recovery_codes"][0]}).status_code == 200)
a = a2

print("== AI settings (organisation-wide)")
ai = a.get("/api/admin/ai-settings").json()
check("ai settings shape", "prediction" in ai and "system_prompt" in ai)
ai["prediction"]["temperature"] = 0.1
ai["prediction"]["max_tokens"] = 300
check("ai settings save", a.put("/api/admin/ai-settings", json=ai).json()["prediction"]["temperature"] == 0.1)

print("== employee chat uses org settings (temperature override ignored)")
ravi = session("ravi.e", "Ravi@2026")
ev, ans = ask(ravi, "A2 tripped at 02:15 - give me the isolation and restart dossier")
check("A2 answer streamed", len(ans) > 20 and "done" in ev, ev.get("error"))
check("A2 facts: conflicts found", any(f["status"] == "CONFLICTING" for f in ev.get("facts", {}).get("facts", [])))
check("A2 sources are EXAMPLE docs", all("[EXAMPLE]" in s["title"] for s in ev.get("retrieval", {}).get("sources", []) if s.get("doc_number") != "MRPL-PUB-REF"))
check("finance withheld for electrician", ev.get("retrieval", {}).get("denied", {}).get("count", 0) >= 1)
mid = ev.get("done", {}).get("message_id")
check("feedback", ravi.post(f"/api/messages/{mid}/feedback", json={"rating": -1, "comment": "test"}).status_code == 200)
ev, ans = ask(ravi, "Who is the managing director of MRPL?")
check("MRPL MD answer", "Kamath" in ans, ans[:200])

print("== access request flow")
a.post("/api/admin/demo/reset")
anil = session("anil.u", "Anil@2026")
ev, ans = ask(anil, "What is the Q2 boiler fuel-cost audit variance?")
check("anil denied finance", ev.get("retrieval", {}).get("denied", {}).get("count", 0) >= 1)
check("canary not leaked", "CANARY" not in ans)
ar = anil.post("/api/access-requests", json={"department": "Finance & Accounts", "justification": "B-02 RCA", "hours": 2}).json()
check("request created", ar.get("state") == "PENDING", ar)
kav = session("kavita.fm", "Kavita@2026")
pend = [x for x in kav.get("/api/access-requests").json()["to_approve"] if x["state"] == "PENDING"]
check("finance manager sees request", len(pend) == 1)
check("approve", kav.post(f"/api/access-requests/{pend[0]['id']}/approve", json={"hours": 2}).json().get("state") == "GRANTED")
ev, ans = ask(anil, "What is the Q2 boiler fuel-cost audit variance?")
check("anil now answered from audit", any(s["doc_number"] == "FIN-AUD-2026-Q2" for s in ev.get("retrieval", {}).get("sources", [])))

print("== findings workflow")
sur = session("suresh.em", "Suresh@2026")
check("electrical HOD does not see mechanical findings", sur.get("/api/findings").json() == [])
mee = session("meera.me", "Meera@2026")
f = mee.get("/api/findings").json()[0]
check("mechanical engineer: acknowledge/escalate/note, no approve", {"acknowledge", "escalate", "note"} <= set(f["allowed_actions"]) and "approve" not in f["allowed_actions"], f["allowed_actions"])
check("note action", mee.post(f"/api/findings/{f['id']}/action", json={"action": "note", "note": "checked"}).status_code == 200)
raj = session("rajesh.mm", "Rajesh@2026")
f = raj.get("/api/findings").json()[0]
check("mechanical HOD has approve/reject", {"approve", "reject"} <= set(f["allowed_actions"]), f["allowed_actions"])
check("reject directly from PENDING", raj.post(f"/api/findings/{f['id']}/action", json={"action": "reject", "note": "re-measure"}).json().get("state") == "REJECTED")
check("reject again not allowed", raj.post(f"/api/findings/{f['id']}/action", json={"action": "reject"}).status_code == 403)

print("== department & rank scoping")
check("employee cannot read engine logs", ravi.get("/api/server/logs").status_code == 403)
check("employee cannot read engine status", ravi.get("/api/server/status").status_code == 403)
con = session("contractor.x", "Vendor@2026")
check("contractor sees only assigned unit assets", all(x["unit"] == "CDU-1" for x in con.get("/api/assets").json()))
check("contractor gets no work orders", con.get("/api/assets/A2").json().get("work_orders") == [])
check("HOD audit limited to department (no export)", sur.get("/api/audit/export").status_code == 403)
check("IT admin cannot read finance audit", not any(d["doc_number"] == "FIN-AUD-2026-Q2" for d in a.get("/api/documents").json()))
check("security headers", "default-src 'self'" in ravi.get("/api/health").headers.get("content-security-policy", ""))

print("== guardrails")
con = session("contractor.x", "Vendor@2026")
ev, _ = ask(con, "What lean MDEA amine concentration should we run?")
check("contractor blocked chemistry", ev.get("guard", {}).get("decision") == "deny")
ev, _ = ask(ravi, "Set FIC-101 setpoint to 180 now")
check("setpoint change refused", ev.get("guard", {}).get("decision") == "deny")

print("== production (no invented numbers)")
arj = session("arjun.pl", "Arjun@2026")
ov = arj.get("/api/production/overview").json()
check("overview has public production data", len(ov["public"]["production_by_fy"]) > 10)
m = arj.get("/api/production/model").json()
check("model starts incomplete", m["complete"] is False and len(m["missing"]) > 0)
check("scenario refused while incomplete", arj.post("/api/production/scenario", json={}).status_code == 422)

print("== data is added only by HODs, for their own department")
import os  # noqa: E402

pdf = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "data", "corpus", "A2_troubleshooting_guide.pdf"), "rb").read()
check("identical file rejected as duplicate", session("rajesh.mm", "Rajesh@2026").post("/api/documents", files={"file": ("dup.pdf", pdf, "application/pdf")}).status_code == 409)
pdf += b"\n% e2e " + str(time.time()).encode() + b"\n"  # a distinct file for the upload tests
check("employee cannot upload", ravi.post("/api/documents", files={"file": ("t.pdf", pdf, "application/pdf")}).status_code == 403)
check("admin cannot upload", a.post("/api/documents", files={"file": ("t.pdf", pdf, "application/pdf")}).status_code == 403)
raj = session("rajesh.mm", "Rajesh@2026")
up = raj.post("/api/documents", files={"file": ("hod.pdf", pdf, "application/pdf")}, data={"department": "Finance & Accounts", "classification": "INTERNAL"}).json()
for _ in range(60):
    if raj.get(f"/api/jobs/{up['job_id']}").json()["status"] in ("done", "error"):
        break
    time.sleep(1)
check("HOD upload forced to own department", raj.get(f"/api/documents/{up['document_id']}").json()["department"] == "Mechanical Maintenance")
other = [x for x in raj.get("/api/documents").json() if x["department"] != "Mechanical Maintenance" and not x["is_public"]]
check("HOD cannot delete other department's document", bool(other) and raj.delete(f"/api/documents/{other[0]['id']}").status_code == 403)
check("HOD deletes own document", raj.delete(f"/api/documents/{up['document_id']}").status_code == 200)

print("== usage, backup, audit, laya, models")
u = a.get("/api/admin/usage").json()
check("usage measured answers", u["perf"]["answers"] >= 1 and u["perf"]["avg_tok_per_s"], u["perf"])
check("usage feedback counted", u["feedback"]["down"] >= 1)
b = a.post("/api/admin/backups").json()
check("backup created", b.get("size_bytes", 0) > 1000, b)
check("backup listed", any(x["name"] == b["name"] for x in a.get("/api/admin/backups").json()))
check("backup download", a.get(f"/api/admin/backups/{b['name']}/file").status_code == 200)
check("audit export csv (org-wide roles)", a.get("/api/audit/export?format=csv").text.startswith("seq,"))
check("audit chain verifies", a.get("/api/audit/verify").json().get("ok") is True)
st = a.get("/api/laya/stats").json()
check("laya: no hard-coded baseline before benchmark", st.get("benchmark") is None or st.get("baseline_llm_router_ms") is not None)
lb = a.post("/api/admin/laya/benchmark", json={"n": 3})
check("laya benchmark measured", lb.status_code == 200 and lb.json().get("llm_router_avg_ms", 0) > 0, lb.text)
check("import dirs", "dirs" in a.get("/api/admin/models/import-dirs").json())
check("import bad path rejected", a.post("/api/admin/models/import", json={"path": "C:/nope.gguf"}).status_code == 422)
# need-to-know: company-level information is for top management only (not even the IT administrator)
check("company page data for top management", session("director.md", "Kavya@2026").get("/api/company").json().get("source_count", 0) > 100)
check("company page refused to the IT admin", a.get("/api/company").status_code == 403)
print()
print("RESULT:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}")
sys.exit(1 if FAILS else 0)
