"""Hot KV cache per chat: sticky llama.cpp slots with TTL + LRU, and per-turn checkpoints.

There is no single unified persistent KV cache. Context is reused in two ways:
- retrieval-driven: earlier turns and relevant documents are retrieved again for each question (chat.py), and
- hot KV: a chat keeps "its" llama.cpp slot while it is in use, so the next turn reuses the cached prompt prefix
  (llama.cpp `cache_prompt`) instead of recomputing it. Slots are handed out least-recently-used first, and a chat that
  has been idle longer than the TTL loses its claim.
Optionally (AI setting `kv_spill`), an evicted slot is saved to disk (`--slot-save-path`) and restored when its chat
returns within the TTL; spilled files are themselves kept in LRU order under a size cap.

Every answered turn writes a checkpoint row: task, worker, model, tool calls, approvals, citations and the KV metadata
(slot, hot/cold/restored, tokens served from cache, KV cache type).
"""
from __future__ import annotations

import collections
import threading
import time
from pathlib import Path
from typing import Any

from .config import STORE
from .db import ex, get_setting, j, now_iso, q

SLOT_DIR = STORE / "slots"
DEFAULTS = {"kv_ttl_s": 1800, "kv_spill": False, "kv_spill_max_mb": 4096}


def settings() -> dict[str, Any]:
    ai = get_setting("ai_settings", {}) or {}
    return {k: ai.get(k, v) for k, v in DEFAULTS.items()}


class HotKV:
    """Sticky slot assignment. Thread-safe; knows nothing about HTTP (the engine performs save/restore)."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.table: collections.OrderedDict[str, dict[str, Any]] = collections.OrderedDict()  # chat_id -> {slot, at}
        self.busy: set[int] = set()
        self.n_slots = 1
        self.hits = self.misses = self.evictions = self.restores = 0

    def reset(self, n_slots: int) -> None:
        """A new model was loaded: every slot is empty again."""
        with self.lock:
            self.table.clear()
            self.busy.clear()
            self.n_slots = max(1, int(n_slots))

    def _expire(self, ttl: float) -> None:
        now = time.time()
        for cid in [c for c, e in self.table.items() if now - e["at"] > ttl and e["slot"] not in self.busy]:
            self.table.pop(cid, None)

    def acquire(self, chat_id: str, ttl: float) -> dict[str, Any]:
        """Slot for this chat: its own while hot, else a free one, else the least recently used idle one."""
        with self.lock:
            self._expire(ttl)
            e = self.table.get(chat_id)
            if e is not None and e["slot"] not in self.busy:
                self.table.move_to_end(chat_id)
                e["at"] = time.time()
                self.busy.add(e["slot"])
                self.hits += 1
                return {"slot": e["slot"], "state": "hot", "evicted": None}
            held = {x["slot"] for x in self.table.values()}
            free = [s for s in range(self.n_slots) if s not in held and s not in self.busy]
            evicted = None
            if free:
                slot = free[0]
            else:
                victim = next((c for c, x in self.table.items() if x["slot"] not in self.busy), None)
                if victim is None:  # every slot is answering right now: let llama.cpp pick (no stickiness)
                    self.misses += 1
                    return {"slot": None, "state": "cold", "evicted": None}
                slot = self.table.pop(victim)["slot"]
                evicted = victim
                self.evictions += 1
            self.table[chat_id] = {"slot": slot, "at": time.time()}
            self.busy.add(slot)
            self.misses += 1
            return {"slot": slot, "state": "cold", "evicted": evicted}

    def release(self, slot: int | None) -> None:
        with self.lock:
            if slot is not None:
                self.busy.discard(slot)

    def stats(self) -> dict[str, Any]:
        with self.lock:
            return {"slots": self.n_slots, "hot_chats": len(self.table), "busy": sorted(self.busy), "hits": self.hits,
                    "misses": self.misses, "evictions": self.evictions, "restores": self.restores,
                    "spilled_files": len(_spilled()), "spilled_mb": round(sum(p.stat().st_size for p in _spilled()) / 2**20, 1)}


hot = HotKV()


def _spilled() -> list[Path]:
    try:
        return sorted(SLOT_DIR.glob("chat-*.bin"), key=lambda p: p.stat().st_mtime)
    except OSError:
        return []


def spill_name(chat_id: str) -> str:
    return f"chat-{''.join(ch for ch in chat_id if ch.isalnum())[:40]}.bin"


def sweep_spilled(ttl: float, max_mb: float) -> int:
    """Delete spilled slot files older than the TTL, then the least recently used ones above the size cap."""
    removed = 0
    files = _spilled()
    now = time.time()
    for p in list(files):
        try:
            if now - p.stat().st_mtime > ttl:
                p.unlink(missing_ok=True)
                files.remove(p)
                removed += 1
        except OSError:
            pass
    total = sum(p.stat().st_size for p in files if p.exists())
    while files and total > max_mb * 2**20:
        p = files.pop(0)
        try:
            total -= p.stat().st_size
            p.unlink(missing_ok=True)
            removed += 1
        except OSError:
            break
    return removed


def checkpoint(chat_id: str, message_id: str, task_id: str | None, worker: str, model: str | None, kv: dict[str, Any],
               tools: list[dict[str, Any]] | None = None, approvals: list[dict[str, Any]] | None = None,
               citations: list[str] | None = None) -> None:
    ex("""INSERT INTO chat_checkpoints(chat_id, message_id, task_id, worker, model, kv_json, tools_json, approvals_json, citations_json, created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)""",
       (chat_id, message_id, task_id, worker, model, j(kv), j(tools or []), j(approvals or []), j(citations or []), now_iso()))


def checkpoints(chat_id: str) -> list[dict[str, Any]]:
    from .db import uj
    return [{"message_id": r["message_id"], "task_id": r["task_id"], "worker": r["worker"], "model": r["model"],
             "kv": uj(r["kv_json"], {}), "tools": uj(r["tools_json"], []), "approvals": uj(r["approvals_json"], []),
             "citations": uj(r["citations_json"], []), "created_at": r["created_at"]}
            for r in q("SELECT * FROM chat_checkpoints WHERE chat_id=? ORDER BY id", (chat_id,))]
