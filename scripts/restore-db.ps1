<#
.SYNOPSIS
  X5: restore a backup made by backup-db.ps1 and report the restore time (RTO).
  Backend replicas are stopped during the restore so nothing writes in between.
  The audit trigger blocks DELETE, so pg_restore --clean drops and recreates the tables instead.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/restore-db.ps1 backups/app_20261127-120000.dump
#>
param([Parameter(Mandatory = $true)][string]$File)
. "$PSScriptRoot\_common.ps1"
Test-Docker
if (-not (Test-Path $File)) { throw "Backup not found: $File" }

$sw = [Diagnostics.Stopwatch]::StartNew()
docker compose stop backend | Out-Null
docker compose cp $File postgres:/tmp/restore.dump
docker compose exec -T postgres pg_restore -U app -d app --clean --if-exists --single-transaction /tmp/restore.dump
$ok = ($LASTEXITCODE -eq 0)
docker compose exec -T postgres rm -f /tmp/restore.dump
docker compose start backend | Out-Null
docker compose up -d --wait --wait-timeout 180 backend | Out-Null
$rto = [math]::Round($sw.Elapsed.TotalSeconds, 1)
if ($ok) { Write-Pass "restored $File; RTO (stop -> restore -> backend healthy) = $rto s" } else { Write-Fail 'pg_restore' }
Invoke-Psql 'select status, count(*) from claims group by 1 order by 1;'
Write-Summary
