@echo off
rem ============================================================================
rem  Hospital Data Platform - launcher (double click to run)
rem
rem  IMPORTANT: this file must stay pure ASCII.
rem  cmd.exe parses batch files byte-by-byte using the current code page, so
rem  UTF-8 Chinese text inside a .bat gets mis-decoded into syntax characters
rem  and breaks the whole script. All Chinese UI lives in tools\launch.mjs,
rem  which also handles the "press Enter to close" pause itself.
rem ============================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [ERROR] Node.js not found.
  echo   Please install Node.js 20+ from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node "tools\launch.mjs"
exit /b %errorlevel%
