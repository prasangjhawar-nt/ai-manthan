<#
.SYNOPSIS
  Failure drills (devops.md sec 12).
    bank-stop     stop the mock bank (drill 1, step 1)
    bank-start    start it again; the retry job sends waiting batches (drill 1, step 4)
    kill-replica  crash one backend replica; Docker restarts it (drill 2)
    status        just print the current state
  Always prints payout batches, backend replicas and firing alerts.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/drill.ps1 bank-stop
#>
param([Parameter(Mandatory = $true)][ValidateSet('bank-stop', 'bank-start', 'kill-replica', 'status')][string]$Action)
. "$PSScriptRoot\_common.ps1"
Test-Docker

switch ($Action) {
    'bank-stop'    { docker compose stop wiremock;  Write-Host 'Mock bank STOPPED. Create a payout batch as HEAD now.' -ForegroundColor Yellow }
    'bank-start'   { docker compose start wiremock; Write-Host 'Mock bank STARTED. Retry job sends within PAYOUT_RETRY_INTERVAL_MS.' -ForegroundColor Green }
    'kill-replica' {
        $id = @(docker compose ps -q backend)[0]
        if (-not $id) { throw 'No backend replica running.' }
        docker exec $id kill 1 | Out-Null     # a crash, not a manual stop -> restart: unless-stopped applies
        Write-Host "Killed backend replica $($id.Substring(0, 12)). Docker restarts it; nginx routes around it." -ForegroundColor Yellow
    }
    'status'       { }
}

Start-Sleep -Seconds 2
Write-Step 'Payout batches (last 5)'
Invoke-Psql "select batch_ref, status, attempts, coalesce(last_error,'') last_error, coalesce(to_char(next_attempt_at,'HH24:MI:SS'),'') next_try from payout_batches order by id desc limit 5;"

Write-Step 'Backend replicas'
docker compose ps backend --format 'table {{.Name}}\t{{.State}}\t{{.Status}}'

Write-Step 'Mock bank'
docker compose ps wiremock --format 'table {{.Name}}\t{{.State}}\t{{.Status}}'

Write-Step 'Firing alerts (Prometheus)'
$json = docker compose exec -T prometheus wget -qO- http://127.0.0.1:9090/api/v1/alerts 2>$null
if ($LASTEXITCODE -eq 0 -and $json) {
    $alerts = ($json | ConvertFrom-Json).data.alerts
    if (-not $alerts) { Write-Host '  (none)' }
    $alerts | ForEach-Object { Write-Host ("  {0,-30} {1,-8} {2}" -f $_.labels.alertname, $_.state, $_.annotations.summary) }
} else { Write-Host '  Prometheus not reachable' -ForegroundColor Yellow }
