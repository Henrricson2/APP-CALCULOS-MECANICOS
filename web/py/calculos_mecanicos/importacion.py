"""
Importación de postes desde Excel, CSV, KML y KMZ con mapeo de columnas,
vista previa, validación y transformación de coordenadas.

Flujo (sin efectos hasta confirmar):
  1. leer_tabla(bytes, nombre)      -> columnas + filas en texto
  2. sugerir_mapeo(columnas)         -> campo -> columna (el usuario lo ajusta)
  3. previsualizar(tabla, mapeo, sistema, georref) -> postes, errores, avisos, candidatos
  4. el cliente confirma y guarda los postes en el proyecto
"""
from __future__ import annotations

import csv
import io
import math
import re
import unicodedata
import uuid
import zipfile
from xml.etree import ElementTree as ET

import pandas as pd

from . import geo

CAMPOS = {
    "nombre": "Número / nombre del poste",
    "id": "Identificador (opcional)",
    "lat": "Latitud",
    "lon": "Longitud",
    "este": "Este / X",
    "norte": "Norte / Y",
    "z": "Cota Z (m)",
    "altura": "Altura de amarre (m)",
    "tipo": "Tipo de estructura (R/S)",
    "conductor": "Conductor asignado",
    "obs": "Observaciones",
}

_ALIAS = {
    "nombre": ["apoyo", "poste", "numero", "nro", "no.", "name", "nombre", "punto"],
    "id": ["id", "identificador", "codigo"],
    "lat": ["latitud", "lat", "latitude"],
    "lon": ["longitud", "lon", "long", "longitude", "lng"],
    "este": ["este", "east", "easting", "coordenada en x", "coord x", "x"],
    "norte": ["norte", "north", "northing", "coordenada en y", "coord y", "y"],
    "z": ["cota", "z", "elevacion", "altitud", "alt", "altitude", "h"],
    "altura": ["altura amarre", "altura de amarre", "altura"],
    "tipo": ["tipo", "estructura", "tipo estructura"],
    "conductor": ["conductor", "calibre"],
    "obs": ["observaciones", "obs", "descripcion", "description", "nota"],
}


def _norm(t) -> str:
    s = unicodedata.normalize("NFKD", str(t)).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[()\[\]_]", " ", s.lower())).strip()


def nuevo_id() -> str:
    return "P-" + uuid.uuid4().hex[:10]


# ------------------------------------------------------------------ lectura
def leer_tabla(contenido: bytes, nombre: str) -> dict:
    """Devuelve {"formato", "columnas", "filas" (lista de listas de texto), "linea" (KML)}."""
    ext = nombre.lower().rsplit(".", 1)[-1] if "." in nombre else ""
    if ext in ("kml", "kmz"):
        return _leer_kml(contenido, ext == "kmz")
    if ext == "csv" or ext == "txt":
        texto = _decodificar(contenido)
        try:
            dialecto = csv.Sniffer().sniff(texto[:4000], delimiters=",;\t|")
            sep = dialecto.delimiter
        except csv.Error:
            sep = ";" if texto.count(";") > texto.count(",") else ","
        filas = [f for f in csv.reader(io.StringIO(texto), delimiter=sep)]
        return _con_encabezado(filas, "csv")
    if ext in ("xlsx", "xlsm", "xls"):
        xls = pd.ExcelFile(io.BytesIO(contenido))
        hoja = next((h for h in xls.sheet_names if _norm(h) in ("datos", "postes", "apoyos", "hoja1")),
                    xls.sheet_names[0])
        df = pd.read_excel(xls, sheet_name=hoja, header=None, dtype=object)
        filas = [["" if (v is None or (isinstance(v, float) and math.isnan(v))) else _texto(v)
                  for v in fila] for fila in df.itertuples(index=False)]
        t = _con_encabezado(filas, "excel")
        t["hoja"] = hoja
        t["hojas"] = xls.sheet_names
        return t
    raise geo.ErrorGeo(f"Formato no soportado: .{ext}. Use Excel, CSV, KML o KMZ.")


def _texto(v) -> str:
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    return str(v)


def _decodificar(b: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            continue
    return b.decode("utf-8", "replace")


def _con_encabezado(filas: list[list[str]], formato: str) -> dict:
    filas = [f for f in filas if any(str(c).strip() for c in f)]
    if not filas:
        raise geo.ErrorGeo("El archivo no tiene datos.")
    ancho = max(len(f) for f in filas)
    filas = [list(f) + [""] * (ancho - len(f)) for f in filas]
    # encabezado = primera fila con mayoría de celdas no numéricas
    def es_num(c):
        try:
            float(str(c).replace(",", "."))
            return True
        except ValueError:
            return False
    idx = 0
    for i, f in enumerate(filas[:15]):
        no_num = sum(1 for c in f if str(c).strip() and not es_num(c))
        if no_num >= max(2, len([c for c in f if str(c).strip()]) // 2):
            idx = i
            break
    enc = [str(c).strip() or f"Columna {j + 1}" for j, c in enumerate(filas[idx])]
    if all(es_num(c) or not str(c).strip() for c in filas[idx]):  # sin encabezado
        enc = [f"Columna {j + 1}" for j in range(ancho)]
        idx = -1
    return {"formato": formato, "columnas": enc, "filas": filas[idx + 1:]}


_KML_NS = {"k": "http://www.opengis.net/kml/2.2"}


def _leer_kml(contenido: bytes, kmz: bool) -> dict:
    if kmz:
        with zipfile.ZipFile(io.BytesIO(contenido)) as z:
            nombre = next((n for n in z.namelist() if n.lower().endswith(".kml")), None)
            if not nombre:
                raise geo.ErrorGeo("El KMZ no contiene un archivo .kml.")
            contenido = z.read(nombre)
    try:
        raiz = ET.fromstring(contenido)
    except ET.ParseError as e:
        raise geo.ErrorGeo(f"KML inválido: {e}") from None
    ns = raiz.tag.split("}")[0] + "}" if raiz.tag.startswith("{") else ""
    filas, linea = [], []
    for pm in raiz.iter(f"{ns}Placemark"):
        nombre = (pm.findtext(f"{ns}name") or "").strip()
        desc = (pm.findtext(f"{ns}description") or "").strip()
        extra = {d.get("name"): (d.findtext(f"{ns}value") or "") for d in pm.iter(f"{ns}Data")}
        pt = pm.find(f".//{ns}Point/{ns}coordinates")
        if pt is not None and pt.text:
            c = pt.text.strip().split(",")
            lon, lat = c[0], c[1]
            alt = c[2] if len(c) > 2 else ""
            filas.append([nombre, extra.get("id", ""), lat, lon, extra.get("cota_z", alt if alt not in ("0", "0.0") else ""),
                          extra.get("altura", ""), extra.get("tipo", ""), extra.get("conductor", ""), desc])
        ls = pm.find(f".//{ns}LineString/{ns}coordinates")
        if ls is not None and ls.text and not linea:
            for tok in ls.text.split():
                c = tok.split(",")
                if len(c) >= 2:
                    linea.append((float(c[1]), float(c[0])))
    if not filas:
        raise geo.ErrorGeo("El KML no contiene puntos (Placemark con Point).")
    return {"formato": "kml", "columnas": ["Nombre", "id", "Latitud", "Longitud", "Cota", "Altura amarre",
                                           "Tipo", "Conductor", "Descripcion"],
            "filas": filas, "linea": linea, "sistema_declarado": "WGS84"}


# ------------------------------------------------------------------ mapeo
def sugerir_mapeo(columnas: list[str]) -> dict:
    norm = [_norm(c) for c in columnas]
    mapa, usadas = {}, set()
    for exacto in (True, False):
        for campo, alias in _ALIAS.items():
            if campo in mapa:
                continue
            for al in alias:
                for i, h in enumerate(norm):
                    if i in usadas:
                        continue
                    ok = h == al if exacto else (al in h.split() or (len(al) > 3 and al in h))
                    if campo in ("nombre",) and "altura" in h:
                        ok = False
                    if campo == "altura" and "amarre" not in h and not exacto:
                        ok = False
                    if ok:
                        mapa[campo] = columnas[i]
                        usadas.add(i)
                        break
                if campo in mapa:
                    break
    return mapa


# ------------------------------------------------------------------ vista previa
def _num(t):
    if t is None:
        return None
    s = str(t).strip().replace(" ", "")
    if s == "":
        return None
    if s.count(",") == 1 and s.count(".") == 0:
        s = s.replace(",", ".")
    elif s.count(",") >= 1 and s.count(".") == 1 and s.index(",") < s.index("."):
        s = s.replace(",", "")  # 1,234.5
    try:
        v = float(s)
    except ValueError:
        return "ERR"
    return v if math.isfinite(v) else "ERR"


def previsualizar(tabla: dict, mapeo: dict, sistema: str | None,
                  georref: dict | None = None, orden: str = "archivo") -> dict:
    """Interpreta las filas y transforma coordenadas. No guarda nada."""
    cols = tabla["columnas"]
    idx = {campo: cols.index(c) for campo, c in mapeo.items() if c in cols}
    errores, avisos = [], []
    s = geo.SISTEMAS.get(sistema) if sistema else None
    usa_geo = "lat" in idx and "lon" in idx
    usa_proy = "este" in idx and "norte" in idx
    if not (usa_geo or usa_proy):
        return {"ok": False, "errores": ["Asigne las columnas de coordenadas (Latitud y Longitud, o Este y Norte)."],
                "postes": [], "avisos": [], "candidatos": []}

    def celda(f, campo):
        return f[idx[campo]] if campo in idx and idx[campo] < len(f) else ""

    # candidatos de sistema (ayuda, nunca decisión)
    muestra = []
    for f in tabla["filas"][:200]:
        a, b = (celda(f, "lat"), celda(f, "lon")) if usa_geo else (celda(f, "este"), celda(f, "norte"))
        try:
            ua = geo.leer_angulo(a, "lat") if usa_geo else _num(a)
            ub = geo.leer_angulo(b, "lon") if usa_geo else _num(b)
        except geo.ErrorGeo:
            continue
        if isinstance(ua, float) and isinstance(ub, float):
            muestra.append((ua, ub))
    candidatos = geo.detectar_sistema(muestra) if muestra else []
    if s is None:
        return {"ok": False, "errores": ["Seleccione el sistema de coordenadas de los datos."],
                "candidatos": candidatos, "postes": [], "avisos": []}
    if s.tipo == "geografico" and not usa_geo:
        errores.append("El sistema elegido es geográfico pero no se asignaron Latitud y Longitud.")
    if s.tipo != "geografico" and not usa_proy:
        errores.append("El sistema elegido es proyectado/local pero no se asignaron Este y Norte.")
    gr = None
    if s.tipo == "local":
        if not georref or not georref.get("puntos"):
            errores.append("Coordenadas locales: agregue puntos de control para georreferenciar.")
        else:
            try:
                gr = geo.georreferenciar(georref["puntos"], georref.get("metodo", "helmert"))
                tol = float(georref.get("tolerancia_m", 0.10))
                if gr.rms_m > tol:
                    errores.append(f"Georreferenciación: error RMS {gr.rms_m:.3f} m supera la tolerancia "
                                   f"de {tol:.3f} m. Revise los puntos de control.")
            except geo.ErrorGeo as e:
                errores.append(str(e))
    if errores:
        return {"ok": False, "errores": errores, "candidatos": candidatos, "postes": [], "avisos": avisos,
                "georref": gr.a_dict() if gr else None}

    postes = []
    for k, f in enumerate(tabla["filas"]):
        fila_n = k + 1
        nombre = str(celda(f, "nombre")).strip()
        u, v = (celda(f, "lat"), celda(f, "lon")) if s.tipo == "geografico" else (celda(f, "este"), celda(f, "norte"))
        if not str(u).strip() and not str(v).strip():
            continue
        p = {"id": str(celda(f, "id")).strip() or nuevo_id(), "nombre": nombre or f"P{fila_n:03d}",
             "fila": fila_n, "orig": {"sistema": s.codigo, "u": str(u), "v": str(v)}, "errores": []}
        try:
            if s.tipo == "geografico":
                t = geo.transformar_punto(s.codigo, u, v)
            else:
                nu, nv = _num(u), _num(v)
                if not isinstance(nu, float) or not isinstance(nv, float):
                    raise geo.ErrorGeo("coordenada no numérica")
                t = geo.transformar_punto(s.codigo, nu, nv, gr)
            if not (geo.COLOMBIA["lat"][0] <= t["lat"] <= geo.COLOMBIA["lat"][1]
                    and geo.COLOMBIA["lon"][0] <= t["lon"] <= geo.COLOMBIA["lon"][1]):
                p["errores"].append("queda fuera de Colombia: revise el sistema o el orden de los ejes")
            p.update({"lat": round(t["lat"], 9), "lon": round(t["lon"], 9),
                      "E": round(t["E"], 4), "N": round(t["N"], 4)})
        except (geo.ErrorGeo, ValueError, OverflowError) as e:
            p["errores"].append(f"coordenadas inválidas ({e})")
        z = _num(celda(f, "z"))
        if z == "ERR":
            p["errores"].append("cota Z no numérica")
            z = None
        p["z"] = z                                   # None = sin dato (≠ 0)
        p["z_fuente"] = "archivo" if z is not None else None
        alt = _num(celda(f, "altura"))
        p["altura"] = alt if isinstance(alt, float) else None
        tipo = _norm(celda(f, "tipo"))
        p["tipo"] = "R" if tipo.startswith(("r", "t", "f", "anc", "ang")) or "reten" in tipo else "S"
        p["conductor"] = str(celda(f, "conductor")).strip() or None
        p["obs"] = str(celda(f, "obs")).strip() or None
        p["bloqueado"] = False
        postes.append(p)

    # orden de los postes
    if orden == "linea_kml" and tabla.get("linea"):
        postes = _ordenar_por_linea(postes, tabla["linea"])
        avisos.append("Postes ordenados según la línea (LineString) del KML.")
    elif orden == "nombre":
        postes.sort(key=lambda p: _clave_natural(p["nombre"]))
        avisos.append("Postes ordenados por nombre (orden natural). Verifique la secuencia en el mapa.")
    else:
        avisos.append("Postes en el orden del archivo. Verifique la secuencia en el mapa antes de calcular.")

    # duplicados y vanos anómalos
    ids = {}
    for p in postes:
        if p["id"] in ids:
            p["errores"].append(f"identificador repetido con la fila {ids[p['id']]}")
        ids.setdefault(p["id"], p["fila"])
    validos = [p for p in postes if "lat" in p and not p["errores"]]
    for a, b in zip(validos[:-1], validos[1:]):
        d = geo.distancia_geodesica(a["lat"], a["lon"], b["lat"], b["lon"])
        b["vano_previo_m"] = round(d, 2)
        if d < 0.5:
            b["errores"].append(f"coincide con {a['nombre']} (a {d:.2f} m): posible duplicado")
        elif d > 600:
            avisos.append(f"Vano {a['nombre']}→{b['nombre']} de {d:.0f} m: verifique el orden o la coordenada.")
    sin_z = sum(1 for p in postes if p["z"] is None)
    if sin_z:
        avisos.append(f"{sin_z} poste(s) sin cota Z: el perfil quedará incompleto hasta agregarla "
                      "(topografía o modelo de elevación).")
    n_err = sum(1 for p in postes if p["errores"])
    return {"ok": n_err == 0, "postes": postes, "errores": [f"{n_err} fila(s) con errores; corríjalas o exclúyalas."] if n_err else [],
            "avisos": avisos, "candidatos": candidatos, "sistema": s.a_dict(),
            "georref": gr.a_dict() if gr else None, "motor_geo": geo.motor_activo()}


def _clave_natural(t):
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r"(\d+)", str(t))]


def _ordenar_por_linea(postes, linea):
    acum = geo.abscisas(linea)

    def posicion(p):
        if "lat" not in p:
            return float("inf")
        mejor, pos = float("inf"), 0.0
        for (la, lo), s in zip(linea, acum):
            d = geo.distancia_geodesica(p["lat"], p["lon"], la, lo)
            if d < mejor:
                mejor, pos = d, s
        return pos
    return sorted(postes, key=posicion)
