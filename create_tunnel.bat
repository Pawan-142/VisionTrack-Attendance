@echo off
title VisionTrack - Public HTTPS Tunnel Generator
cd /d "%~dp0"

echo ========================================================
echo   VisionTrack - Creating Public HTTPS Tunnel
echo ========================================================
echo.

if exist "cloudflared.exe" (
    echo Launching Cloudflare Tunnel (HTTP/2 mode)...
    cloudflared.exe tunnel --protocol http2 --url http://localhost:8000
) else (
    echo Launching HTTPS Tunnel...
    call npx -y localtunnel --port 8000
)

pause
