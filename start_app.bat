@echo off
title VisionTrack - AI Facial Attendance System
cd /d "%~dp0"

echo ========================================================
echo   VisionTrack - AI Facial Attendance System
echo ========================================================
echo.

echo Working Directory: %~dp0
echo.

:: Detect Python executable
set "PYTHON_EXE="
where python >nul 2>nul
if %errorlevel% equ 0 (
    set "PYTHON_EXE=python"
) else (
    where py >nul 2>nul
    if %errorlevel% equ 0 (
        set "PYTHON_EXE=py"
    ) else if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" (
        set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    ) else if exist "C:\Python313\python.exe" (
        set "PYTHON_EXE=C:\Python313\python.exe"
    ) else if exist "%LOCALAPPDATA%\Programs\Python310\python.exe" (
        set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python310\python.exe"
    ) else if exist "C:\Python310\python.exe" (
        set "PYTHON_EXE=C:\Python310\python.exe"
    ) else (
        echo [ERROR] Python not found in PATH or standard directories.
        echo Please install Python and add it to PATH.
        pause
        exit /b 1
    )
)

:: Free port 8000 if occupied by any stale background process
echo [1/3] Checking for stale processes on port 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do (
    echo [INFO] Terminating old process on port 8000 (PID: %%a)...
    taskkill /F /PID %%a >nul 2>nul
)

echo [2/3] Starting VisionTrack Web Server from current directory...
start "VisionTrack Backend & Frontend" cmd /k "cd /d "%~dp0" && "%PYTHON_EXE%" fastapi_app.py"

:: Wait for server to initialize
timeout /t 4 /nobreak >nul

echo [3/3] Opening browser...
start http://127.0.0.1:8000

echo.
echo ========================================================
echo   VisionTrack is Running!
echo   Application URL : http://127.0.0.1:8000
echo   API Docs URL    : http://127.0.0.1:8000/docs
echo ========================================================
echo.
echo Keep the server console window open while using the app.
pause

