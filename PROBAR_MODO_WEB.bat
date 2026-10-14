@echo off
REM Prueba el modo web SIN servidor (Python dentro del navegador, como en GitHub Pages)
cd /d "%~dp0"
call .venv\Scripts\activate.bat
python construir_web.py
start "" http://127.0.0.1:8777/
python -m http.server 8777 --bind 127.0.0.1 -d web
