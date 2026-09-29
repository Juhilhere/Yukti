# Start the Yukti SERVER for employee desktop clients on the plant network.
#   .\start-server.ps1          -> local only (127.0.0.1)
#   .\start-server.ps1 -Lan     -> listen on all interfaces (open TCP 8000 in Windows Firewall for the plant subnet only)
param([switch]$Lan)
$root = Split-Path -Parent $PSScriptRoot
& "$PSScriptRoot\stop.ps1" | Out-Null
$env:UV_CACHE_DIR = "E:\uvcache"; $env:PYTHONIOENCODING = "utf-8"
$bind = if ($Lan) { "0.0.0.0" } else { "127.0.0.1" }
Set-Location "$root\backend"
if (-not $env:YUKTI_TIER) { $env:YUKTI_TIER = "demo" }   # developer/demo launcher: sample accounts on the login page
Start-Process -WindowStyle Minimized -FilePath "uv" -ArgumentList "run", "uvicorn", "app.main:app", "--host", $bind, "--port", "8000" `
  -RedirectStandardOutput "$root\data\store\logs\api.log" -RedirectStandardError "$root\data\store\logs\api.err.log"
Write-Host "Yukti server starting on $($bind):8000"
