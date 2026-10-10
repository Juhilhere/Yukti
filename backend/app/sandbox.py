"""Sandboxed code execution for the coding worker and the workbench's calculations.

Code never runs inside the Yukti server. Each run gets its own process and an empty working folder, and is limited in
layers (defence in depth, not a promise that hostile code cannot escape a general-purpose interpreter):
- separate process in isolated mode, no inherited environment, a hard time limit, and a memory limit
  (Windows: a job object that also forbids child processes; Linux/macOS: resource limits);
- no network: sockets are disabled inside the process before the code starts (and the plant firewall still applies);
- imports from the code itself are limited to an allow-list of calculation and data libraries (math, statistics, numpy,
  pandas, openpyxl ...): no os, subprocess, socket, ctypes;
- files can only be opened inside the working folder; files the code writes there are returned as results.
Every run is recorded in the audit log by the caller.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .config import STORE
from .db import new_id

SANDBOX_DIR = STORE / "sandbox"
TIMEOUT_S = 20
MEMORY_MB = 1024
MAX_OUTPUT = 20000
ALLOWED_IMPORTS = {"math", "cmath", "statistics", "decimal", "fractions", "random", "json", "csv", "datetime", "time", "calendar",
                   "re", "string", "textwrap", "itertools", "functools", "operator", "collections", "heapq", "bisect",
                   "dataclasses", "typing", "enum", "io", "pprint", "numpy", "pandas", "openpyxl", "docx", "pptx"}

# Runs inside the sandbox process before the user's code. Kept as text so the frozen server can execute it too.
PRELUDE = r'''
import builtins, io, os, sys, socket
_root = os.path.realpath(os.getcwd())
class _NoNet(socket.socket):
    def __init__(self, *a, **k):
        raise PermissionError("Network access is disabled in the Yukti sandbox.")
def _no_net(*a, **k):
    raise PermissionError("Network access is disabled in the Yukti sandbox.")
socket.socket = _NoNet
socket.create_connection = _no_net
socket.getaddrinfo = _no_net
_open = builtins.open
def _guarded_open(file, mode="r", *a, **k):
    if isinstance(file, int):
        raise PermissionError("File descriptors are not available in the Yukti sandbox.")
    p = os.path.realpath(os.path.join(_root, os.fspath(file)))
    if p != _root and not p.startswith(_root + os.sep):
        raise PermissionError("Only files in the sandbox folder can be opened.")
    return _open(p, mode, *a, **k)
builtins.open = _guarded_open
io.open = _guarded_open
_ALLOWED = set(__ALLOWED__)
_import = builtins.__import__
def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    caller = (globals or {}).get("__name__", "")
    if caller == "__sandbox__" and level == 0 and name.split(".")[0] not in _ALLOWED:
        raise ImportError(f"Module '{name}' is not available in the Yukti sandbox.")
    return _import(name, globals, locals, fromlist, level)
builtins.__import__ = _guarded_import
'''


def _import_paths() -> list[str]:
    """The server's own library folders (numpy, pandas ...), given to the sandbox explicitly: it runs the base interpreter
    in isolated mode, which ignores environment variables and the virtual environment."""
    return [p for p in sys.path if p and os.path.isdir(p)]


def _runner_source(code: str) -> str:
    paths = "" if getattr(sys, "frozen", False) else f"import sys as _s\n_s.path[:0] = {_import_paths()!r}\n"
    return (paths + PRELUDE.replace("__ALLOWED__", repr(sorted(ALLOWED_IMPORTS)))
            + "\n_g = {'__name__': '__sandbox__', '__builtins__': builtins}\n"
            + f"exec(compile({code!r}, 'sandbox.py', 'exec'), _g)\n")


def _posix_limits() -> None:  # pragma: no cover - runs in the child on Linux/macOS
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (TIMEOUT_S, TIMEOUT_S + 1))
    try:
        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_MB * 2**20, MEMORY_MB * 2**20))
    except (ValueError, OSError):
        pass  # macOS does not support an address-space limit
    os.setsid()


def _windows_job(proc: subprocess.Popen) -> None:  # pragma: no cover - Windows only
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.windll.kernel32

    class BASIC(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class IO(ctypes.Structure):
        _fields_ = [(n, ctypes.c_uint64) for n in ("R", "W", "O", "RB", "WB", "OB")]

    class EXT(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", IO), ("ProcessMemoryLimit", ctypes.c_size_t),
                    ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                    ("PeakJobMemoryUsed", ctypes.c_size_t)]

    k32.CreateJobObjectW.restype = wintypes.HANDLE
    job = k32.CreateJobObjectW(None, None)
    if not job:
        raise OSError("CreateJobObject failed")
    info = EXT()
    # kill on close | one active process (no children) | process memory limit
    info.BasicLimitInformation.LimitFlags = 0x2000 | 0x0008 | 0x0100
    info.BasicLimitInformation.ActiveProcessLimit = 1
    info.ProcessMemoryLimit = MEMORY_MB * 2**20
    if not k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):
        raise OSError("SetInformationJobObject failed")
    if not k32.AssignProcessToJobObject(job, int(proc._handle)):  # type: ignore[attr-defined]
        raise OSError("AssignProcessToJobObject failed")
    proc._yukti_job = job  # type: ignore[attr-defined]  # keep the handle alive as long as the process object


def _command(script: Path) -> list[str]:
    if getattr(sys, "frozen", False):  # yukti-server.exe --sandbox <script> runs it with the bundled interpreter
        return [sys.executable, "--sandbox", str(script)]
    # a virtual environment's python.exe on Windows is a launcher that starts the real interpreter as a child process,
    # which the job object (one process, no children) would refuse: start the base interpreter directly
    exe = getattr(sys, "_base_executable", None) if os.name == "nt" and sys.prefix != sys.base_prefix else None
    return [exe if exe and os.path.exists(exe) else sys.executable, "-I", "-B", str(script)]


def run(code: str, inputs: dict[str, bytes] | None = None, timeout: float = TIMEOUT_S) -> dict[str, Any]:
    """Run Python code in the sandbox. Returns stdout, stderr, exit code, time and the files it wrote."""
    SANDBOX_DIR.mkdir(parents=True, exist_ok=True)
    rid = new_id()
    work = SANDBOX_DIR / rid
    work.mkdir()
    for name, data in (inputs or {}).items():
        (work / Path(name).name).write_bytes(data)
    script = SANDBOX_DIR / f"{rid}.py"  # outside the working folder: the code cannot read or change its own runner
    script.write_text(_runner_source(code), encoding="utf-8")
    before = {p.name for p in work.iterdir()}
    env = {"PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1", "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1",
           "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""), "YUKTI_SANDBOX": "1"}
    t0 = time.time()
    kw: dict[str, Any] = {"cwd": str(work), "env": env, "stdout": subprocess.PIPE, "stderr": subprocess.PIPE, "stdin": subprocess.DEVNULL}
    if os.name == "nt":
        kw["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "CREATE_SUSPENDED", 0x4)
    else:
        kw["preexec_fn"] = _posix_limits
    proc = subprocess.Popen(_command(script), **kw)
    if os.name == "nt":  # pragma: no cover
        try:
            _windows_job(proc)
        except Exception as e:  # noqa: BLE001 - never run code that could not be confined
            proc.kill()
            proc.communicate()
            script.unlink(missing_ok=True)
            raise RuntimeError(f"The sandbox could not confine the process ({type(e).__name__}).") from e
        _resume(proc)
    timed_out = False
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        proc.kill()
        out, err = proc.communicate()
    ms = round((time.time() - t0) * 1000)
    files = []
    for p in sorted(work.iterdir()):
        if p.is_file() and p.name not in before:
            files.append({"name": p.name, "size": p.stat().st_size, "path": str(p)})
    script.unlink(missing_ok=True)
    return {"id": rid, "exit_code": proc.returncode, "timed_out": timed_out, "ms": ms,
            "stdout": out.decode("utf-8", "replace")[:MAX_OUTPUT], "stderr": _clean_err(err.decode("utf-8", "replace"))[:MAX_OUTPUT],
            "files": files, "workdir": str(work)}


def _resume(proc: subprocess.Popen) -> None:  # pragma: no cover - Windows only
    """Start a process created suspended (it is placed in its job object before it runs a single instruction)."""
    import ctypes
    ntdll = ctypes.windll.ntdll
    ntdll.NtResumeProcess(int(proc._handle))  # type: ignore[attr-defined]


def _clean_err(err: str) -> str:
    """Only the user's part of a traceback (the prelude's frames say nothing useful)."""
    lines = err.splitlines()
    keep = [ln for ln in lines if "File \"" not in ln or "sandbox.py" in ln]
    return "\n".join(keep)


def cleanup(max_age_s: int = 24 * 3600) -> int:
    n = 0
    if not SANDBOX_DIR.exists():
        return 0
    for p in SANDBOX_DIR.iterdir():
        try:
            if time.time() - p.stat().st_mtime > max_age_s:
                shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)
                n += 1
        except OSError:
            pass
    return n


def main_from_argv(argv: list[str]) -> int:  # pragma: no cover - frozen server: yukti-server.exe --sandbox <script>
    script = Path(argv[argv.index("--sandbox") + 1])
    src = script.read_text(encoding="utf-8")
    exec(compile(src, str(script), "exec"), {"__name__": "__main__"})
    return 0
