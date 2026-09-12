@echo off
title 🤖 ANA — Autonomous Navigation Assistant
color 0B
cd /d "%~dp0"
cls
echo.
echo  ======================================================
echo    🤖  A.N.A — Autonomous Navigation Assistant
echo    Voice-Activated Browser Agent
echo  ======================================================
echo.
echo  Starting ANA in Voice Mode...
echo.
node index.js --voice
pause
