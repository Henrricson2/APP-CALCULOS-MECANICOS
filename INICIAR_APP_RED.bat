@echo off
REM Abre la app y permite usarla desde celulares en la misma red Wi-Fi
cd /d "%~dp0"
call .venv\Scripts\activate.bat
python server.py --red
pause
