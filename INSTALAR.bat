@echo off
REM Instala el entorno de la aplicacion (una sola vez)
cd /d "%~dp0"
if not exist .venv (
    py -3 -m venv .venv || python -m venv .venv
)
call .venv\Scripts\activate.bat
REM Redes corporativas con inspeccion SSL: truststore usa los certificados de Windows
python -m pip install --use-feature=truststore --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo Reintentando con certificados de Windows...
    python -m pip install --use-feature=truststore -r requirements.txt
)
if errorlevel 1 (
    echo.
    echo ERROR: no se pudieron instalar las librerias. Revise la conexion o el proxy.
) else (
    echo.
    echo Instalacion terminada correctamente. Ejecute EJECUTAR.bat
)
pause
