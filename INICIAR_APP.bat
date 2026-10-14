@echo off
REM App Calculos Mecanicos MT - abre la app (PC)
cd /d "%~dp0"
if not exist .venv (
    echo Primero ejecute INSTALAR.bat
    pause
    exit /b 1
)
call .venv\Scripts\activate.bat
python server.py %*
if errorlevel 1 pause
