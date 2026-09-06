@echo off
chcp 65001 > nul
title MikuChat v3 - Desktop AI Companion
cd /d "%~dp0"
echo ========================================================
echo   🎵 MikuChat v3 — High-Performance AI Companion
echo ========================================================
echo.
echo [1/2] Starting MikuChat Desktop Companion...
start "" "%~dp0node_modules\electron\dist\electron.exe" .
