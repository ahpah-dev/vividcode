@echo off
setlocal
chcp 65001 >nul 2>nul
title VividCode  -  Neon 9Router Vibe CLI
color 0B

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js 18+ is required to run VividCode.
  echo   Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

node "%~dp0bin\vividcode.js" %*
set "VIVIDCODE_EXIT=%ERRORLEVEL%"

if not "%VIVIDCODE_EXIT%"=="0" (
  echo.
  pause
)

exit /b %VIVIDCODE_EXIT%
