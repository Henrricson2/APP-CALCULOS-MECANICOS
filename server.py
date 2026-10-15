"""
Servidor de la App de Cálculos Mecánicos (misma arquitectura que la app de APUs):
Python estándar (http.server) + frontend PWA en la carpeta web/.

    python server.py                 -> http://127.0.0.1:8766 (solo este PC)
    python server.py --red           -> accesible desde celulares en la misma red Wi-Fi
    python server.py --puerto 9000 --no-abrir

API (JSON):
    GET  /api/salud                 estado del motor
    GET  /api/info                  parámetros por defecto y biblioteca de conductores
    GET  /api/plantilla             Excel de plantilla
    POST /api/importar              cuerpo = bytes del .xlsx  -> tablas editables
    POST /api/calcular              cuerpo = JSON del proyecto -> resultados
    POST /api/exportar/{xlsx|pdf|dxf}  cuerpo = JSON del proyecto -> archivo
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import shutil
import socket
import subprocess
import sys
import threading
import traceback
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse

RAIZ = Path(__file__).resolve().parent
WEB = RAIZ / "web"
PAQUETE = RAIZ / "calculos_mecanicos"
MAX_CUERPO = 25 * 1024 * 1024

sys.path.insert(0, str(RAIZ))
from calculos_mecanicos import __version__, motor  # noqa: E402
from calculos_mecanicos.almacen import Almacen  # noqa: E402

ALMACEN = Almacen()
CONFIG = Path(ALMACEN.ruta).parent / "config.json"


def leer_config() -> dict:
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/x-python", ".py")
mimetypes.add_type("image/svg+xml", ".svg")


class Manejador(BaseHTTPRequestHandler):
    server_version = f"CalculosMecanicos/{__version__}"

    # ------------------------------------------------------------ utilidades
    def log_message(self, fmt, *args):  # registro compacto
        sys.stdout.write(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}\n")

    def _enviar(self, codigo: int, cuerpo: bytes, tipo: str, extra: dict | None = None):
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(cuerpo)

    def _json(self, datos, codigo=200):
        self._enviar(codigo, json.dumps(datos, ensure_ascii=False).encode("utf-8"),
                     "application/json; charset=utf-8", {"Cache-Control": "no-store"})

    def _error(self, codigo, mensaje):
        self._json({"ok": False, "errores": [mensaje]}, codigo)

    def _cuerpo(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_CUERPO:
            raise ValueError("Archivo demasiado grande (máx. 25 MB).")
        return self.rfile.read(n) if n else b""

    def _archivo(self, base: Path, rel: str):
        destino = (base / rel).resolve()
        if base.resolve() not in destino.parents and destino != base.resolve():
            return self._error(403, "Ruta no permitida.")
        if destino.is_dir():
            destino = destino / "index.html"
        if not destino.is_file():
            return self._error(404, "No encontrado.")
        tipo = mimetypes.guess_type(destino.name)[0] or "application/octet-stream"
        if tipo.startswith("text/") or tipo in ("application/json", "application/manifest+json"):
            tipo += "; charset=utf-8"
        cache = "no-cache" if destino.suffix in (".html", ".js", ".css", ".py", ".webmanifest") \
            else "max-age=86400"
        self._enviar(200, destino.read_bytes(), tipo, {"Cache-Control": cache})

    # ------------------------------------------------------------ rutas
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        ruta = urlparse(self.path).path
        try:
            if ruta == "/api/salud":
                return self._json({"ok": True, "motor": "servidor", "version": __version__})
            if ruta == "/api/info":
                return self._json(motor.info())
            if ruta == "/api/plantilla":
                return self._enviar(200, motor.plantilla_excel(),
                                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                    {"Content-Disposition": 'attachment; filename="PLANTILLA_DATOS.xlsx"'})
            if ruta == "/api/config":
                c = leer_config()
                return self._json({"ok": True, "google_maps_key": c.get("google_maps_key", "")})
            if ruta == "/api/proyectos":
                return self._json({"ok": True, "proyectos": ALMACEN.listar()})
            partes = ruta.strip("/").split("/")
            if len(partes) >= 3 and partes[:2] == ["api", "proyectos"]:
                pid = partes[2]
                if len(partes) == 3:
                    p = ALMACEN.obtener(pid)
                    return self._json({"ok": True, "proyecto": p}) if p else self._error(404, "Proyecto no encontrado.")
                if partes[3] == "versiones" and len(partes) == 4:
                    return self._json({"ok": True, "versiones": ALMACEN.versiones(pid)})
                if partes[3] == "versiones" and len(partes) == 5:
                    v = ALMACEN.obtener_version(pid, int(partes[4]))
                    return self._json({"ok": True, "version": v}) if v else self._error(404, "Versión no encontrada.")
                if partes[3] == "bitacora":
                    return self._json({"ok": True, "bitacora": ALMACEN.bitacora(pid)})
            if ruta.startswith("/py/calculos_mecanicos/"):
                return self._archivo(PAQUETE, ruta.split("/py/calculos_mecanicos/", 1)[1])
            if ruta == "/py/manifest.json":
                return self._json(sorted(p.name for p in PAQUETE.glob("*.py") if p.name not in ("gui.py", "almacen.py")))
            return self._archivo(WEB, ruta.lstrip("/") or "index.html")
        except Exception:
            traceback.print_exc()
            return self._error(500, "Error interno del servidor.")

    def do_POST(self):
        ruta = urlparse(self.path).path
        try:
            cuerpo = self._cuerpo()
            if ruta == "/api/importar":
                if not cuerpo:
                    return self._error(400, "No se recibió ningún archivo.")
                return self._json(motor.importar_excel(cuerpo))
            if ruta == "/api/calcular":
                return self._json(motor.calcular(json.loads(cuerpo or b"{}")))
            if ruta == "/api/apagar":  # solo desde este mismo PC: lo usa una versión nueva para reemplazarlo
                if self.client_address[0] not in ("127.0.0.1", "::1"):
                    return self._error(403, "No permitido.")
                self._json({"ok": True, "version": __version__})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return None
            if ruta.startswith("/api/rpc/"):
                return self._json(motor.rpc(ruta.rsplit("/", 1)[1], json.loads(cuerpo or b"{}")))
            if ruta == "/api/config":
                d = json.loads(cuerpo or b"{}")
                c = leer_config()
                c["google_maps_key"] = str(d.get("google_maps_key", "")).strip()
                CONFIG.write_text(json.dumps(c, indent=1), encoding="utf-8")
                return self._json({"ok": True})
            partes = ruta.strip("/").split("/")
            if partes[:2] == ["api", "proyectos"]:
                d = json.loads(cuerpo or b"{}")
                if len(partes) == 2:
                    return self._json({"ok": True, **ALMACEN.guardar(d.get("datos") or {}, d.get("id"))})
                pid = partes[2]
                if len(partes) == 4 and partes[3] == "versiones":
                    return self._json({"ok": True, **ALMACEN.crear_version(pid, d.get("comentario", ""))})
                if len(partes) == 4 and partes[3] == "archivar":
                    return self._json({"ok": ALMACEN.archivar(pid)})
            if ruta.startswith("/api/exportar/"):
                fmt = ruta.rsplit("/", 1)[1]
                datos, nombre, mime = motor.exportar(json.loads(cuerpo or b"{}"), fmt)
                return self._enviar(200, datos, mime, {
                    "Content-Disposition": f"attachment; filename*=UTF-8''{quote(nombre)}",
                    "Cache-Control": "no-store"})
            return self._error(404, "Ruta no encontrada.")
        except json.JSONDecodeError:
            return self._error(400, "JSON inválido.")
        except KeyError:
            return self._error(404, "No encontrado.")
        except ValueError as e:
            return self._error(400, str(e))
        except Exception as e:
            traceback.print_exc()
            return self._error(500, f"Error interno: {e}")


# ---------------------------------------------------------------- arranque
def ip_local() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def abrir_navegador(url: str):
    """En Windows abre Edge/Chrome en modo aplicación (ventana sin barra, como app de escritorio)."""
    if sys.platform.startswith("win"):
        for exe in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                    shutil.which("msedge") or "", shutil.which("chrome") or ""):
            if exe and Path(exe).exists():
                subprocess.Popen([exe, f"--app={url}", "--window-size=1366,860"])
                return
    webbrowser.open(url)


class Servidor(ThreadingHTTPServer):
    """En Windows, SO_REUSEADDR deja que VARIOS procesos escuchen el mismo puerto y las
    peticiones se reparten entre versiones viejas y nuevas. Se usa uso exclusivo del puerto."""
    allow_reuse_address = not sys.platform.startswith("win")
    daemon_threads = True

    def server_bind(self):
        if sys.platform.startswith("win") and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def _pids_escuchando(puerto: int) -> set[str]:
    salida = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True).stdout
    return {ln.split()[-1] for ln in salida.splitlines()
            if f":{puerto} " in ln and "LISTENING" in ln.upper() and ln.split()[-1].isdigit()}


def reemplazar_version_vieja(puerto: int) -> bool:
    """Si en el puerto corre OTRA versión de esta app, la cierra para abrir la nueva.

    Evita el problema de abrir la app actualizada y seguir hablando con el servidor viejo.
    """
    import time
    import urllib.request
    base = f"http://127.0.0.1:{puerto}"
    try:
        with urllib.request.urlopen(base + "/api/salud", timeout=3) as r:
            salud = json.loads(r.read() or b"{}")
    except Exception:
        return False
    if not (salud.get("ok") and salud.get("motor") == "servidor"):
        return False                      # el puerto lo usa otro programa: no se toca
    # Siempre se reemplaza el servidor que esté abierto (aunque diga la misma versión): así nunca
    # quedan procesos viejos atendiendo. Los datos están en la base SQLite, no se pierde nada.
    print(f"Había otra ventana de la app abierta (v{salud.get('version')}). Cerrándola para abrir v{__version__}…")
    try:
        req = urllib.request.Request(base + "/api/apagar", data=b"{}", method="POST",
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=3).read()
    except Exception:
        pass
    if sys.platform.startswith("win"):
        # versiones anteriores no tienen /api/apagar y pueden quedar VARIAS escuchando el puerto
        time.sleep(1.0)
        try:
            for pid in _pids_escuchando(puerto):
                if int(pid) != os.getpid():
                    subprocess.run(["taskkill", "/PID", pid, "/F"], capture_output=True)
        except Exception:
            return False
    for _ in range(20):
        time.sleep(0.3)
        try:
            with socket.create_connection(("127.0.0.1", puerto), timeout=0.5):
                pass
        except OSError:
            return True
    return False


def main(argv=None):
    ap = argparse.ArgumentParser(description="Servidor App Cálculos Mecánicos MT")
    ap.add_argument("--puerto", type=int, default=8766)
    ap.add_argument("--red", action="store_true", help="aceptar conexiones de la red local (celulares)")
    ap.add_argument("--no-abrir", action="store_true", help="no abrir el navegador")
    a = ap.parse_args(argv)
    host = "0.0.0.0" if a.red else "127.0.0.1"
    srv = None
    for intento in range(2):
        try:
            srv = Servidor((host, a.puerto), Manejador)
            break
        except OSError:
            if intento == 0 and reemplazar_version_vieja(a.puerto):
                continue
            print(f"El puerto {a.puerto} está ocupado. ¿La app ya está abierta? "
                  f"Abra http://127.0.0.1:{a.puerto}")
            if not a.no_abrir:
                abrir_navegador(f"http://127.0.0.1:{a.puerto}/")
            return 1
    url = f"http://127.0.0.1:{a.puerto}/"
    print("=" * 64)
    print(f" App Cálculos Mecánicos MT v{__version__}")
    print(f" En este PC:        {url}")
    if a.red:
        print(f" Desde el celular:  http://{ip_local()}:{a.puerto}/   (misma red Wi-Fi)")
    print(" Para cerrar la app cierre esta ventana (o Ctrl+C).")
    print("=" * 64)
    if not a.no_abrir:
        threading.Timer(0.8, abrir_navegador, args=(url,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
