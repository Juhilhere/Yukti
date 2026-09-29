"""Build the single-file Yukti release: ONE zip with the desktop app and the complete Yukti Server inside.

  Yukti-<ver>-Windows.zip
    Yukti-<ver>/
      Yukti.exe  (+ Electron runtime files)   the application users open
      server/                                  yukti-server.exe, llama.cpp CUDA + Vulkan, model, Laya, UI, data
      START HERE.txt, LICENSE, NOTICE

Users extract the zip and double-click Yukti.exe: it starts the bundled server and opens Yukti. Data is kept in
%LOCALAPPDATA%\\Yukti, so a newer version's zip can replace the folder without losing anything.

Usage:
  python ops/bundle.py --app desktop/dist/win-unpacked --package E:/yukti-build/Yukti-Server-0.3.0 \
                       --out E:/yukti-build/publish --version 0.3.0 [--no-page]
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

START_HERE = """YUKTI {version} - Sovereign Industrial AI Workbench (Team UniMinds)
====================================================================

1. Extract this whole folder first (right-click the zip > Extract All...). Do not run Yukti from inside the zip.
2. Double-click Yukti.exe. The first start prepares the knowledge base and loads the AI model (about 1 minute).
   Desktop and Start-menu shortcuts are created automatically.
3. Sign in. {accounts}

Everything runs on this PC, fully offline. Nothing else needs to be installed (no Python, Ollama or LM Studio).
Your data (database, documents, chats, backups) is stored in %LOCALAPPDATA%\\Yukti, not in this folder:
to update, extract a newer version and open its Yukti.exe - your data stays.

Use as a plant server for other PCs: run "server\\Start Yukti Server (Plant LAN).cmd" on the server, then on
employee PCs open Yukti.exe > File > Switch server > Connect to our plant Yukti server.

Remove Yukti: delete this folder, the shortcuts and %LOCALAPPDATA%\\Yukti (and %APPDATA%\\Yukti for app settings).

Problems: juhilprogramming@gmail.com (inside the app: Help > Report a problem).
"""

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Download Yukti</title>
<style>
 :root{{--bg:#0e0e10;--s:#161618;--b:#2a2a2e;--t:#ececee;--m:#9a9aa3;--a:#f5a524;--c:#22d3ee}}
 *{{box-sizing:border-box}} body{{margin:0;background:var(--bg);color:var(--t);font:15px/1.55 system-ui,Segoe UI,Inter,sans-serif}}
 main{{max-width:880px;margin:0 auto;padding:56px 16px}} h1{{font-size:34px;margin:0 0 6px}} .sub{{color:var(--m);margin:0 0 28px}}
 .card{{background:var(--s);border:1px solid var(--b);border-radius:12px;padding:24px;margin:16px 0}}
 .btn{{display:inline-flex;gap:10px;align-items:center;background:var(--a);color:#111;font-weight:700;padding:14px 22px;border-radius:10px;text-decoration:none;font-size:17px}}
 .meta{{color:var(--m);font-size:13px;margin-top:10px}} code{{font-family:ui-monospace,Consolas,monospace;color:var(--c);word-break:break-all}}
 table{{width:100%;border-collapse:collapse;font-size:13px}} td,th{{border-top:1px solid var(--b);padding:8px 6px;text-align:left}} th{{color:var(--m);font-weight:500}}
 ol li{{margin:6px 0}}
</style></head><body><main>
<h1>Yukti</h1><p class="sub">Sovereign Industrial AI Workbench · version {version} · Windows 10/11 (64-bit)</p>
<div class="card">
 <a class="btn" href="{zip}" download>⬇ Download Yukti for Windows ({zip_gb} GB)</a>
 <div class="meta">{zip} · one file with everything: the app, the AI server, the AI engines and the model.<br>SHA-256 <code>{sha}</code></div>
 <ol>
  <li>Right-click the downloaded zip → <b>Extract All…</b></li>
  <li>Open the extracted folder and double-click <b>Yukti.exe</b> (Windows may show SmartScreen — choose <i>More info → Run anyway</i>).</li>
  <li>Wait about a minute on the first start, then sign in. Shortcuts are created on the Desktop and in the Start menu.</li>
 </ol>
</div>
<div class="card"><b>System requirements</b>
 <table><tr><th>Component</th><th>Minimum</th><th>Recommended</th></tr>
 <tr><td>OS</td><td>Windows 10 64-bit</td><td>Windows 11 64-bit</td></tr>
 <tr><td>Memory</td><td>8 GB RAM</td><td>16 GB RAM or more</td></tr>
 <tr><td>GPU</td><td>none (CPU mode)</td><td>NVIDIA GPU, 6 GB VRAM+ (CUDA) · AMD/Intel via Vulkan</td></tr>
 <tr><td>Disk</td><td colspan="2">{disk_gb} GB free (download + extracted)</td></tr></table>
 <div class="meta">Published {published} · Yukti runs fully on-premise; no internet connection is needed or used after download.</div>
</div>
</main></body></html>
"""


def _unused(rel: Path) -> bool:
    """Library test suites and developer tools that the server never imports. Leaving them out shortens the deepest
    paths (Windows' 260-character limit when users extract into long folders such as OneDrive) and the download."""
    parts = [x.lower() for x in rel.parts]
    if parts[:1] == ["_internal"] and "tests" in parts[1:-1] and parts[1] in ("sklearn", "scipy", "numpy", "pandas", "onnx", "skl2onnx"):
        return True
    return parts[:3] == ["_internal", "onnxruntime", "tools"] or parts[:3] == ["_internal", "onnxruntime", "transformers"]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for chunk in iter(lambda: fh.read(16 * 2**20), b""):
            h.update(chunk)
    return h.hexdigest().upper()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", required=True, type=Path, help="electron-builder --dir output (win-unpacked)")
    ap.add_argument("--package", required=True, type=Path, help="Yukti Server package folder")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--version", required=True)
    ap.add_argument("--no-page", action="store_true", help="only build the zip (no index.html)")
    a = ap.parse_args()
    if not (a.app / "Yukti.exe").exists():
        raise SystemExit(f"{a.app} has no Yukti.exe - run `npm run pack` in desktop/ first")
    if not (a.package / "yukti-server.exe").exists():
        raise SystemExit(f"{a.package} has no yukti-server.exe - run ops/build-release.ps1 first")
    a.out.mkdir(parents=True, exist_ok=True)
    top = f"Yukti-{a.version}"
    demo = (a.package / "DEMO_MODE").exists()
    accounts = ("This demonstration build lists sample accounts on the sign-in page (e.g. admin / Admin@2026)."
                if demo else "Use the account your administrator created. First sign-in asks you to set a new password.")
    zpath = a.out / f"Yukti-{a.version}-Windows.zip"
    tmp = zpath.with_suffix(".zip.part")
    n = 0
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
        for base, prefix in ((a.app, Path(top)), (a.package, Path(top) / "server")):
            for p in sorted(base.rglob("*")):
                rel = p.relative_to(base)
                if p.is_dir():
                    continue
                if base == a.package and rel.parts[:2] == ("data", "store") and (len(rel.parts) < 3 or rel.parts[2] != "laya"):
                    continue  # never ship runtime data (database, uploads, logs)
                if base == a.package and p.name == "installed.json":
                    continue
                if base == a.package and _unused(rel):
                    continue
                store = p.suffix.lower() in (".gguf", ".zip") and p.stat().st_size > 64 * 2**20  # already compressed
                z.write(p, prefix / rel, compress_type=zipfile.ZIP_STORED if store else zipfile.ZIP_DEFLATED)
                n += 1
        z.writestr(f"{top}/START HERE.txt", START_HERE.format(version=a.version, accounts=accounts).replace("\n", "\r\n"))
        for extra in ("LICENSE", "NOTICE"):
            z.write(ROOT / extra, f"{top}/{extra}.txt")
    tmp.replace(zpath)
    digest = sha256(zpath)
    (a.out / (zpath.name + ".sha256")).write_text(f"{digest}  {zpath.name}\n", encoding="ascii")
    size = zpath.stat().st_size
    if not a.no_page:
        (a.out / "index.html").write_text(PAGE.format(
            version=a.version, zip=zpath.name, zip_gb=f"{size / 2**30:.1f}", sha=digest,
            disk_gb=f"{size * 2.2 / 2**30:.0f}", published=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")), encoding="utf-8")
    print(f"{zpath}  ({n} files, {size / 2**30:.2f} GB)\nSHA-256 {digest}")


if __name__ == "__main__":
    main()
