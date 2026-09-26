# PowerShell script to launch AUTOTHRASH Web Simulation in Google Chrome
param (
    [switch]$DirectFile = $false
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$indexPath = Join-Path $scriptDir "index.html"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " AUTOTHRASH: Autonomous Navigation Simulation Prototype (SIH 2026)" -ForegroundColor Green
Write-Host " Launching Web Simulation Dashboard in Google Chrome..." -ForegroundColor Yellow
Write-Host "======================================================================" -ForegroundColor Cyan

# Locate Chrome executable
$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$chromeExe = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $DirectFile) {
    # Preferred mode: Run the Python launcher with built-in HTTP server
    $pyLauncher = Join-Path $scriptDir "launch_chrome.py"
    if (Test-Path $pyLauncher) {
        Write-Host "[OK] Starting Python HTTP Server and launching Chrome..." -ForegroundColor Green
        python $pyLauncher
        exit
    }
}

# Fallback: Open index.html directly in Chrome
if ($chromeExe) {
    Write-Host "[OK] Opening $indexPath in Google Chrome ($chromeExe)..." -ForegroundColor Green
    Start-Process -FilePath $chromeExe -ArgumentList "`"$indexPath`""
} else {
    Write-Host "[INFO] Chrome executable not found in standard paths, launching default browser..." -ForegroundColor Yellow
    Start-Process $indexPath
}

Write-Host "`n[DONE] Web Dashboard opened successfully!" -ForegroundColor Green
