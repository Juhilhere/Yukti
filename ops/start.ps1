# Start Yukti: API + SPA on http://127.0.0.1:8000 (the default model auto-loads on the GPU)
$root = Split-Path -Parent $PSScriptRoot
& "$PSScriptRoot\stop.ps1" | Out-Null
$env:UV_CACHE_DIR = "E:\uvcache"; $env:PYTHONIOENCODING = "utf-8"
Set-Location "$root\backend"
if (-not $env:YUKTI_TIER) { $env:YUKTI_TIER = "demo" }   # developer/demo launcher: sample accounts on the login page
Start-Process -WindowStyle Minimized -FilePath "uv" -ArgumentList "run", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000" `
  -RedirectStandardOutput "$root\data\store\logs\api.log" -RedirectStandardError "$root\data\store\logs\api.err.log"
Write-Host "Starting Yukti ... waiting for the model"
for ($i = 0; $i -lt 120; $i++) {
  try { $h = Invoke-RestMethod http://127.0.0.1:8000/api/health -TimeoutSec 2; if ($h.engine -in @('ready', 'error')) { break } } catch {}
  Start-Sleep 1
}
Write-Host "Yukti is up: http://127.0.0.1:8000  (engine: $($h.engine))"
Start-Process "http://127.0.0.1:8000"
