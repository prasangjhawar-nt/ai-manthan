<#
.SYNOPSIS
  Team gate before merging to main (README sec 13, devops.md sec 11):
  secret file -> backend tests -> frontend build -> full stack up --wait -> tests/integration.sh
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/check.ps1
  powershell -ExecutionPolicy Bypass -File scripts/check.ps1 -SkipTests   # stack + integration only
#>
param([switch]$SkipTests)
. "$PSScriptRoot\_common.ps1"
Test-Docker
Initialize-DotEnv

Write-Step 'Secret file'
if (-not (Test-Path secrets)) { New-Item -ItemType Directory secrets | Out-Null }
if (-not (Test-Path secrets/db_password.txt)) {
    Set-Content -Path secrets/db_password.txt -Value 'app' -NoNewline -Encoding ascii
    Write-Pass 'created secrets/db_password.txt (dev value, git-ignored)'
} else { Write-Pass 'secrets/db_password.txt present' }

Write-Step 'Compose files'
if (Invoke-Native { docker compose config -q }) { Write-Pass 'docker-compose.yml valid' } else { Write-Fail 'docker-compose.yml invalid' }
if (Invoke-Native { docker compose -f docker-compose.yml -f docker-compose.dev.yml config -q }) { Write-Pass 'docker-compose.dev.yml valid' } else { Write-Fail 'docker-compose.dev.yml invalid' }

if ($SkipTests) { Write-Skip 'backend tests (-SkipTests)' }
else {
    Write-Step 'Backend tests (JDK 25, Testcontainers)'
    if (Invoke-BackendTests 'verify') { Write-Pass 'backend mvn verify' } else { Write-Fail 'backend mvn verify (see backend/target/surefire-reports)' }
}

Write-Step 'Frontend build'
if (Test-Path frontend/package.json) {
    $fe = Join-Path $Root 'frontend'
    $ok = Invoke-Native { docker run --rm -v "${fe}:/app" -w /app $NodeImage sh -c 'npm ci && npm run build' }
    if ($ok) { Write-Pass 'frontend npm ci + build' } else { Write-Fail 'frontend build' }
} else { Write-Skip 'frontend has no package.json yet (placeholder page is served)' }

Write-Step 'Build images'
if (Invoke-WithRetry { docker compose build }) { Write-Pass 'docker compose build' } else { Write-Fail 'docker compose build'; Write-Summary }

Write-Step 'Start full stack (waits for every healthcheck)'
if (Invoke-Native { docker compose up -d --wait --wait-timeout 300 }) { Write-Pass 'stack healthy' }
else { Write-Fail 'stack did not become healthy'; docker compose ps -a; Write-Summary }
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
$replicas = @(docker compose ps -q backend).Count
if ($replicas -ge 2) { Write-Pass "$replicas backend replicas behind the gateway" } else { Write-Fail "expected 2 backend replicas, found $replicas" }

Write-Step 'Integration tests through the gateway'
$bash = Get-GitBash
& $bash tests/integration.sh
if ($LASTEXITCODE -eq 0) { Write-Pass 'tests/integration.sh' } else { Write-Fail 'tests/integration.sh' }

Write-Summary
