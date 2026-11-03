@echo off
setlocal
title Founder Desk
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [CrewZero] Node.js is not installed. Please install Node.js LTS from https://nodejs.org and double-click this file again.
  pause
  exit /b 1
)
echo [CrewZero] Starting Founder Desk. Keep this window open while you use the page; close it to stop.
node "%~dp0server.mjs" --open
echo.
echo [CrewZero] Stopped.
pause
