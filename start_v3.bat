@echo off
chcp 65001 > nul
title MikuChat v3 - Desktop AI Companion
cd /d "%~dp0"
echo ========================================================
echo   🎵 MikuChat v3 — High-Performance AI Companion
echo ========================================================
echo.
echo [1/2] Starting Vite & Electron Overlay...
node "node_modules/vite/bin/vite.js"
