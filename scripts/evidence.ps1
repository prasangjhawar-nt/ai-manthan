<#
.SYNOPSIS
  Collects evidence for the submission (devops.md sec 17) into evidence/<timestamp>/:
  compose status, test reports, k6 summaries, Prometheus rules/alerts/targets, latest security scan.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/evidence.ps1
#>
. "$PSScriptRoot\_common.ps1"
Test-Docker
$ts  = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $Root "evidence/$ts"
New-Item -ItemType Directory -Force $out | Out-Null

$utf8 = New-Object Text.UTF8Encoding($false)
function Save-Text([string]$Path, $Lines) { [IO.File]::WriteAllText($Path, (($Lines | Out-String)), $utf8) }
Save-Text "$out/compose-ps.txt" (docker compose ps -a)
Write-Pass 'compose-ps.txt'

foreach ($api in 'rules', 'alerts', 'targets') {
    $json = docker compose exec -T prometheus wget -qO- "http://127.0.0.1:9090/api/v1/$api" 2>$null
    if ($LASTEXITCODE -eq 0) { Save-Text "$out/prometheus-$api.json" $json; Write-Pass "prometheus-$api.json" }
    else { Write-Skip "prometheus $api (Prometheus not running)" }
}

if (Test-Path backend/target/surefire-reports) {
    Copy-Item -Recurse backend/target/surefire-reports "$out/surefire-reports"; Write-Pass 'surefire-reports'
} else { Write-Skip 'no backend test reports (run scripts/check.ps1)' }

Get-ChildItem evidence -Filter 'k6-*.json' -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName $out; Write-Pass $_.Name
}
$sec = Get-ChildItem evidence/security -Directory -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
if ($sec) { Copy-Item -Recurse $sec.FullName "$out/security"; Write-Pass "security scan $($sec.Name)" }
else { Write-Skip 'no security scan yet (run scripts/scan.ps1)' }

Save-Text "$out/claims-by-status.txt" (Invoke-Psql 'select status, count(*) from claims group by 1 order by 1;')
Write-Pass 'claims-by-status.txt'
Write-Host "`nEvidence: $out"
Write-Summary
