@echo off
title AUTOTHRASH Simulation Prototype (SIH 2026)
echo ======================================================================
echo AUTOTHRASH: Adaptive Autonomous Navigation for Unstructured Indian Roads
echo SIH 2026 Engineering Simulation Prototype
echo ======================================================================
echo Starting local desktop application...
cd /d "%~dp0"
python main.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Simulation exited with error code %ERRORLEVEL%.
    pause
)
