<#
.SYNOPSIS
  Security scans (NFR-SEC-8, devops.md sec 10/11): gitleaks, Trivy filesystem (dependencies),
  Trivy image scan of our 3 images, CycloneDX SBOMs. Reports go to evidence/security/<timestamp>/.
  Fails on leaked secrets or fixable HIGH/CRITICAL vulnerabilities.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/scan.ps1
#>
param([switch]$NoImages)
. "$PSScriptRoot\_common.ps1"
Test-Docker

$ts  = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $Root "evidence/security/$ts"
New-Item -ItemType Directory -Force $out | Out-Null
$trivy    = 'aquasec/trivy:0.57.1'
$gitleaks = 'zricethezav/gitleaks:v8.21.2'
$cache    = 'ef-trivy-cache:/root/.cache/trivy'

Write-Step 'Secrets (gitleaks, full git history)'
docker run --rm -v "${Root}:/repo" $gitleaks detect --source /repo --no-banner --redact `
    --report-format json --report-path /repo/evidence/security/$ts/gitleaks.json
if ($LASTEXITCODE -eq 0) { Write-Pass 'gitleaks: no leaks found' } else { Write-Fail 'gitleaks found secrets (see gitleaks.json)' }

Write-Step 'Dependencies (Trivy fs: pom.xml, package-lock.json, Dockerfiles)'
docker run --rm -v "${Root}:/repo" -v $cache $trivy fs --no-progress --scanners vuln --severity HIGH,CRITICAL `
    --ignore-unfixed --exit-code 1 --format table --output /repo/evidence/security/$ts/trivy-fs.txt /repo
$fsOk = ($LASTEXITCODE -eq 0)
Get-Content "$out/trivy-fs.txt" -ErrorAction SilentlyContinue | Select-Object -First 40
if ($fsOk) { Write-Pass 'Trivy fs: no fixable HIGH/CRITICAL' } else { Write-Fail 'Trivy fs: fixable HIGH/CRITICAL found (trivy-fs.txt)' }

if ($NoImages) { Write-Skip 'image scans (-NoImages)' }
else {
    $tag = if ($env:TAG) { $env:TAG } else { 'local' }
    foreach ($svc in 'backend', 'frontend', 'gateway') {
        $img = "expenseflow/${svc}:$tag"
        docker image inspect $img *> $null
        if ($LASTEXITCODE -ne 0) { Write-Skip "$img not built (run docker compose build)"; continue }
        Write-Step "Image $img"
        docker run --rm -v //var/run/docker.sock:/var/run/docker.sock -v "${out}:/out" -v $cache $trivy image --no-progress `
            --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --format table --output "/out/trivy-$svc.txt" $img
        $ok = ($LASTEXITCODE -eq 0)
        Get-Content "$out/trivy-$svc.txt" -ErrorAction SilentlyContinue | Select-Object -First 25
        if ($ok) { Write-Pass "Trivy image ${svc}: no fixable HIGH/CRITICAL" } else { Write-Fail "Trivy image ${svc}: fixable HIGH/CRITICAL (trivy-$svc.txt)" }
        docker run --rm -v //var/run/docker.sock:/var/run/docker.sock -v "${out}:/out" -v $cache $trivy image --no-progress `
            --format cyclonedx --output "/out/sbom-$svc.cdx.json" $img *> $null
        if ($LASTEXITCODE -eq 0) { Write-Pass "SBOM sbom-$svc.cdx.json" } else { Write-Fail "SBOM $svc" }
    }
}
Write-Host "`nReports: $out"
Write-Summary
