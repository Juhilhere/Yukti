"""Performance Engine profiles: load settings are chosen from validated profiles, not changed arbitrarily.

A profile is a complete llama.cpp load configuration for one class of model on one class of hardware: context window,
GPU offload (auto-fitted to free VRAM), batch and micro-batch sizes, KV-cache type, flash attention, continuous
batching, parallel slots and speculative decoding. Yukti picks one from the model's size and the free video memory.

`measured` profiles carry numbers measured by Team UniMinds on the stated hardware. `reference` profiles are starting
points for hardware we have not measured; an administrator validates them on the plant's own server
(POST /api/admin/profiles/{id}/validate), which records tok/s, time to first token and memory on that machine.
Nothing here is presented as measured unless it was.
"""
from __future__ import annotations

import re
import time
from typing import Any

from .db import get_setting, now_iso, set_setting

PROFILES: dict[str, dict[str, Any]] = {
    "auto-fit": {
        "label": "Any GPU, memory not readable (AMD / Intel via Vulkan, Apple): all layers offered, llama.cpp fits them",
        "params_b": (0, 1000), "min_vram_mb": 0, "status": "reference",
        "load": {"ctx_size": 16384, "gpu_layers": 99, "fit": "on", "flash_attn": "on", "cache_type_k": "q8_0",
                 "cache_type_v": "q8_0", "parallel": 2, "cont_batching": True, "cache_prompt": True},
        "note": "Yukti's long-standing default. Used when free video memory cannot be measured, so a GPU is never left unused.",
    },
    "small-6gb": {
        "label": "Small model (≈4B) on a 6 GB GPU", "params_b": (0, 6), "min_vram_mb": 4500, "status": "measured",
        "measured": "Gemma 3 4B Q4_K_M on an RTX 4050 laptop GPU (6 GB): 44–58 tok/s; with Whisper turbo 5.1 of 6 GB in use. "
                    "(0.2 s to the first token was measured on the same GPU with Gemma 2 2B Q8_0.)",
        "load": {"ctx_size": 16384, "gpu_layers": 99, "fit": "on", "flash_attn": "on", "cache_type_k": "q8_0",
                 "cache_type_v": "q8_0", "parallel": 2, "cont_batching": True, "batch_size": 2048, "ubatch_size": 512,
                 "cache_prompt": True},
    },
    "small-cpu": {
        "label": "Small model on the processor (no GPU)", "params_b": (0, 6), "min_vram_mb": 0, "status": "measured",
        "measured": "Gemma 2 2B Q8_0 on the processor: 13.4 tok/s (CUDA on the same laptop: 51.7 tok/s, 3.9× faster).",
        "load": {"ctx_size": 8192, "gpu_layers": 0, "fit": "off", "flash_attn": "auto", "cache_type_k": "q8_0",
                 "cache_type_v": "q8_0", "parallel": 1, "cont_batching": True, "batch_size": 512, "ubatch_size": 256,
                 "cache_prompt": True},
    },
    "mid-8b-8gb": {
        "label": "8B-class model on an 8 GB GPU", "params_b": (6, 14), "min_vram_mb": 7000, "status": "reference",
        "load": {"ctx_size": 16384, "gpu_layers": 99, "fit": "on", "flash_attn": "on", "cache_type_k": "q8_0",
                 "cache_type_v": "q8_0", "parallel": 2, "cont_batching": True, "batch_size": 2048, "ubatch_size": 512,
                 "cache_prompt": True},
    },
    "reasoning-27b-12gb": {
        "label": "27B-class reasoning model on a 12 GB GPU (partial offload)", "params_b": (20, 40), "min_vram_mb": 11000,
        "status": "reference",
        "load": {"ctx_size": 8192, "gpu_layers": 99, "fit": "on", "flash_attn": "on", "cache_type_k": "q8_0",
                 "cache_type_v": "q8_0", "parallel": 1, "cont_batching": True, "batch_size": 1024, "ubatch_size": 256,
                 "cache_prompt": True, "spec_type": "ngram-cache"},
    },
    "reasoning-27b-16gb": {
        "label": "27B-class reasoning model on a 16 GB GPU", "params_b": (20, 40), "min_vram_mb": 15000, "status": "reference",
        "load": {"ctx_size": 16384, "gpu_layers": 99, "fit": "on", "flash_attn": "on", "cache_type_k": "q8_0",
                 "cache_type_v": "q8_0", "parallel": 1, "cont_batching": True, "batch_size": 2048, "ubatch_size": 512,
                 "cache_prompt": True, "spec_type": "ngram-cache"},
    },
    "reasoning-27b-24gb": {
        "label": "27B-class reasoning model on a 24 GB GPU (draft-model speculation)", "params_b": (20, 40),
        "min_vram_mb": 22000, "status": "reference",
        "load": {"ctx_size": 32768, "gpu_layers": 99, "fit": "on", "flash_attn": "on", "cache_type_k": "q8_0",
                 "cache_type_v": "q8_0", "parallel": 2, "cont_batching": True, "batch_size": 2048, "ubatch_size": 512,
                 "cache_prompt": True, "draft_max": 16, "draft_min": 2, "draft_p_min": 0.75},
        "note": "Choose a small draft model of the same family (same tokenizer) under Speculative decoding.",
    },
}


def params_b(model: dict[str, Any]) -> float:
    """Model size in billions of parameters, from its name (\"27b\", \"4B\", \"e4b\") or else from its file size."""
    m = re.search(r"(?<![\d.])(\d+(?:\.\d+)?)\s*[bB](?![a-zA-Z])", str(model.get("name") or ""))
    if m:
        return float(m.group(1))
    size = float(model.get("size_bytes") or 0)
    return round(size / 2**30 / 0.6, 1) if size else 0.0  # ~0.6 GB per billion parameters at Q4_K_M


def free_vram_mb() -> int | None:
    try:
        import pynvml
        pynvml.nvmlInit()
        best = 0
        for i in range(pynvml.nvmlDeviceGetCount()):
            best = max(best, int(pynvml.nvmlDeviceGetMemoryInfo(pynvml.nvmlDeviceGetHandleByIndex(i)).free) // 2**20)
        return best
    except Exception:  # noqa: BLE001 - no NVIDIA GPU / driver
        return None


def select(model: dict[str, Any], vram_mb: int | None) -> str:
    """Largest-fitting validated profile for this model on this hardware (CPU profile when no GPU memory is known)."""
    size = params_b(model)
    if vram_mb is None:  # no NVIDIA reading: a Vulkan / Apple GPU may still be there - offer every layer and let llama.cpp fit
        return "auto-fit"
    fits = [(pid, p) for pid, p in PROFILES.items() if pid != "auto-fit"
            and p["params_b"][0] <= size < p["params_b"][1] and p["min_vram_mb"] <= vram_mb]
    if not fits:
        if vram_mb < 4500:
            return "small-cpu" if size < 6 else min(
                (pid for pid, p in PROFILES.items() if p["params_b"][0] <= size < p["params_b"][1]),
                key=lambda pid: PROFILES[pid]["min_vram_mb"], default="small-cpu")
        # nothing in our table for this size: the profile whose model class is closest, auto-fit does the rest
        return min((pid for pid in PROFILES if pid != "auto-fit"), key=lambda pid: abs(sum(PROFILES[pid]["params_b"]) / 2 - size))
    return max(fits, key=lambda kv: kv[1]["min_vram_mb"])[0]


def apply(profile_id: str, cfg: dict[str, Any] | None) -> dict[str, Any]:
    """The profile's settings, with anything the administrator set explicitly taking precedence."""
    base = PROFILES.get(profile_id, {}).get("load", {})
    return {**base, **{k: v for k, v in (cfg or {}).items() if v not in (None, "")}, "profile": profile_id}


def validations() -> dict[str, Any]:
    return get_setting("profile_validations", {}) or {}


def listing(model: dict[str, Any] | None = None) -> dict[str, Any]:
    vram = free_vram_mb()
    val = validations()
    return {"free_vram_mb": vram, "recommended": select(model, vram) if model else None,
            "profiles": [{"id": pid, "label": p["label"], "status": "validated" if pid in val else p["status"],
                          "measured": p.get("measured"), "note": p.get("note"), "min_vram_mb": p["min_vram_mb"],
                          "params_b": list(p["params_b"]), "load": p["load"], "validation": val.get(pid)}
                         for pid, p in PROFILES.items()]}


async def validate(profile_id: str, actor: str) -> dict[str, Any]:
    """Measure the loaded model under this profile on this server: tok/s, time to first token, video memory in use."""
    from . import engine
    if profile_id not in PROFILES:
        raise ValueError("Unknown performance profile.")
    if engine.state.status != "ready":
        raise RuntimeError("Load a model with this profile first.")
    runs = []
    for _ in range(3):
        stats: dict[str, Any] = {}
        async for ev in engine.stream_chat([{"role": "user", "content": "List five checks before restarting a tripped pump motor."}],
                                           {"temperature": 0, "max_tokens": 160}):
            if ev["type"] == "done":
                stats = ev["stats"]
            elif ev["type"] == "error":
                raise RuntimeError(ev.get("message") or "engine error")
        runs.append(stats)
    vram = None
    try:
        import pynvml
        pynvml.nvmlInit()
        h = pynvml.nvmlDeviceGetHandleByIndex(0)
        mi = pynvml.nvmlDeviceGetMemoryInfo(h)
        vram = {"used_mb": int(mi.used) // 2**20, "total_mb": int(mi.total) // 2**20}
    except Exception:  # noqa: BLE001
        pass
    tps = sorted(float(r.get("tok_per_s") or 0) for r in runs)
    ttft = sorted(float(r.get("ttft_ms") or 0) for r in runs)
    rec = {"at": now_iso(), "by": actor, "model": engine.state.model_name, "engine": engine.state.engine,
           "tok_per_s_median": tps[len(tps) // 2], "tok_per_s_range": [tps[0], tps[-1]], "ttft_ms_median": ttft[len(ttft) // 2],
           "vram": vram, "load_config": engine.state.load_config, "runs": len(runs), "measured_at_unix": int(time.time())}
    val = validations()
    val[profile_id] = rec
    set_setting("profile_validations", val, actor)
    return rec
