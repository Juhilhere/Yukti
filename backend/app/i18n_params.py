"""Hindi / Kannada translations of the AI parameter forms (labels, descriptions, groups, option labels) from llm_params.py.

Applied to the /api/params/schema response with translate_schema(); the module-level lists in llm_params are never changed.
Technical tokens (GPU, VRAM, KV, RoPE, JSON, flag names, numbers) stay in Latin script.
"""
from __future__ import annotations

import copy
from typing import Any

PARAMS: dict[str, dict[str, tuple[str, str]]] = {}


def _p(key: str, hi_label: str, hi_desc: str, kn_label: str, kn_desc: str) -> None:
    PARAMS[key] = {"hi": (hi_label, hi_desc), "kn": (kn_label, kn_desc)}


# ------------------------------------------------------------------ load: context
_p("ctx_size", "संदर्भ लंबाई (Context length)",
   "मॉडल एक बार में कितने टोकन (शब्द-अंश) याद रख सकता है (KV cache का आकार)। ज़्यादा = ज़्यादा VRAM/RAM।",
   "ಸಂದರ್ಭದ ಉದ್ದ (Context length)",
   "ಮಾದರಿ ಒಮ್ಮೆಗೆ ಎಷ್ಟು ಟೋಕನ್‌ಗಳನ್ನು (ಪದ-ಭಾಗಗಳು) ನೆನಪಿಡಬಹುದು (KV cache ಗಾತ್ರ). ಹೆಚ್ಚು = ಹೆಚ್ಚು VRAM/RAM.")
_p("keep", "भरने पर रखे जाने वाले टोकन",
   "संदर्भ भर जाने पर प्रश्न के कितने टोकन रखे जाएँ (-1 = सभी)।",
   "ತುಂಬಿದಾಗ ಉಳಿಸುವ ಟೋಕನ್‌ಗಳು",
   "ಸಂದರ್ಭ ತುಂಬಿದಾಗ ಪ್ರಶ್ನೆಯ ಎಷ್ಟು ಟೋಕನ್‌ಗಳನ್ನು ಉಳಿಸಬೇಕು (-1 = ಎಲ್ಲವೂ).")
_p("context_shift", "संदर्भ खिसकाना (Context shift)",
   "उत्तर लिखते समय संदर्भ भर जाए तो रुकने के बजाय पुराने टोकन हटा दें।",
   "ಸಂದರ್ಭ ಸರಿಸುವಿಕೆ (Context shift)",
   "ಉತ್ತರ ಬರೆಯುವಾಗ ಸಂದರ್ಭ ತುಂಬಿದರೆ ನಿಲ್ಲುವ ಬದಲು ಹಳೆಯ ಟೋಕನ್‌ಗಳನ್ನು ತೆಗೆದುಹಾಕಿ.")
# GPU & offload
_p("backend", "गणना बैकएंड (Compute backend)",
   "साथ आया llama.cpp संस्करण: auto (NVIDIA GPU हो तो CUDA, नहीं तो Vulkan), CUDA 12.4 (NVIDIA) या Vulkan (AMD/Intel GPU; GPU layers = 0 होने पर CPU)।",
   "ಗಣನೆ ಬ್ಯಾಕೆಂಡ್ (Compute backend)",
   "ಜೊತೆಗಿರುವ llama.cpp ಆವೃತ್ತಿ: auto (NVIDIA GPU ಇದ್ದರೆ CUDA, ಇಲ್ಲದಿದ್ದರೆ Vulkan), CUDA 12.4 (NVIDIA) ಅಥವಾ Vulkan (AMD/Intel GPU; GPU layers = 0 ಆದರೆ CPU).")
_p("gpu_layers", "GPU पर भेजी परतें (layers)",
   "मॉडल की कितनी परतें VRAM में रहें। 99 = सभी परतें; 0 = केवल CPU। आंशिक रूप से भेजने पर VRAM बचती है पर गति घटती है।",
   "GPU ಗೆ ಕಳುಹಿಸುವ ಪದರಗಳು (layers)",
   "ಮಾದರಿಯ ಎಷ್ಟು ಪದರಗಳು VRAM ನಲ್ಲಿ ಇರಬೇಕು. 99 = ಎಲ್ಲಾ ಪದರಗಳು; 0 = ಕೇವಲ CPU. ಭಾಗಶಃ ಕಳುಹಿಸಿದರೆ VRAM ಉಳಿಯುತ್ತದೆ ಆದರೆ ವೇಗ ಕಡಿಮೆ.")
_p("fit", "मेमोरी में अपने-आप फिट करें",
   "llama.cpp को खाली छोड़ी गई सेटिंग (संदर्भ, offload) घटाने दें ताकि मॉडल VRAM में आ जाए।",
   "ಮೆಮೊರಿಗೆ ತಾನಾಗಿ ಹೊಂದಿಸಿ",
   "ಮಾದರಿ VRAM ನಲ್ಲಿ ಹಿಡಿಸುವಂತೆ ಖಾಲಿ ಬಿಟ್ಟ ಸೆಟ್ಟಿಂಗ್‌ಗಳನ್ನು (ಸಂದರ್ಭ, offload) llama.cpp ಕಡಿಮೆ ಮಾಡಲಿ.")
_p("main_gpu", "मुख्य GPU क्रमांक",
   "मॉडल / बीच के परिणामों के लिए उपयोग होने वाला GPU।",
   "ಮುಖ್ಯ GPU ಸಂಖ್ಯೆ",
   "ಮಾದರಿ / ಮಧ್ಯಂತರ ಫಲಿತಾಂಶಗಳಿಗೆ ಬಳಸುವ GPU.")
_p("split_mode", "कई GPU में बाँटने का तरीका",
   "GPU में कैसे बाँटें: none, layer (डिफ़ॉल्ट), row।",
   "ಹಲವು GPU ಗಳಲ್ಲಿ ಹಂಚುವ ವಿಧಾನ",
   "GPU ಗಳಲ್ಲಿ ಹೇಗೆ ಹಂಚಬೇಕು: none, layer (ಡೀಫಾಲ್ಟ್), row.")
_p("tensor_split", "Tensor बँटवारा",
   "हर GPU पर मॉडल का हिस्सा, जैसे 3,1।",
   "Tensor ಹಂಚಿಕೆ",
   "ಪ್ರತಿ GPU ಮೇಲೆ ಮಾದರಿಯ ಭಾಗ, ಉದಾ. 3,1.")
_p("kv_offload", "KV cache को GPU पर रखें",
   "KV cache को VRAM में रखें (तेज़)। VRAM बचाने के लिए बंद करें।",
   "KV cache ಅನ್ನು GPU ಮೇಲೆ ಇರಿಸಿ",
   "KV cache ಅನ್ನು VRAM ನಲ್ಲಿ ಇರಿಸಿ (ವೇಗ). VRAM ಉಳಿಸಲು ಆಫ್ ಮಾಡಿ.")
_p("op_offload", "होस्ट tensor कार्य GPU पर भेजें",
   "होस्ट के tensor कार्यों को डिवाइस (GPU) पर चलाएँ।",
   "ಹೋಸ್ಟ್ tensor ಕಾರ್ಯಗಳನ್ನು GPU ಗೆ ಕಳುಹಿಸಿ",
   "ಹೋಸ್ಟ್‌ನ tensor ಕಾರ್ಯಗಳನ್ನು ಸಾಧನದಲ್ಲಿ (GPU) ನಡೆಸಿ.")
# CPU
_p("threads", "CPU threads (उत्तर लिखना)",
   "उत्तर के टोकन बनाते समय उपयोग होने वाले threads। सबसे अच्छा ≈ भौतिक cores जितने।",
   "CPU threads (ಉತ್ತರ ಬರೆಯುವುದು)",
   "ಉತ್ತರದ ಟೋಕನ್‌ಗಳನ್ನು ರಚಿಸುವಾಗ ಬಳಸುವ threads. ಉತ್ತಮ ≈ ಭೌತಿಕ cores ಸಂಖ್ಯೆ.")
_p("threads_batch", "CPU threads (प्रश्न पढ़ना)",
   "प्रश्न (prompt) पढ़ते समय उपयोग होने वाले threads।",
   "CPU threads (ಪ್ರಶ್ನೆ ಓದುವುದು)",
   "ಪ್ರಶ್ನೆ (prompt) ಓದುವಾಗ ಬಳಸುವ threads.")
_p("prio", "प्रक्रिया प्राथमिकता",
   "AI प्रक्रिया के threads की प्राथमिकता।",
   "ಪ್ರಕ್ರಿಯೆ ಆದ್ಯತೆ",
   "AI ಪ್ರಕ್ರಿಯೆಯ threads ಗಳ ಆದ್ಯತೆ.")
_p("numa", "NUMA तरीका",
   "NUMA सुधार (सर्वर के लिए)।",
   "NUMA ವಿಧಾನ",
   "NUMA ಸುಧಾರಣೆ (ಸರ್ವರ್‌ಗಳಿಗೆ).")
# Batching
_p("batch_size", "प्रोसेसिंग batch आकार",
   "प्रश्न पढ़ने का अधिकतम तार्किक batch (-b)। ज़्यादा = तेज़ पढ़ना, ज़्यादा मेमोरी।",
   "ಪ್ರಕ್ರಿಯೆ batch ಗಾತ್ರ",
   "ಪ್ರಶ್ನೆ ಓದುವ ಗರಿಷ್ಠ ತಾರ್ಕಿಕ batch (-b). ಹೆಚ್ಚು = ವೇಗವಾಗಿ ಓದುವುದು, ಹೆಚ್ಚು ಮೆಮೊರಿ.")
_p("ubatch_size", "भौतिक (micro) batch आकार",
   "हर गणना चरण का अधिकतम भौतिक batch (-ub)।",
   "ಭೌತಿಕ (micro) batch ಗಾತ್ರ",
   "ಪ್ರತಿ ಗಣನೆ ಹಂತದ ಗರಿಷ್ಠ ಭೌತಿಕ batch (-ub).")
_p("cont_batching", "लगातार batching",
   "एक साथ आए अनुरोधों को अपने-आप साथ में चलाएँ।",
   "ನಿರಂತರ batching",
   "ಒಟ್ಟಿಗೆ ಬಂದ ವಿನಂತಿಗಳನ್ನು ತಾನಾಗಿ ಜೊತೆಯಾಗಿ ನಡೆಸಿ.")
# Attention & KV
_p("flash_attn", "Flash attention",
   "तेज़ attention, कम मेमोरी। quantized V cache के लिए ज़रूरी।",
   "Flash attention",
   "ವೇಗದ attention, ಕಡಿಮೆ ಮೆಮೊರಿ. quantized V cache ಗೆ ಅಗತ್ಯ.")
_p("cache_type_k", "K cache संपीड़न (quantization)",
   "K cache का डेटा प्रकार। q8_0 से KV मेमोरी आधी होती है और गुणवत्ता लगभग वही रहती है।",
   "K cache ಸಂಕುಚನ (quantization)",
   "K cache ನ ಡೇಟಾ ಪ್ರಕಾರ. q8_0 KV ಮೆಮೊರಿಯನ್ನು ಅರ್ಧಗೊಳಿಸುತ್ತದೆ, ಗುಣಮಟ್ಟ ಬಹುತೇಕ ಅದೇ.")
_p("cache_type_v", "V cache संपीड़न (quantization)",
   "V cache का डेटा प्रकार (quantized V के लिए flash attention चाहिए)।",
   "V cache ಸಂಕುಚನ (quantization)",
   "V cache ನ ಡೇಟಾ ಪ್ರಕಾರ (quantized V ಗೆ flash attention ಬೇಕು).")
_p("kv_unified", "एकीकृत KV buffer",
   "सभी क्रमों के लिए एक ही साझा KV buffer।",
   "ಏಕೀಕೃತ KV buffer",
   "ಎಲ್ಲಾ ಅನುಕ್ರಮಗಳಿಗೆ ಒಂದೇ ಹಂಚಿದ KV buffer.")
_p("swa_full", "पूरे आकार का SWA cache",
   "पूरे आकार का sliding-window-attention cache उपयोग करें (Gemma)।",
   "ಪೂರ್ಣ ಗಾತ್ರದ SWA cache",
   "ಪೂರ್ಣ ಗಾತ್ರದ sliding-window-attention cache ಬಳಸಿ (Gemma).")
_p("cache_ram", "प्रश्न cache RAM (MiB)",
   "प्रश्न cache के लिए अधिकतम RAM (-1 असीमित, 0 बंद)।",
   "ಪ್ರಶ್ನೆ cache RAM (MiB)",
   "ಪ್ರಶ್ನೆ cache ಗೆ ಗರಿಷ್ಠ RAM (-1 ಮಿತಿಯಿಲ್ಲ, 0 ಆಫ್).")
_p("ctx_checkpoints", "संदर्भ checkpoints",
   "हर slot के लिए अधिकतम SWA/संदर्भ checkpoints।",
   "ಸಂದರ್ಭ checkpoints",
   "ಪ್ರತಿ slot ಗೆ ಗರಿಷ್ಠ SWA/ಸಂದರ್ಭ checkpoints.")
# RoPE
_p("rope_scaling", "RoPE scaling",
   "संदर्भ बढ़ाने के लिए frequency scaling का तरीका।",
   "RoPE scaling",
   "ಸಂದರ್ಭ ಹೆಚ್ಚಿಸಲು frequency scaling ವಿಧಾನ.")
_p("rope_freq_base", "RoPE frequency base",
   "NTK-aware base frequency (0 = मॉडल से)।",
   "RoPE frequency base",
   "NTK-aware base frequency (0 = ಮಾದರಿಯಿಂದ).")
_p("rope_freq_scale", "RoPE frequency scale",
   "संदर्भ विस्तार गुणक 1/N (0 = मॉडल से)।",
   "RoPE frequency scale",
   "ಸಂದರ್ಭ ವಿಸ್ತರಣೆ ಅಂಶ 1/N (0 = ಮಾದರಿಯಿಂದ).")
_p("yarn_orig_ctx", "YaRN मूल संदर्भ",
   "YaRN के लिए मूल प्रशिक्षण संदर्भ (0 = मॉडल)।",
   "YaRN ಮೂಲ ಸಂದರ್ಭ",
   "YaRN ಗಾಗಿ ಮೂಲ ತರಬೇತಿ ಸಂದರ್ಭ (0 = ಮಾದರಿ).")
_p("yarn_ext_factor", "YaRN extrapolation गुणक",
   "Extrapolation मिश्रण गुणक (-1 = डिफ़ॉल्ट)।",
   "YaRN extrapolation ಅಂಶ",
   "Extrapolation ಮಿಶ್ರಣ ಅಂಶ (-1 = ಡೀಫಾಲ್ಟ್).")
_p("yarn_attn_factor", "YaRN attention गुणक",
   "sqrt(t) / attention परिमाण का पैमाना (-1 = डिफ़ॉल्ट)।",
   "YaRN attention ಅಂಶ",
   "sqrt(t) / attention ಪ್ರಮಾಣದ ಮಾಪನ (-1 = ಡೀಫಾಲ್ಟ್).")
# Memory
_p("mmap", "मॉडल फ़ाइल को मेमोरी-मैप करें (mmap)",
   "पूरी फ़ाइल पढ़ने के बजाय मैप करें; तेज़ लोड, कम RAM।",
   "ಮಾದರಿ ಫೈಲ್ ಅನ್ನು ಮೆಮೊರಿ-ಮ್ಯಾಪ್ ಮಾಡಿ (mmap)",
   "ಪೂರ್ಣ ಫೈಲ್ ಓದುವ ಬದಲು ಮ್ಯಾಪ್ ಮಾಡಿ; ವೇಗದ ಲೋಡ್, ಕಡಿಮೆ RAM.")
_p("keep_alive", "मॉडल लोड रखें",
   "आखिरी अनुरोध के बाद Ollama मॉडल को कितनी देर मेमोरी में रखे (जैसे 30m, 2h, -1 = हमेशा)।",
   "ಮಾದರಿಯನ್ನು ಲೋಡ್ ಆಗಿ ಇರಿಸಿ",
   "ಕೊನೆಯ ವಿನಂತಿಯ ನಂತರ Ollama ಮಾದರಿಯನ್ನು ಎಷ್ಟು ಹೊತ್ತು ಮೆಮೊರಿಯಲ್ಲಿ ಇರಿಸಬೇಕು (ಉದಾ. 30m, 2h, -1 = ಯಾವಾಗಲೂ).")
_p("mlock", "मॉडल को मेमोरी में बाँधे रखें (mlock)",
   "मॉडल को RAM में लॉक करें ताकि सिस्टम उसे कभी swap न करे।",
   "ಮಾದರಿಯನ್ನು ಮೆಮೊರಿಯಲ್ಲಿ ಬಂಧಿಸಿ (mlock)",
   "ಸಿಸ್ಟಮ್ ಎಂದಿಗೂ swap ಮಾಡದಂತೆ ಮಾದರಿಯನ್ನು RAM ನಲ್ಲಿ ಲಾಕ್ ಮಾಡಿ.")
_p("repack", "Weights को फिर से व्यवस्थित करें",
   "तेज़ CPU गणना के लिए weights को फिर से व्यवस्थित करें।",
   "Weights ಮರುಜೋಡಣೆ",
   "ವೇಗದ CPU ಗಣನೆಗಾಗಿ weights ಅನ್ನು ಮರುಜೋಡಿಸಿ.")
_p("check_tensors", "लोड पर tensors जाँचें",
   "tensor डेटा में गलत मान जाँचें (लोड धीमा होगा)।",
   "ಲೋಡ್ ವೇಳೆ tensors ಪರಿಶೀಲಿಸಿ",
   "tensor ಡೇಟಾದಲ್ಲಿ ತಪ್ಪು ಮೌಲ್ಯಗಳನ್ನು ಪರಿಶೀಲಿಸಿ (ಲೋಡ್ ನಿಧಾನ).")
# Speculative
_p("draft_model", "सहायक (draft) मॉडल",
   "उसी tokenizer वाला छोटा मॉडल जो टोकन सुझाता है; मुख्य मॉडल उन्हें जाँचता है।",
   "ಸಹಾಯಕ (draft) ಮಾದರಿ",
   "ಅದೇ tokenizer ಇರುವ ಚಿಕ್ಕ ಮಾದರಿ ಟೋಕನ್‌ಗಳನ್ನು ಸೂಚಿಸುತ್ತದೆ; ಮುಖ್ಯ ಮಾದರಿ ಅವುಗಳನ್ನು ಪರಿಶೀಲಿಸುತ್ತದೆ.")
_p("draft_max", "अधिकतम draft टोकन",
   "हर चरण में सुझाए गए टोकन।",
   "ಗರಿಷ್ಠ draft ಟೋಕನ್‌ಗಳು",
   "ಪ್ರತಿ ಹಂತದಲ್ಲಿ ಸೂಚಿಸುವ ಟೋಕನ್‌ಗಳು.")
_p("draft_min", "न्यूनतम draft टोकन",
   "सुझाए जाने वाले न्यूनतम टोकन।",
   "ಕನಿಷ್ಠ draft ಟೋಕನ್‌ಗಳು",
   "ಸೂಚಿಸಬೇಕಾದ ಕನಿಷ್ಠ ಟೋಕನ್‌ಗಳು.")
_p("draft_p_min", "न्यूनतम draft संभावना",
   "draft की सबसे पक्की संभावना इससे नीचे जाए तो सुझाना रोक दें।",
   "ಕನಿಷ್ಠ draft ಸಂಭವನೀಯತೆ",
   "draft ನ ಅತ್ಯುತ್ತಮ ಸಂಭವನೀಯತೆ ಇದಕ್ಕಿಂತ ಕಡಿಮೆಯಾದರೆ ಸೂಚಿಸುವುದನ್ನು ನಿಲ್ಲಿಸಿ.")
_p("gpu_layers_draft", "Draft GPU परतें",
   "draft मॉडल की GPU परतें।",
   "Draft GPU ಪದರಗಳು",
   "draft ಮಾದರಿಯ GPU ಪದರಗಳು.")
_p("spec_type", "बिना draft के अनुमान / MTP",
   "MTP (कई टोकन एक साथ बताने वाला हिस्सा, जिन मॉडलों में हो) या बिना draft मॉडल के n-gram अनुमान।",
   "draft ಇಲ್ಲದ ಊಹೆ / MTP",
   "MTP (ಹಲವು ಟೋಕನ್ ಒಟ್ಟಿಗೆ ಊಹಿಸುವ ಭಾಗ, ಇರುವ ಮಾದರಿಗಳಿಗೆ) ಅಥವಾ draft ಮಾದರಿ ಇಲ್ಲದೆ n-gram ಊಹೆ.")
# MoE
_p("cpu_moe", "सभी MoE experts CPU पर",
   "सभी Mixture-of-Experts weights सिस्टम RAM में रखें (छोटे GPU पर बड़े MoE मॉडल चलाने के लिए)।",
   "ಎಲ್ಲಾ MoE experts CPU ಮೇಲೆ",
   "ಎಲ್ಲಾ Mixture-of-Experts weights ಅನ್ನು ಸಿಸ್ಟಮ್ RAM ನಲ್ಲಿ ಇರಿಸಿ (ಚಿಕ್ಕ GPU ಮೇಲೆ ದೊಡ್ಡ MoE ಮಾದರಿಗಳಿಗೆ).")
_p("n_cpu_moe", "CPU पर MoE परतें",
   "पहली N परतों के experts CPU पर रखें। VRAM लगभग 90% भरने तक घटाएँ।",
   "CPU ಮೇಲೆ MoE ಪದರಗಳು",
   "ಮೊದಲ N ಪದರಗಳ experts ಅನ್ನು CPU ಮೇಲೆ ಇರಿಸಿ. VRAM ಸುಮಾರು 90% ಬಳಕೆಯಾಗುವವರೆಗೆ ಕಡಿಮೆ ಮಾಡಿ.")
# Parallelism
_p("parallel", "एक साथ सत्र (slots)",
   "एक साथ कितने उत्तर बनें; संदर्भ slots में बँट जाता है।",
   "ಏಕಕಾಲಿಕ ಅವಧಿಗಳು (slots)",
   "ಒಟ್ಟಿಗೆ ಎಷ್ಟು ಉತ್ತರಗಳು ರಚನೆಯಾಗಬಹುದು; ಸಂದರ್ಭ slots ಗಳಲ್ಲಿ ಹಂಚಲಾಗುತ್ತದೆ.")
_p("cache_prompt", "प्रश्न caching",
   "मिलते-जुलते प्रश्न की शुरुआत का KV अनुरोधों के बीच दोबारा उपयोग करें।",
   "ಪ್ರಶ್ನೆ caching",
   "ಹೊಂದುವ ಪ್ರಶ್ನೆಯ ಆರಂಭದ KV ಅನ್ನು ವಿನಂತಿಗಳ ನಡುವೆ ಮರುಬಳಸಿ.")
_p("cache_reuse", "KV दोबारा उपयोग का आकार",
   "KV खिसकाकर cache से दोबारा उपयोग का न्यूनतम टुकड़ा (0 = बंद)।",
   "KV ಮರುಬಳಕೆ ತುಣುಕು ಗಾತ್ರ",
   "KV ಸರಿಸಿ cache ನಿಂದ ಮರುಬಳಸುವ ಕನಿಷ್ಠ ತುಣುಕು (0 = ಆಫ್).")
_p("threads_http", "HTTP threads",
   "HTTP अनुरोध संभालने वाले threads (-1 अपने-आप)।",
   "HTTP threads",
   "HTTP ವಿನಂತಿಗಳನ್ನು ನಿರ್ವಹಿಸುವ threads (-1 ತಾನಾಗಿ).")
# Reasoning & template
_p("jinja", "Jinja chat templates",
   "मॉडल का अपना Jinja chat template उपयोग करें।",
   "Jinja chat templates",
   "ಮಾದರಿಯ ಸ್ವಂತ Jinja chat template ಬಳಸಿ.")
_p("reasoning", "सोचना (Reasoning)",
   "मॉडल को सोचने दें (reasoning मॉडलों के लिए)।",
   "ಯೋಚನೆ (Reasoning)",
   "ಮಾದರಿ ಯೋಚಿಸಲು ಬಿಡಿ (reasoning ಮಾದರಿಗಳಿಗೆ).")
_p("reasoning_format", "सोच का प्रारूप",
   "सोच कहाँ जाए: message.reasoning_content (deepseek) या उत्तर के अंदर।",
   "ಯೋಚನೆಯ ಸ್ವರೂಪ",
   "ಯೋಚನೆ ಎಲ್ಲಿ ಹೋಗಬೇಕು: message.reasoning_content (deepseek) ಅಥವಾ ಉತ್ತರದೊಳಗೆ.")
_p("reasoning_budget", "सोचने की सीमा (टोकन)",
   "सोचने के लिए टोकन सीमा (-1 असीमित, 0 बिना सोचे)।",
   "ಯೋಚನೆಯ ಮಿತಿ (ಟೋಕನ್‌ಗಳು)",
   "ಯೋಚನೆಗೆ ಟೋಕನ್ ಮಿತಿ (-1 ಮಿತಿಯಿಲ್ಲ, 0 ಯೋಚನೆ ಇಲ್ಲ).")
_p("chat_template_kwargs", "Chat template सेटिंग (JSON)",
   "template की अतिरिक्त सेटिंग, जैसे {\"enable_thinking\": false}।",
   "Chat template ಸೆಟ್ಟಿಂಗ್ (JSON)",
   "template ನ ಹೆಚ್ಚುವರಿ ಸೆಟ್ಟಿಂಗ್, ಉದಾ. {\"enable_thinking\": false}.")
# vLLM
_p("tensor_parallel_size", "Tensor parallel आकार",
   "मॉडल को कितने GPU में बाँटें।",
   "Tensor parallel ಗಾತ್ರ",
   "ಮಾದರಿಯನ್ನು ಎಷ್ಟು GPU ಗಳಲ್ಲಿ ಹಂಚಬೇಕು.")
_p("gpu_memory_utilization", "GPU मेमोरी उपयोग",
   "weights + KV cache के लिए vLLM कितना VRAM (हिस्सा) उपयोग करे।",
   "GPU ಮೆಮೊರಿ ಬಳಕೆ",
   "weights + KV cache ಗಾಗಿ vLLM ಎಷ್ಟು VRAM (ಭಾಗ) ಬಳಸಬಹುದು.")
_p("max_model_len", "अधिकतम मॉडल लंबाई",
   "अधिकतम संदर्भ लंबाई।",
   "ಗರಿಷ್ಠ ಮಾದರಿ ಉದ್ದ",
   "ಗರಿಷ್ಠ ಸಂದರ್ಭದ ಉದ್ದ.")
_p("max_num_seqs", "अधिकतम एक साथ क्रम",
   "हर चक्र में साथ चलने वाले अधिकतम क्रम।",
   "ಗರಿಷ್ಠ ಏಕಕಾಲಿಕ ಅನುಕ್ರಮಗಳು",
   "ಪ್ರತಿ ಸುತ್ತಿನಲ್ಲಿ ಒಟ್ಟಿಗೆ ನಡೆಯುವ ಗರಿಷ್ಠ ಅನುಕ್ರಮಗಳು.")
_p("max_num_batched_tokens", "अधिकतम batch टोकन",
   "हर scheduler चरण की टोकन सीमा।",
   "ಗರಿಷ್ಠ batch ಟೋಕನ್‌ಗಳು",
   "ಪ್ರತಿ scheduler ಹಂತದ ಟೋಕನ್ ಮಿತಿ.")
_p("dtype", "Weights का dtype",
   "मॉडल weights की सटीकता।",
   "Weights dtype",
   "ಮಾದರಿ weights ನ ನಿಖರತೆ.")
_p("quantization", "संपीड़न (Quantization)",
   "weights संपीड़न का तरीका।",
   "ಸಂಕುಚನ (Quantization)",
   "weights ಸಂಕುಚನ ವಿಧಾನ.")
_p("kv_cache_dtype", "KV cache dtype",
   "KV cache की सटीकता (Ada/Hopper पर fp8)।",
   "KV cache dtype",
   "KV cache ನಿಖರತೆ (Ada/Hopper ಮೇಲೆ fp8).")
_p("enable_prefix_caching", "Prefix caching",
   "अनुरोधों के बीच प्रश्न की शुरुआत का अपने-आप cache।",
   "Prefix caching",
   "ವಿನಂತಿಗಳ ನಡುವೆ ಪ್ರಶ್ನೆಯ ಆರಂಭದ ಸ್ವಯಂ cache.")
_p("enable_chunked_prefill", "टुकड़ों में prefill",
   "लंबे प्रश्नों को टुकड़ों में पढ़ें ताकि उत्तर की गति बनी रहे।",
   "ತುಣುಕುಗಳಲ್ಲಿ prefill",
   "ಉತ್ತರದ ವೇಗ ಕಾಯ್ದುಕೊಳ್ಳಲು ಉದ್ದ ಪ್ರಶ್ನೆಗಳನ್ನು ತುಣುಕುಗಳಲ್ಲಿ ಓದಿ.")
_p("swap_space", "CPU swap जगह (GiB)",
   "swap किए गए KV blocks के लिए CPU मेमोरी।",
   "CPU swap ಸ್ಥಳ (GiB)",
   "swap ಮಾಡಿದ KV blocks ಗಾಗಿ CPU ಮೆಮೊರಿ.")
_p("enforce_eager", "Eager mode अनिवार्य",
   "CUDA graphs बंद करें (कम मेमोरी, धीमा)।",
   "Eager mode ಕಡ್ಡಾಯ",
   "CUDA graphs ಆಫ್ ಮಾಡಿ (ಕಡಿಮೆ ಮೆಮೊರಿ, ನಿಧಾನ).")
_p("speculative_config", "Speculative सेटिंग (JSON)",
   "जैसे {\"method\":\"mtp\",\"num_speculative_tokens\":3}",
   "Speculative ಸೆಟ್ಟಿಂಗ್ (JSON)",
   "ಉದಾ. {\"method\":\"mtp\",\"num_speculative_tokens\":3}")
_p("reasoning_parser", "Reasoning parser",
   "जैसे qwen3, deepseek_r1।",
   "Reasoning parser",
   "ಉದಾ. qwen3, deepseek_r1.")
_p("tool_call_parser", "Tool-call parser",
   "जैसे hermes, llama3_json।",
   "Tool-call parser",
   "ಉದಾ. hermes, llama3_json.")
_p("extra_args", "अतिरिक्त इंजन arguments",
   "llama-server कमांड के अंत में जोड़े जाने वाले सीधे flags (Bionic के arguments override जैसे)।",
   "ಹೆಚ್ಚುವರಿ ಎಂಜಿನ್ arguments",
   "llama-server ಆದೇಶದ ಕೊನೆಗೆ ಸೇರಿಸುವ ನೇರ flags (Bionic ನ arguments override ನಂತೆ).")

# ------------------------------------------------------------------ prediction
_p("temperature", "तापमान (रचनात्मकता)",
   "उत्तर में कितनी विविधता हो। 0 = हर बार एक जैसा, पक्का उत्तर; ज़्यादा = अधिक रचनात्मक।",
   "ತಾಪಮಾನ (ಸೃಜನಶೀಲತೆ)",
   "ಉತ್ತರದಲ್ಲಿ ಎಷ್ಟು ವೈವಿಧ್ಯತೆ. 0 = ಪ್ರತಿ ಬಾರಿ ಒಂದೇ, ಖಚಿತ ಉತ್ತರ; ಹೆಚ್ಚು = ಹೆಚ್ಚು ಸೃಜನಶೀಲ.")
_p("top_k", "Top-K",
   "केवल K सबसे संभावित टोकन में से चुनें (0 = बंद)।",
   "Top-K",
   "ಕೇವಲ K ಅತ್ಯಂತ ಸಂಭವನೀಯ ಟೋಕನ್‌ಗಳಿಂದ ಆರಿಸಿ (0 = ಆಫ್).")
_p("top_p", "Top-P (nucleus)",
   "उन सबसे कम टोकनों में से चुनें जिनकी कुल संभावना ≥ P हो (1 = बंद)।",
   "Top-P (nucleus)",
   "ಒಟ್ಟು ಸಂಭವನೀಯತೆ ≥ P ಆಗುವ ಕನಿಷ್ಠ ಟೋಕನ್‌ಗಳಿಂದ ಆರಿಸಿ (1 = ಆಫ್).")
_p("min_p", "Min-P",
   "सबसे संभावित टोकन की संभावना × P से कम वाले टोकन हटा दें (0 = बंद)।",
   "Min-P",
   "ಅತ್ಯಂತ ಸಂಭವನೀಯ ಟೋಕನ್‌ನ ಸಂಭವನೀಯತೆ × P ಗಿಂತ ಕಡಿಮೆ ಇರುವ ಟೋಕನ್‌ಗಳನ್ನು ತೆಗೆದುಹಾಕಿ (0 = ಆಫ್).")
_p("typical_p", "Typical-P",
   "सामान्य (typical) टोकन चुनना (1 = बंद)।",
   "Typical-P",
   "ಸಾಮಾನ್ಯ (typical) ಟೋಕನ್ ಆಯ್ಕೆ (1 = ಆಫ್).")
_p("top_n_sigma", "Top-nσ",
   "सबसे बड़े logit से n मानक विचलन के भीतर के टोकन रखें (-1 = बंद)।",
   "Top-nσ",
   "ಅತಿ ದೊಡ್ಡ logit ನಿಂದ n ಪ್ರಮಾಣಿತ ವಿಚಲನದೊಳಗಿನ ಟೋಕನ್‌ಗಳನ್ನು ಇರಿಸಿ (-1 = ಆಫ್).")
_p("dynatemp_range", "बदलते तापमान की सीमा",
   "अनिश्चितता के अनुसार तापमान की सीमा (0 = बंद)।",
   "ಬದಲಾಗುವ ತಾಪಮಾನದ ವ್ಯಾಪ್ತಿ",
   "ಅನಿಶ್ಚಿತತೆಯ ಆಧಾರದ ತಾಪಮಾನ ವ್ಯಾಪ್ತಿ (0 = ಆಫ್).")
_p("dynatemp_exponent", "बदलते तापमान का घातांक",
   "बदलते तापमान का घातांक।",
   "ಬದಲಾಗುವ ತಾಪಮಾನದ ಘಾತ",
   "ಬದಲಾಗುವ ತಾಪಮಾನದ ಘಾತ.")
_p("samplers", "Sampler क्रम",
   "अर्धविराम से अलग सूची, जैसे penalties;dry;top_n_sigma;top_k;typ_p;top_p;min_p;xtc;temperature।",
   "Sampler ಕ್ರಮ",
   "ಅರ್ಧವಿರಾಮದಿಂದ ಬೇರ್ಪಡಿಸಿದ ಪಟ್ಟಿ, ಉದಾ. penalties;dry;top_n_sigma;top_k;typ_p;top_p;min_p;xtc;temperature.")
_p("repeat_penalty", "दोहराव दंड",
   "दोहराए गए टोकन पर दंड (1 = बंद)।",
   "ಪುನರಾವರ್ತನೆ ದಂಡ",
   "ಪುನರಾವರ್ತಿತ ಟೋಕನ್‌ಗಳಿಗೆ ದಂಡ (1 = ಆಫ್).")
_p("repeat_last_n", "दोहराव जाँच की सीमा",
   "दोहराव दंड के लिए देखे जाने वाले टोकन (0 बंद, -1 = पूरा संदर्भ)।",
   "ಪುನರಾವರ್ತನೆ ಪರಿಶೀಲನೆ ವ್ಯಾಪ್ತಿ",
   "ಪುನರಾವರ್ತನೆ ದಂಡಕ್ಕಾಗಿ ಪರಿಗಣಿಸುವ ಟೋಕನ್‌ಗಳು (0 ಆಫ್, -1 = ಪೂರ್ಣ ಸಂದರ್ಭ).")
_p("presence_penalty", "उपस्थिति दंड",
   "पहले आ चुके टोकन पर दंड (नए विषय को बढ़ावा)।",
   "ಉಪಸ್ಥಿತಿ ದಂಡ",
   "ಈಗಾಗಲೇ ಬಂದ ಟೋಕನ್‌ಗಳಿಗೆ ದಂಡ (ಹೊಸ ವಿಷಯಕ್ಕೆ ಉತ್ತೇಜನ).")
_p("frequency_penalty", "आवृत्ति दंड",
   "टोकन जितनी बार आया, उतना दंड।",
   "ಆವರ್ತನ ದಂಡ",
   "ಟೋಕನ್ ಎಷ್ಟು ಬಾರಿ ಬಂದಿದೆಯೋ ಅಷ್ಟು ದಂಡ.")
_p("dry_multiplier", "DRY गुणक",
   "\"खुद को न दोहराएँ\" दंड की ताकत (0 = बंद)।",
   "DRY ಗುಣಕ",
   "\"ನಿಮ್ಮನ್ನು ಪುನರಾವರ್ತಿಸಬೇಡಿ\" ದಂಡದ ಬಲ (0 = ಆಫ್).")
_p("dry_base", "DRY आधार",
   "DRY दंड का घातांकीय आधार।",
   "DRY ಆಧಾರ",
   "DRY ದಂಡದ ಘಾತೀಯ ಆಧಾರ.")
_p("dry_allowed_length", "DRY अनुमत लंबाई",
   "इस लंबाई तक के दोहराए गए क्रम पर दंड नहीं।",
   "DRY ಅನುಮತಿಸಿದ ಉದ್ದ",
   "ಈ ಉದ್ದದವರೆಗಿನ ಪುನರಾವರ್ತಿತ ಅನುಕ್ರಮಗಳಿಗೆ ದಂಡವಿಲ್ಲ.")
_p("dry_penalty_last_n", "DRY जाँच सीमा",
   "दोहराव के लिए जाँचे जाने वाले टोकन (-1 = पूरा संदर्भ)।",
   "DRY ಪರಿಶೀಲನೆ ವ್ಯಾಪ್ತಿ",
   "ಪುನರಾವರ್ತನೆಗಾಗಿ ಪರಿಶೀಲಿಸುವ ಟೋಕನ್‌ಗಳು (-1 = ಪೂರ್ಣ ಸಂದರ್ಭ).")
_p("xtc_probability", "XTC संभावना",
   "सबसे ऊपर के विकल्प हटाने की संभावना (0 = बंद)।",
   "XTC ಸಂಭವನೀಯತೆ",
   "ಮೇಲಿನ ಆಯ್ಕೆಗಳನ್ನು ಹೊರಗಿಡುವ ಸಂಭವನೀಯತೆ (0 = ಆಫ್).")
_p("xtc_threshold", "XTC सीमा",
   "इस संभावना से ऊपर के टोकन हटाए जा सकते हैं।",
   "XTC ಮಿತಿ",
   "ಈ ಸಂಭವನೀಯತೆಗಿಂತ ಮೇಲಿನ ಟೋಕನ್‌ಗಳನ್ನು ಹೊರಗಿಡಬಹುದು.")
_p("mirostat", "Mirostat",
   "अपने-आप perplexity नियंत्रण (top-k/p की जगह)।",
   "Mirostat",
   "ಸ್ವಯಂ perplexity ನಿಯಂತ್ರಣ (top-k/p ಬದಲಿಗೆ).")
_p("mirostat_tau", "Mirostat τ (लक्ष्य entropy)",
   "लक्ष्य आश्चर्य स्तर।",
   "Mirostat τ (ಗುರಿ entropy)",
   "ಗುರಿ ಅಚ್ಚರಿಯ ಮಟ್ಟ.")
_p("mirostat_eta", "Mirostat η (सीखने की दर)",
   "समायोजन की गति।",
   "Mirostat η (ಕಲಿಕೆಯ ದರ)",
   "ಹೊಂದಾಣಿಕೆಯ ವೇಗ.")
_p("max_tokens", "अधिकतम उत्तर टोकन",
   "उत्तर में अधिकतम टोकन (-1 = रुकने तक)।",
   "ಗರಿಷ್ಠ ಉತ್ತರ ಟೋಕನ್‌ಗಳು",
   "ಉತ್ತರದಲ್ಲಿ ಗರಿಷ್ಠ ಟೋಕನ್‌ಗಳು (-1 = ನಿಲ್ಲುವವರೆಗೆ).")
_p("stop", "रोकने वाले शब्द",
   "इनमें से कोई भी शब्द आते ही उत्तर रुक जाता है।",
   "ನಿಲ್ಲಿಸುವ ಪದಗಳು",
   "ಇವುಗಳಲ್ಲಿ ಯಾವುದೇ ಪದ ಬಂದ ತಕ್ಷಣ ಉತ್ತರ ನಿಲ್ಲುತ್ತದೆ.")
_p("seed", "Seed (दोहराने योग्य परिणाम)",
   "एक जैसे परिणाम दोबारा पाने के लिए RNG seed (-1 = यादृच्छिक)।",
   "Seed (ಪುನರಾವರ್ತಿಸಬಹುದಾದ ಫಲಿತಾಂಶ)",
   "ಒಂದೇ ಫಲಿತಾಂಶ ಮತ್ತೆ ಪಡೆಯಲು RNG seed (-1 = ಯಾದೃಚ್ಛಿಕ).")
_p("context_overflow", "संदर्भ भरने पर क्या करें",
   "बातचीत संदर्भ से बड़ी हो जाए तो क्या करें: system + हाल की बातें रखें, या रुकें।",
   "ಸಂದರ್ಭ ತುಂಬಿದಾಗ ಏನು ಮಾಡಬೇಕು",
   "ಸಂಭಾಷಣೆ ಸಂದರ್ಭಕ್ಕಿಂತ ದೊಡ್ಡದಾದರೆ ಏನು ಮಾಡಬೇಕು: system + ಇತ್ತೀಚಿನ ಮಾತುಗಳನ್ನು ಇರಿಸಿ, ಅಥವಾ ನಿಲ್ಲಿಸಿ.")
_p("n_probs", "टोकन संभावनाएँ (top-N)",
   "हर बनाए गए टोकन के लिए top-N टोकन संभावनाएँ लौटाएँ।",
   "ಟೋಕನ್ ಸಂಭವನೀಯತೆಗಳು (top-N)",
   "ಪ್ರತಿ ರಚಿತ ಟೋಕನ್‌ಗೆ top-N ಟೋಕನ್ ಸಂಭವನೀಯತೆಗಳನ್ನು ಹಿಂತಿರುಗಿಸಿ.")
_p("ignore_eos", "EOS को अनदेखा करें",
   "अंत-सूचक टोकन (EOS) के बाद भी लिखते रहें।",
   "EOS ಕಡೆಗಣಿಸಿ",
   "ಅಂತ್ಯ ಸೂಚಕ ಟೋಕನ್ (EOS) ನಂತರವೂ ಬರೆಯುತ್ತಿರಿ.")
_p("min_tokens", "न्यूनतम टोकन",
   "EOS की अनुमति से पहले न्यूनतम टोकन।",
   "ಕನಿಷ್ಠ ಟೋಕನ್‌ಗಳು",
   "EOS ಅನುಮತಿಸುವ ಮೊದಲು ಕನಿಷ್ಠ ಟೋಕನ್‌ಗಳು.")
_p("enable_thinking", "सोचना चालू करें",
   "reasoning मॉडलों से उत्तर से पहले सोचने को कहें (chat_template_kwargs.enable_thinking)।",
   "ಯೋಚನೆ ಆನ್ ಮಾಡಿ",
   "reasoning ಮಾದರಿಗಳಿಗೆ ಉತ್ತರಿಸುವ ಮೊದಲು ಯೋಚಿಸಲು ಹೇಳಿ (chat_template_kwargs.enable_thinking).")
_p("reasoning_effort", "सोचने का प्रयास",
   "जो मॉडल इसे समझते हैं (जैसे gpt-oss): low / medium / high।",
   "ಯೋಚನೆಯ ಪ್ರಯತ್ನ",
   "ಇದನ್ನು ಬೆಂಬಲಿಸುವ ಮಾದರಿಗಳಿಗೆ (ಉದಾ. gpt-oss): low / medium / high.")
_p("json_schema", "तय ढाँचे में उत्तर (JSON Schema)",
   "उत्तर को इस JSON schema तक सीमित करें (response_format)।",
   "ನಿಗದಿತ ರಚನೆಯ ಉತ್ತರ (JSON Schema)",
   "ಉತ್ತರವನ್ನು ಈ JSON schema ಗೆ ಸೀಮಿತಗೊಳಿಸಿ (response_format).")
_p("grammar", "GBNF व्याकरण",
   "उत्तर को सीमित करने वाला llama.cpp व्याकरण।",
   "GBNF ವ್ಯಾಕರಣ",
   "ಉತ್ತರವನ್ನು ಸೀಮಿತಗೊಳಿಸುವ llama.cpp ವ್ಯಾಕರಣ.")
_p("logit_bias", "Logit bias (JSON)",
   "टोकन-id → bias सूची, जैसे {\"15043\": -100}।",
   "Logit bias (JSON)",
   "ಟೋಕನ್-id → bias ಪಟ್ಟಿ, ಉದಾ. {\"15043\": -100}.")

GROUPS: dict[str, dict[str, str]] = {
    "Context": {"hi": "संदर्भ", "kn": "ಸಂದರ್ಭ"},
    "GPU & Offload": {"hi": "GPU और offload", "kn": "GPU ಮತ್ತು offload"},
    "CPU": {"hi": "CPU", "kn": "CPU"},
    "Batching": {"hi": "Batching (एक साथ प्रोसेसिंग)", "kn": "Batching (ಒಟ್ಟಿಗೆ ಪ್ರಕ್ರಿಯೆ)"},
    "Attention & KV Cache": {"hi": "Attention और KV cache", "kn": "Attention ಮತ್ತು KV cache"},
    "RoPE": {"hi": "RoPE", "kn": "RoPE"},
    "Memory": {"hi": "मेमोरी", "kn": "ಮೆಮೊರಿ"},
    "Ollama": {"hi": "Ollama", "kn": "Ollama"},
    "Speculative Decoding": {"hi": "तेज़ अनुमान (Speculative decoding)", "kn": "ವೇಗದ ಊಹೆ (Speculative decoding)"},
    "MoE": {"hi": "MoE", "kn": "MoE"},
    "Parallelism": {"hi": "एक साथ काम (Parallelism)", "kn": "ಏಕಕಾಲಿಕ ಕೆಲಸ (Parallelism)"},
    "Chat Template & Reasoning": {"hi": "Chat template और सोच", "kn": "Chat template ಮತ್ತು ಯೋಚನೆ"},
    "vLLM": {"hi": "vLLM", "kn": "vLLM"},
    "Advanced": {"hi": "उन्नत", "kn": "ಸುಧಾರಿತ"},
    "Sampling": {"hi": "शब्द चयन (Sampling)", "kn": "ಪದ ಆಯ್ಕೆ (Sampling)"},
    "Penalties": {"hi": "दंड (दोहराव रोकना)", "kn": "ದಂಡಗಳು (ಪುನರಾವರ್ತನೆ ತಡೆ)"},
    "DRY": {"hi": "DRY", "kn": "DRY"},
    "XTC": {"hi": "XTC", "kn": "XTC"},
    "Mirostat": {"hi": "Mirostat", "kn": "Mirostat"},
    "Output": {"hi": "उत्तर", "kn": "ಉತ್ತರ"},
    "Reasoning": {"hi": "सोच (Reasoning)", "kn": "ಯೋಚನೆ (Reasoning)"},
    "Structured Output": {"hi": "तय ढाँचे में उत्तर", "kn": "ನಿಗದಿತ ರಚನೆಯ ಉತ್ತರ"},
}

OPTIONS: dict[str, dict[str, str]] = {
    "Auto-detect": {"hi": "अपने-आप पहचानें", "kn": "ತಾನಾಗಿ ಗುರುತಿಸಿ"},
    "CUDA 12.4 (NVIDIA)": {"hi": "CUDA 12.4 (NVIDIA GPU)", "kn": "CUDA 12.4 (NVIDIA GPU)"},
    "Vulkan / CPU": {"hi": "Vulkan / CPU", "kn": "Vulkan / CPU"},
    "on": {"hi": "चालू", "kn": "ಆನ್"},
    "off": {"hi": "बंद", "kn": "ಆಫ್"},
    "low": {"hi": "कम", "kn": "ಕಡಿಮೆ"},
    "normal": {"hi": "सामान्य", "kn": "ಸಾಮಾನ್ಯ"},
    "medium": {"hi": "मध्यम", "kn": "ಮಧ್ಯಮ"},
    "high": {"hi": "ज़्यादा", "kn": "ಹೆಚ್ಚು"},
    "none": {"hi": "कोई नहीं", "kn": "ಯಾವುದೂ ಇಲ್ಲ"},
    "model default": {"hi": "मॉडल का डिफ़ॉल्ट", "kn": "ಮಾದರಿಯ ಡೀಫಾಲ್ಟ್"},
    "default": {"hi": "डिफ़ॉल्ट", "kn": "ಡೀಫಾಲ್ಟ್"},
    "Truncate middle": {"hi": "बीच का हिस्सा हटाएँ", "kn": "ಮಧ್ಯದ ಭಾಗ ತೆಗೆದುಹಾಕಿ"},
    "Rolling window": {"hi": "खिसकती खिड़की (पुराना हटाएँ)", "kn": "ಸರಿಯುವ ಕಿಟಕಿ (ಹಳೆಯದು ತೆಗೆದುಹಾಕಿ)"},
    "Stop at limit": {"hi": "सीमा पर रुकें", "kn": "ಮಿತಿಯಲ್ಲಿ ನಿಲ್ಲಿಸಿ"},
    "distribute": {"hi": "बाँटें (distribute)", "kn": "ಹಂಚಿ (distribute)"},
    "isolate": {"hi": "अलग रखें (isolate)", "kn": "ಪ್ರತ್ಯೇಕಿಸಿ (isolate)"},
    "Mirostat": {"hi": "Mirostat", "kn": "Mirostat"},
    "Mirostat 2.0": {"hi": "Mirostat 2.0", "kn": "Mirostat 2.0"},
}


def _translate_field(p: dict[str, Any], lang: str) -> dict[str, Any]:
    out = dict(p)
    tr = PARAMS.get(p.get("key", ""), {}).get(lang)
    if tr:
        out["label"], out["description"] = tr
    g = GROUPS.get(p.get("group", ""), {}).get(lang)
    if g:
        out["group"] = g
    if isinstance(p.get("options"), list):
        opts = []
        for o in p["options"]:
            o2 = dict(o) if isinstance(o, dict) else o
            if isinstance(o2, dict) and isinstance(o2.get("label"), str):
                o2["label"] = OPTIONS.get(o2["label"], {}).get(lang, o2["label"])
            opts.append(o2)
        out["options"] = opts
    return out


def translate_schema(schema: dict[str, Any], lang: str) -> dict[str, Any]:
    """Translated copy of {"load": [...], "prediction": [...]}; the input is never modified."""
    if lang not in ("hi", "kn"):
        return schema
    out = {k: copy.deepcopy(v) for k, v in schema.items() if k not in ("load", "prediction")}
    for part in ("load", "prediction"):
        if part in schema:
            out[part] = [_translate_field(p, lang) for p in schema[part]]
    return out


_LABEL_TO_KEY: dict[str, str] | None = None


def param_label(label_or_key: str, lang: str) -> str:
    """Translated label for an English parameter label (or key); unchanged if unknown or English."""
    global _LABEL_TO_KEY
    if lang not in ("hi", "kn") or not isinstance(label_or_key, str):
        return label_or_key
    if _LABEL_TO_KEY is None:
        from .llm_params import LOAD, PREDICTION
        _LABEL_TO_KEY = {p["label"]: p["key"] for p in [*LOAD, *PREDICTION]}
    key = _LABEL_TO_KEY.get(label_or_key, label_or_key)
    tr = PARAMS.get(key, {}).get(lang)
    return tr[0] if tr else label_or_key
