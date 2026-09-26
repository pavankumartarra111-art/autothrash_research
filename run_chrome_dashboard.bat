@echo off
title AUTOTHRASH Web Simulation (Chrome Launcher)
cd /d "%~dp0"
echo ======================================================================
echo Starting AUTOTHRASH Web Dashboard in Google Chrome...
echo ======================================================================
python launch_chrome.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Python server exited. Opening file directly in Chrome...
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" "%~dp0index.html"
)
pause
