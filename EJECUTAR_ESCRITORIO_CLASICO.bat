@echo off
REM Version clasica de escritorio (Tkinter)
cd /d "%~dp0"
call .venv\Scripts\activate.bat
python -c "from calculos_mecanicos.gui import main; main()"
if errorlevel 1 pause
