"""
Lectura y validación del archivo de datos (Excel).

Formato compatible con el DATOS.xlsx original (primera hoja):

    Apoyo | Coordenada en X | Coordenada en Y | Vano | Flecha

Columnas OPCIONALES nuevas (cualquier orden; se reconocen por nombre):
    Altura amarre (m)  -> altura del conductor sobre el terreno en el apoyo.
                          Si existe, "Coordenada en Y" se interpreta como COTA DEL TERRENO.
    Tipo               -> R/RET/T/FIN/ANCLAJE = retención (corta la sección de tendido),
                          S/SUS = suspensión. Primer y último apoyo siempre son retención.

Hojas OPCIONALES:
    Terreno      -> perfil topográfico (Abscisa, Cota) para verificar distancias reales.
    Tensionados  -> si trae la fila de "Calibre", se leen las características del conductor.

Mejoras frente al original: las columnas se ubican por NOMBRE (no por posición
fija), no se asume que las flechas empiezan en la fila 3, y se valida todo antes
de calcular, devolviendo mensajes claros en vez de excepciones crípticas.
"""
from __future__ import annotations

import math
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from .config import Conductor, Criterios


def _norm(txt) -> str:
    s = unicodedata.normalize("NFKD", str(txt)).encode("ascii", "ignore").decode()
    return " ".join(s.lower().replace("\n", " ").split())


# alias de columnas (texto normalizado contiene ...)
_ALIAS = {
    "apoyo": [("apoyo",), ("poste",), ("estructura n",), ("nombre",)],
    "x": [("coordenada en x",), ("coord x",), ("abscisa",), ("x",)],
    "y": [("coordenada en y",), ("coord y",), ("cota",), ("elevacion",), ("y",)],
    "vano": [("vano",)],
    "flecha": [("flecha",)],
    "altura": [("altura",)],
    "tipo": [("tipo",), ("funcion",)],
}


def _mapear_columnas(encabezados: list[str]) -> dict[str, int]:
    norm = [_norm(h) for h in encabezados]
    usado: set[int] = set()
    mapa: dict[str, int] = {}
    # primero coincidencias exactas, luego "contiene"
    for exacto in (True, False):
        for clave, alias in _ALIAS.items():
            if clave in mapa:
                continue
            for (patron,) in alias:
                for i, h in enumerate(norm):
                    if i in usado or not h:
                        continue
                    ok = (h == patron) if exacto else (patron in h.split() or
                                                       (len(patron) > 2 and patron in h))
                    if clave == "apoyo" and "altura" in h:
                        ok = False
                    if ok:
                        mapa[clave] = i
                        usado.add(i)
                        break
                if clave in mapa:
                    break
    return mapa


def _es_retencion(valor) -> bool:
    if valor is None or (isinstance(valor, float) and math.isnan(valor)):
        return False
    s = _norm(valor)
    return s.startswith(("r", "t", "f", "anc", "ang")) or "reten" in s or "termin" in s


@dataclass
class DatosLinea:
    archivo: str
    apoyos: pd.DataFrame                       # nombre, x, y, altura, retencion
    flechas_excel: list[float] | None = None   # una por vano (si existen)
    vanos_excel: list[float] | None = None
    conductor: Conductor | None = None
    terreno: pd.DataFrame | None = None        # columnas x, cota
    y_es_terreno: bool = False
    advertencias: list[str] = field(default_factory=list)
    errores: list[str] = field(default_factory=list)
    deflexiones: list | None = None              # ángulo en cada apoyo (si hay coordenadas)
    geo: list | None = None                      # (lat, lon) por apoyo

    @property
    def n_apoyos(self) -> int:
        return len(self.apoyos)

    @property
    def n_vanos(self) -> int:
        return max(0, len(self.apoyos) - 1)

    @property
    def ok(self) -> bool:
        return not self.errores


# ---------------------------------------------------------------------------
def _leer_conductor(xls: pd.ExcelFile) -> Conductor | None:
    hoja = next((h for h in xls.sheet_names if "tension" in _norm(h)), None)
    if hoja is None:
        return None
    df = pd.read_excel(xls, sheet_name=hoja, header=None, nrows=40)
    for i in range(len(df) - 1):
        if _norm(df.iat[i, 0]) == "calibre":
            v = df.iloc[i + 1, :7].tolist()
            try:
                return Conductor(nombre=str(v[0]), seccion_mm2=float(v[1]),
                                 carga_rotura_kgf=float(v[2]), peso_kgf_m=float(v[3]),
                                 modulo_elasticidad=float(v[4]), coef_dilatacion=float(v[5]),
                                 diametro_mm=float(v[6]))
            except (TypeError, ValueError):
                return None
    return None


def _leer_terreno(xls: pd.ExcelFile) -> pd.DataFrame | None:
    hoja = next((h for h in xls.sheet_names if "terreno" in _norm(h) or "perfil" in _norm(h)), None)
    if hoja is None:
        return None
    df = pd.read_excel(xls, sheet_name=hoja)
    m = _mapear_columnas(list(df.columns))
    if "x" not in m or "y" not in m:
        return None
    t = pd.DataFrame({"x": pd.to_numeric(df.iloc[:, m["x"]], errors="coerce"),
                      "cota": pd.to_numeric(df.iloc[:, m["y"]], errors="coerce")}).dropna()
    return t.sort_values("x").reset_index(drop=True) if len(t) >= 2 else None


def _leer_tablas_excel(fuente, nombre: str):
    """Lee el Excel y devuelve (filas, terreno, conductor, errores).

    `filas` es una lista de dicts {nombre, x, y, altura, tipo, vano, flecha, fila_excel}.
    """
    try:
        xls = pd.ExcelFile(fuente)
    except Exception as e:  # archivo abierto, dañado, formato errado
        return None, None, None, [f"No se pudo abrir el Excel ({e}). ¿Está abierto en Excel?"]

    hoja = next((h for h in xls.sheet_names if _norm(h) in ("datos", "hoja1", "apoyos")),
                xls.sheet_names[0])
    crudo = pd.read_excel(xls, sheet_name=hoja, header=None)
    if crudo.empty:
        return None, None, None, [f"La hoja '{hoja}' está vacía."]
    fila_enc = next((i for i in range(min(20, len(crudo)))
                     if any("apoyo" in _norm(v) for v in crudo.iloc[i].tolist())), 0)
    enc = [str(v) for v in crudo.iloc[fila_enc].tolist()]
    m = _mapear_columnas(enc)
    faltan = [c for c in ("apoyo", "x", "y") if c not in m]
    if faltan:
        return None, None, None, [f"Hoja '{hoja}': no se encontraron las columnas {faltan}. "
                                  f"Encabezados leídos: {enc}"]
    cuerpo = crudo.iloc[fila_enc + 1:].reset_index(drop=True)
    filas = []
    for i in range(len(cuerpo)):
        fila = {k: cuerpo.iat[i, j] for k, j in m.items()}
        fila = {k: (None if (isinstance(v, float) and math.isnan(v)) else v) for k, v in fila.items()}
        if fila.get("x") is None and fila.get("y") is None and fila.get("apoyo") is None:
            break
        fila["nombre"] = fila.pop("apoyo", None)
        fila["fila_excel"] = fila_enc + i + 2
        filas.append(fila)
    return filas, _leer_terreno(xls), _leer_conductor(xls), []


def leer_datos(ruta, criterios: Criterios | None = None) -> DatosLinea:
    """Lee un Excel desde una ruta, bytes o un objeto tipo archivo."""
    if isinstance(ruta, (bytes, bytearray)):
        import io
        fuente, nombre = io.BytesIO(ruta), "archivo.xlsx"
    elif hasattr(ruta, "read"):
        fuente, nombre = ruta, getattr(ruta, "name", "archivo.xlsx")
    else:
        fuente = nombre = str(ruta)
        if not Path(fuente).exists():
            return DatosLinea(nombre, pd.DataFrame(), errores=[f"No existe el archivo: {ruta}"])
    filas, terreno, conductor, err = _leer_tablas_excel(fuente, nombre)
    if err:
        return DatosLinea(nombre, pd.DataFrame(), errores=err)
    return construir_datos(filas, terreno, conductor, criterios, nombre)


def _num(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip().replace(",", ".")
        if v == "":
            return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return "ERR"
    return None if math.isnan(f) else f


def construir_datos(filas: list[dict], terreno=None, conductor: Conductor | None = None,
                    criterios: Criterios | None = None, origen: str = "datos") -> DatosLinea:
    """Construye y valida los datos de la línea a partir de filas (Excel, web o JSON).

    filas: [{nombre, x, y, altura?, tipo?, vano?, flecha?, fila_excel?}, ...]
    terreno: DataFrame (x, cota) o lista de {x, cota}.
    """
    criterios = criterios or Criterios()
    adv: list[str] = []
    err: list[str] = []
    if terreno is not None and not isinstance(terreno, pd.DataFrame):
        t = pd.DataFrame(list(terreno))
        if len(t) and {"x", "cota"} <= set(t.columns):
            t = t[["x", "cota"]].apply(pd.to_numeric, errors="coerce").dropna()
            terreno = t.sort_values("x").reset_index(drop=True) if len(t) >= 2 else None
        else:
            terreno = None

    validas = []
    for k, f in enumerate(filas):
        ref = f"Fila {f.get('fila_excel', k + 1)}"
        x, y = _num(f.get("x")), _num(f.get("y"))
        nombre = f.get("nombre")
        if x is None and y is None and (nombre in (None, "")):
            continue
        if x in (None, "ERR") or y in (None, "ERR"):
            err.append(f"{ref}: apoyo '{nombre or ''}' sin coordenada X o Y válida.")
            continue
        alt = _num(f.get("altura"))
        if alt == "ERR":
            err.append(f"{ref}: altura de amarre no numérica.")
            alt = None
        validas.append({
            "nombre": str(nombre) if nombre not in (None, "") else f"AP{len(validas) + 1:03d}",
            "x": x, "y": y, "altura": np.nan if alt is None else alt,
            "retencion": _es_retencion(f.get("tipo")),
            "fila_excel": f.get("fila_excel", k + 1),
            "_vano": _num(f.get("vano")), "_flecha": _num(f.get("flecha")),
        })
    ap = pd.DataFrame(validas, columns=["nombre", "x", "y", "altura", "retencion", "fila_excel",
                                        "_vano", "_flecha"])

    # ----------------------------------------------------------- validaciones
    if len(ap) < 2:
        err.append("Se requieren al menos 2 apoyos con coordenadas.")
    if len(ap):
        ap.loc[0, "retencion"] = True
        ap.loc[len(ap) - 1, "retencion"] = True
        dup = ap["nombre"][ap["nombre"].duplicated()].tolist()
        if dup:
            adv.append(f"Nombres de apoyo repetidos: {sorted(set(dup))}.")
        dx = np.diff(ap["x"].to_numpy(dtype=float))
        for j in np.where(dx <= 0)[0]:
            err.append(f"X no creciente entre {ap.nombre[j]} (x={ap.x[j]}) y "
                       f"{ap.nombre[j + 1]} (x={ap.x[j + 1]}). Las abscisas deben ser crecientes.")
        for j, a in enumerate(dx):
            if a <= 0:
                continue
            if a < criterios.vano_min_alerta_m:
                adv.append(f"Vano {j + 1} ({ap.nombre[j]}→{ap.nombre[j + 1]}) muy corto: {a:.1f} m.")
            if a > criterios.vano_max_alerta_m:
                adv.append(f"Vano {j + 1} ({ap.nombre[j]}→{ap.nombre[j + 1]}) muy largo: {a:.1f} m.")
            dy = ap.y[j + 1] - ap.y[j]
            if abs(dy) / a > criterios.pendiente_max_alerta:
                adv.append(f"Vano {j + 1} ({ap.nombre[j]}→{ap.nombre[j + 1]}): desnivel "
                           f"{dy:+.1f} m en {a:.1f} m ({100 * abs(dy) / a:.0f} %). "
                           "Verifique la cota (posible error de digitación).")
        yy = ap["y"].to_numpy(dtype=float)
        for j in range(1, len(yy) - 1):
            d1, d2 = yy[j] - yy[j - 1], yy[j] - yy[j + 1]
            if d1 * d2 > 0 and min(abs(d1), abs(d2)) > 15:
                adv.append(f"Apoyo {ap.nombre[j]}: cota {yy[j]:g} se aparta >15 m de ambos vecinos "
                           f"({yy[j - 1]:g}, {yy[j + 1]:g}). Revise el dato.")

    # columnas de vano/flecha (modo legado)
    flechas = vanos = None
    if len(ap) > 1:
        fl = ap["_flecha"].iloc[1:].tolist()
        if any(v is not None and not pd.isna(v) for v in fl):
            if any(v is None or pd.isna(v) or v == "ERR" for v in fl):
                adv.append("La columna 'Flecha' tiene celdas vacías o con fórmulas sin calcular "
                           "(abra y guarde el Excel en Excel). El modo 'excel' no estará disponible.")
            else:
                flechas = [float(v) for v in fl]
        vn = ap["_vano"].iloc[1:].tolist()
        if any(v is not None and not pd.isna(v) for v in vn):
            vanos = [float(v) if v not in (None, "ERR") else np.nan for v in vn]
            dxx = np.diff(ap["x"].to_numpy(dtype=float))
            for j, (v, d) in enumerate(zip(vanos, dxx)):
                if not pd.isna(v) and abs(v - d) > 0.5:
                    adv.append(f"Vano {j + 1}: columna 'Vano' = {v:g} m pero ΔX = {d:.2f} m. "
                               "Se usa ΔX.")
    ap = ap.drop(columns=["_vano", "_flecha"])

    # interpretación de la cota Y
    y_es_terreno = False
    if ap["altura"].notna().any() or criterios.altura_amarre_defecto_m is not None:
        y_es_terreno = True
        if ap["altura"].isna().any():
            if criterios.altura_amarre_defecto_m is None:
                err.append("Hay apoyos sin 'Altura amarre' y no se definió una altura por defecto.")
            else:
                ap["altura"] = ap["altura"].fillna(criterios.altura_amarre_defecto_m)
    else:
        ap["altura"] = 0.0
        adv.append("No hay columna 'Altura amarre': se asume que 'Coordenada en Y' es la cota "
                   "del PUNTO DE AMARRE del conductor (como el programa original). Sin la cota "
                   "del terreno no se puede verificar la distancia mínima a tierra.")
    ap["altura"] = ap["altura"].astype(float)
    ap["x"] = ap["x"].astype(float)
    ap["y"] = ap["y"].astype(float)
    ap["retencion"] = ap["retencion"].astype(bool)

    return DatosLinea(origen, ap, flechas, vanos, conductor, terreno, y_es_terreno, adv, err)
