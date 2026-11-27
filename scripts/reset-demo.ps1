<#
.SYNOPSIS
  DESTRUCTIVE: wipes all data (docker compose down -v), starts the full stack, Flyway re-seeds,
  logs in as every demo user and prints claim counts per status. Use before a demo / rehearsal.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/reset-demo.ps1 -Yes
#>
param([switch]$Yes)
. "$PSScriptRoot\_common.ps1"
Test-Docker
Initialize-DotEnv

if (-not $Yes) {
    $answer = Read-Host 'This deletes ALL ExpenseFlow data (volumes). Type RESET to continue'
    if ($answer -ne 'RESET') { Write-Host 'Cancelled.'; exit 1 }
}

Write-Step 'Wipe and restart'
docker compose down -v --remove-orphans
if (Invoke-WithRetry { docker compose build }) { Write-Pass 'images built' } else { Write-Fail 'build'; Write-Summary }
if (Invoke-Native { docker compose up -d --wait --wait-timeout 300 }) { Write-Pass 'stack healthy (data re-seeded)' }
else { Write-Fail 'stack not healthy'; docker compose ps -a; Write-Summary }

Write-Step 'Demo logins (password Demo@123)'
$base = "http://localhost:$(if ($env:GATEWAY_PORT) { $env:GATEWAY_PORT } else { 8080 })"
foreach ($u in 'emp.demo', 'colleague.demo', 'mgr.demo', 'mgr.leave', 'auditor.demo', 'head.demo') {
    try {
        $r = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType 'application/json' `
            -Body (@{ email = "$u@expenseflow.test"; password = 'Demo@123' } | ConvertTo-Json)
        Write-Pass "$u ($($r.user.role))"
    } catch { Write-Fail "$u login: $($_.Exception.Message)" }
}

Write-Step 'Seeded data'
Invoke-Psql 'select status, count(*) from claims group by 1 order by 1;'
Invoke-Psql 'select role, count(*) from employees group by 1 order by 1;'
Write-Summary
