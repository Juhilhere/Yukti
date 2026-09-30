"""Publish a Yukti release to a website folder.

Produces <out>/ (upload the whole folder to your website, e.g. https://example.com/yukti/):
  index.html                 download page with the one-click "Download Yukti" button
  Yukti-Setup-<ver>.exe      desktop app installer (the only thing users click)
  manifest.json              component list with sizes and SHA-256 (the desktop app reads this)
  files/<artifact>.partNN    server components split into parts (host file-size limits)

Usage:
  python ops/publish.py --package E:/yukti-build/Yukti-Server-0.4.0 --setup desktop/dist/Yukti-Setup-0.4.0.exe
                        --out E:/yukti-build/publish --version 0.4.0 --part-mb 1900
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8 * 2**20), b""):
            h.update(chunk)
    return h.hexdigest().upper()


def make_zip(src_root: Path, members: list[Path], out: Path) -> None:
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
        for m in members:
            if m.is_dir():
                for root, _, files in os.walk(m):
                    for f in files:
                        p = Path(root) / f
                        z.write(p, p.relative_to(src_root).as_posix())
            elif m.exists():
                z.write(m, m.relative_to(src_root).as_posix())


def split(file: Path, out_dir: Path, name: str, part_bytes: int, url_prefix: str = "files/") -> list[dict]:
    parts = []
    with file.open("rb") as f:
        i = 0
        while True:
            data_path = out_dir / f"{name}.part{i:02d}"
            h = hashlib.sha256()
            n = 0
            with data_path.open("wb") as o:
                while n < part_bytes:
                    chunk = f.read(min(8 * 2**20, part_bytes - n))
                    if not chunk:
                        break
                    o.write(chunk)
                    h.update(chunk)
                    n += len(chunk)
            if n == 0:
                data_path.unlink()
                break
            parts.append({"url": f"{url_prefix}{data_path.name}", "size": n, "sha256": h.hexdigest().upper()})
            i += 1
    return parts


PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Download Yukti</title>
<style>
 :root{{--bg:#0e0e10;--s:#161618;--b:#2a2a2e;--t:#ececee;--m:#9a9aa3;--a:#f5a524;--c:#22d3ee}}
 *{{box-sizing:border-box}} body{{margin:0;background:var(--bg);color:var(--t);font:15px/1.55 system-ui,Segoe UI,Inter,sans-serif}}
 main{{max-width:880px;margin:0 auto;padding:56px 20px}} h1{{font-size:34px;margin:0 0 6px}} .sub{{color:var(--m);margin:0 0 28px}}
 .card{{background:var(--s);border:1px solid var(--b);border-radius:12px;padding:24px;margin:16px 0}}
 .btn{{display:inline-flex;gap:10px;align-items:center;background:var(--a);color:#111;font-weight:700;padding:14px 22px;border-radius:10px;text-decoration:none;font-size:17px}}
 .meta{{color:var(--m);font-size:13px;margin-top:10px}} code{{font-family:ui-monospace,Consolas,monospace;color:var(--c);word-break:break-all}}
 table{{width:100%;border-collapse:collapse;font-size:13px}} td,th{{border-top:1px solid var(--b);padding:8px 6px;text-align:left}} th{{color:var(--m);font-weight:500}}
 ol li{{margin:6px 0}}
</style></head><body><main>
<h1>Yukti</h1><p class="sub">Sovereign Industrial AI Workbench · version {version} · Windows 10/11 (64-bit)</p>
<div class="card">
 <a class="btn" href="{setup}" download>⬇ Download Yukti for Windows</a>
 <div class="meta">{setup} · {setup_mb} MB · SHA-256 <code>{setup_sha}</code></div>
 <ol>
  <li>Run the installer (Windows may show SmartScreen — choose <i>More info → Run anyway</i> until the installer is code-signed).</li>
  <li>Open Yukti. Choose <b>Install Yukti on this PC</b> (downloads the AI server, runtime and model — {server_gb} GB, resumable, verified) or <b>Connect to our plant server</b>.</li>
  <li>Sign in with the account your administrator created.</li>
 </ol>
</div>
<div class="card"><b>System requirements</b>
 <table><tr><th>Component</th><th>Minimum</th><th>Recommended</th></tr>
 <tr><td>OS</td><td>Windows 10 64-bit</td><td>Windows 11 64-bit</td></tr>
 <tr><td>Memory</td><td>8 GB RAM</td><td>16 GB RAM or more</td></tr>
 <tr><td>GPU</td><td>none (CPU mode)</td><td>NVIDIA GPU, 6 GB VRAM+ (CUDA) · AMD/Intel via Vulkan</td></tr>
 <tr><td>Disk</td><td colspan="2">{disk_gb} GB free during installation</td></tr></table>
</div>
<div class="card"><b>Components</b> (installed by the app from <code>manifest.json</code>, each verified by SHA-256)
 <table><tr><th>Component</th><th>Size</th><th>When</th></tr>{rows}</table>
 <div class="meta">Published {published} · Yukti runs fully on-premise; after installation no internet connection is needed or used.</div>
</div>
</main></body></html>
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True, type=Path)
    ap.add_argument("--setup", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--version", required=True)
    ap.add_argument("--part-mb", type=int, default=1900, help="max size of each uploaded file (host limit)")
    ap.add_argument("--github", default="", help="owner/repo: publish as GitHub release assets (flat files, absolute versioned URLs)")
    ap.add_argument("--tag", default="", help="release tag for --github (default v<version>)")
    a = ap.parse_args()
    # GitHub release assets: one flat folder, each part < 2 GiB, URLs pinned to the tag (so the "latest" manifest always
    # points at the parts of the same version)
    gh_base = f"https://github.com/{a.github}/releases/download/{a.tag or 'v' + a.version}/" if a.github else ""
    pkg, out = a.package.resolve(), a.out.resolve()
    if out.exists():
        shutil.rmtree(out)
    files = out if gh_base else out / "files"
    files.mkdir(parents=True, exist_ok=True)
    work = out.parent / (out.name + "-work")
    work.mkdir(exist_ok=True)
    part = a.part_mb * 2**20
    models = sorted((pkg / "models").rglob("*.gguf"))
    specs = [
        {"name": "server-core", "kind": "zip", "check": "yukti-server.exe", "replace_dir": "_internal", "label": "Yukti server, UI, Laya, public data, examples",
         "members": [p for p in pkg.iterdir() if p.name not in ("llama", "models", "data", "speech")] +
                    [p for p in (pkg / "data").iterdir() if p.name != "store"] + [pkg / "data" / "store" / "laya", pkg / "models" / "MODELS.txt"]},
        {"name": "llama-cuda", "kind": "zip", "check": "llama/cuda/llama-server.exe", "requires": "nvidia", "replace_dir": "llama/cuda",
         "label": "llama.cpp CUDA 12.4 runtime", "members": [pkg / "llama" / "cuda"]},
        {"name": "llama-vulkan", "kind": "zip", "check": "llama/vulkan/llama-server.exe", "replace_dir": "llama/vulkan",
         "label": "llama.cpp Vulkan / CPU runtime", "members": [pkg / "llama" / "vulkan"]},
        {"name": "speech-cuda", "kind": "zip", "check": "speech/cuda/whisper-server.exe", "requires": "nvidia", "replace_dir": "speech/cuda",
         "label": "Voice input (NVIDIA GPU)", "members": [pkg / "speech" / "cuda"]},
        {"name": "speech-cpu", "kind": "zip", "check": "speech/cpu/whisper-server.exe", "replace_dir": "speech/cpu",
         "label": "Voice input", "members": [pkg / "speech" / "cpu"]},
    ] + [{"name": "voice-" + m.stem.lower(), "kind": "file", "dest": m.relative_to(pkg).as_posix(), "check": m.relative_to(pkg).as_posix(),
          "label": f"Voice model {m.name}", "src": m, **({"requires": "nvidia"} if "turbo" in m.name else {})}
         for m in sorted((pkg / "speech" / "models").glob("*.bin"))] + [{"name": "model-" + m.stem.lower(), "kind": "file", "dest": m.relative_to(pkg).as_posix(), "check": m.relative_to(pkg).as_posix(),
          "label": f"Model {m.name}", "src": m} for m in models]
    artifacts = []
    for s in specs:
        if s["kind"] == "zip":
            z = work / f"{s['name']}.zip"
            print("zipping", s["name"])
            make_zip(pkg, s["members"], z)
            src = z
        else:
            src = s["src"]
        print("hashing / splitting", s["name"], f"{src.stat().st_size / 2**20:.0f} MB")
        art = {k: v for k, v in s.items() if k not in ("members", "src")}
        art.update({"size": src.stat().st_size, "sha256": sha256(src), "parts": split(src, files, s["name"], part, gh_base or "files/")})
        if s["kind"] == "file":
            art["dest"] = s["dest"]
        artifacts.append(art)
    setup_name = a.setup.name if gh_base else f"Yukti-Setup-{a.version}.exe"   # GitHub: stable name for /releases/latest/download/
    shutil.copy2(a.setup, out / setup_name)
    manifest = {"product": "yukti-server", "version": a.version, "published_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "desktop": {"file": setup_name, "size": (out / setup_name).stat().st_size, "sha256": sha256(out / setup_name)},
                "artifacts": artifacts}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    total = sum(x["size"] for x in artifacts)
    rows = "".join(f"<tr><td>{x['label']}</td><td>{x['size'] / 2**20:,.0f} MB</td><td>{'NVIDIA GPUs only' if x.get('requires') == 'nvidia' else 'always'}</td></tr>"
                   for x in artifacts)
    if gh_base:
        shutil.rmtree(work)
        print(f"\nGitHub release assets in {out} ({total / 2**30:.2f} GB of components) - upload every file to tag "
              f"{a.tag or 'v' + a.version} of {a.github}, then sign manifest.json")
        return
    (out / "index.html").write_text(PAGE.format(version=a.version, setup=setup_name, setup_mb=round(manifest["desktop"]["size"] / 2**20),
                                                setup_sha=manifest["desktop"]["sha256"], server_gb=f"{total / 2**30:.1f}",
                                                disk_gb=f"{total * 2.2 / 2**30:.0f}", rows=rows, published=manifest["published_at"]), encoding="utf-8")
    shutil.rmtree(work)
    print(f"\nPublished to {out}\n  upload the whole folder; manifest: <site>/<folder>/manifest.json\n  components: {total / 2**30:.2f} GB in "
          f"{sum(len(x['parts']) for x in artifacts)} files (<= {a.part_mb} MB each)")


if __name__ == "__main__":
    main()
