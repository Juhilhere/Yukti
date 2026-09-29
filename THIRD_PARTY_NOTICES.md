# Third-party notices

Yukti is proprietary software by Team UniMinds (see [NOTICE](NOTICE)). It is built on, and the Yukti Server package redistributes, the open-source
components and open-weight model listed below. Each remains under its own licence, and its copyright belongs to its respective authors.

Licence names are given where we are confident of them. Where the entry says *see upstream*, consult the project's own licence file. Transitive
dependencies are not listed individually. Their licences are in the package metadata installed with each dependency (for Python, `*.dist-info`
under `_internal\`; for Node, `node_modules/*/LICENSE`).

## Inference runtime and model (bundled in the server package)

| Component | Use | Licence |
|---|---|---|
| [llama.cpp](https://github.com/ggml-org/llama.cpp) (build b11255, CUDA 12.4 and Vulkan) | Local LLM inference server | MIT |
| NVIDIA CUDA runtime libraries (shipped with the llama.cpp CUDA build) | GPU runtime | NVIDIA CUDA Toolkit EULA (redistributable components); see upstream |
| [Gemma 2](https://ai.google.dev/gemma) 2B-it, Q8_0 GGUF (lmstudio-community conversion) | Default language model | [Gemma Terms of Use](https://ai.google.dev/gemma/terms) |
| RapidOCR PP-OCR ONNX models (derived from PaddleOCR) | OCR of scanned pages | Apache-2.0 |

## Backend (Python)

| Component | Use | Licence |
|---|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) | Web framework | MIT |
| [Uvicorn](https://www.uvicorn.org/) | ASGI server | BSD-3-Clause |
| [python-multipart](https://github.com/Kludex/python-multipart) | Form and file uploads | Apache-2.0 |
| [RapidOCR (rapidocr-onnxruntime)](https://github.com/RapidAI/RapidOCR) | OCR | Apache-2.0 |
| [ONNX Runtime](https://onnxruntime.ai/) | Laya and OCR inference | MIT |
| [pypdfium2](https://github.com/pypdfium2-team/pypdfium2) / PDFium | PDF text and rendering | Apache-2.0 / BSD-3-Clause |
| [python-docx](https://github.com/python-openxml/python-docx) | DOCX reading | MIT |
| [openpyxl](https://openpyxl.readthedocs.io/) | XLSX reading | MIT |
| [reportlab](https://www.reportlab.com/opensource/) | PDF dossier generation | BSD |
| [HiGHS](https://highs.dev/) / highspy | Linear-programming optimizer | MIT |
| [scikit-learn](https://scikit-learn.org/) | Laya training | BSD-3-Clause |
| [skl2onnx](https://github.com/onnx/sklearn-onnx) | Laya export to ONNX | Apache-2.0 |
| [NumPy](https://numpy.org/) | Numerics | BSD-3-Clause |
| [pandas](https://pandas.pydata.org/) | Tabular data | BSD-3-Clause |
| [Pillow](https://python-pillow.org/) | Images | MIT-CMU (HPND) |
| [argon2-cffi](https://github.com/hynek/argon2-cffi) | Password hashing | MIT |
| [pyotp](https://github.com/pyauth/pyotp) | TOTP MFA | MIT |
| [segno](https://github.com/heuer/segno) | QR codes for MFA enrolment | BSD-3-Clause |
| [httpx](https://www.python-httpx.org/) | HTTP client (local engine) | BSD-3-Clause |
| [psutil](https://github.com/giampaolo/psutil) | System metrics | BSD-3-Clause |
| [nvidia-ml-py](https://pypi.org/project/nvidia-ml-py/) | GPU detection and metrics | BSD-3-Clause |
| [PyYAML](https://pyyaml.org/) | Policy files | MIT |
| [simpleeval](https://github.com/danthedeckie/simpleeval) | Safe policy expression evaluation | MIT |
| [PyInstaller](https://pyinstaller.org/) (build tool; its bootloader is in `yukti-server.exe`) | Freezing the server | GPL-2.0-or-later with the PyInstaller bootloader exception |

## Web UI

| Component | Use | Licence |
|---|---|---|
| [React](https://react.dev/) / react-dom | UI library | MIT |
| [React Router](https://reactrouter.com/) | Routing | MIT |
| [TanStack Query](https://tanstack.com/query) | Data fetching | MIT |
| [react-markdown](https://github.com/remarkjs/react-markdown) / [remark-gfm](https://github.com/remarkjs/remark-gfm) | Markdown rendering | MIT |
| [Recharts](https://recharts.org/) | Charts | MIT |
| [Lucide](https://lucide.dev/) (lucide-react) | Icons | ISC |
| [Tailwind CSS](https://tailwindcss.com/) / @tailwindcss/vite | Styling | MIT |
| [Vite](https://vitejs.dev/) / @vitejs/plugin-react | Build tool | MIT |
| [TypeScript](https://www.typescriptlang.org/) | Language (build time) | Apache-2.0 |
| Inter (@fontsource-variable/inter) | UI font | SIL Open Font License 1.1 |
| JetBrains Mono (@fontsource/jetbrains-mono) | Monospace font | SIL Open Font License 1.1 |

## Desktop app

| Component | Use | Licence |
|---|---|---|
| [Electron](https://www.electronjs.org/) (includes Chromium and Node.js) | Desktop runtime | MIT (Chromium and Node.js components under their own licences; see `LICENSES.chromium.html` in the installed app) |
| [electron-builder](https://www.electron.build/) | Installer build (NSIS) | MIT |

## Data

- **MRPL public information** in `data/mrpl/` is a compilation of facts from publicly available sources (the company website, annual reports, BRSR,
  regulatory filings, environmental clearances and credit-rating rationales). Each fact carries its source URL. The underlying documents remain the
  property of their publishers. Team UniMinds is not affiliated with MRPL.
- **Example documents** in `data/corpus/` were written by Team UniMinds and are covered by [NOTICE](NOTICE).
