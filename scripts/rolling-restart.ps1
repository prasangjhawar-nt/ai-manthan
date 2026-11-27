<#
.SYNOPSIS
  X8: restart backend replicas one at a time, waiting for each to be healthy before the next.
  Graceful shutdown (20 s drain) + gateway failover = no failed requests (prove it with k6 running).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/rolling-restart.ps1
#>
. "$PSScriptRoot\_common.ps1"
Test-Docker
$ids = @(docker compose ps -q backend)
if ($ids.Count -lt 2) { Write-Fail "need >= 2 replicas for a rolling restart, found $($ids.Count)"; Write-Summary }
foreach ($id in $ids) {
    $short = $id.Substring(0, 12)
    docker restart --time 25 $id | Out-Null
    $deadline = (Get-Date).AddSeconds(180)
    do {
        Start-Sleep -Seconds 3
        $h = docker inspect -f '{{.State.Health.Status}}' $id
    } until ($h -eq 'healthy' -or (Get-Date) -gt $deadline)
    if ($h -eq 'healthy') { Write-Pass "$short restarted and healthy" } else { Write-Fail "$short not healthy after 180 s ($h)"; Write-Summary }
}
Write-Summary
