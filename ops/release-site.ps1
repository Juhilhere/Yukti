# Build the website release: one-click desktop installer + server components + download page.
#   .\ops\release-site.ps1 -SiteUrl "https://www.example.com/yukti/" [-PartMB 1900]
# Then upload everything in <Out>\publish\ to that URL (keep the folder structure). Users click "Download Yukti" on index.html.
param(
  [Parameter(Mandatory = $true)][string]$SiteUrl,          # public folder URL where the files will live (must end with /)
  [string]$Version = "0.3.0",
  [string]$Package = "E:\yukti-build\Yukti-Server-$Version",  # built by ops\build-release.ps1
  [string]$Out = "E:\yukti-build\publish",
  [int]$PartMB = 1900                                        # lower it if your host limits file size (e.g. 95 for 100 MB limits)
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $SiteUrl.EndsWith("/")) { $SiteUrl += "/" }
# 1. bake the download source into the desktop app, so users never type a URL
#    and the release public key, so the app only installs releases signed with your key (created once, kept offline)
$publicKey = (node "$root\ops\sign-manifest.js" keygen).Trim()
@{ manifestUrl = "$($SiteUrl)manifest.json"; publicKey = $publicKey } | ConvertTo-Json | Set-Content -Encoding utf8 "$root\desktop\distribution.json"
Push-Location "$root\desktop"; npm run dist; Pop-Location
# 2. split components, hash everything, write manifest.json + index.html
python "$root\ops\publish.py" --package $Package --setup "$root\desktop\dist\Yukti-Setup-$Version.exe" --out $Out --version $Version --part-mb $PartMB
# 3. sign the manifest (the desktop app rejects unsigned or tampered releases)
node "$root\ops\sign-manifest.js" sign "$Out\manifest.json"
Write-Host "`nUpload the contents of $Out to $SiteUrl"
Write-Host "Download page: $($SiteUrl)index.html   (or link your own button to $($SiteUrl)Yukti-Setup-$Version.exe)"
Write-Host "Test locally first:  python ops\serve_site.py $Out --port 9000  (and build with -SiteUrl http://127.0.0.1:9000/)"
