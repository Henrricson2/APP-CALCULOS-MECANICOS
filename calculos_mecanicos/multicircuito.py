"""
Varios circuitos en las mismas estructuras (p. ej. un poste de 14 m con dos circuitos de 34,5 kV
y dos de 13,8 kV).

  * El CIRCUITO PRINCIPAL es el de «Conductor» y «Criterios» y recorre toda la línea.
  * Cada CIRCUITO ADICIONAL ocupa un tramo (desde–hasta) con su propio conductor, tensión,
    número de fases y altura de montaje (amarre `bajo_cima_m` metros bajo la cima del poste).
  * Cada circuito se plantilla por separado (secciones de tendido entre retenciones, vano
    regulador, cambio de estado, catenarias, distancia al terreno, gravivano). Los extremos de
    su tramo son retenciones (terminales) para ese circuito.
  * Separación entre circuitos en cada vano compartido: distancia vertical mínima, en todo el
    vano, entre el circuito de arriba con su flecha MÁXIMA (hipótesis de plantillado, 50 °C) y
    el de abajo a la temperatura media sin viento (EDS, 20 °C) — criterio del tipo NESC 235C —,
    contra  separacion_vano_factor × separacion_min_circuitos_m  (75 %, NESC 235C2b); en los apoyos se
    exige la separación mínima completa. Detecta también circuitos que se cruzan en el vano
    por tener flechas distintas.
  * Las cargas de todos los circuitos se suman en la verificación del poste y los templetes
    (ver estructuras.py): cada circuito aporta su tiro y su viento a SU altura de amarre.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .cambio_estado import ErrorCalculo
from .config import Circuito, Proyecto
from .datos import DatosLinea


@dataclass
class ResultadoCircuito:
    circuito: Circuito
    i0: int                     # primera estructura (índice en la línea completa)
    i1: int                     # última estructura
    alturas: list[float]        # altura de amarre sobre el terreno en cada estructura del tramo
    res: object                 # ResultadoPlantillado del tramo (índices locales)
    advertencias: list[str] = field(default_factory=list)

    @property
    def nombre(self) -> str:
        return self.circuito.nombre


def _f(v):
    from .estructuras import _f as f
    return f(v)


def _indice(nombres: list[str], valor: str, defecto: int, circuito: str, campo: str) -> int:
    if valor in (None, ""):
        return defecto
    v = str(valor).strip()
    for i, n in enumerate(nombres):
        if str(n).strip() == v:
            return i
    raise ErrorCalculo(f"{circuito}: la estructura «{v}» ({campo}) no existe en la línea.")


def altura_circuito(i: int, c: Circuito, datos: DatosLinea, crit) -> float:
    """Altura de amarre del circuito sobre el terreno en la estructura i (índice global)."""
    from .estructuras import empotramiento
    est = (datos.estructuras or [None] * datos.n_apoyos)[i] or {}
    L = _f(est.get("poste_altura"))
    if L:
        return L - empotramiento(L, crit) - float(c.bajo_cima_m)
    # sin altura de poste: se baja desde el amarre del circuito principal
    return float(datos.apoyos["altura"][i]) - (float(c.bajo_cima_m) - float(crit.amarre_bajo_cima_m))


def calcular_circuitos(datos: DatosLinea, proyecto: Proyecto) -> list[ResultadoCircuito]:
    from .plantillado import calcular_plantillado
    nombres = [str(n) for n in datos.apoyos["nombre"]]
    n_ap = len(nombres)
    out = []
    for k, c in enumerate(proyecto.circuitos, start=2):
        if not c.activo:
            continue
        nom = c.nombre or f"Circuito {k}"
        i0 = _indice(nombres, c.desde, 0, nom, "desde")
        i1 = _indice(nombres, c.hasta, n_ap - 1, nom, "hasta")
        if i0 > i1:
            i0, i1 = i1, i0
        if i1 - i0 < 1:
            raise ErrorCalculo(f"{nom}: el tramo debe tener al menos un vano (desde {nombres[i0]} hasta {nombres[i1]}).")
        alturas = [altura_circuito(i, c, datos, proyecto.criterios) for i in range(i0, i1 + 1)]
        bajas = [nombres[i0 + j] for j, h in enumerate(alturas) if h <= 0.5] if datos.y_es_terreno else []
        if bajas:
            raise ErrorCalculo(f"{nom}: el amarre queda a ras del terreno o por debajo en {', '.join(bajas[:5])}. "
                               "Revise la altura del poste o la distancia del amarre bajo la cima.")
        ap = datos.apoyos.iloc[i0:i1 + 1].reset_index(drop=True).copy()
        ap["altura"] = np.array(alturas, dtype=float)
        ap.loc[0, "retencion"] = True
        ap.loc[len(ap) - 1, "retencion"] = True
        sub = DatosLinea(datos.archivo, ap, None, None, None, datos.terreno, datos.y_es_terreno)
        if datos.deflexiones:
            sub.deflexiones = list(datos.deflexiones[i0:i1 + 1])
        p = copy.deepcopy(proyecto)
        p.circuitos = []
        p.conductor = copy.deepcopy(c.conductor)
        p.criterios.tension_kv = c.tension_kv
        p.criterios.n_fases = int(c.n_fases)
        p.criterios.long_cadena_aisladores_m = c.long_cadena_aisladores_m
        if p.modo_flecha != "cambio_estado":  # las flechas del Excel son del circuito principal
            p.modo_flecha = "cambio_estado"
        try:
            r = calcular_plantillado(sub, p)
        except ErrorCalculo as e:
            raise ErrorCalculo(f"{nom}: {e}") from e
        # numeración global de vanos para que coincida con la línea completa
        r.vanos["Vano"] = r.vanos["Vano"] + i0
        adv = [f"[{nom}] {a}" for a in r.advertencias if not a.startswith("No se indicó 'Tipo'")]
        out.append(ResultadoCircuito(c, i0, i1, alturas, r, adv))
    return out


def _catenarias_en(r, clave: str):
    """Catenarias de un resultado en la hipótesis `clave` (si no hay cambio de estado: las frías)."""
    from .catenaria import catenaria_por_parametro
    out = []
    for k, c in enumerate(r.catenarias):
        s_ = next((s_ for s_ in r.secciones if s_.i_ini <= k < s_.i_fin), None)
        if s_ is not None and s_.estado is not None and clave in s_.estado.tensiones:
            out.append(catenaria_por_parametro(c.x1, c.y1, c.x2, c.y2, s_.estado.parametro(clave)))
        else:
            out.append(r.catenarias_frias[k])
    return out


def separaciones(res, circuitos: list[ResultadoCircuito]) -> pd.DataFrame | None:
    """Distancia vertical mínima entre circuitos en cada vano que comparten."""
    crit = res.proyecto.criterios
    clave = "EDS" if "EDS" in res.proyecto.hipotesis else res.proyecto.hipotesis_arrancamiento
    req = float(crit.separacion_min_circuitos_m or 0)
    fac = float(getattr(crit, "separacion_vano_factor", 0.75) or 1.0)
    nombres = list(res.apoyos["Apoyo"])
    todos = [(crit.nombre_circuito_principal or "Circuito 1", 0, len(res.catenarias), res.catenarias,
              _catenarias_en(res, clave))]
    todos += [(c.nombre, c.i0, c.i1, c.res.catenarias, _catenarias_en(c.res, clave)) for c in circuitos]
    filas = []
    for a in range(len(todos)):
        for b in range(a + 1, len(todos)):
            na, ia0, ia1, ca, fa = todos[a]
            nb, ib0, ib1, cb, fb = todos[b]
            for j in range(max(ia0, ib0), min(ia1, ib1)):
                ka, kb = ca[j - ia0], cb[j - ib0]
                ya = (ka.y1 + ka.y2) / 2
                yb = (kb.y1 + kb.y2) / 2
                if ya >= yb:
                    (ns, cs, fs_), (ni, ci, fi) = (na, ka, None), (nb, kb, fb[j - ib0])
                else:
                    (ns, cs, fs_), (ni, ci, fi) = (nb, kb, None), (na, ka, fa[j - ia0])
                xs = np.linspace(cs.x1, cs.x2, 120)
                d = cs.y(xs) - fi.y(xs)           # superior con flecha máxima − inferior a temperatura media
                m = int(np.argmin(d))
                s_ap = min(cs.y1 - ci.y1, cs.y2 - ci.y2)
                filas.append({
                    "Vano": j + 1, "Apoyo inicial": nombres[j], "Apoyo final": nombres[j + 1],
                    "Circuito superior": ns, "Circuito inferior": ni,
                    "Separación en apoyos (m)": round(float(s_ap), 3),
                    "Separación mínima en el vano (m)": round(float(d[m]), 3),
                    "X separación mín.": round(float(xs[m]), 2),
                    "Requerida en apoyos (m)": req, "Requerida en el vano (m)": round(req * fac, 3),
                    "Hipótesis inferior": clave,
                    "Cumple separación": "Sí" if (d[m] >= req * fac - 1e-6 and s_ap >= req - 1e-6) else "NO",
                })
    return pd.DataFrame(filas) if filas else None


def tabla_circuitos(res, circuitos: list[ResultadoCircuito]) -> pd.DataFrame:
    """Resumen por circuito (el principal primero)."""
    p, crit = res.proyecto, res.proyecto.criterios
    nombres = list(res.apoyos["Apoyo"])

    def fila(nombre, kv, cond, nf, i0, i1, bajo, r):
        lc = float(sum(c.longitud for c in r.catenarias))
        v = r.vanos
        return {"Circuito": nombre, "Tensión (kV)": kv, "Conductor": cond.nombre, "Fases": nf,
                "Desde": nombres[i0], "Hasta": nombres[i1], "Vanos": len(r.catenarias),
                "Amarre bajo la cima (m)": bajo,
                "Longitud de conductor por fase (m)": round(lc, 2),
                f"Conductor total + {100 * crit.desperdicio_conductor:.0f}% (m)":
                    round(lc * nf * (1 + crit.desperdicio_conductor), 1),
                "Flecha máxima (m)": round(float(v["Flecha máx. (m)"].max()), 3),
                "Secciones de tendido": len(r.secciones),
                "Vanos sin distancia a terreno": int((v.get("Cumple distancia", pd.Series(dtype=object)) == "NO").sum()),
                "Apoyos con arrancamiento": int((r.apoyos["Arrancamiento"] == "SÍ").sum())}

    filas = [fila(crit.nombre_circuito_principal or "Circuito 1", crit.tension_kv, p.conductor, crit.n_fases,
                  0, len(nombres) - 1, crit.amarre_bajo_cima_m, res)]
    for c in circuitos:
        filas.append(fila(c.nombre, c.circuito.tension_kv, c.circuito.conductor, c.circuito.n_fases,
                          c.i0, c.i1, c.circuito.bajo_cima_m, c.res))
    return pd.DataFrame(filas)
