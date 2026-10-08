@echo off
rem ============================================================================
rem  Hospital Data Platform - disable auto start on Windows logon
rem  This file must stay pure ASCII (see the launcher bat for the reason).
rem ============================================================================
setlocal
cd /d "%~dp0"
node "tools\autostart.mjs" uninstall
exit /b %errorlevel%
