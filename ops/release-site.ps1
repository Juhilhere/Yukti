# Build the website release: ONE zip with everything (the Yukti app + the complete Yukti Server + engines + model)
# and a download page.
#   .\ops\release-site.ps1 [-Version 0.5.1] [-Package E:\yukti-build\Yukti-Server-0.5.1] [-Out E:\yukti-build\publish]
# Upload the contents of <Out> (index.html, Yukti-<ver>-Windows.zip, .sha256) to your website.
# Users download the zip, Extract All, and double-click Yukti.exe - nothing else to install.
param(
  [string]$Version = "0.5.1",
  [string]$Package = "E:\yukti-build\Yukti-Server-$Version",  # built by ops\build-release.ps1
  [string]$Out = "E:\yukti-build\publish"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
# 1. the desktop app as a portable folder (no installer: it lives inside the zip next to the server)
Push-Location "$root\desktop"; npm run pack; Pop-Location
# 2. one zip + SHA-256 + download page
python "$root\ops\bundle.py" --app "$root\desktop\dist\win-unpacked" --package $Package --out $Out --version $Version
Write-Host "`nUpload the contents of $Out to your website (index.html links to the zip)."
Write-Host "Test locally first:  python ops\serve_site.py $Out --port 9000   then open http://127.0.0.1:9000/"
