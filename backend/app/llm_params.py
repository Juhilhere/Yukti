"""Every tunable exposed by Yukti — load-time (engine/server) and prediction-time (sampling) parameters.

Mirrors the depth of Bionic / LM Studio (`llm.load.*`, `llm.prediction.*`), llama.cpp `llama-server`, and vLLM.
The frontend renders its forms generically from this schema.
"""
from __future__ import annotations

from typing import Any

L = "llamacpp"
B = "bionic"
V = "vllm"
R = "remote"
O = "ollama"
ALL = [L, O, B, V, R]

KV_TYPES = [{"value": v, "label": v} for v in ["f16", "bf16", "f32", "q8_0", "q5_1", "q5_0", "iq4_nl", "q4_1", "q4_0"]]


def f(key: str, label: str, group: str, type_: str, default: Any, desc: str, engines: list[str], **kw: Any) -> dict[str, Any]:
    d = {"key": key, "label": label, "group": group, "type": type_, "default": default, "description": desc,
         "engines": engines}
    d.update(kw)
    return d


LOAD: list[dict[str, Any]] = [
    # Context
    f("ctx_size", "Context length", "Context", "int", 8192, "Tokens of context the model can attend to (KV cache size). Larger = more VRAM/RAM.", [L, V, O], min=512, max=131072, step=512, unit="tokens", flag="-c"),
    f("keep", "Tokens to keep on overflow", "Context", "int", 0, "Number of prompt tokens kept when the context is shifted (-1 = all).", [L], min=-1, max=8192, step=1, advanced=True, flag="--keep"),
    f("context_shift", "Context shift", "Context", "bool", False, "Discard old tokens instead of failing when the context fills during generation.", [L], advanced=True, flag="--context-shift"),
    # GPU & offload
    f("backend", "Compute backend", "GPU & Offload", "select", "auto", "Bundled llama.cpp build: auto (CUDA if an NVIDIA GPU is present, else Vulkan), CUDA 12.4 (NVIDIA) or Vulkan (AMD/Intel GPUs; CPU when GPU layers = 0).", [L], options=[{"value": "auto", "label": "Auto-detect"}, {"value": "cuda", "label": "CUDA 12.4 (NVIDIA)"}, {"value": "vulkan", "label": "Vulkan / CPU"}]),
    f("gpu_layers", "GPU offload (layers)", "GPU & Offload", "int", 99, "Transformer layers kept in VRAM. 99 = all layers; 0 = CPU only. Partial offload trades speed for VRAM.", [L, O], min=0, max=99, step=1, flag="-ngl"),
    f("fit", "Auto-fit to device memory", "GPU & Offload", "select", "on", "Let llama.cpp shrink unset arguments (context, offload) so the model fits in VRAM.", [L], options=[{"value": "on", "label": "on"}, {"value": "off", "label": "off"}], flag="--fit"),
    f("main_gpu", "Main GPU index", "GPU & Offload", "int", 0, "GPU used for the model / intermediate results.", [L], min=0, max=8, step=1, advanced=True, flag="-mg"),
    f("split_mode", "Multi-GPU split mode", "GPU & Offload", "select", "layer", "How to split across GPUs: none, layer (default), row.", [L], options=[{"value": v, "label": v} for v in ["none", "layer", "row"]], advanced=True, flag="-sm"),
    f("tensor_split", "Tensor split", "GPU & Offload", "text", "", "Fraction of the model per GPU, e.g. 3,1.", [L], advanced=True, flag="-ts"),
    f("kv_offload", "Offload KV cache to GPU", "GPU & Offload", "bool", True, "Keep the KV cache in VRAM (faster). Disable to save VRAM.", [L], flag="kv_offload"),
    f("op_offload", "Offload host tensor ops", "GPU & Offload", "bool", True, "Offload host tensor operations to the device.", [L], advanced=True, flag="op_offload"),
    # CPU
    f("threads", "CPU threads (generation)", "CPU", "int", 8, "Threads used during token generation. Best ≈ physical cores.", [L, O], min=1, max=32, step=1, flag="-t"),
    f("threads_batch", "CPU threads (prompt/batch)", "CPU", "int", 16, "Threads used during prompt processing.", [L], min=1, max=32, step=1, flag="-tb"),
    f("prio", "Process priority", "CPU", "select", 0, "Thread priority for the inference process.", [L], options=[{"value": v, "label": l} for v, l in [(-1, "low"), (0, "normal"), (1, "medium"), (2, "high")]], advanced=True, flag="--prio"),
    f("numa", "NUMA strategy", "CPU", "select", "", "NUMA optimisation (servers).", [L], options=[{"value": "", "label": "off"}, {"value": "distribute", "label": "distribute"}, {"value": "isolate", "label": "isolate"}, {"value": "numactl", "label": "numactl"}], advanced=True, flag="--numa"),
    # Batching
    f("batch_size", "Evaluation batch size", "Batching", "int", 2048, "Logical max batch for prompt processing (-b). Higher = faster prefill, more memory.", [L, O], min=32, max=8192, step=32, flag="-b"),
    f("ubatch_size", "Physical (micro) batch size", "Batching", "int", 512, "Physical max batch per compute step (-ub).", [L], min=32, max=4096, step=32, flag="-ub"),
    f("cont_batching", "Continuous batching", "Batching", "bool", True, "Dynamically batch concurrent requests.", [L], flag="cont_batching"),
    # Attention & KV
    f("flash_attn", "Flash attention", "Attention & KV Cache", "select", "auto", "Faster attention, lower memory. Required for quantized V cache.", [L], options=[{"value": v, "label": v} for v in ["auto", "on", "off"]], flag="-fa"),
    f("cache_type_k", "K cache quantization", "Attention & KV Cache", "select", "f16", "Data type of the K cache. q8_0 halves KV memory with minimal quality loss.", [L], options=KV_TYPES, flag="-ctk"),
    f("cache_type_v", "V cache quantization", "Attention & KV Cache", "select", "f16", "Data type of the V cache (quantized V needs flash attention).", [L], options=KV_TYPES, flag="-ctv"),
    f("kv_unified", "Unified KV buffer", "Attention & KV Cache", "bool", False, "Single KV buffer shared by all sequences.", [L], advanced=True, flag="kv_unified"),
    f("swa_full", "Full-size SWA cache", "Attention & KV Cache", "bool", False, "Use full-size sliding-window-attention cache (Gemma).", [L], advanced=True, flag="--swa-full"),
    f("cache_ram", "Prompt cache RAM (MiB)", "Attention & KV Cache", "int", 8192, "Max host RAM for the prompt cache (-1 unlimited, 0 off).", [L], min=-1, max=65536, step=256, advanced=True, flag="-cram"),
    f("ctx_checkpoints", "Context checkpoints", "Attention & KV Cache", "int", 8, "Max SWA/context checkpoints per slot.", [L], min=0, max=64, step=1, advanced=True, flag="-ctxcp"),
    # RoPE
    f("rope_scaling", "RoPE scaling", "RoPE", "select", "", "Frequency scaling method to extend context.", [L], options=[{"value": "", "label": "model default"}, {"value": "none", "label": "none"}, {"value": "linear", "label": "linear"}, {"value": "yarn", "label": "yarn"}], advanced=True, flag="--rope-scaling"),
    f("rope_freq_base", "RoPE frequency base", "RoPE", "number", 0, "NTK-aware base frequency (0 = from model).", [L], min=0, max=10000000, step=1000, advanced=True, flag="--rope-freq-base"),
    f("rope_freq_scale", "RoPE frequency scale", "RoPE", "number", 0, "Context expansion factor 1/N (0 = from model).", [L], min=0, max=1, step=0.05, advanced=True, flag="--rope-freq-scale"),
    f("yarn_orig_ctx", "YaRN original context", "RoPE", "int", 0, "Original training context for YaRN (0 = model).", [L], min=0, max=131072, step=512, advanced=True, flag="--yarn-orig-ctx"),
    f("yarn_ext_factor", "YaRN extrapolation factor", "RoPE", "number", -1, "Extrapolation mix factor (-1 = default).", [L], min=-1, max=1, step=0.05, advanced=True, flag="--yarn-ext-factor"),
    f("yarn_attn_factor", "YaRN attention factor", "RoPE", "number", -1, "Scale of sqrt(t) / attention magnitude (-1 = default).", [L], min=-1, max=4, step=0.05, advanced=True, flag="--yarn-attn-factor"),
    # Memory
    f("mmap", "Memory-map model (mmap)", "Memory", "bool", True, "Map the model file instead of reading it fully; faster load, lower RAM.", [L, O], flag="mmap"),
    f("keep_alive", "Keep model loaded", "Ollama", "text", "30m", "How long Ollama keeps the model in memory after the last request (e.g. 30m, 2h, -1 = forever).", [O]),
    f("mlock", "Keep model in memory (mlock)", "Memory", "bool", False, "Lock the model in RAM so the OS never swaps it.", [L], flag="--mlock"),
    f("repack", "Weight repacking", "Memory", "bool", True, "Repack weights for faster CPU kernels.", [L], advanced=True, flag="repack"),
    f("check_tensors", "Validate tensors on load", "Memory", "bool", False, "Check tensor data for invalid values (slower load).", [L], advanced=True, flag="--check-tensors"),
    # Speculative
    f("draft_model", "Draft model (speculative)", "Speculative Decoding", "select", "", "Smaller model with the same tokenizer that proposes tokens; the main model verifies them.", [L], options=[], flag="-md"),
    f("draft_max", "Max draft tokens", "Speculative Decoding", "int", 16, "Tokens drafted per step.", [L], min=1, max=64, step=1, flag="--draft-max"),
    f("draft_min", "Min draft tokens", "Speculative Decoding", "int", 0, "Minimum tokens to draft.", [L], min=0, max=32, step=1, flag="--draft-min"),
    f("draft_p_min", "Min draft probability", "Speculative Decoding", "number", 0.75, "Stop drafting when the draft's greedy probability drops below this.", [L], min=0, max=1, step=0.05, flag="--draft-p-min"),
    f("gpu_layers_draft", "Draft GPU layers", "Speculative Decoding", "int", 99, "GPU layers for the draft model.", [L], min=0, max=99, step=1, advanced=True, flag="-ngld"),
    f("spec_type", "Draft-free speculation / MTP", "Speculative Decoding", "select", "none", "MTP (multi-token prediction head, for models that ship one) or n-gram speculation without a draft model.", [L], options=[{"value": v, "label": v} for v in ["none", "draft-mtp", "ngram-cache", "ngram-simple", "ngram-map-k", "ngram-mod"]], advanced=True, flag="--spec-type"),
    # MoE
    f("cpu_moe", "All MoE experts on CPU", "MoE", "bool", False, "Keep all Mixture-of-Experts weights in system RAM (fit big MoE models on small GPUs).", [L], flag="--cpu-moe"),
    f("n_cpu_moe", "MoE layers on CPU", "MoE", "int", 0, "Keep experts of the first N layers on CPU. Lower until VRAM is ~90% used.", [L], min=0, max=128, step=1, flag="--n-cpu-moe"),
    # Parallelism & caching
    f("parallel", "Parallel sessions (slots)", "Parallelism", "int", 1, "Concurrent sequences served; context is divided between slots.", [L], min=1, max=16, step=1, flag="-np"),
    f("cache_prompt", "Prompt caching", "Parallelism", "bool", True, "Reuse KV of a matching prompt prefix between requests.", [L], flag="cache_prompt"),
    f("cache_reuse", "KV reuse chunk size", "Parallelism", "int", 256, "Min chunk size to reuse from cache via KV shifting (0 = off).", [L], min=0, max=4096, step=64, flag="--cache-reuse"),
    f("threads_http", "HTTP threads", "Parallelism", "int", -1, "Threads handling HTTP requests (-1 auto).", [L], min=-1, max=64, step=1, advanced=True, flag="--threads-http"),
    # Reasoning & template
    f("jinja", "Jinja chat templates", "Chat Template & Reasoning", "bool", True, "Use the model's Jinja chat template.", [L], flag="jinja"),
    f("reasoning", "Reasoning / thinking", "Chat Template & Reasoning", "select", "auto", "Enable model thinking (for reasoning models).", [L], options=[{"value": v, "label": v} for v in ["auto", "on", "off"]], flag="-rea"),
    f("reasoning_format", "Reasoning format", "Chat Template & Reasoning", "select", "deepseek", "Where thoughts go: message.reasoning_content (deepseek) or inline.", [L], options=[{"value": v, "label": v} for v in ["deepseek", "deepseek-legacy", "none"]], flag="--reasoning-format"),
    f("reasoning_budget", "Reasoning budget (tokens)", "Chat Template & Reasoning", "int", -1, "Token budget for thinking (-1 unlimited, 0 no thinking).", [L], min=-1, max=32768, step=64, flag="--reasoning-budget"),
    f("chat_template_kwargs", "Chat template kwargs (JSON)", "Chat Template & Reasoning", "json", "", "Extra template params, e.g. {\"enable_thinking\": false}.", [L], advanced=True, flag="--chat-template-kwargs"),
    # vLLM (plant GPU)
    f("tensor_parallel_size", "Tensor parallel size", "vLLM", "int", 1, "Number of GPUs to shard the model across.", [V], min=1, max=8, step=1),
    f("gpu_memory_utilization", "GPU memory utilization", "vLLM", "number", 0.9, "Fraction of VRAM vLLM may use for weights + KV cache.", [V], min=0.1, max=0.99, step=0.01),
    f("max_model_len", "Max model length", "vLLM", "int", 32768, "Maximum context length.", [V], min=1024, max=262144, step=1024),
    f("max_num_seqs", "Max concurrent sequences", "vLLM", "int", 64, "Max sequences batched per iteration.", [V], min=1, max=1024, step=1),
    f("max_num_batched_tokens", "Max batched tokens", "vLLM", "int", 8192, "Token budget per scheduler step.", [V], min=256, max=131072, step=256),
    f("dtype", "Weights dtype", "vLLM", "select", "auto", "Model weight precision.", [V], options=[{"value": v, "label": v} for v in ["auto", "bfloat16", "float16"]]),
    f("quantization", "Quantization", "vLLM", "select", "", "Weight quantization method.", [V], options=[{"value": v, "label": v or "none"} for v in ["", "fp8", "awq", "gptq", "bitsandbytes", "compressed-tensors"]]),
    f("kv_cache_dtype", "KV cache dtype", "vLLM", "select", "auto", "KV cache precision (fp8 on Ada/Hopper).", [V], options=[{"value": v, "label": v} for v in ["auto", "fp8", "fp8_e5m2", "fp8_e4m3"]]),
    f("enable_prefix_caching", "Prefix caching", "vLLM", "bool", True, "Automatic prefix caching across requests.", [V]),
    f("enable_chunked_prefill", "Chunked prefill", "vLLM", "bool", True, "Split long prefills to keep decode latency low.", [V]),
    f("swap_space", "CPU swap space (GiB)", "vLLM", "int", 4, "CPU memory for swapped KV blocks.", [V], min=0, max=64, step=1, advanced=True),
    f("enforce_eager", "Enforce eager mode", "vLLM", "bool", False, "Disable CUDA graphs (less memory, slower).", [V], advanced=True),
    f("speculative_config", "Speculative config (JSON)", "vLLM", "json", "", "e.g. {\"method\":\"mtp\",\"num_speculative_tokens\":3}", [V], advanced=True),
    f("reasoning_parser", "Reasoning parser", "vLLM", "text", "", "e.g. qwen3, deepseek_r1.", [V], advanced=True),
    f("tool_call_parser", "Tool-call parser", "vLLM", "text", "", "e.g. hermes, llama3_json.", [V], advanced=True),
    # Advanced
    f("extra_args", "Extra engine arguments", "Advanced", "text", "", "Raw flags appended to the llama-server command (like Bionic's arguments override).", [L], advanced=True),
]

PREDICTION: list[dict[str, Any]] = [
    # Sampling
    f("temperature", "Temperature", "Sampling", "number", 0.8, "Randomness. 0 = greedy/deterministic; higher = more creative.", ALL, min=0, max=2, step=0.05),
    f("top_k", "Top-K", "Sampling", "int", 40, "Sample only from the K most likely tokens (0 = off).", [L, O, B, V], min=0, max=200, step=1),
    f("top_p", "Top-P (nucleus)", "Sampling", "number", 0.95, "Sample from the smallest set whose probability ≥ P (1 = off).", ALL, min=0, max=1, step=0.01),
    f("min_p", "Min-P", "Sampling", "number", 0.05, "Drop tokens below P × probability of the top token (0 = off).", [L, O, B, V], min=0, max=1, step=0.01),
    f("typical_p", "Typical-P", "Sampling", "number", 1.0, "Locally typical sampling (1 = off).", [L, V], min=0, max=1, step=0.01, advanced=True),
    f("top_n_sigma", "Top-nσ", "Sampling", "number", -1, "Keep tokens within n standard deviations of the max logit (-1 = off).", [L], min=-1, max=5, step=0.1, advanced=True),
    f("dynatemp_range", "Dynamic temperature range", "Sampling", "number", 0, "Entropy-based temperature range (0 = off).", [L], min=0, max=2, step=0.05, advanced=True),
    f("dynatemp_exponent", "Dynamic temperature exponent", "Sampling", "number", 1, "Exponent for dynamic temperature.", [L], min=0, max=4, step=0.1, advanced=True),
    f("samplers", "Sampler order", "Sampling", "text", "", "Semicolon list, e.g. penalties;dry;top_n_sigma;top_k;typ_p;top_p;min_p;xtc;temperature.", [L], advanced=True),
    # Penalties
    f("repeat_penalty", "Repeat penalty", "Penalties", "number", 1.0, "Penalise repeated tokens (1 = off).", [L, O, B, V], min=0.5, max=2, step=0.01),
    f("repeat_last_n", "Repeat window", "Penalties", "int", 64, "Tokens considered for repeat penalty (0 off, -1 = context).", [L], min=-1, max=4096, step=1),
    f("presence_penalty", "Presence penalty", "Penalties", "number", 0.0, "Penalise tokens that already appeared (topic novelty).", ALL, min=-2, max=2, step=0.05),
    f("frequency_penalty", "Frequency penalty", "Penalties", "number", 0.0, "Penalise tokens by how often they appeared.", ALL, min=-2, max=2, step=0.05),
    # DRY
    f("dry_multiplier", "DRY multiplier", "DRY", "number", 0.0, "Don't-Repeat-Yourself penalty strength (0 = off).", [L], min=0, max=5, step=0.05, advanced=True),
    f("dry_base", "DRY base", "DRY", "number", 1.75, "Exponential base of the DRY penalty.", [L], min=1, max=4, step=0.05, advanced=True),
    f("dry_allowed_length", "DRY allowed length", "DRY", "int", 2, "Repeated sequences up to this length are not penalised.", [L], min=0, max=20, step=1, advanced=True),
    f("dry_penalty_last_n", "DRY window", "DRY", "int", -1, "Tokens scanned for repetition (-1 = context).", [L], min=-1, max=8192, step=1, advanced=True),
    # XTC
    f("xtc_probability", "XTC probability", "XTC", "number", 0.0, "Exclude-Top-Choices probability (0 = off).", [L], min=0, max=1, step=0.01, advanced=True),
    f("xtc_threshold", "XTC threshold", "XTC", "number", 0.1, "Tokens above this probability may be excluded.", [L], min=0, max=1, step=0.01, advanced=True),
    # Mirostat
    f("mirostat", "Mirostat", "Mirostat", "select", 0, "Adaptive perplexity control (replaces top-k/p).", [L], options=[{"value": 0, "label": "off"}, {"value": 1, "label": "Mirostat"}, {"value": 2, "label": "Mirostat 2.0"}], advanced=True),
    f("mirostat_tau", "Mirostat τ (target entropy)", "Mirostat", "number", 5.0, "Target surprise.", [L], min=0, max=10, step=0.1, advanced=True),
    f("mirostat_eta", "Mirostat η (learning rate)", "Mirostat", "number", 0.1, "Adaptation speed.", [L], min=0, max=1, step=0.01, advanced=True),
    # Output
    f("max_tokens", "Max response tokens", "Output", "int", -1, "Limit on generated tokens (-1 = until stop).", ALL, min=-1, max=32768, step=16),
    f("stop", "Stop strings", "Output", "tags", [], "Generation stops when any of these strings appears.", ALL),
    f("seed", "Seed", "Output", "int", -1, "RNG seed for reproducible sampling (-1 = random).", ALL, min=-1, max=2147483647, step=1),
    f("context_overflow", "Context overflow policy", "Output", "select", "truncate_middle", "What to do when the conversation exceeds the context: keep system + recent turns, or stop.", ALL, options=[{"value": "truncate_middle", "label": "Truncate middle"}, {"value": "rolling_window", "label": "Rolling window"}, {"value": "stop", "label": "Stop at limit"}]),
    f("n_probs", "Token probabilities (top-N)", "Output", "int", 0, "Return top-N token probabilities per generated token.", [L], min=0, max=20, step=1, advanced=True),
    f("ignore_eos", "Ignore EOS", "Output", "bool", False, "Keep generating past the end-of-sequence token.", [L], advanced=True),
    f("min_tokens", "Min tokens", "Output", "int", 0, "Minimum tokens before EOS is allowed.", [V], min=0, max=4096, step=1, advanced=True),
    # Reasoning
    f("enable_thinking", "Enable thinking", "Reasoning", "select", "auto", "Ask reasoning models to think before answering (chat_template_kwargs.enable_thinking).", [L, O, B, V], options=[{"value": "auto", "label": "model default"}, {"value": "on", "label": "on"}, {"value": "off", "label": "off"}]),
    f("reasoning_effort", "Reasoning effort", "Reasoning", "select", "", "For models that support it (e.g. gpt-oss): low / medium / high.", ALL, options=[{"value": "", "label": "default"}, {"value": "low", "label": "low"}, {"value": "medium", "label": "medium"}, {"value": "high", "label": "high"}]),
    # Structured
    f("json_schema", "Structured output (JSON Schema)", "Structured Output", "json", "", "Constrain output to this JSON schema (response_format).", ALL, advanced=True),
    f("grammar", "GBNF grammar", "Structured Output", "textarea", "", "llama.cpp grammar constraining generation.", [L], advanced=True),
    f("logit_bias", "Logit bias (JSON)", "Structured Output", "json", "", "Token-id → bias map, e.g. {\"15043\": -100}.", [L, V], advanced=True),
]

DEFAULT_PREDICTION = {p["key"]: p["default"] for p in PREDICTION}
DEFAULT_LOAD = {p["key"]: p["default"] for p in LOAD}


def schema(models: list[dict[str, Any]]) -> dict[str, Any]:
    load = [dict(p) for p in LOAD]
    for p in load:
        if p["key"] == "draft_model":
            p["options"] = [{"value": "", "label": "none"}] + [{"value": m["id"], "label": m["name"]} for m in models if m.get("source") != "engine"]
    return {"load": load, "prediction": PREDICTION}


def llama_args(cfg: dict[str, Any], model_path: str, draft_path: str | None) -> list[str]:
    """Translate a load config into llama-server CLI arguments."""
    c = {**DEFAULT_LOAD, **{k: v for k, v in cfg.items() if v is not None}}
    a: list[str] = ["-m", model_path]

    def add(flag: str, v: Any) -> None:
        a.extend([flag, str(v)])

    add("-c", int(c["ctx_size"]))
    add("-ngl", int(c["gpu_layers"]))
    add("--fit", c["fit"])
    if int(c["main_gpu"]):
        add("-mg", int(c["main_gpu"]))
    if c["split_mode"] != "layer":
        add("-sm", c["split_mode"])
    if c["tensor_split"]:
        add("-ts", c["tensor_split"])
    if not c["kv_offload"]:
        a.append("-nkvo")
    if not c["op_offload"]:
        a.append("--no-op-offload")
    add("-t", int(c["threads"]))
    add("-tb", int(c["threads_batch"]))
    if int(c["prio"]):
        add("--prio", int(c["prio"]))
    if c["numa"]:
        add("--numa", c["numa"])
    add("-b", int(c["batch_size"]))
    add("-ub", int(c["ubatch_size"]))
    if not c["cont_batching"]:
        a.append("-nocb")
    add("-fa", c["flash_attn"])
    add("-ctk", c["cache_type_k"])
    add("-ctv", c["cache_type_v"])
    if c["kv_unified"]:
        a.append("-kvu")
    if c["swa_full"]:
        a.append("--swa-full")
    if int(c["cache_ram"]) != 8192:
        add("-cram", int(c["cache_ram"]))
    if int(c["ctx_checkpoints"]) != 8:
        add("-ctxcp", int(c["ctx_checkpoints"]))
    if int(c["keep"]):
        add("--keep", int(c["keep"]))
    if c["context_shift"]:
        a.append("--context-shift")
    if c["rope_scaling"]:
        add("--rope-scaling", c["rope_scaling"])
    if float(c["rope_freq_base"]):
        add("--rope-freq-base", c["rope_freq_base"])
    if float(c["rope_freq_scale"]):
        add("--rope-freq-scale", c["rope_freq_scale"])
    if int(c["yarn_orig_ctx"]):
        add("--yarn-orig-ctx", int(c["yarn_orig_ctx"]))
    if float(c["yarn_ext_factor"]) != -1:
        add("--yarn-ext-factor", c["yarn_ext_factor"])
    if float(c["yarn_attn_factor"]) != -1:
        add("--yarn-attn-factor", c["yarn_attn_factor"])
    a.append("--mmap" if c["mmap"] else "--no-mmap")
    if c["mlock"]:
        a.append("--mlock")
    if not c["repack"]:
        a.append("--no-repack")
    if c["check_tensors"]:
        a.append("--check-tensors")
    if draft_path:
        add("-md", draft_path)
        add("--draft-max", int(c["draft_max"]))
        add("--draft-min", int(c["draft_min"]))
        add("--draft-p-min", c["draft_p_min"])
        add("-ngld", int(c["gpu_layers_draft"]))
    if c["spec_type"] and c["spec_type"] != "none":
        add("--spec-type", c["spec_type"])
    if c["cpu_moe"]:
        a.append("--cpu-moe")
    elif int(c["n_cpu_moe"]):
        add("--n-cpu-moe", int(c["n_cpu_moe"]))
    add("-np", int(c["parallel"]))
    if not c["cache_prompt"]:
        a.append("--no-cache-prompt")
    if int(c["cache_reuse"]):
        add("--cache-reuse", int(c["cache_reuse"]))
    if int(c["threads_http"]) != -1:
        add("--threads-http", int(c["threads_http"]))
    a.append("--jinja" if c["jinja"] else "--no-jinja")
    add("-rea", c["reasoning"])
    add("--reasoning-format", c["reasoning_format"])
    if int(c["reasoning_budget"]) != -1:
        add("--reasoning-budget", int(c["reasoning_budget"]))
    if c["chat_template_kwargs"]:
        add("--chat-template-kwargs", c["chat_template_kwargs"])
    if c["extra_args"]:
        a.extend(str(c["extra_args"]).split())
    return a


def vllm_command(cfg: dict[str, Any], model: str) -> str:
    c = {**DEFAULT_LOAD, **cfg}
    parts = [f"vllm serve {model}", f"--tensor-parallel-size {c['tensor_parallel_size']}",
             f"--gpu-memory-utilization {c['gpu_memory_utilization']}", f"--max-model-len {c['max_model_len']}",
             f"--max-num-seqs {c['max_num_seqs']}", f"--max-num-batched-tokens {c['max_num_batched_tokens']}",
             f"--dtype {c['dtype']}", f"--kv-cache-dtype {c['kv_cache_dtype']}", f"--swap-space {c['swap_space']}"]
    if c["quantization"]:
        parts.append(f"--quantization {c['quantization']}")
    parts.append("--enable-prefix-caching" if c["enable_prefix_caching"] else "--no-enable-prefix-caching")
    parts.append("--enable-chunked-prefill" if c["enable_chunked_prefill"] else "--no-enable-chunked-prefill")
    if c["enforce_eager"]:
        parts.append("--enforce-eager")
    if c["speculative_config"]:
        parts.append(f"--speculative-config '{c['speculative_config']}'")
    if c["reasoning_parser"]:
        parts.append(f"--reasoning-parser {c['reasoning_parser']}")
    if c["tool_call_parser"]:
        parts.append(f"--enable-auto-tool-choice --tool-call-parser {c['tool_call_parser']}")
    return " \\\n  ".join(parts)


def request_body(pred: dict[str, Any], engine: str) -> dict[str, Any]:
    """Map prediction params to an OpenAI-compatible /chat/completions body (+ engine extensions)."""
    p = {**DEFAULT_PREDICTION, **{k: v for k, v in (pred or {}).items() if v is not None and v != ""}}
    body: dict[str, Any] = {
        "temperature": float(p["temperature"]), "top_p": float(p["top_p"]),
        "presence_penalty": float(p["presence_penalty"]), "frequency_penalty": float(p["frequency_penalty"]),
    }
    if int(p["max_tokens"]) > 0:
        body["max_tokens"] = int(p["max_tokens"])
    if p["stop"]:
        body["stop"] = list(p["stop"])[:8]
    if int(p["seed"]) >= 0:
        body["seed"] = int(p["seed"])
    if p.get("reasoning_effort"):
        body["reasoning_effort"] = p["reasoning_effort"]
    if p.get("enable_thinking") in ("on", "off") and engine in ("llamacpp", "vllm"):  # llama.cpp / vLLM extension
        body["chat_template_kwargs"] = {"enable_thinking": p["enable_thinking"] == "on"}
    if p.get("json_schema"):
        try:
            import json
            sch = json.loads(p["json_schema"]) if isinstance(p["json_schema"], str) else p["json_schema"]
            body["response_format"] = {"type": "json_schema", "json_schema": {"name": "output", "schema": sch}}
        except Exception:
            pass
    if engine in ("llamacpp", "bionic", "vllm"):
        body["top_k"] = int(p["top_k"])
        body["min_p"] = float(p["min_p"])
        body["repeat_penalty"] = float(p["repeat_penalty"])
    if engine == "vllm":
        body["repetition_penalty"] = float(p["repeat_penalty"])
        body.pop("repeat_penalty", None)
        body["typical_p"] = float(p["typical_p"])
        if int(p["min_tokens"]):
            body["min_tokens"] = int(p["min_tokens"])
    if engine == "llamacpp":
        adv = {"typical_p": float, "repeat_last_n": int, "top_n_sigma": float, "dynatemp_range": float, "dynatemp_exponent": float,
               "dry_multiplier": float, "dry_base": float, "dry_allowed_length": int, "dry_penalty_last_n": int,
               "xtc_probability": float, "xtc_threshold": float, "mirostat": int, "mirostat_tau": float, "mirostat_eta": float,
               "n_probs": int, "ignore_eos": bool}
        for k, cast in adv.items():  # send only what the user changed (builds validate ranges differently)
            if p.get(k) is not None and cast(p[k]) != cast(DEFAULT_PREDICTION[k]):
                v = cast(p[k])
                if k in ("dry_penalty_last_n", "repeat_last_n") and v < 0:
                    v = 0 if k == "dry_penalty_last_n" else v
                body[k] = v
        if p.get("samplers"):
            body["samplers"] = [s for s in str(p["samplers"]).split(";") if s]
        if p.get("grammar"):
            body["grammar"] = p["grammar"]
    if p.get("logit_bias") and engine in ("llamacpp", "vllm"):
        try:
            import json
            body["logit_bias"] = json.loads(p["logit_bias"]) if isinstance(p["logit_bias"], str) else p["logit_bias"]
        except Exception:
            pass
    return body
