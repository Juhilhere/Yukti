"""Speech to text for the microphone button: whisper.cpp (OpenAI Whisper models), fully offline.

- NVIDIA GPU present (and ~1 GB of video memory free): Whisper large-v3-turbo on the GPU (about 2 s for a 10 s question).
- Otherwise: Whisper small on the processor (about 3-4 s).
The recogniser is started on first use and stopped after 10 idle minutes. It is given the plant's own vocabulary
(equipment tags the person can see, common plant words) as a hint, which roughly halves mistakes on tags like "E-310".
The transcript is only put into the question box; the person reads and corrects it before sending.
"""
from __future__ import annotations

import asyncio
import io
import os
import re
import secrets
import subprocess
import threading
import time
import wave
from pathlib import Path
from typing import Any

import httpx

from . import engine
from .config import FROZEN, ROOT, has_nvidia_gpu
from .db import q
from .policy import Subject
from .scope import asset_visible

# a developer's whisper.cpp folder is used only when running from source (never by the packaged server)
_DEV = ROOT / "speech" if FROZEN else Path(os.environ.get("YUKTI_WHISPER_DEV") or r"E:\yukti-build\research\whisper")
BIN = {
    "gpu": [ROOT / "speech" / "cuda" / "whisper-server.exe", _DEV / "cublas" / "Release" / "whisper-server.exe"],
    "cpu": [ROOT / "speech" / "cpu" / "whisper-server.exe", _DEV / "blas" / "Release" / "whisper-server.exe"],
}
MODEL = {
    "gpu": ("ggml-large-v3-turbo-q5_0.bin", "Whisper large-v3-turbo"),
    "cpu": ("ggml-small-q8_0.bin", "Whisper small"),
}
MODEL_DIRS = [ROOT / "speech" / "models", _DEV]
_EMPTY = engine.LOG_DIR.parent / "speech-www"  # whisper-server serves static files from here: keep it empty
_EMPTY.mkdir(parents=True, exist_ok=True)
IDLE_S = 10 * 60
MAX_S = 60.0
GLOSSARY = ("CDU-1, VDU, SRU, MDEA amine, H2S, LOTO isolation, permit, work order, dossier, calibration, SOP, feeder, "
            "flange, gasket, corrosion, leak, trip")
HALLUCINATIONS = {"thank you.", "thank you", "thanks for watching!", "thanks for watching.", "you", "bye.", ".", "subtitles by the amara.org community"}


def _first(paths: list[Path]) -> Path | None:
    return next((p for p in paths if p.exists()), None)


def _model(dev: str) -> Path | None:
    return _first([d / MODEL[dev][0] for d in MODEL_DIRS])


def _gpu_free_mb() -> int:
    try:
        import pynvml
        pynvml.nvmlInit()
        h = pynvml.nvmlDeviceGetHandleByIndex(0)
        return int(pynvml.nvmlDeviceGetMemoryInfo(h).free // 2**20)
    except Exception:  # noqa: BLE001
        return 0


def gpu_installed() -> bool:
    """The GPU voice recogniser and its model are installed on a PC with an NVIDIA card (whether or not memory is free now)."""
    return bool(_first(BIN["gpu"]) and _model("gpu") and has_nvidia_gpu())


def choose() -> dict[str, Any]:
    """Which recogniser this computer can run: {'device', 'binary', 'model', 'model_name'} or {'reason'}."""
    if _first(BIN["gpu"]) and _model("gpu") and has_nvidia_gpu() and (_S.device == "gpu" or _gpu_free_mb() >= 1200):
        return {"device": "gpu", "binary": _first(BIN["gpu"]), "model": _model("gpu"), "model_name": MODEL["gpu"][1]}
    cpu_model = _model("cpu") or _model("gpu")  # turbo also runs on the processor, just slower
    if _first(BIN["cpu"]) and cpu_model:
        return {"device": "cpu", "binary": _first(BIN["cpu"]), "model": cpu_model,
                "model_name": MODEL["cpu"][1] if cpu_model.name == MODEL["cpu"][0] else MODEL["gpu"][1]}
    return {"reason": "Voice input has not been added yet. An administrator can add it from the Yukti home screen on the server computer."}


class _State:
    def __init__(self) -> None:
        self.proc: subprocess.Popen | None = None
        self.port = 0
        self.device: str | None = None
        self.model_name: str | None = None
        self.last_used = 0.0
        self.lock = threading.Lock()


_S = _State()


def status() -> dict[str, Any]:
    c = choose()
    if "reason" in c:
        return {"available": False, "device": None, "model": None, "reason": c["reason"]}
    return {"available": True, "device": c["device"], "model": c["model_name"], "running": bool(_S.proc and _S.proc.poll() is None)}


def _start() -> None:
    """Start whisper-server (under the lock). Raises RuntimeError with a plain-language reason."""
    if _S.proc and _S.proc.poll() is None:
        return
    c = choose()
    if "reason" in c:
        raise RuntimeError(c["reason"])
    port = engine._free_port(8790)
    threads = max(2, min(8, (os.cpu_count() or 4) - 1))
    args = [str(c["binary"]), "-m", str(c["model"]), "--host", "127.0.0.1", "--port", str(port), "-t", str(threads),
            "-bs", "5", "-bo", "5", "-sns", "-nt",
            "--public", str(_EMPTY), "--request-path", "/" + secrets.token_hex(12)]
    if c["device"] == "cpu":
        args.append("-ng")
    env = dict(os.environ)
    if c["device"] == "gpu":  # CUDA runtime libraries are shared with the bundled llama.cpp CUDA build
        extra = [str(p) for p in (ROOT / "llama" / "cuda", Path(r"E:\tools\llama-cuda")) if p.exists()]
        env["PATH"] = os.pathsep.join([str(c["binary"].parent), *extra, env.get("PATH", "")])
    log_f = open(engine.LOG_DIR / "speech.log", "a", encoding="utf-8")  # noqa: SIM115
    proc = subprocess.Popen(args, stdout=log_f, stderr=subprocess.STDOUT, env=env, cwd=str(c["binary"].parent),
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    engine._attach_to_job(proc)
    t0 = time.time()
    while time.time() - t0 < 90:  # the model is loaded before the port opens
        if proc.poll() is not None:
            log_f.close()
            if c["device"] == "gpu":  # e.g. not enough video memory next to the language model: fall back to the processor
                engine.log("[speech] GPU recogniser did not start; trying the processor")
                _S.device = "cpu-fallback"
                BIN["gpu"] = []
                return _start()
            raise RuntimeError("The voice recogniser could not start. Details are in the server log (speech.log).")
        try:
            import socket
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                break
        except OSError:
            time.sleep(0.3)
    else:
        proc.kill()
        raise RuntimeError("The voice recogniser took too long to start.")
    _S.proc, _S.port, _S.device, _S.model_name = proc, port, c["device"], c["model_name"]
    _S.path = args[args.index("--request-path") + 1]  # type: ignore[attr-defined]
    engine.log(f"[speech] {c['model_name']} ready on the {'GPU' if c['device'] == 'gpu' else 'processor'}")


def stop() -> None:
    with _S.lock:
        if _S.proc and _S.proc.poll() is None:
            _S.proc.kill()
        _S.proc = None


def _idle_watch() -> None:
    while True:
        time.sleep(30)
        if _S.proc and _S.proc.poll() is None and time.time() - _S.last_used > IDLE_S:
            engine.log("[speech] stopped after 10 idle minutes")
            stop()


threading.Thread(target=_idle_watch, daemon=True, name="speech-idle").start()


def vocabulary(s: Subject) -> str:
    """Hint for the recogniser: equipment tags this person can see + common plant words (Whisper prompt, < 224 tokens)."""
    # "pump A2", "exchanger E-310": a tag with its equipment type is recognised far more reliably than a bare list of tags
    kind = {"psv": "PSV", "mcc": "", "vessel": "vessel", "valve": "valve"}
    rows = q("SELECT tag, class, unit, owner_department FROM assets ORDER BY criticality, tag")
    terms = [(kind.get(a["class"] or "", a["class"] or "") + " " + a["tag"]).strip().replace("PSV PSV-", "PSV-")
             for a in rows if asset_visible(s, a)]
    return ("Refinery plant: " + ", ".join(terms[:40]) + ". " + GLOSSARY + ".")[:700]


class SpeechError(ValueError):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def check_wav(data: bytes) -> tuple[float, float]:
    """(duration seconds, loudness 0..1). Only 16 kHz mono 16-bit WAV (what the app records) is accepted."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            frames = w.readframes(n)
    except Exception:  # noqa: BLE001
        raise SpeechError(422, "invalid_audio", "The recording could not be read. Please try again.")
    if (ch, sw, sr) != (1, 2, 16000):
        raise SpeechError(422, "invalid_audio", "The recording must be 16 kHz mono 16-bit WAV.")
    dur = n / sr
    if dur > MAX_S + 0.5:
        raise SpeechError(413, "too_long", "Recordings can be at most 60 seconds long.")
    if dur < 0.3:
        raise SpeechError(422, "too_short", "The recording is too short. Press Speak, say your question, then press Done.")
    import numpy as np
    x = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    return dur, float(np.sqrt(np.mean(x * x))) if len(x) else 0.0


def _clean(text: str) -> str:
    text = re.sub(r"\[[^\]]*\]|\([^)]*(music|noise|silence|applause|blank)[^)]*\)", " ", text, flags=re.I)  # [BLANK_AUDIO], (music)
    # a character cut in half at the recogniser's output limit arrives as U+FFFD: never show it
    text = text.replace("�", "")
    return re.sub(r"\s+", " ", text).strip()


# Whisper writes at most ~224 tokens per 30-second window. Hindi and especially Kannada need many tokens per word, so a
# long sentence was cut off in the middle (FLEURS Kannada, 26 s: the last third was missing and ended in a broken
# character). Speech in those languages is therefore recognised in pieces of at most CHUNK_S seconds, cut at pauses.
CHUNK_S = 10.0


def split_wav(data: bytes, max_s: float = CHUNK_S) -> list[bytes]:
    """16 kHz mono 16-bit WAV -> WAV pieces of at most `max_s` seconds, each cut at the quietest moment of its last 40%."""
    import numpy as np
    with wave.open(io.BytesIO(data)) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    n_max = int(max_s * sr)
    if len(x) <= n_max:
        return [data]
    hop = int(0.02 * sr)
    cuts, start = [0], 0
    while len(x) - start > n_max:
        lo, hi = start + int(0.6 * n_max), start + n_max
        seg = x[lo:hi].astype(np.float32)
        frames = len(seg) // hop
        energy = (seg[: frames * hop].reshape(frames, hop) ** 2).mean(axis=1) if frames else np.zeros(1)
        start = lo + int(np.argmin(energy)) * hop + hop // 2
        cuts.append(start)
    cuts.append(len(x))
    out = []
    for a, b in zip(cuts, cuts[1:]):
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(x[a:b].tobytes())
        out.append(buf.getvalue())
    return out


# Whisper's language guess, folded onto Yukti's three languages. Whisper often hears Kannada as Tamil/Telugu and Hindi
# as Urdu/Marathi; the family decides, and the person's screen language gets a small preference.
FAMILY = {"en": ("en",), "hi": ("hi", "ur", "mr", "ne", "pa", "gu", "bn", "sa"), "kn": ("kn", "ta", "te", "ml")}


def pick_language(probs: dict[str, float], preferred: str) -> str:
    score = {k: sum(float(probs.get(c) or 0) for c in codes) for k, codes in FAMILY.items()}
    if preferred in score:
        score[preferred] *= 4.0
    best = max(score, key=lambda k: score[k])
    return best if score[best] > 0 else (preferred if preferred in FAMILY else "en")


async def _recognise(data: bytes, lang: str, prompt: str, detect_only: bool = False) -> dict[str, Any]:
    form = {"response_format": "verbose_json", "language": lang, "prompt": prompt, "temperature": "0.0",
            "temperature_inc": "0.2", "no_timestamps": "true", "detect_language": "true" if detect_only else "false"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=5)) as c:
            r = await c.post(f"http://127.0.0.1:{_S.port}{getattr(_S, 'path', '')}/inference", data=form,
                             files={"file": ("speech.wav", data, "audio/wav")})
    except Exception as e:  # noqa: BLE001
        engine.log(f"[speech] request failed: {e!r}")
        stop()
        raise SpeechError(503, "speech_unavailable", "The voice recogniser stopped unexpectedly. Please try again.")
    _S.last_used = time.time()
    if r.status_code != 200:
        engine.log(f"[speech] recogniser answered {r.status_code}: {r.text[:200]}")
        raise SpeechError(502, "speech_failed", "The recording could not be converted to text. Please try again.")
    return r.json()


async def transcribe(s: Subject, data: bytes, language: str) -> dict[str, Any]:
    """`language` is the person's screen language (en/hi/kn) or "auto"; the spoken language is detected and may differ."""
    dur, rms = check_wav(data)
    preferred = language if language in FAMILY else ""
    t0 = time.time()
    if rms < 0.002:  # silence: Whisper would otherwise invent words such as "Thank you."
        return {"text": "", "language": preferred or "en", "duration_s": round(dur, 1), "elapsed_s": 0.0, "no_speech": True}
    try:
        await asyncio.to_thread(_locked_start)
    except RuntimeError as e:
        raise SpeechError(503, "speech_unavailable", str(e))
    _S.last_used = time.time()
    # the plant-vocabulary hint helps English a lot but pushes Hindi/Kannada into Latin script (measured on FLEURS:
    # Kannada character errors 20% -> 87%), so it is used only once the speech is known to be English
    det = await _recognise(data, "auto", "", detect_only=True)  # which language is spoken (encoder only, fast)
    heard = str(det.get("detected_language") or det.get("language") or "").lower()
    heard = {"english": "en", "hindi": "hi", "kannada": "kn"}.get(heard, heard[:2])
    lang = pick_language(det.get("language_probabilities") or {heard: 1.0}, preferred)
    if lang == "en":
        out = await _recognise(data, lang, vocabulary(s))
        text = _clean(str(out.get("text") or ""))
    else:
        parts = [_clean(str((await _recognise(piece, lang, "")).get("text") or "")) for piece in split_wav(data)]
        text = " ".join(p for p in parts if p and p.lower() not in HALLUCINATIONS)
    if text.lower() in HALLUCINATIONS and rms < 0.02:
        text = ""
    return {"text": text, "language": lang, "duration_s": round(dur, 1), "elapsed_s": round(time.time() - t0, 2),
            "device": _S.device, "no_speech": not text}


def _locked_start() -> None:
    with _S.lock:
        _start()
