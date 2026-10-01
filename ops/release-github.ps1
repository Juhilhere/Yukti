# Publish a Yukti release on GitHub so that users need exactly ONE download:
#   https://github.com/<repo>/releases/latest/download/Yukti-Setup.exe
# Double-clicking it installs Yukti; Yukti then downloads its AI components from the same release (signed manifest,
# every part SHA-256 checked, resumable) and starts. Each release file stays below GitHub's 2 GB limit.
#
#   .\ops\release-github.ps1 [-Version 0.5.0] [-Repo Juhilhere/Yukti] [-Package E:\yukti-build\Yukti-Server-0.5.0]
# Requires: gh (logged in), node, python, the server package from ops\build-release.ps1, the signing key.
param(
  [string]$Version = "0.5.0",
  [string]$Repo = "Juhilhere/Yukti",
  [string]$Package = "E:\yukti-build\Yukti-Server-$Version",
  [string]$Out = "E:\yukti-build\github-release",
  [switch]$UploadOnly,                               # the files in $Out are already built and signed: only upload them
  [switch]$PreRelease,                               # publish as a pre-release: "latest" keeps pointing at the previous release,
                                                     # so the real download can be tested first (then run again with -Promote)
  [switch]$Promote                                   # nothing is built or uploaded: the tested pre-release becomes "latest"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$tag = "v$Version"

if ($Promote) {
  gh release edit $tag --repo $Repo --draft=false --prerelease=false --latest
  if ($LASTEXITCODE -ne 0) { throw "could not make $tag the latest release" }
  Write-Host "`nDone. Users download: https://github.com/$Repo/releases/latest/download/Yukti-Setup.exe"
  return
}

if (-not $UploadOnly) {
# 1. the one-click installer, with the GitHub download address and the release public key built in
$publicKey = (node "$root\ops\sign-manifest.js" keygen).Trim()
$json = [ordered]@{ manifestUrl = "https://github.com/$Repo/releases/latest/download/manifest.json"; publicKey = $publicKey } | ConvertTo-Json
# written WITHOUT a byte-order mark: Windows PowerShell's "Set-Content -Encoding utf8" adds one, and the app then could
# not read the file (no download address, no release key)
[IO.File]::WriteAllText("$root\desktop\distribution.json", $json, (New-Object Text.UTF8Encoding $false))
Push-Location "$root\desktop"; npm run dist; Pop-Location

# 2. components split into < 2 GB parts + manifest with URLs pinned to this tag
python "$root\ops\publish.py" --package $Package --setup "$root\desktop\dist\Yukti-Setup.exe" --out $Out --version $Version --github $Repo --tag $tag
node "$root\ops\sign-manifest.js" sign "$Out\manifest.json"
}

# 3. create (or update) the release and upload every file
$notes = (Get-Content "$root\ops\release-notes.md" -Raw).Replace("{VERSION}", $Version).Replace("{REPO}", $Repo)
$notesFile = Join-Path $env:TEMP "yukti-release-notes.md"; Set-Content -Encoding utf8 $notesFile $notes
# uploaded as a draft first: "latest" keeps pointing at the previous, complete release until every file is up
$ErrorActionPreference = "Continue"   # "release not found" on stderr is an answer here, not a failure
gh release view $tag --repo $Repo 2>&1 | Out-Null
$exists = $LASTEXITCODE -eq 0
if (-not $exists) { gh release create $tag --repo $Repo --title "Yukti $Version" --notes-file $notesFile --draft }
else { gh release edit $tag --repo $Repo --title "Yukti $Version" --notes-file $notesFile }
Get-ChildItem $Out -File | ForEach-Object {
  Write-Host "uploading $($_.Name) ($([math]::Round($_.Length / 1MB)) MB)"
  gh release upload $tag $_.FullName --repo $Repo --clobber
  if ($LASTEXITCODE -ne 0) { throw "upload of $($_.Name) failed - the release stays a draft; run this script again" }
}
if ($PreRelease) {
  gh release edit $tag --repo $Repo --draft=false --prerelease --latest=false
  Write-Host "`nPre-release $tag is up; 'latest' is unchanged. Test it with the manifest address"
  Write-Host "  https://github.com/$Repo/releases/download/$tag/manifest.json"
  Write-Host "then run this script again with -Promote."
  return
}
gh release edit $tag --repo $Repo --draft=false --prerelease=false --latest
Write-Host "`nDone. Users download: https://github.com/$Repo/releases/latest/download/Yukti-Setup.exe"
