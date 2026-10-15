"""
Carga masiva de estructuras desde Excel (o CSV): columnas Name, Latitud, Longitud.

- Orden por defecto: 1.ª Name, 2.ª Latitud, 3.ª Longitud. Si la fila de encabezados nombra las
  columnas (Latitud/Lat, Longitud/Lon/Long), se respeta lo que diga el encabezado.
- Name vacío → se asigna un nombre automático (AP-001, AP-002, …) sin repetir los existentes.
- Validaciones por fila: latitud y longitud numéricas (decimal con punto o coma, o GMS),
  dentro de rango (−90…90 / −180…180) y dentro de Colombia (aviso si quedan por fuera);
  columnas invertidas (latitud ≈ −75, longitud ≈ 3) se detectan y se corrigen con aviso;
  nombres repetidos y coordenadas duplicadas se informan.
"""
from __future__ import annotations

import csv
import io
import math
import re
import unicodedata

from . import geo

# Rango de Colombia continental e insular (con margen) para el aviso «fuera de Colombia»
COLOMBIA = {"lat": (-4.6, 13.6), "lon": (-82.0, -66.6)}


def _norm(t) -> str:
    s = unicodedata.normalize("NFKD", str(t)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _texto(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        if math.isnan(v):
            return ""
        return repr(v)
    return str(v).strip()


def _leer_filas(contenido: bytes, nombre: str) -> list[list[str]]:
    ext = nombre.lower().rsplit(".", 1)[-1] if "." in nombre else ""
    if ext in ("xlsx", "xlsm", "xls"):
        import pandas as pd
        xls = pd.ExcelFile(io.BytesIO(contenido))
        df = pd.read_excel(xls, sheet_name=xls.sheet_names[0], header=None, dtype=object)
        return [[_texto(v) for v in fila] for fila in df.itertuples(index=False)]
    if ext in ("csv", "txt"):
        for enc in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                texto = contenido.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        try:
            sep = csv.Sniffer().sniff(texto[:4000], delimiters=",;\t|").delimiter
        except csv.Error:
            sep = ";" if texto.count(";") > texto.count(",") else ","
        return [[c.strip() for c in f] for f in csv.reader(io.StringIO(texto), delimiter=sep)]
    raise ValueError(f"Formato no soportado (.{ext}). Use un archivo Excel (.xlsx) o CSV.")


def _numero(txt: str, eje: str):
    """Ángulo en decimal (punto o coma) o GMS. Devuelve float o lanza ValueError."""
    t = str(txt).strip()
    if not t:
        raise ValueError("vacía")
    try:
        return float(t.replace(",", "."))
    except ValueError:
        pass
    try:
        return float(geo.leer_angulo(t, eje))
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"«{t}» no es un número válido") from e


def _es_num(t: str) -> bool:
    try:
        _numero(t, "lat")
        return True
    except ValueError:
        return False


def leer_estructuras(contenido: bytes, nombre: str, existentes: list[str] | None = None) -> dict:
    filas = [f for f in _leer_filas(contenido, nombre) if any(str(c).strip() for c in f)]
    if not filas:
        raise ValueError("El archivo está vacío.")
    ancho = max(len(f) for f in filas)
    if ancho < 3:
        raise ValueError("El archivo debe tener tres columnas: Name, Latitud y Longitud "
                         f"(se encontraron {ancho}).")
    filas = [list(f) + [""] * (ancho - len(f)) for f in filas]

    # encabezado: primera fila cuyas columnas 2 y 3 no son números
    col = {"nombre": 0, "lat": 1, "lon": 2}
    encabezado = None
    if not (_es_num(filas[0][1]) or _es_num(filas[0][2])):
        encabezado = [str(c).strip() for c in filas[0]]
        n = [_norm(c) for c in encabezado]
        for j, h in enumerate(n):
            if h in ("lat", "latitud", "latitude", "y lat") or h.startswith("latitud"):
                col["lat"] = j
            elif h in ("lon", "long", "lng", "longitud", "longitude") or h.startswith("longitud"):
                col["lon"] = j
            elif h in ("name", "nombre", "estructura", "poste", "apoyo", "id"):
                col["nombre"] = j
        filas = filas[1:]
        if col["lat"] == col["lon"]:
            raise ValueError("El encabezado no permite distinguir Latitud de Longitud.")
    if not filas:
        raise ValueError("El archivo solo tiene encabezados, sin estructuras.")

    usados = set(str(x) for x in (existentes or []))
    def auto_nombre():
        k = 1
        while f"AP-{k:03d}" in usados:
            k += 1
        n = f"AP-{k:03d}"
        usados.add(n)
        return n

    out, vistos, coords = [], {}, {}
    fila0 = 2 if encabezado else 1
    for k, f in enumerate(filas):
        r = {"fila": fila0 + k, "nombre": str(f[col["nombre"]]).strip(), "lat": None, "lon": None,
             "errores": [], "avisos": [], "nombre_auto": False}
        try:
            r["lat"] = _numero(f[col["lat"]], "lat")
        except ValueError as e:
            r["errores"].append(f"Latitud {e}")
        try:
            r["lon"] = _numero(f[col["lon"]], "lon")
        except ValueError as e:
            r["errores"].append(f"Longitud {e}")
        la, lo = r["lat"], r["lon"]
        if la is not None and lo is not None:
            # columnas invertidas: «latitud» con valor de longitud de Colombia y viceversa
            if (COLOMBIA["lon"][0] <= la <= COLOMBIA["lon"][1] and COLOMBIA["lat"][0] <= lo <= COLOMBIA["lat"][1]):
                r["lat"], r["lon"] = lo, la
                la, lo = lo, la
                r["avisos"].append("Latitud y longitud venían invertidas: se corrigieron.")
            if not (-90 <= la <= 90):
                r["errores"].append(f"Latitud {la:g} fuera de rango (−90 a 90).")
            if not (-180 <= lo <= 180):
                r["errores"].append(f"Longitud {lo:g} fuera de rango (−180 a 180).")
            if not r["errores"] and not (COLOMBIA["lat"][0] <= la <= COLOMBIA["lat"][1]
                                         and COLOMBIA["lon"][0] <= lo <= COLOMBIA["lon"][1]):
                r["errores"].append(f"Coordenada ({la:.6f}, {lo:.6f}) fuera de Colombia. "
                                    "Verifique el signo (en Colombia la longitud es negativa).")
        if not r["nombre"]:
            r["nombre"] = auto_nombre()
            r["nombre_auto"] = True
            r["avisos"].append(f"Sin nombre: se asignó «{r['nombre']}».")
        elif r["nombre"] in usados:
            r["errores"].append(f"El nombre «{r['nombre']}» ya existe" +
                                (" en el archivo." if r["nombre"] in vistos else " en el proyecto."))
        else:
            usados.add(r["nombre"])
        vistos[r["nombre"]] = r["fila"]
        if not r["errores"]:
            clave = (round(r["lat"], 7), round(r["lon"], 7))
            if clave in coords:
                r["avisos"].append(f"Misma coordenada que la fila {coords[clave]}.")
            coords[clave] = r["fila"]
        out.append(r)

    validas = [r for r in out if not r["errores"]]
    return {
        "encabezado": encabezado,
        "columnas_usadas": {k: (encabezado[v] if encabezado else f"Columna {v + 1}") for k, v in col.items()},
        "filas": out,
        "validas": len(validas),
        "con_error": len(out) - len(validas),
        "filas_con_error": [r["fila"] for r in out if r["errores"]],
    }


def plantilla_xlsx() -> bytes:
    """Plantilla de ejemplo con las tres columnas."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.title = "Estructuras"
    ws.append(["Name", "Latitud", "Longitud"])
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="17324D")
    ws.append(["AP-001", 2.927300, -75.281900])
    ws.append(["AP-002", 2.928100, -75.281200])
    ws.append(["", 2.929000, -75.280500])
    ws.column_dimensions["A"].width = 16
    ws.column_dimensions["B"].width = 14
    ws.column_dimensions["C"].width = 14
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
