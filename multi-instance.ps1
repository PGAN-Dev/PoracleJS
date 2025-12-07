# Multi-Instance Startup Script for Windows PowerShell
# This script helps start multiple PoracleJS instances for testing

param(
    [switch]$Install,
    [switch]$Start,
    [switch]$Stop,
    [switch]$Status
)

$ErrorActionPreference = "Stop"

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Install-Dependencies {
    Write-Info "Installing dependencies..."
    npm install
    Write-Success "Dependencies installed"
}

function Test-Redis {
    Write-Info "Checking Redis connection..."
    try {
        $result = redis-cli ping 2>&1
        if ($result -eq "PONG") {
            Write-Success "Redis is running"
            return $true
        } else {
            Write-Error "Redis is not responding correctly"
            return $false
        }
    } catch {
        Write-Error "Redis is not running. Please install and start Redis:"
        Write-Host "  Windows: choco install redis-64" -ForegroundColor Yellow
        Write-Host "  Linux: sudo apt-get install redis-server" -ForegroundColor Yellow
        Write-Host "  Docker: docker run -d -p 6379:6379 redis" -ForegroundColor Yellow
        return $false
    }
}

function Start-Instances {
    Write-Info "Starting PoracleJS multi-instance setup..."
    
    if (-not (Test-Redis)) {
        Write-Error "Cannot start instances without Redis"
        exit 1
    }
    
    Write-Info "Starting Discord Commands instance (Port 3030)..."
    Start-Process powershell -ArgumentList "-NoExit", "-Command", @"
        `$env:NODE_CONFIG_DIR='./config-discord'
        `$env:PORACLE_INSTANCE_ID='discord-commands'
        Write-Host 'Discord Commands Instance - Port 3030' -ForegroundColor Green
        node poracle.js
"@
    
    Start-Sleep -Seconds 3
    
    Write-Info "Starting Webhook Processing instance (Port 3031)..."
    Start-Process powershell -ArgumentList "-NoExit", "-Command", @"
        `$env:NODE_CONFIG_DIR='./config-webhook'
        `$env:PORACLE_INSTANCE_ID='webhook-processor-1'
        Write-Host 'Webhook Processor Instance - Port 3031' -ForegroundColor Green
        node poracle.js
"@
    
    Write-Success "Instances started!"
    Write-Info "Check the console windows for startup logs"
    Write-Info "Look for: [Redis] Multi-instance coordination enabled"
}

function Stop-Instances {
    Write-Info "Stopping PoracleJS instances..."
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*poracle*"
    } | Stop-Process -Force
    Write-Success "Instances stopped"
}

function Show-Status {
    Write-Info "Checking PoracleJS instances..."
    
    $processes = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*poracle*"
    }
    
    if ($processes) {
        Write-Success "Found $($processes.Count) running instance(s):"
        $processes | ForEach-Object {
            Write-Host "  PID: $($_.Id)" -ForegroundColor Yellow
        }
    } else {
        Write-Info "No running instances found"
    }
    
    Write-Host ""
    Test-Redis | Out-Null
}

# Main script logic
if ($Install) {
    Install-Dependencies
}
elseif ($Start) {
    Start-Instances
}
elseif ($Stop) {
    Stop-Instances
}
elseif ($Status) {
    Show-Status
}
else {
    Write-Host @"
PoracleJS Multi-Instance Manager

Usage:
  .\multi-instance.ps1 -Install    Install dependencies
  .\multi-instance.ps1 -Start      Start all instances
  .\multi-instance.ps1 -Stop       Stop all instances
  .\multi-instance.ps1 -Status     Check instance status

Before starting:
1. Ensure Redis is installed and running
2. Create config-discord/local.json (see config/local.json.example-discord-commands)
3. Create config-webhook/local.json (see config/local.json.example-webhook-processor)

Documentation:
  docs/MULTI_INSTANCE_QUICKSTART.md - Quick start guide
  docs/MULTI_INSTANCE_SETUP.md - Full setup documentation
"@
}
