"""Local journal: everything Yukti does and every problem it meets, in the data folder's logs\\ (never sent anywhere).

- yukti.log   activity + warnings + errors (what happened, when, by which part)
- errors.log  warnings and errors only, with the full technical detail, for quick troubleshooting
Both rotate (5 x 5 MB). Every server error gets a short reference (e.g. E-7F3A2C) that the user sees on screen, so the
matching log entry is found at once. Passwords, tokens, question texts and file contents are never written.
"""
from __future__ import annotations

import asyncio
import collections
import itertools
import logging
import secrets
import sys
import threading
import traceback
from logging.handlers import RotatingFileHandler
from typing import Any

from .config import LOG_DIR

_FMT = logging.Formatter("%(asctime)s %(levelname)-7s [%(area)s] %(message)s", "%Y-%m-%d %H:%M:%S")
_log = logging.getLogger("yukti")
_log.setLevel(logging.INFO)
_log.propagate = False
RECENT: collections.deque[dict[str, Any]] = collections.deque(maxlen=300)   # recent warnings/errors for Admin > Usage & health
# what web pages report about themselves is kept apart (and smaller): a page that floods cannot push the server's own
# problems out of the list
RECENT_WEB: collections.deque[dict[str, Any]] = collections.deque(maxlen=60)
_SEQ = itertools.count()


class _Recent(logging.Handler):
    def emit(self, r: logging.LogRecord) -> None:
        area = getattr(r, "area", "yukti")
        (RECENT_WEB if area == "web" else RECENT).append({
            "at": self.formatter.formatTime(r, "%Y-%m-%d %H:%M:%S") if self.formatter else "", "level": r.levelname,
            "area": area, "message": r.getMessage()[:600], "ref": getattr(r, "ref", None), "_n": next(_SEQ)})


def _setup() -> None:
    if _log.handlers:
        return
    for name, level in (("yukti.log", logging.INFO), ("errors.log", logging.WARNING)):
        try:
            h = RotatingFileHandler(LOG_DIR / name, maxBytes=5 * 2**20, backupCount=5, encoding="utf-8", delay=True)
            h.setLevel(level)
            h.setFormatter(_FMT)
            _log.addHandler(h)
        except OSError:
            pass
    r = _Recent(logging.WARNING)
    r.setFormatter(_FMT)
    _log.addHandler(r)


_setup()


def _clean(v: Any) -> str:
    s = str(v).replace("\r", " ").replace("\n", " ")
    return s if len(s) <= 300 else s[:300] + "…"


def event(area: str, message: str, **fields: Any) -> None:
    """Something happened (model loaded, add-on found, restart, admin action …)."""
    extra = " ".join(f"{k}={_clean(v)}" for k, v in fields.items() if v is not None)
    _log.info(f"{message}{' | ' + extra if extra else ''}", extra={"area": area})


def warn(area: str, message: str, **fields: Any) -> None:
    """Something went wrong but Yukti carried on (a fallback was used, a file could not be read …)."""
    extra = " ".join(f"{k}={_clean(v)}" for k, v in fields.items() if v is not None)
    _log.warning(f"{message}{' | ' + extra if extra else ''}", extra={"area": area})


def error(area: str, message: str, exc: BaseException | None = None, **fields: Any) -> str:
    """A real problem. Returns a short reference to show to the user (the same reference is in the log)."""
    ref = "E-" + secrets.token_hex(3).upper()
    extra = " ".join(f"{k}={_clean(v)}" for k, v in fields.items() if v is not None)
    text = f"{ref} {message}{' | ' + extra if extra else ''}"
    if exc is not None:
        text += f" | {type(exc).__name__}: {_clean(exc)}\n" + "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-4000:]
    _log.error(text, extra={"area": area, "ref": ref})
    return ref


def swallowed(area: str, what: str, exc: BaseException) -> None:
    """An exception that is deliberately not shown to the user — still written down, never silently lost."""
    warn(area, f"{what} failed (continuing)", error=f"{type(exc).__name__}: {exc}")


def install_hooks() -> None:
    """Uncaught errors anywhere in the server (threads, background tasks) end up in the journal."""
    def _sys(t, e, tb):  # type: ignore[no-untyped-def]
        error("server", "uncaught error", e)
    sys.excepthook = _sys

    def _thr(a):  # type: ignore[no-untyped-def]
        if a.exc_type is not SystemExit:
            error("thread", f"uncaught error in thread {getattr(a.thread, 'name', '?')}", a.exc_value)
    threading.excepthook = _thr
    try:
        loop = asyncio.get_running_loop()

        def _aio(_loop, ctx):  # type: ignore[no-untyped-def]
            e = ctx.get("exception")
            error("async", ctx.get("message") or "background task failed", e if isinstance(e, BaseException) else None)
        loop.set_exception_handler(_aio)
    except RuntimeError:
        pass


def recent(level: str = "WARNING", limit: int = 200) -> list[dict[str, Any]]:
    want = {"ERROR"} if level.upper() == "ERROR" else {"WARNING", "ERROR"}
    rows = sorted([*list(RECENT), *list(RECENT_WEB)], key=lambda r: r.get("_n", 0), reverse=True)  # newest first
    return [{k: v for k, v in r.items() if k != "_n"} for r in rows if r["level"] in want][:limit]
