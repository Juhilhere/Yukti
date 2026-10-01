"""Yukti's own AI model is optional on a computer that already has a model: which models Yukti starts with by itself,
and what the server tells the page about the photo add-on in that case."""
from __future__ import annotations

import json


def _m(name, size_mb, source="lmstudio", vision=False):
    return {"id": name, "name": name, "path": name, "size_bytes": size_mb * 2**20, "source": source, "vision": vision}


def test_only_real_chat_models_are_started_by_default(monkeypatch):
    from app import engine
    models = [_m("nomic-embed-text-v1.5.Q8_0", 400), _m("tiny-helper", 20), _m("gemma3:4b (Ollama library)", 3184, "ollama-library"),
              _m("bge-reranker-large", 900), _m("qwen2.5-7b-instruct-Q4_K_M", 4400), _m("gemma-2-2b-it-Q8_0", 2590)]
    monkeypatch.setattr(engine, "scan_models", lambda: sorted(models, key=lambda m: m["size_bytes"]))
    assert [m["name"] for m in engine.startable_models()] == ["gemma-2-2b-it-Q8_0", "qwen2.5-7b-instruct-Q4_K_M"]


def _picked(monkeypatch, models):
    from app import engine
    got = []
    monkeypatch.setattr(engine, "scan_models", lambda: sorted(models, key=lambda m: m["size_bytes"]))
    monkeypatch.setattr(engine, "load", lambda eng, mid, cfg, **k: got.append(mid))
    engine.autoload_default()
    return got


def test_default_model_prefers_yuktis_own_then_a_gemma_then_the_smallest(monkeypatch):
    own = _m("gemma-3-4b-it-Q4_K_M", 2374, "yukti")
    own_seeing = {**own, "vision": True}
    other_gemma = _m("gemma-2-2b-it-Q8_0", 2590)
    small = _m("phi-3-mini-4k-instruct-Q4_K_M", 2200)
    big = _m("qwen2.5-7b-instruct-Q4_K_M", 4400)
    assert _picked(monkeypatch, [small, other_gemma, own_seeing, big]) == ["gemma-3-4b-it-Q4_K_M"]
    assert _picked(monkeypatch, [small, _m("gemma-2-2b-it-Q4_K_M", 1700), own]) == ["gemma-3-4b-it-Q4_K_M"]   # own before a smaller Gemma
    assert _picked(monkeypatch, [small, other_gemma, big]) == ["gemma-2-2b-it-Q8_0"]    # no own model: a Gemma already here
    assert _picked(monkeypatch, [big, small]) == ["phi-3-mini-4k-instruct-Q4_K_M"]      # no Gemma: the smallest
    assert _picked(monkeypatch, [_m("gemma3:4b (Ollama library)", 3184, "ollama-library")]) == []   # nothing Yukti can start itself


def test_photo_add_on_says_when_it_brings_the_model_along(login, monkeypatch, tmp_path):
    from app import main
    u = login("admin")
    monkeypatch.setattr(main, "ROOT", tmp_path)
    assert u.get("/api/features").json()["vision_with_model"] is False          # not installed with Yukti-Setup: nothing to say
    (tmp_path / "installed.json").write_text(json.dumps({"version": "9.9.9", "artifacts": {"server-core": "X", "llama-vulkan": "Y"}}))
    f = u.get("/api/features").json()
    assert f["downloadable"] is True and f["vision_with_model"] is True         # own model was left out
    (tmp_path / "installed.json").write_text(json.dumps({"artifacts": {"server-core": "X", "model-mmproj-gemma-3-4b-it-f16": "M"}}))
    assert u.get("/api/features").json()["vision_with_model"] is True           # the image module alone is not the model
    (tmp_path / "installed.json").write_text(json.dumps({"artifacts": {"server-core": "X", "model-gemma-3-4b-it-q4_k_m": "Z"}}))
    assert u.get("/api/features").json()["vision_with_model"] is False
    (tmp_path / "installed.json").write_text("not json")
    assert u.get("/api/features").json()["vision_with_model"] is False
