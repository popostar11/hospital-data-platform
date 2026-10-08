@echo off
rem ============================================================================
rem  Hospital Data Platform - environment diagnostics
rem  This file must stay pure ASCII (see the launcher bat for the reason).
rem ============================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo   [ERROR] Node.js not found.
  pause
  exit /b 1
)

node "tools\diagnose.mjs"
exit /b %errorlevel%
