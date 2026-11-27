<#
.SYNOPSIS
  X5: PostgreSQL backup (custom format) into backups/ (git-ignored). PowerShell '>' corrupts binary
  output, so the dump is written inside the container and copied out (devops.md 11.1).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/backup-db.ps1
#>
. "$PSScriptRoot\_common.ps1"
Test-Docker
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force backups | Out-Null
$sw = [Diagnostics.Stopwatch]::StartNew()
docker compose exec -T postgres pg_dump -U app -d app -Fc -f /tmp/app.dump
if ($LASTEXITCODE -ne 0) { Write-Fail 'pg_dump'; Write-Summary }
docker compose cp postgres:/tmp/app.dump "backups/app_$ts.dump"
if ($LASTEXITCODE -ne 0) { Write-Fail 'copy dump out of container'; Write-Summary }
docker compose exec -T postgres rm -f /tmp/app.dump
$size = [math]::Round((Get-Item "backups/app_$ts.dump").Length / 1MB, 2)
Write-Pass "backups/app_$ts.dump ($size MB) in $([math]::Round($sw.Elapsed.TotalSeconds, 1)) s"
Invoke-Psql 'select status, count(*) from claims group by 1 order by 1;'
Write-Summary
