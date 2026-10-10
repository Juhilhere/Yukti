# Research and references

The research Yukti builds on. It follows a request from **a question or a scan** to **a cited, approved output** in five stages,
with two references per stage.

For each reference: the citation, how we use it, and where it lives in this repository. Where Yukti uses only part of
a method, or an optional component, the note says so.

## Stage 1 · Grounded retrieval

| Reference | How we use it | In this repository |
|---|---|---|
| Lewis, P., et al. (2020). *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks.* NeurIPS 2020. [arXiv:2005.11401](https://arxiv.org/abs/2005.11401) | The basis of our evidence-first answers. | `backend/app/rag.py` (`retrieve`: policy-filtered retrieval of passages) and `backend/app/chat.py` (passages given to the model as delimited `<doc>` data, answers cited `[S1]`/`[F1]`, citation check). Facts are marked KNOWN / MISSING / CONFLICTING (`rag.py`, dossier facts). |
| Edge, D., et al. (2024). *From Local to Global: A Graph RAG Approach to Query-Focused Summarization.* [arXiv:2404.16130](https://arxiv.org/abs/2404.16130) | Graph links between assets, procedures and records. | `backend/app/graph.py`: a knowledge graph built from the plant's own data (asset → document, asset → procedure, supersedes, references, related assets, work orders, findings, ledger entries). `rag.py` adds linked documents as the *graph* channel. Yukti uses graph links for retrieval; it does not build the community summaries of the paper. |

## Stage 2 · Hybrid search

| Reference | How we use it | In this repository |
|---|---|---|
| Robertson, S. & Zaragoza, H. (2009). *The Probabilistic Relevance Framework: BM25 and Beyond.* Foundations and Trends in Information Retrieval 3(4). [doi:10.1561/1500000019](https://doi.org/10.1561/1500000019) | The keyword-relevance model in our retriever. | `backend/app/rag.py`: SQLite FTS5 full-text index ranked with `bm25()`, combined with asset-tag, metadata and graph boosts. |
| Chen, J., et al. (2024). *BGE M3-Embedding: Multi-Lingual, Multi-Functionality, Multi-Granularity Text Embeddings Through Self-Knowledge Distillation.* [arXiv:2402.03216](https://arxiv.org/abs/2402.03216) | Multilingual dense and sparse embeddings for vector search. | `backend/app/vectors.py` (optional): BGE-M3 served locally by llama.cpp in embedding mode, or an existing local embeddings server (`YUKTI_EMBED_URL`); cosine search fused into `rag.py` as the *vector* channel. Yukti currently uses BGE-M3's **dense** vectors; sparse lexical matching comes from BM25. |

## Stage 3 · Access and decisions

| Reference | How we use it | In this repository |
|---|---|---|
| Hu, V. C., et al. (2014). *Guide to Attribute Based Access Control (ABAC) Definition and Considerations.* NIST Special Publication 800-162. [doi:10.6028/NIST.SP.800-162](https://doi.org/10.6028/NIST.SP.800-162) | The model behind our role- and asset-scoped policy engine. | `backend/app/policy.py` (the decision point: deny-overrides, default deny, fail closed) and `backend/policies/core.yaml` (the rules), with `backend/app/scope.py` for assets, findings and records. Subject, resource and environment attributes come from the database, never from the model. See [SECURITY_MODEL.md](SECURITY_MODEL.md). |
| Kahneman, D. (2011). *Thinking, Fast and Slow.* Farrar, Straus and Giroux. | The System-1 split behind Laya: fast typed decisions first. | `backend/app/laya.py`: Laya, a small decision model on ONNX Runtime (about 1 ms) that returns typed decisions (intent, department, urgency, worker) and abstains below 0.40 confidence, before any LLM call. `backend/app/workqueue.py` turns the decision into the worker that does the job. Jev is the closed-source reference pattern for this category; Laya is our open-weight implementation with a compatible typed interface. |

## Stage 4 · Multimodal documents

| Reference | How we use it | In this repository |
|---|---|---|
| Bai, S., et al. (2025). *Qwen2.5-VL Technical Report.* [arXiv:2502.13923](https://arxiv.org/abs/2502.13923) | Open-weight VLM for stamps, layouts and drawings. | `backend/app/scan_findings.py` (`look`: stamps, signatures, layout, drawing symbols, safety markings on a scan) and `backend/app/attachments.py` with `backend/app/chat.py` (photos asked about in chat). Any vision model llama.cpp runs with its image module can be used; Yukti ships Gemma 3 4B with its image module as the default. When no vision model is loaded, the vision step is skipped and says so. |
| Du, Y., et al. (2020). *PP-OCR: A Practical Ultra Lightweight OCR System.* [arXiv:2009.09941](https://arxiv.org/abs/2009.09941) | On-device OCR for scanned records. | RapidOCR with PP-OCR ONNX models: `backend/app/rag.py` (scanned pages at ingestion, with per-page OCR confidence) and `backend/app/scan_findings.py` (`ocr_rows`: lines with their position on the page, for evidence regions and human review). |

## Stage 5 · Efficient local inference

| Reference | How we use it | In this repository |
|---|---|---|
| Leviathan, Y., Kalman, M. & Matias, Y. (2023). *Fast Inference from Transformers via Speculative Decoding.* ICML 2023. [arXiv:2211.17192](https://arxiv.org/abs/2211.17192) | Draft-model, MTP and n-gram drafting in our engine. | `backend/app/llm_params.py` (*Speculative Decoding* group: draft model `-md`, `--draft-max/min`, `--draft-p-min`, and `--spec-type` for MTP or n-gram speculation) and `backend/app/perf_profiles.py` (the 27B reference profiles use n-gram or draft-model speculation). |
| Kwon, W., et al. (2023). *Efficient Memory Management for Large Language Model Serving with PagedAttention.* SOSP 2023. [arXiv:2309.06180](https://arxiv.org/abs/2309.06180) | Behind our optional vLLM engine for multi-user serving. | `backend/app/engine.py` (the `vllm` engine: Yukti connects to a vLLM server on the plant GPU server) and `backend/app/llm_params.py` (*vLLM* settings group). vLLM is not bundled; the built-in engine is llama.cpp. |

## Related project documents

- [ARCHITECTURE.md](ARCHITECTURE.md): how the pieces fit together
- [SECURITY_MODEL.md](SECURITY_MODEL.md): access control, sandbox, research-layer isolation, audit
- [FEASIBILITY.md](FEASIBILITY.md): risks, feasibility, viability and impact
