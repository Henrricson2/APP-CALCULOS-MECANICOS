"""
Prepara la carpeta web/ (ejecútelo después de cambiar el motor Python):

    python construir_web.py

Genera:
  web/defaults.json        parámetros por defecto y biblioteca de conductores
  web/ejemplo.json         proyecto de ejemplo (ejemplos/DATOS_EJEMPLO_COMPLETO.xlsx)
  web/icon-192.png / 512   iconos para instalar la app
  web/py/                  copia del motor Python para el modo "Python en el navegador"
                           (web estática: GitHub Pages, celular sin servidor)
"""
import json
import shutil
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
WEB = RAIZ / "web"
sys.path.insert(0, str(RAIZ))

from calculos_mecanicos import motor  # noqa: E402


def iconos():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import FancyBboxPatch
    import numpy as np
    for n in (192, 512):
        fig = plt.figure(figsize=(1, 1), dpi=n)
        ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, 256); ax.set_ylim(256, 0); ax.axis("off")
        fig.patch.set_facecolor("#17324d")
        ax.add_patch(FancyBboxPatch((28, 28), 200, 200, boxstyle="round,pad=0,rounding_size=30", fc="#e9783f", ec="none"))
        for x in (66, 190):
            ax.plot([x, x], [70, 192], color="white", lw=n / 256 * 11, solid_capstyle="round")
        t = np.linspace(0, 1, 60)
        ax.plot(66 + 124 * t, 88 + 230 * t * (1 - t) * 0.5, color="white", lw=n / 256 * 8, solid_capstyle="round")
        fig.savefig(WEB / f"icon-{n}.png", dpi=n, facecolor="#17324d")
        plt.close(fig)


def main():
    (WEB / "defaults.json").write_text(json.dumps(motor.info(), ensure_ascii=False, indent=1), encoding="utf-8")
    ej = motor.importar_excel((RAIZ / "ejemplos" / "DATOS_EJEMPLO_COMPLETO.xlsx").read_bytes())
    proyecto = {"nombre": "Ejemplo – línea 13.2 kV (AP-129 a AP-151)"}
    if ej.get("conductor"):
        proyecto["conductor"] = ej["conductor"]
    (WEB / "ejemplo.json").write_text(json.dumps({"proyecto": proyecto, "apoyos": ej["apoyos"], "terreno": ej["terreno"]},
                                                 ensure_ascii=False), encoding="utf-8")
    destino = WEB / "py" / "calculos_mecanicos"
    shutil.rmtree(WEB / "py", ignore_errors=True)
    destino.mkdir(parents=True)
    archivos = []
    for f in sorted((RAIZ / "calculos_mecanicos").glob("*.py")):
        if f.name in ("gui.py", "almacen.py"):
            continue
        shutil.copy2(f, destino / f.name)
        archivos.append(f.name)
    (WEB / "py" / "manifest.json").write_text(json.dumps(archivos), encoding="utf-8")
    iconos()
    print("web/ preparada:", ", ".join(archivos))


if __name__ == "__main__":
    main()
