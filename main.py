"""
Punto de entrada.

    python main.py                         -> abre la interfaz gráfica
    python main.py DATOS.xlsx              -> calcula y exporta en ./salida
    python main.py DATOS.xlsx -o resultados --modo excel --param proyecto.json
"""
import argparse
import sys
from pathlib import Path

from calculos_mecanicos.cambio_estado import ErrorCalculo
from calculos_mecanicos.config import Proyecto
from calculos_mecanicos.datos import leer_datos
from calculos_mecanicos.exportar import exportar_todo
from calculos_mecanicos.plantillado import calcular_plantillado


def cli(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Plantillado y cálculo mecánico de conductores MT")
    ap.add_argument("archivo", help="Excel de datos (apoyos, coordenadas…)")
    ap.add_argument("-o", "--salida", default="salida", help="carpeta de resultados")
    ap.add_argument("--param", help="JSON de parámetros del proyecto")
    ap.add_argument("--modo", choices=["cambio_estado", "excel"], help="modo de flecha")
    a = ap.parse_args(argv)

    p = Proyecto.desde_json(a.param) if a.param else Proyecto()
    if a.modo:
        p.modo_flecha = a.modo
    datos = leer_datos(a.archivo, p.criterios)
    for e in datos.errores:
        print("ERROR:", e)
    if not datos.ok:
        return 2
    if datos.conductor and not a.param:
        p.conductor = datos.conductor
    try:
        res = calcular_plantillado(datos, p)
    except ErrorCalculo as e:
        print("ERROR:", e)
        return 3
    for adv in res.advertencias:
        print("AVISO:", adv)
    for k, v in res.resumen.items():
        print(f"{k:45s} {v}")
    for k, ruta in exportar_todo(res, a.salida, Path(a.archivo).stem).items():
        print(f"{k.upper():5s} -> {ruta}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1:
        sys.exit(cli())
    from calculos_mecanicos.gui import main
    main()
