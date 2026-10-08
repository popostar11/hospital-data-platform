@echo off
rem ============================================================================
rem  Hospital Data Platform - enable auto start on Windows logon
rem  This file must stay pure ASCII (see the launcher bat for the reason).
rem ============================================================================
setlocal
cd /d "%~dp0"
node "tools\autostart.mjs" install
exit /b %errorlevel%
