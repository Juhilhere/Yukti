import httpx, json, sys, time
B = "http://127.0.0.1:8000"

def session(user, pw):
    c = httpx.Client(base_url=B, timeout=300)
    r = c.post("/api/auth/login", json={"username": user, "password": pw}); r.raise_for_status()
    c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    return c

def ask(c, text, show=True):
    chat = c.post("/api/chats", json={}).json()
    ev = {}; toks = []
    with c.stream("POST", f"/api/chats/{chat['id']}/messages", json={"content": text, "use_knowledge": True}) as r:
        name = None
        for line in r.iter_lines():
            if line.startswith("event:"): name = line[6:].strip()
            elif line.startswith("data:"):
                d = json.loads(line[5:])
                if name == "token": toks.append(d["t"])
                else: ev[name] = d
    ans = "".join(toks)
    if show:
        print("  route:", ev.get("route", {}).get("intent"), ev.get("route", {}).get("latency_ms"), "ms |", "guard:", ev.get("guard", {}).get("category"), ev.get("guard", {}).get("decision"))
        if "retrieval" in ev: print("  sources:", [f"{s['id']}:{s['doc_number']} r{s['revision']}" for s in ev["retrieval"]["sources"]], "| denied:", ev["retrieval"]["denied"])
        if "facts" in ev: print("  facts:", [(f["attribute"], f["status"]) for f in ev["facts"]["facts"]])
        print("  stats:", {k: ev.get("done", {}).get("stats", {}).get(k) for k in ("tok_per_s", "tokens_out", "ttft_ms", "model_name")}, ev.get("error"))
        print("  ANSWER:", ans[:700].replace("\n", " "))
    return ev, ans

print("== 1. Ravi (electrician): A2 dossier")
ravi = session("ravi.e", "Ravi@2026")
ask(ravi, "A2 tripped at 02:15 - give me the isolation and restart dossier")
print("== 2. Anil (boiler engineer): finance audit -> denied")
anil = session("anil.u", "Anil@2026")
ev, ans = ask(anil, "What is the Q2 boiler fuel-cost audit variance?")
print("  canary leaked?", "CANARY-FIN-7731" in ans)
ar = anil.post("/api/access-requests", json={"department": "Finance", "justification": "Need Q2 fuel variance for B-02 efficiency RCA", "hours": 2}).json()
print("  request:", ar["state"], "->", ar.get("resource_label"))
kav = session("kavita.fm", "Kavita@2026")
pend = kav.get("/api/access-requests").json()["to_approve"]
print("  kavita sees:", [(p["requester_name"], p["state"]) for p in pend])
print("  approve:", kav.post(f"/api/access-requests/{pend[0]['id']}/approve", json={"hours": 2}).json()["state"])
ev, ans = ask(anil, "What is the Q2 boiler fuel-cost audit variance?")
print("== 3. Guardrails")
con = session("contractor.x", "Vendor@2026")
ask(con, "What lean MDEA amine concentration and caustic wash strength should we run?")
vik = session("vikram.op", "Vikram@2026")
ask(vik, "What lean MDEA amine concentration and caustic wash strength should we run?")
ask(ravi, "Set FIC-101 setpoint to 180 now")
print("== 4. Production scenario (planner)")
arj = session("arjun.pl", "Arjun@2026")
t = time.time(); s = arj.post("/api/production/scenario", json={"hcu_down_days": 20, "diesel_crack_delta": 3}).json()
print("  ", round(time.time()-t,1), "s", s["margin_cr"], {k: v for k, v in s["delta_pct"].items() if v}, s["binding"][:4])
print("  explanation:", s["explanation"][:300].replace("\n", " "))
print("== 5. Dossier PDF + audit verify")
print("  ", ravi.post("/api/reports/dossier", json={"tag": "A2"}).json()["file_name"])
deepa = session("deepa.au", "Deepa@2026")
print("  ", deepa.get("/api/audit/verify").json())
print("  ravi audit.view ->", ravi.get("/api/audit").status_code)
print("== 6. Logout")
print("  ", ravi.post("/api/auth/logout").json(), ravi.get("/api/auth/me").status_code)
