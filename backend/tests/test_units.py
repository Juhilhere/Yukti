"""Unit tests: engine argument mapping, sampling request mapping, Laya, policy engine."""
from __future__ import annotations

from app.llm_params import DEFAULT_PREDICTION, llama_args, request_body


def test_llama_args_mapping():
    a = llama_args({"ctx_size": 4096, "gpu_layers": 20, "cache_type_k": "q4_0", "cache_type_v": "q4_0", "parallel": 3,
                    "threads": 6, "batch_size": 1024, "ubatch_size": 256, "mlock": True, "cpu_moe": True}, "m.gguf", None)
    s = " ".join(a)
    for frag in ["-m m.gguf", "-c 4096", "-ngl 20", "-ctk q4_0", "-ctv q4_0", "-np 3", "-t 6", "-b 1024", "-ub 256", "--mlock", "--cpu-moe"]:
        assert frag in s, frag


def test_llama_args_draft_model():
    s = " ".join(llama_args({"draft_max": 8}, "m.gguf", "d.gguf"))
    assert "-md d.gguf" in s and "--draft-max 8" in s


def test_request_body_sends_only_changed_advanced_params():
    b = request_body({}, "llamacpp")
    assert "mirostat" not in b and "dry_penalty_last_n" not in b
    b = request_body({"mirostat": 2, "top_k": 7, "seed": 42}, "llamacpp")
    assert b["mirostat"] == 2 and b["top_k"] == 7 and b["seed"] == 42


def test_request_body_vllm_uses_repetition_penalty():
    b = request_body({"repeat_penalty": 1.2}, "vllm")
    assert b["repetition_penalty"] == 1.2 and "repeat_penalty" not in b


def test_defaults_match_llama_cpp():
    assert DEFAULT_PREDICTION["temperature"] == 0.8 and DEFAULT_PREDICTION["repeat_penalty"] == 1.0


def test_filter_args_drops_unknown_flags(monkeypatch):
    from app import engine
    monkeypatch.setattr(engine, "supported_flags", lambda b: {"-m", "-c", "--mmap", "--load-mode"})
    out = engine.filter_args("x", ["-m", "a.gguf", "-c", "4096", "--made-up", "5", "--mmap"])
    assert out == ["-m", "a.gguf", "-c", "4096", "--mmap"]


def test_laya_intents(app_client):
    from app import laya
    l = laya.get()
    assert l.classify("A2 tripped at 02:15 give me the dossier")["intent"] == "asset_dossier"
    assert l.classify("which certificates expire in the next 30 days")["intent"] == "asset_expiry"
    d = l.classify("hello")
    assert d["intent"] == "smalltalk" and d["latency_ms"] < 50


def test_guard_categories():
    from app.laya import guard_category
    assert guard_category("set FIC-101 setpoint to 180") == "control_system_change"
    assert guard_category("what MDEA amine concentration") == "process_chemistry"
    assert guard_category("how to make a bomb") == "off_domain_harm"
