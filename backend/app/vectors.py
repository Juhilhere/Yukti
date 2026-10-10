"""Dense vector search (optional): multilingual BGE-M3 embeddings served locally, fused with BM25.

When a BGE-M3 GGUF is in a models folder, Yukti starts a second llama.cpp server in embedding mode on 127.0.0.1 and
embeds every chunk in the background. An administrator can instead point Yukti at an existing local
OpenAI-compatible /v1/embeddings server (`YUKTI_EMBED_URL`). Without either, retrieval is BM25 + asset tags + graph +
structured facts and nothing here runs.

Vectors are only a way to *find* chunks; every hit still passes the same per-document policy check as a BM25 hit.
"""
from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np

from .db import ex, q, q1

_STATE: dict[str, Any] = {"status": "off", "url": os.environ.get("YUKTI_EMBED_URL", "").rstrip("/"), "model": "", "error": None,
                          "proc": None, "indexed": 0}
_MATRIX: dict[str, Any] = {"ids": [], "m": None, "n": -1}
_LOCK = threading.Lock()
BATCH = 16


def model_file() -> Path | None:
    from .config import MODELS_DIRS
    for d in MODELS_DIRS:
        try:
            for p in Path(d).rglob("*.gguf"):
                if "bge-m3" in p.name.lower():
                    return p
        except OSError:
            continue
    return None


def status() -> dict[str, Any]:
    n = (q1("SELECT COUNT(*) n FROM chunk_vectors") or {"n": 0})["n"]
    total = (q1("SELECT COUNT(*) n FROM chunks") or {"n": 0})["n"]
    return {"status": _STATE["status"], "model": _STATE["model"], "error": _STATE["error"], "vectors": n, "chunks": total,
            "url": _STATE["url"] if _STATE["url"] and not _STATE["proc"] else None}


def ready() -> bool:
    return _STATE["status"] == "ready"


def start() -> None:
    """Start the embedding server when a BGE-M3 model is present (background; never blocks the server start)."""
    if _STATE["url"]:
        _STATE.update(status="ready", model="external")
        threading.Thread(target=index_missing, daemon=True, name="embed-index").start()
        return
    mf = model_file()
    if not mf:
        return
    from . import engine
    from .config import LLAMA_BINARIES, pick_backend
    binary = LLAMA_BINARIES.get(pick_backend("auto"))
    if not binary:
        _STATE.update(status="error", error="No llama.cpp build to run the embedding model.")
        return
    port = engine._free_port(engine.LLAMA_PORT + 20)
    args = [binary, "-m", str(mf), "--embedding", "--pooling", "cls", "-c", "8192", "-ngl", "99", "--host", "127.0.0.1",
            "--port", str(port), "--offline", "--no-webui"]
    args = engine.filter_args(binary, args)
    try:
        proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except OSError as e:
        _STATE.update(status="error", error=str(e))
        return
    engine._attach_to_job(proc)
    _STATE.update(status="loading", proc=proc, url=f"http://127.0.0.1:{port}/v1", model=mf.stem)

    def wait() -> None:
        import httpx
        for _ in range(240):
            if proc.poll() is not None:
                _STATE.update(status="error", error=f"embedding server exited with code {proc.returncode}")
                return
            try:
                if httpx.get(_STATE["url"].rsplit("/v1", 1)[0] + "/health", timeout=1).status_code == 200:
                    _STATE["status"] = "ready"
                    engine.log(f"[vectors] {mf.name} ready on port {port}")
                    index_missing()
                    return
            except Exception:  # noqa: BLE001
                pass
            time.sleep(0.5)
        _STATE.update(status="error", error="embedding server did not start")

    threading.Thread(target=wait, daemon=True, name="embed-start").start()


def stop() -> None:
    p = _STATE.get("proc")
    if p and p.poll() is None:
        p.kill()


def embed(texts: list[str], embedder: Any = None) -> np.ndarray:
    """Unit-length vectors for the texts (rows). `embedder` replaces the server (tests)."""
    if embedder is not None:
        v = np.asarray(embedder(texts), dtype=np.float32)
    else:
        import httpx
        r = httpx.post(f"{_STATE['url']}/embeddings", json={"input": texts, "model": _STATE["model"] or "bge-m3"}, timeout=120)
        r.raise_for_status()
        v = np.asarray([d["embedding"] for d in sorted(r.json()["data"], key=lambda d: d["index"])], dtype=np.float32)
    n = np.linalg.norm(v, axis=1, keepdims=True)
    return v / np.maximum(n, 1e-9)


def index_missing(embedder: Any = None) -> int:
    """Embed every chunk that has no vector yet. Returns how many were added."""
    if embedder is None and not ready():
        return 0
    added = 0
    with _LOCK:
        while True:
            rows = q("SELECT c.id, c.text FROM chunks c LEFT JOIN chunk_vectors v ON v.chunk_id=c.id WHERE v.chunk_id IS NULL LIMIT ?", (BATCH,))
            if not rows:
                break
            vecs = embed([r["text"][:2000] for r in rows], embedder)
            for r, v in zip(rows, vecs):
                ex("INSERT OR REPLACE INTO chunk_vectors(chunk_id, model, dim, vec) VALUES(?,?,?,?)",
                   (r["id"], _STATE["model"] or "test", int(v.shape[0]), v.astype(np.float32).tobytes()))
            added += len(rows)
    _MATRIX["n"] = -1
    return added


def _matrix() -> tuple[list[str], np.ndarray | None]:
    n = (q1("SELECT COUNT(*) n FROM chunk_vectors") or {"n": 0})["n"]
    if n != _MATRIX["n"]:
        rows = q("SELECT v.chunk_id, v.vec FROM chunk_vectors v JOIN chunks c ON c.id=v.chunk_id")
        _MATRIX["ids"] = [r["chunk_id"] for r in rows]
        _MATRIX["m"] = np.vstack([np.frombuffer(r["vec"], dtype=np.float32) for r in rows]) if rows else None
        _MATRIX["n"] = n
    return _MATRIX["ids"], _MATRIX["m"]


def search(text: str, k: int = 40, embedder: Any = None) -> list[tuple[str, float]]:
    """Nearest chunks by cosine similarity: [(chunk_id, similarity)]. Empty when vectors are not available."""
    if embedder is None and not ready():
        return []
    ids, m = _matrix()
    if m is None or not ids:
        return []
    try:
        qv = embed([text], embedder)[0]
    except Exception as e:  # noqa: BLE001 - vector search is an extra channel: never fail the question because of it
        from .engine import log
        log(f"[vectors] query embedding failed: {type(e).__name__}")
        return []
    sims = m @ qv
    top = np.argsort(-sims)[:k]
    return [(ids[i], float(sims[i])) for i in top]
