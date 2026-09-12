@echo off
title 🤖 ANA Background Listener
color 0A
cd /d "%~dp0"
echo.
echo  ======================================================
echo    🤖  A.N.A Global 3x Spacebar Listener Active
echo  ======================================================
echo.
echo  Listening for 3x Spacebar keypresses anywhere on Windows...
echo  Minimize this window or keep it running.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File listen_space_global.ps1
