# Shared helpers for ExpenseFlow scripts. Dot-source: . "$PSScriptRoot\_common.ps1"
# 'Continue', not 'Stop': in Windows PowerShell 5.1 docker's progress output on stderr would otherwise
# abort the script. Every native call is checked through $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Script:Results = New-Object System.Collections.Generic.List[object]
$MavenImage = 'maven:3.9.16-eclipse-temurin-25-alpine'
$NodeImage  = 'node:26-alpine'

function Write-Pass([string]$m) { Write-Host "PASS  $m" -ForegroundColor Green;  $Script:Results.Add([pscustomobject]@{ Ok = $true;  Step = $m }) }
function Write-Fail([string]$m) { Write-Host "FAIL  $m" -ForegroundColor Red;    $Script:Results.Add([pscustomobject]@{ Ok = $false; Step = $m }) }
function Write-Skip([string]$m) { Write-Host "SKIP  $m" -ForegroundColor Yellow }
function Write-Step([string]$m) { Write-Host "`n== $m" -ForegroundColor Cyan }

# Run a native command; returns ONLY $true/$false (exit code 0). Output goes to the console via Out-Host -
# without it the command's stdout would become part of the return value, and an array is always truthy.
function Invoke-Native([scriptblock]$Block) {
    & $Block | Out-Host
    return ($LASTEXITCODE -eq 0)
}

# Docker Desktop's proxy sometimes fails a registry call; retry builds/pulls a few times.
function Invoke-WithRetry([scriptblock]$Block, [int]$Tries = 3) {
    for ($i = 1; $i -le $Tries; $i++) {
        & $Block | Out-Host
        if ($LASTEXITCODE -eq 0) { return $true }
        Write-Host "  attempt $i failed, retrying..." -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    }
    return $false
}

function Test-Docker {
    docker info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop and try again.' }
}

function Get-GitBash {
    foreach ($p in @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe")) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    $cmd = Get-Command bash.exe -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notmatch 'System32') { return $cmd.Source }
    throw 'Git Bash not found (needed for tests/integration.sh). Install Git for Windows.'
}

# psql inside the postgres container; returns rows as text
function Invoke-Psql([string]$Sql) {
    docker compose exec -T postgres psql -U app -d app -A -F ' | ' -c $Sql
}

# Backend tests on JDK 25 in a container (same JDK as the image), Testcontainers via the host Docker socket
function Invoke-BackendTests([string]$Goal = 'verify') {
    $src = Join-Path $Root 'backend'
    docker run --rm `
        -v //var/run/docker.sock:/var/run/docker.sock `
        -v "${src}:/src" -v ef-m2:/root/.m2 -w /src `
        -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal `
        $MavenImage mvn -B $Goal | Out-Host
    return ($LASTEXITCODE -eq 0)
}

# Creates .env from .env.example with a random JWT secret, so the published dev default is never used by our
# scripts (plain `docker compose up` without .env still falls back to the dev value - fine on a laptop only).
function Initialize-DotEnv {
    if (Test-Path (Join-Path $Root '.env')) { return }
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes)
    $lines = Get-Content (Join-Path $Root '.env.example') | ForEach-Object { if ($_ -like 'JWT_SECRET=*') { "JWT_SECRET=$secret" } else { $_ } }
    [IO.File]::WriteAllLines((Join-Path $Root '.env'), [string[]]$lines, (New-Object Text.UTF8Encoding($false)))
    Write-Host 'Created .env with a random JWT_SECRET (git-ignored).' -ForegroundColor Yellow
}

function Write-Summary {
    $failed = @($Script:Results | Where-Object { -not $_.Ok })
    Write-Host ''
    if ($failed.Count -eq 0) {
        Write-Host "ALL PASS ($($Script:Results.Count) steps)" -ForegroundColor Green
        exit 0
    }
    Write-Host "$($failed.Count) FAILED of $($Script:Results.Count):" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host "  - $($_.Step)" -ForegroundColor Red }
    exit 1
}
