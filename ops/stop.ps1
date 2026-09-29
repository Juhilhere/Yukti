# Stop Yukti (API on :8000 and the managed llama-server on :8080)
$ports = 8000, 8080
foreach ($c in Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue) {
  $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -in @('llama-server', 'python', 'uvicorn')) { Stop-Process -Id $p.Id -Force -Confirm:$false; "stopped $($p.ProcessName) ($($p.Id)) on :$($c.LocalPort)" }
}
