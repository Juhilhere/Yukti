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


def test_fit_to_context_keeps_system_and_question():
    from app.chat import fit_to_context
    docs = "".join(f'<doc id="S{i}">' + "x" * 1400 + "</doc>\n" for i in range(8))
    msgs = [{"role": "system", "content": "SYSTEM"}] + [{"role": "user", "content": "old " * 400}, {"role": "assistant", "content": "a " * 400}] \
        + [{"role": "user", "content": "CONTEXT:\n" + docs + "\n\nQUESTION: why did A2 trip?"}]
    out, trimmed = fit_to_context(msgs, 1500)
    assert trimmed and out[0]["content"] == "SYSTEM" and out[-1]["content"].endswith("QUESTION: why did A2 trip?")
    assert sum(len(m["content"]) // 3 + 8 for m in out) <= 1500 + 50


def test_llama_diagnosis_messages():
    from app.engine import diagnose
    assert "architecture 'qwen9'" in diagnose(["llama_model_load: error loading model: unknown model architecture: 'qwen9'"])
    assert "not a valid GGUF" in diagnose(["gguf_init_from_file_impl: invalid magic characters"])
    assert "memory" in diagnose(["ggml_backend_cuda_buffer_type_alloc_buffer: allocating 9000 MiB on device 0: cudaMalloc failed: out of memory"])
    assert "Ollama engine" in diagnose(["done_getting_tensors: wrong number of tensors; expected 883, got 444"])


def test_ollama_url_and_options():
    from app import ollama
    assert ollama.root("127.0.0.1:11434/v1/") == "http://127.0.0.1:11434"
    o = ollama.options({"temperature": 0.3, "max_tokens": 200, "top_k": 20, "seed": -1}, {"ctx_size": 16384, "gpu_layers": 20})
    assert o["num_ctx"] == 16384 and o["num_gpu"] == 20 and o["num_predict"] == 200 and "seed" not in o


def test_diagnose_ollama_variant():
    from app.engine import diagnose
    assert "Ollama engine" in diagnose(["llama_model_load: error loading model: error loading model hyperparameters: key not found in model: gemma3.attention.layer_norm_rms_epsilon"])
