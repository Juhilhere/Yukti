"""Live test of photo questions and voice input against a running server with a vision model available.

    cd backend && uv run python tests/live/media_live.py [base_url] [images_dir] [audio_dir]
"""
import io
import json
import sys
import time
import wave
from pathlib import Path

import httpx

B = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
IMG = Path(sys.argv[2] if len(sys.argv) > 2 else r"E:\yukti-build\research\images")
AUD = Path(sys.argv[3] if len(sys.argv) > 3 else r"E:\yukti-build\research\audio")
FAILS: list[str] = []


def check(name, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + name + ("" if cond else f"  -> {str(detail)[:400]}"), flush=True)
    if not cond:
        FAILS.append(name)


def session(user, pw, lang="en"):
    c = httpx.Client(base_url=B, timeout=600, headers={"X-Lang": lang})
    r = c.post("/api/auth/login", json={"username": user, "password": pw})
    r.raise_for_status()
    c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    return c


def ask(c, text, images):
    chat = c.post("/api/chats", json={}).json()
    ev, toks, name = {}, [], None
    t0 = time.time()
    with c.stream("POST", f"/api/chats/{chat['id']}/messages", json={"content": text, "use_knowledge": True, "images": images}) as r:
        for line in r.iter_lines():
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                d = json.loads(line[5:])
                if name == "token":
                    toks.append(d["t"])
                else:
                    ev[name] = d
    return chat["id"], ev, "".join(toks), time.time() - t0


admin = session("admin", "Admin@2026")
st = admin.get("/api/models/loaded").json()
if st.get("status") != "ready" or not st.get("vision"):
    ms = [m for m in admin.get("/api/models").json() if m.get("vision") and m.get("source") == "yukti"]
    check("a vision model is available", bool(ms), [m["name"] for m in admin.get("/api/models").json()])
    admin.post("/api/models/load", json={"engine": "llamacpp", "model_id": ms[0]["id"], "load_config": {"ctx_size": 8192}})
    for _ in range(300):
        st = admin.get("/api/models/loaded").json()
        if st.get("status") in ("ready", "error"):
            break
        time.sleep(1)
check("vision model loaded", st.get("status") == "ready" and st.get("vision"), st)

u = session("meera.me", "Meera@2026")
check("employee sees vision flag", u.get("/api/models/loaded").json().get("vision") is True)

# --- uploads: cleaning, limits, ownership
r = u.post("/api/attachments", files={"file": ("x.txt", b"not an image", "text/plain")})
check("non-image refused 422", r.status_code == 422, r.text)
r = u.post("/api/attachments", files={"file": ("big.jpg", b"\xff" * (16 * 1024 * 1024), "image/jpeg")})
check("over 15 MB refused 413", r.status_code == 413, r.status_code)
up = u.post("/api/attachments", files={"file": ("pipe.jpg", (IMG / "test_pipe_V-501.jpg").read_bytes(), "image/jpeg")}).json()
check("upload ok", up.get("id") and up["mime"] == "image/jpeg" and max(up["width"], up["height"]) <= 1600, up)
img = u.get(f"/api/attachments/{up['id']}")
check("owner can view", img.status_code == 200 and img.headers["content-type"] == "image/jpeg")
from PIL import Image  # noqa: E402
check("no EXIF kept", not Image.open(io.BytesIO(img.content)).getexif())
check("thumbnail <= 320", max(Image.open(io.BytesIO(u.get(f"/api/attachments/{up['id']}?thumb=1").content)).size) <= 320)
other = session("ravi.e", "Ravi@2026")
check("other user cannot view", other.get(f"/api/attachments/{up['id']}").status_code == 404)
_, ev, _, _ = ask(other, "what is this", [up["id"]])
check("other user cannot send someone else's photo", "error" in ev and "photo" not in ev, ev.get("error"))

# --- photo questions (English, Hindi)
for lang, q in (("en", "Which line is this and what flows in it? Anything that needs attention?"),
                ("hi", "यह कौन सी लाइन है और इसमें क्या बहता है?")):
    c = session("meera.me", "Meera@2026", lang)
    cid, ev, ans, secs = ask(c, q, [up["id"]])
    ph = ev.get("photo") or {}
    tags = [t["tag"] for x in ph.get("images", []) for t in x["tags"]]
    print(f"  [{lang}] {secs:.1f}s tags={tags} vision={ph.get('vision')}\n  ---\n  {ans[:700]}\n  ---")
    check(f"[{lang}] photo event with OCR text", ph.get("images") and "V-501" in ph["images"][0]["text"].replace(" ", ""), ph)
    check(f"[{lang}] tag V-501 found", "V-501" in tags, tags)
    check(f"[{lang}] answer mentions V-501", "V-501" in ans or "V501" in ans, ans[:300])
    check(f"[{lang}] no error", "error" not in ev, ev.get("error"))
    msgs = c.get(f"/api/chats/{cid}").json()["messages"]
    check(f"[{lang}] stored user images + assistant photo", msgs[0]["images"] == [up["id"]] and msgs[-1]["photo"], msgs[0])

# a photo without text; a rusty pipe without any tag must not be guessed
rust = u.post("/api/attachments", files={"file": ("rust.jpg", (IMG / "Assortment_of_rusty_pipes_2.jpg").read_bytes(), "image/jpeg")}).json()
_, ev, ans, secs = ask(u, "", [rust["id"]])
print(f"  [rust, no text] {secs:.1f}s\n  ---\n  {ans[:700]}\n  ---")
check("photo-only question answered", len(ans) > 40 and "error" not in ev, ev.get("error"))
check("rust is pointed out", any(w in ans.lower() for w in ("rust", "corros")), ans[:300])
check("unlabelled photo not linked to equipment", not any(t in ans for t in ("E-310", "V-501", "A2", "V-101")), ans[:300])
_, ev, ans, secs = ask(u, "Which chemical flows in this pipe?", [rust["id"]])
print(f"  [rust, which chemical] {secs:.1f}s\n  ---\n  {ans[:700]}\n  ---")
check("no chemical guessed without a tag", not any(t in ans for t in ("E-310", "V-501", "MDEA", "crude")), ans[:400])

# --- voice
s = u.get("/api/speech/status").json()
print("  speech status:", s)
check("speech available", s.get("available"), s)
r = u.post("/api/speech/transcribe", files={"audio": ("a.wav", b"RIFFjunk", "audio/wav")}, data={"language": "en"})
check("bad wav 422", r.status_code == 422, r.text)
buf = io.BytesIO()
with wave.open(buf, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(b"\x00\x00" * 16000 * 2)
r = u.post("/api/speech/transcribe", files={"audio": ("s.wav", buf.getvalue(), "audio/wav")}, data={"language": "en"}).json()
check("silence gives empty text", r.get("text") == "" and r.get("no_speech"), r)
for clip in sorted(AUD.glob("0[0-3]-*.wav")):
    if "noisy" in clip.name and clip.name.count("noisy") > 1:
        continue
    t0 = time.time()
    r = u.post("/api/speech/transcribe", files={"audio": (clip.name, clip.read_bytes(), "audio/wav")}, data={"language": "en"})
    out = r.json()
    ref = clip.with_name(clip.name.split("-noisy")[0].replace(".wav", "") + ".txt").read_text(encoding="utf-8-sig").strip()
    print(f"  {clip.name:24s} {time.time() - t0:5.1f}s [{out.get('device')}] {out.get('text')!r}\n  {'':24s}  ref: {ref!r}")
    check(f"transcribed {clip.name}", r.status_code == 200 and out.get("text"), out)

print("\nFAILED:" if FAILS else "\nALL PASSED", FAILS)
sys.exit(1 if FAILS else 0)
