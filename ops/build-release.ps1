# Build a complete, self-contained Yukti release:
#   <Out>\Yukti-Server-<ver>\   (yukti-server.exe + bundled llama.cpp CUDA/Vulkan + model + Laya + UI + data)
#   desktop\dist\Yukti-Setup-<ver>.exe   (employee desktop client)
# Requirements on the BUILD machine only: uv, Node 22, the llama.cpp release folders and a GGUF model.
param(
  [string]$Version = "0.3.0",
  [string]$Out = "E:\yukti-build",
  [string]$LlamaCuda = "E:\tools\llama-cuda",      # llama-bXXXX-bin-win-cuda-12.4-x64.zip + cudart zip, extracted
  [string]$LlamaVulkan = "E:\tools\llama-vulkan",  # llama-bXXXX-bin-win-vulkan-x64.zip, extracted
  [string]$Model = "$env:USERPROFILE\.lmstudio\models\lmstudio-community\gemma-2-2b-it-GGUF\gemma-2-2b-it-Q8_0.gguf"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:UV_PYTHON_PREFERENCE = "only-managed"   # never freeze against Anaconda/system Python (missing DLLs on target PCs)
$pkg = Join-Path $Out "Yukti-Server-$Version"

Write-Host "1/5 Web UI"; Push-Location "$root\web"; npm ci; npm run build; Pop-Location

Write-Host "2/5 Freeze server"
Push-Location "$root\backend"
uv sync
uv run pyinstaller --noconfirm --clean --name yukti-server --distpath "$Out\pyi-dist" --workpath "$Out\pyi-work" --specpath $Out `
  --paths . --console `
  --collect-all rapidocr_onnxruntime --collect-all onnxruntime --collect-all pypdfium2 --collect-all pypdfium2_raw --collect-all docx `
  --collect-all reportlab --collect-all highspy --collect-all skl2onnx --collect-submodules sklearn --collect-data sklearn `
  --collect-all segno --collect-all argon2 --collect-submodules uvicorn --collect-submodules app `
  --hidden-import simpleeval --hidden-import pynvml --hidden-import multipart --hidden-import python_multipart --hidden-import openpyxl --hidden-import pyotp `
  server_main.py
# pre-train Laya once so the package needs no training at first start
uv run python -c "from app import db; db.init_db(); from app import laya; laya.get()"
Pop-Location

Write-Host "3/5 Assemble package"
if (Test-Path $pkg) { Remove-Item $pkg -Recurse -Force -Confirm:$false }
New-Item -ItemType Directory -Force "$pkg\backend\policies", "$pkg\web", "$pkg\data\corpus", "$pkg\data\store\laya", "$pkg\models\gemma-2-2b-it-GGUF", "$pkg\llama\cuda", "$pkg\llama\vulkan" | Out-Null
Copy-Item "$Out\pyi-dist\yukti-server\*" $pkg -Recurse
Copy-Item "$root\backend\policies\core.yaml" "$pkg\backend\policies\"
Copy-Item "$root\web\dist" "$pkg\web\dist" -Recurse
Copy-Item "$root\data\structured", "$root\data\mrpl" "$pkg\data\" -Recurse
Copy-Item "$root\data\corpus\manifest.json" "$pkg\data\corpus\"
$examples = python -c "import re;s=open(r'$root\backend\app\seed.py',encoding='utf8').read();i=s.index('EXAMPLE_FILES');print('\n'.join(re.findall(r'\""([^\""]+\.(?:pdf|docx|png|txt|xlsx))\""', s[i:s.index(']',i)])))"
$examples -split "`n" | Where-Object { $_ } | ForEach-Object { Copy-Item "$root\data\corpus\$($_.Trim())" "$pkg\data\corpus\" }
Copy-Item "$root\data\store\laya\*" "$pkg\data\store\laya\"
Copy-Item $Model "$pkg\models\gemma-2-2b-it-GGUF\"
Copy-Item "$LlamaCuda\*.exe", "$LlamaCuda\*.dll" "$pkg\llama\cuda\"
Copy-Item "$LlamaVulkan\*.exe", "$LlamaVulkan\*.dll" "$pkg\llama\vulkan\"
Copy-Item "$root\ops\package\*.cmd", "$root\ops\package\README.txt" $pkg
Copy-Item "$root\ops\package\MODELS.txt" "$pkg\models\"

Write-Host "4/5 Desktop installer"; Push-Location "$root\desktop"; npm ci; npm run dist; Pop-Location

Write-Host "5/5 Done: $pkg  and  $root\desktop\dist\Yukti-Setup-$Version.exe"
