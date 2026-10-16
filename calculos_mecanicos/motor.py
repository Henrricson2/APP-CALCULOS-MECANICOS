"""
Fachada JSON del motor de cálculo.

La MISMA función se usa en:
  * el servidor Python (servidor/server.py)        -> PC y celulares en la red local
  * Python dentro del navegador (Pyodide)           -> web y celular sin servidor
  * pruebas automáticas

Entradas y salidas son dicts serializables a JSON (y bytes para archivos).

payload = {
    "proyecto": {...parámetros (ver config.Proyecto)...},
    "apoyos":  [{"nombre","x","y","altura","tipo","vano","flecha"}, ...],
    "terreno": [{"x","cota"}, ...]            # opcional
}
"""
from __future__ import annotations

import io
import json
import math
import os
import tempfile
from dataclasses import asdict
from pathlib import Path

import numpy as np
import pandas as pd

from . import __version__
from .cambio_estado import ErrorCalculo
from .config import BIBLIOTECA_CONDUCTORES, Conductor, Proyecto
from .estructuras import CABLES_TEMPLETE, CATALOGO_POSTES
from .datos import construir_datos, leer_datos
from .plantillado import calcular_plantillado, tabla_secciones


# ---------------------------------------------------------------- utilidades
def _limpio(v):
    """Convierte valores numpy/NaN a tipos JSON."""
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 6)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


def _registros(df: pd.DataFrame) -> dict:
    return {"columnas": [str(c) for c in df.columns],
            "filas": [[_limpio(v) for v in fila] for fila in df.itertuples(index=False)]}


def preparar_apoyos(apoyos: list[dict]) -> tuple[list[dict], list[str], list[float | None]]:
    """Si los postes tienen latitud/longitud, calcula la abscisa geodésica (x) y usa la cota z como y.

    Devuelve (apoyos_para_calculo, errores, deflexiones_en_grados).
    """
    from . import geo
    apoyos = [dict(a) for a in (apoyos or [])]
    con_geo = [a for a in apoyos if a.get("lat") not in (None, "") and a.get("lon") not in (None, "")]
    if not apoyos or len(con_geo) != len(apoyos):
        return apoyos, [], [None] * len(apoyos)
    errores = []
    pts = [(float(a["lat"]), float(a["lon"])) for a in apoyos]
    xs = geo.abscisas(pts)
    for a, x in zip(apoyos, xs):
        a["x"] = round(x, 4)
        if a.get("z") not in (None, ""):
            a["y"] = a["z"]
        elif a.get("y") in (None, ""):
            errores.append(f"Poste {a.get('nombre') or a.get('id')}: sin cota Z. Agregue la cota "
                           "(topografía o modelo de elevación) para calcular el perfil.")
    defl = [None] * len(apoyos)
    for i in range(1, len(pts) - 1):
        az1 = geo.azimut(*pts[i - 1], *pts[i])
        az2 = geo.azimut(*pts[i], *pts[i + 1])
        defl[i] = round(geo.deflexion(az1, az2), 3)
    return apoyos, errores, defl


def _elevacion_web(fuente: str, puntos: list[dict]) -> dict:
    """Consulta la elevación desde el servidor (evita el bloqueo CORS del navegador).

    srtm: OpenTopoData SRTM 30 m (máx. 100 puntos por consulta, 1 consulta/s).
    openmeteo: Open-Meteo, Copernicus DEM 90 m.
    """
    import ssl
    import urllib.parse
    import urllib.request
    if len(puntos) > 100:
        raise ValueError("Máximo 100 puntos por consulta.")
    try:  # red corporativa con inspección SSL: usar los certificados de Windows
        import truststore  # type: ignore
        ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:
        ctx = ssl.create_default_context()
    if fuente == "srtm":
        loc = "|".join(f"{float(p['lat']):.7f},{float(p['lon']):.7f}" for p in puntos)
        url = "https://api.opentopodata.org/v1/srtm30m?interpolation=bilinear&locations=" + urllib.parse.quote(loc, safe=",|.-")
    elif fuente == "openmeteo":
        url = ("https://api.open-meteo.com/v1/elevation?latitude=" + ",".join(f"{float(p['lat']):.6f}" for p in puntos)
               + "&longitude=" + ",".join(f"{float(p['lon']):.6f}" for p in puntos))
    else:
        raise ValueError(f"Fuente desconocida: {fuente}")
    req = urllib.request.Request(url, headers={"User-Agent": "calculos-mecanicos-mt"})
    with urllib.request.urlopen(req, timeout=40, context=ctx) as r:
        j = json.loads(r.read())
    if fuente == "srtm":
        if j.get("status") != "OK":
            raise ValueError(j.get("error") or "OpenTopoData no devolvió datos")
        cotas = [x.get("elevation") for x in j["results"]]
    else:
        cotas = j.get("elevation")
        if not isinstance(cotas, list):
            raise ValueError(j.get("reason") or "Open-Meteo no devolvió datos")
    return {"cotas": cotas, "fuente": fuente}


def _terreno_por_estructuras(terreno, apoyos):
    """El perfil del terreno pasa exactamente por la base de cada estructura (su cota Z):
    el poste queda parado sobre el terreno aunque la cota se haya corregido después."""
    from .estructuras import _f
    if not terreno or not any(a.get("lat") not in (None, "") for a in apoyos):
        return terreno
    bases = [(_f(a.get("x")), _f(a.get("y"))) for a in apoyos]
    bases = [(x, y) for x, y in bases if x is not None and y is not None]
    if not bases:
        return terreno
    pts = [t for t in terreno if _f(t.get("x")) is not None and _f(t.get("cota")) is not None
           and all(abs(_f(t["x"]) - x) > 0.5 for x, _ in bases)]
    pts += [{"x": x, "cota": y} for x, y in bases]
    return sorted(pts, key=lambda t: _f(t["x"]))


_CAMPOS_ESTRUCTURA = ("poste_altura", "poste_rotura", "poste_peso", "templetes", "estructura", "bajo_cima_m")


def _datos_payload(payload: dict, proyecto: Proyecto):
    from .estructuras import _f, altura_amarre_desde_poste
    apoyos, errores, defl = preparar_apoyos(payload.get("apoyos") or [])
    # altura de amarre a partir del poste cuando no se escribió
    for a in apoyos:
        L = _f(a.get("poste_altura"))
        if L:  # la altura de amarre depende de la altura del poste (y de la estructura EH, si tiene)
            a["altura"] = round(altura_amarre_desde_poste(L, proyecto.criterios, _f(a.get("bajo_cima_m"))), 3)
    terreno = _terreno_por_estructuras(payload.get("terreno"), apoyos)
    d = construir_datos(apoyos, terreno, None, proyecto.criterios, payload.get("origen", "web"))
    d.errores = errores + d.errores
    d.deflexiones = defl
    validos = [a for a in apoyos if not (a.get("x") in (None, "") and a.get("y") in (None, "") and a.get("nombre") in (None, ""))]
    if len(validos) == len(d.apoyos):
        d.estructuras = [{k: a.get(k) for k in _CAMPOS_ESTRUCTURA} for a in validos]
    d.geo = [(a.get("lat"), a.get("lon")) for a in apoyos] if any(a.get("lat") is not None for a in apoyos) else None
    return d


# ---------------------------------------------------------------- API
def info() -> dict:
    return {
        "version": __version__,
        "proyecto_defecto": Proyecto().a_dict(),
        "conductores": {k: asdict(c) for k, c in BIBLIOTECA_CONDUCTORES.items()},
        "postes": CATALOGO_POSTES,
        "cables_templete": CABLES_TEMPLETE,
    }


def importar_excel(contenido: bytes) -> dict:
    """Lee un Excel (bytes) y devuelve las tablas editables + avisos."""
    d = leer_datos(bytes(contenido))
    if d.errores and d.apoyos.empty:
        return {"ok": False, "errores": d.errores, "advertencias": d.advertencias}
    apoyos = []
    ap = d.apoyos
    for i in range(len(ap)):
        fila = {"nombre": ap.nombre[i], "x": _limpio(ap.x[i]), "y": _limpio(ap.y[i]),
                "altura": _limpio(ap.altura[i]) if d.y_es_terreno else None,
                "tipo": "R" if ap.retencion[i] else "S"}
        if i > 0 and d.flechas_excel:
            fila["flecha"] = _limpio(d.flechas_excel[i - 1])
        apoyos.append(fila)
    # el primer/último apoyo se marcan R por regla; si el archivo no traía Tipo se dejan así
    terreno = ([] if d.terreno is None else
               [{"x": _limpio(x), "cota": _limpio(c)} for x, c in zip(d.terreno.x, d.terreno.cota)])
    return {"ok": not d.errores, "apoyos": apoyos, "terreno": terreno,
            "conductor": asdict(d.conductor) if d.conductor else None,
            "errores": d.errores, "advertencias": d.advertencias}


def _advertir_geometria(datos, res) -> None:
    """Estructuras que parecen mal ubicadas: la línea va hasta ella y regresa (rodeo grande),
    típico de un arrastre accidental en el mapa o de una coordenada mal digitada."""
    from . import geo
    pts = getattr(datos, "geo", None)
    if not pts or len(pts) < 3 or any(p[0] in (None, "") for p in pts):
        return
    nombres = list(datos.apoyos["nombre"])
    for i in range(1, len(pts) - 1):
        (la0, lo0), (la1, lo1), (la2, lo2) = [(float(a), float(b)) for a, b in pts[i - 1:i + 2]]
        a = geo.distancia_geodesica(la0, lo0, la1, lo1)
        b = geo.distancia_geodesica(la1, lo1, la2, lo2)
        c = geo.distancia_geodesica(la0, lo0, la2, lo2)
        if a + b > 2.5 * max(c, 1.0) and a + b - c > 200:
            res.advertencias.insert(0, (
                f"Estructura {nombres[i]}: parece mal ubicada. Está a {a:.0f} m y {b:.0f} m de sus vecinas, "
                f"que están a solo {c:.0f} m entre sí (la línea va y regresa). Revise sus coordenadas: "
                "pudo moverse sin querer en el mapa (en la tabla, ↺ la devuelve a su posición original)."))


def _resolver(payload: dict):
    proyecto = Proyecto.desde_dict(payload.get("proyecto"))
    datos = _datos_payload(payload, proyecto)
    res = calcular_plantillado(datos, proyecto)
    _advertir_geometria(datos, res)
    return proyecto, datos, res


def calcular(payload: dict) -> dict:
    try:
        proyecto, datos, res = _resolver(payload)
    except ErrorCalculo as e:
        return {"ok": False, "errores": str(e).split("\n- ") if "\n- " in str(e) else [str(e)]}
    except (TypeError, ValueError, KeyError) as e:
        return {"ok": False, "errores": [f"Parámetros inválidos: {e}"]}

    n = 48  # puntos por vano para graficar (suficiente y liviano para celular)
    vanos_geo = []
    for i, (c, cf) in enumerate(zip(res.catenarias, res.catenarias_frias)):
        x, y = c.muestrear(n)
        _, yf = cf.muestrear(n)
        fila = res.vanos.iloc[i]
        vanos_geo.append({
            "x": [round(float(v), 3) for v in x], "y": [round(float(v), 3) for v in y],
            "yf": [round(float(v), 3) for v in yf],
            "a": round(c.vano, 2), "f": round(c.flecha, 3),
            "xf": round(c.x_flecha_maxima, 2), "yfm": round(float(c.y(c.x_flecha_maxima)), 3),
            "cumple": fila.get("Cumple distancia", None),
            "xmin": _limpio(fila.get("X dist. mín.", None)),
            "dmin": _limpio(fila.get("Dist. mín. terreno (m)", None)),
        })
    ap = res.apoyos
    defl = getattr(datos, "deflexiones", None)
    if defl and any(v is not None for v in defl) and len(defl) == len(ap):
        ap.insert(ap.columns.get_loc("Tipo") + 1, "Deflexión (°)", defl)
    apoyos_geo = [{"nombre": r["Apoyo"], "x": _limpio(r["X (m)"]), "ya": _limpio(r["Cota amarre (m)"]),
                   "yt": _limpio(r["Cota Y (m)"]), "tipo": r["Tipo"],
                   "arranc": r["Arrancamiento"] == "SÍ", "abscisa": _limpio(r["Abscisa (m)"])}
                  for _, r in ap.iterrows()]
    if getattr(datos, "geo", None):
        for g, (la, lo) in zip(apoyos_geo, datos.geo):
            g["lat"], g["lon"] = la, lo
    terreno = None
    if datos.terreno is not None:
        terreno = {"x": [_limpio(v) for v in datos.terreno.x], "y": [_limpio(v) for v in datos.terreno.cota]}
    elif datos.y_es_terreno:
        terreno = {"x": [_limpio(v) for v in datos.apoyos.x], "y": [_limpio(v) for v in datos.apoyos.y]}

    circuitos = []
    for c in res.circuitos:
        vs = []
        for k, (cc, cf) in enumerate(zip(c.res.catenarias, c.res.catenarias_frias)):
            x, y = cc.muestrear(n)
            _, yf = cf.muestrear(n)
            fila = c.res.vanos.iloc[k]
            vs.append({"i": c.i0 + k, "x": [round(float(v), 3) for v in x], "y": [round(float(v), 3) for v in y],
                       "yf": [round(float(v), 3) for v in yf], "a": round(cc.vano, 2), "f": round(cc.flecha, 3),
                       "cumple": fila.get("Cumple distancia", None),
                       "xmin": _limpio(fila.get("X dist. mín.", None)), "dmin": _limpio(fila.get("Dist. mín. terreno (m)", None))})
        ya = list(c.res.apoyos["Cota amarre (m)"])
        circuitos.append({"nombre": c.nombre, "tension_kv": _limpio(c.circuito.tension_kv),
                          "conductor": c.circuito.conductor.nombre, "i0": c.i0, "i1": c.i1,
                          "vanos": vs, "ya": [_limpio(v) for v in ya], "vanos_tabla": _registros(c.res.vanos)})
    extra = {}
    if res.tabla_circuitos is not None:
        extra["circuitos"] = _registros(res.tabla_circuitos)
    if res.separaciones is not None:
        extra["separaciones"] = _registros(res.separaciones)
    if res.cargas_circuitos is not None:
        extra["cargas_circuitos"] = _registros(res.cargas_circuitos)
    return {
        "ok": True,
        **extra,
        "resumen": {k: _limpio(v) for k, v in res.resumen.items()},
        "vanos": _registros(res.vanos),
        "apoyos": _registros(res.apoyos),
        "secciones": _registros(tabla_secciones(res)),
        "postes": _registros(res.postes) if res.postes is not None else None,
        "advertencias": res.advertencias,
        "perfil": {"vanos": vanos_geo, "apoyos": apoyos_geo, "terreno": terreno,
                   "dmin": proyecto.criterios.distancia_minima_terreno_m,
                   "y_es_terreno": datos.y_es_terreno, "modo": proyecto.modo_flecha,
                   "vanos_por_pagina": proyecto.salida.vanos_por_pagina,
                   "circuito_principal": proyecto.criterios.nombre_circuito_principal or "Circuito 1",
                   "circuitos": circuitos},
    }


_FORMATOS = {
    "xlsx": ("_RESULTADOS.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "pdf": ("_PERFIL.pdf", "application/pdf"),
    "dxf": ("_PERFIL.dxf", "application/dxf"),
}


def _base(nombre: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in nombre)[:60] or "PROYECTO"


def exportar(payload: dict, formato: str) -> tuple[bytes, str, str]:
    """Devuelve (contenido, nombre_archivo, tipo_mime)."""
    if formato in ("kml", "kmz", "html"):
        from . import kml
        nombre = (payload.get("proyecto") or {}).get("nombre") or "Proyecto"
        doc = {"nombre": nombre, "postes": payload.get("apoyos") or []}
        if not any(p.get("lat") is not None for p in doc["postes"]):
            raise ValueError("Los postes no tienen coordenadas geográficas: importe o ubique los postes en el mapa.")
        if formato == "html":
            from .mapa_html import proyecto_a_html
            return proyecto_a_html(doc).encode("utf-8"), _base(nombre) + "_MAPA.html", "text/html; charset=utf-8"
        if formato == "kml":
            return kml.proyecto_a_kml(doc).encode("utf-8"), _base(nombre) + ".kml", "application/vnd.google-earth.kml+xml"
        return kml.proyecto_a_kmz(doc), _base(nombre) + ".kmz", "application/vnd.google-earth.kmz"
    from .exportar import exportar_dxf, exportar_excel, exportar_pdf
    if formato not in _FORMATOS:
        raise ValueError(f"Formato no soportado: {formato}")
    proyecto, _, res = _resolver(payload)
    sufijo, mime = _FORMATOS[formato]
    base = _base(proyecto.nombre)
    fn = {"xlsx": exportar_excel, "pdf": exportar_pdf, "dxf": exportar_dxf}[formato]
    with tempfile.TemporaryDirectory() as tmp:
        ruta = Path(tmp) / f"salida{sufijo}"
        fn(res, ruta)
        return ruta.read_bytes(), base + sufijo, mime


def plantilla_excel() -> bytes:
    """Plantilla de datos vacía con las columnas reconocidas."""
    buf = io.BytesIO()
    ej = pd.DataFrame({
        "Apoyo": ["AP-001", "AP-002", "AP-003"],
        "Coordenada en X": [0, 120, 250],
        "Coordenada en Y": [1000.0, 1002.5, 998.0],
        "Altura amarre (m)": [9.6, 10.0, 9.6],
        "Tipo": ["R", "S", "R"],
    })
    ter = pd.DataFrame({"Abscisa": [0, 60, 120, 185, 250], "Cota": [1000, 1001.2, 1002.5, 999.0, 998.0]})
    ayuda = pd.DataFrame({"Instrucciones": [
        "Hoja 'Datos': un apoyo por fila, abscisas X crecientes (m).",
        "Coordenada en Y: cota del terreno si existe 'Altura amarre'; si no, cota del punto de amarre.",
        "Tipo: R = retención (inicia/termina sección de tendido), S = suspensión.",
        "Hoja 'Terreno' (opcional): perfil topográfico para verificar distancias de seguridad.",
        "Columna opcional 'Flecha' (m): solo para el modo 'excel'.",
    ]})
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        ej.to_excel(xw, sheet_name="Datos", index=False)
        ter.to_excel(xw, sheet_name="Terreno", index=False)
        ayuda.to_excel(xw, sheet_name="Ayuda", index=False)
    return buf.getvalue()


# ------------------------------------------------- puente para Pyodide (JSON str)
def js_calcular(payload_json: str) -> str:
    return json.dumps(calcular(json.loads(payload_json)), ensure_ascii=False)


def js_importar(contenido) -> str:
    return json.dumps(importar_excel(bytes(contenido)), ensure_ascii=False)


def js_info() -> str:
    return json.dumps(info(), ensure_ascii=False)


# ------------------------------------------------------------- RPC (servidor y navegador)
MUNICIPIOS_HUILA = [
    "Neiva", "Acevedo", "Agrado", "Aipe", "Algeciras", "Altamira", "Baraya", "Campoalegre", "Colombia",
    "Elías", "Garzón", "Gigante", "Guadalupe", "Hobo", "Íquira", "Isnos", "La Argentina", "La Plata",
    "Nátaga", "Oporapa", "Paicol", "Palermo", "Palestina", "Pital", "Pitalito", "Rivera", "Saladoblanco",
    "San Agustín", "Santa María", "Suaza", "Tarqui", "Tello", "Teruel", "Tesalia", "Timaná", "Villavieja",
    "Yaguará"]


def rpc(nombre: str, datos: dict) -> dict:
    """Despachador único de funciones del motor (lista blanca)."""
    import base64
    from . import geo, importacion
    d = datos or {}
    try:
        if nombre == "geo_sistemas":
            return {"ok": True, "sistemas": [s.a_dict() for s in geo.SISTEMAS.values()],
                    "interno": geo.INTERNO, "motor": geo.motor_activo()}
        if nombre == "municipios":
            return {"ok": True, "departamentos": {"Huila": MUNICIPIOS_HUILA},
                    "nota": "Lista del Huila. Coordenadas de referencia solo para Neiva (2.9273, -75.2819)."}
        if nombre == "geo_transformar":
            gr = None
            if d.get("georref"):
                gr = geo.georreferenciar(d["georref"]["puntos"], d["georref"].get("metodo", "helmert"))
            out = []
            for p in d.get("puntos", []):
                try:
                    out.append({"ok": True, **geo.transformar_punto(d["sistema"], p["u"], p["v"], gr)})
                except (geo.ErrorGeo, ValueError, KeyError) as e:
                    out.append({"ok": False, "error": str(e)})
            return {"ok": True, "puntos": out}
        if nombre == "geo_desde_latlon":
            out = []
            for p in d.get("puntos", []):
                E, N = geo.desde_geograficas(geo.INTERNO, float(p["lat"]), float(p["lon"]))
                out.append({"E": E, "N": N})
            return {"ok": True, "puntos": out}
        if nombre == "elevacion":
            try:
                return {"ok": True, **_elevacion_web(d.get("fuente") or "srtm", d.get("puntos") or [])}
            except Exception as e:  # sin internet, proxy, certificado, servicio caído…
                return {"ok": False, "errores": [f"No se pudo consultar la elevación: {e}"]}
        if nombre == "estructuras_excel":
            from .carga_estructuras import leer_estructuras
            try:
                return {"ok": True, **leer_estructuras(base64.b64decode(d["contenido"]), d.get("nombre", "archivo.xlsx"),
                                                       d.get("existentes") or [])}
            except ValueError as e:
                return {"ok": False, "errores": [str(e)]}
            except Exception as e:  # archivo dañado o que no es Excel
                return {"ok": False, "errores": [f"No se pudo leer el archivo: {e}"]}
        if nombre == "plantilla_estructuras":
            from .carga_estructuras import plantilla_xlsx
            return {"ok": True, "contenido": base64.b64encode(plantilla_xlsx()).decode(),
                    "nombre": "PLANTILLA_ESTRUCTURAS.xlsx"}
        if nombre == "perfil_muestras":
            pts = [(float(p["lat"]), float(p["lon"])) for p in d.get("puntos", [])]
            return {"ok": True, **geo.muestras_perfil(pts, float(d.get("paso_m") or 10), int(d.get("max_muestras") or 2000))}
        if nombre == "geo_distancia":
            a, b = d["a"], d["b"]
            return {"ok": True, "distancia_m": geo.distancia_geodesica(float(a["lat"]), float(a["lon"]),
                                                                       float(b["lat"]), float(b["lon"]))}
        if nombre == "geo_georreferenciar":
            return {"ok": True, **geo.georreferenciar(d["puntos"], d.get("metodo", "helmert")).a_dict()}
        if nombre == "importar_leer":
            tabla = importacion.leer_tabla(base64.b64decode(d["contenido"]), d.get("nombre", "archivo.xlsx"))
            return {"ok": True, "tabla": tabla, "mapeo": importacion.sugerir_mapeo(tabla["columnas"]),
                    "campos": importacion.CAMPOS}
        if nombre == "importar_previa":
            return importacion.previsualizar(d["tabla"], d.get("mapeo") or {}, d.get("sistema"),
                                             d.get("georref"), d.get("orden", "archivo"))
    except (geo.ErrorGeo, ValueError, KeyError) as e:
        return {"ok": False, "errores": [str(e)]}
    return {"ok": False, "errores": [f"Función desconocida: {nombre}"]}


def js_rpc(nombre: str, datos_json: str) -> str:
    return json.dumps(rpc(nombre, json.loads(datos_json)), ensure_ascii=False, default=str)
