@echo off
chcp 65001 > nul
title ANA Voice Assistant
color 0B
cd /d "%~dp0"
cls
echo.
echo  =============================================================
echo    A.N.A - Autonomous Navigation Assistant
echo    Voice-Activated Web Browser Agent
echo  =============================================================
echo.
echo  [SYSTEM] Starting ANA in Voice Mode...
echo.
node index.js --voice
pause
