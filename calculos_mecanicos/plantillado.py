"""
Plantillado de la línea: secciones de tendido, catenarias por vano y verificaciones.

Flujo (modo recomendado "cambio_estado"):
  1. La línea se divide en SECCIONES DE TENDIDO entre apoyos de retención.
  2. Para cada sección se calcula el VANO REGULADOR y, por cambio de estado,
     la tensión horizontal H de cada hipótesis (H es igual en todos los vanos
     de la sección: así se comporta el conductor tendido sobre poleas/grapas
     de suspensión). El original usaba la flecha de cada vano aislado, lo cual
     es incorrecto para vanos que comparten tendido.
  3. Cada vano se dibuja como catenaria exacta con C = H/w entre puntos de amarre.
  4. Verificaciones: distancia mínima al terreno, separación de conductores
     (EH-RAA-004 §4.3.1.2), tensiones en apoyos, gravivano/arrancamiento,
     eolovano, longitud de conductor.

Modo "excel": usa la columna Flecha del archivo (compatibilidad con el original),
interpretada como flecha máxima medida desde la cuerda.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .cambio_estado import EstadoTendido, ErrorCalculo, calcular_estado, vano_regulador
from .catenaria import Catenaria, catenaria_por_flecha, catenaria_por_parametro
from .config import Proyecto
from .datos import DatosLinea


@dataclass
class Seccion:
    numero: int
    i_ini: int
    i_fin: int
    vanos: list[float]
    vano_regulador: float
    estado: EstadoTendido | None


@dataclass
class ResultadoPlantillado:
    proyecto: Proyecto
    datos: DatosLinea
    secciones: list[Seccion]
    catenarias: list[Catenaria]            # hipótesis de plantillado (caliente)
    catenarias_frias: list[Catenaria]      # hipótesis de arrancamiento
    vanos: pd.DataFrame
    apoyos: pd.DataFrame
    resumen: dict
    advertencias: list[str] = field(default_factory=list)
    postes: pd.DataFrame | None = None     # verificación de postes y templetes

    def terreno(self, x):
        return _funcion_terreno(self.datos)(x)


def _funcion_terreno(datos: DatosLinea):
    if datos.terreno is not None:
        t = datos.terreno
        return lambda x: np.interp(x, t["x"], t["cota"])
    if datos.y_es_terreno:
        ap = datos.apoyos
        return lambda x: np.interp(x, ap["x"], ap["y"])
    return None


def calcular_plantillado(datos: DatosLinea, proyecto: Proyecto) -> ResultadoPlantillado:
    if not datos.ok:
        raise ErrorCalculo("Corrija los errores de los datos antes de calcular:\n- "
                           + "\n- ".join(datos.errores))
    errs = proyecto.validar()
    if errs:
        raise ErrorCalculo("Parámetros del proyecto inválidos:\n- " + "\n- ".join(errs))

    cfg, crit, cond = proyecto, proyecto.criterios, proyecto.conductor
    hip = cfg.hipotesis
    kp, kf = cfg.hipotesis_plantillado, cfg.hipotesis_arrancamiento
    adv: list[str] = list(datos.advertencias)

    ap = datos.apoyos.copy()
    ap["y_amarre"] = ap["y"] + ap["altura"]
    x = ap["x"].to_numpy()
    ya = ap["y_amarre"].to_numpy()
    n = len(ap) - 1
    a = np.diff(x)

    # ------------------------------------------------------------- secciones
    cortes = [i for i in range(len(ap)) if ap.retencion[i]]
    secciones: list[Seccion] = []
    seccion_de_vano = np.zeros(n, dtype=int)
    for s, (i0, i1) in enumerate(zip(cortes[:-1], cortes[1:]), start=1):
        vs = a[i0:i1].tolist()
        ar = vano_regulador(vs)
        estado = None
        if cfg.modo_flecha == "cambio_estado":
            estado = calcular_estado(ar, cond, hip, crit.fluencia_delta_t_c, kp)
        secciones.append(Seccion(s, i0, i1, vs, ar, estado))
        seccion_de_vano[i0:i1] = s - 1
    if len(secciones) == 1 and n > 1:
        adv.append("No se indicó 'Tipo' de apoyo: toda la línea se trata como UNA sola sección "
                   "de tendido. Indique las retenciones para un cálculo más preciso.")

    # ------------------------------------------------------------ catenarias
    cats, frias = [], []
    for i in range(n):
        sec = secciones[seccion_de_vano[i]]
        try:
            if cfg.modo_flecha == "cambio_estado":
                c = catenaria_por_parametro(x[i], ya[i], x[i + 1], ya[i + 1], sec.estado.parametro(kp))
                cf = catenaria_por_parametro(x[i], ya[i], x[i + 1], ya[i + 1], sec.estado.parametro(kf))
            else:
                if datos.flechas_excel is None:
                    raise ErrorCalculo("Modo 'excel' sin columna Flecha válida en el archivo.")
                c = catenaria_por_flecha(x[i], ya[i], x[i + 1], ya[i + 1], datos.flechas_excel[i])
                cf = c
        except ErrorCalculo as e:
            raise ErrorCalculo(f"Vano {i + 1} ({ap.nombre[i]}→{ap.nombre[i + 1]}): {e}") from e
        cats.append(c)
        frias.append(cf)

    # ------------------------------------------------------- verificaciones
    terreno = _funcion_terreno(datos)
    w_p = hip[kp].peso_aparente(cond)
    filas = []
    for i, c in enumerate(cats):
        sec = secciones[seccion_de_vano[i]]
        T1, T2 = c.tensiones_apoyos(w_p)
        fila = {
            "Vano": i + 1,
            "Apoyo inicial": ap.nombre[i],
            "Apoyo final": ap.nombre[i + 1],
            "Sección": sec.numero,
            "Vano regulador (m)": round(sec.vano_regulador, 2),
            "Vano a (m)": round(c.vano, 3),
            "Desnivel (m)": round(c.desnivel, 3),
            "Parámetro C (m)": round(c.C, 3),
            "Flecha máx. (m)": round(c.flecha, 3),
            "Flecha centro (m)": round(c.flecha_centro, 3),
            "Longitud conductor (m)": round(c.longitud, 3),
            "Vértice X": round(c.vertice[0], 3),
            "Vértice Y": round(c.vertice[1], 3),
            "Vértice dentro del vano": "Sí" if c.vertice_en_vano else "No",
            "T apoyo ini (kgf)": round(T1, 1),
            "T apoyo fin (kgf)": round(T2, 1),
        }
        if sec.estado is not None:
            e = sec.estado
            ctm = catenaria_por_parametro(c.x1, c.y1, c.x2, c.y2, e.parametro("TMAX")) \
                if "TMAX" in hip else None
            if ctm is not None:
                tmax = max(ctm.tensiones_apoyos(e.pesos["TMAX"]))
                fila["T máx. apoyos TMAX (kgf)"] = round(tmax, 1)
                fila["% rotura TMAX"] = round(100 * tmax / cond.carga_rotura_kgf, 1)
            fila["Gobierna"] = e.hipotesis_gobernante
        # separación mínima de conductores (EH-RAA-004 §4.3.1.2)
        sep = crit.k_separacion * math.sqrt(c.flecha + crit.long_cadena_aisladores_m) \
            + crit.tension_kv / 150.0
        fila["Separación mín. fases (m)"] = round(sep, 3)
        # distancia al terreno
        if terreno is not None:
            xs, ys = c.muestrear(cfg.salida.puntos_por_vano)
            d = ys - terreno(xs)
            j = int(np.argmin(d))
            fila["Dist. mín. terreno (m)"] = round(float(d[j]), 3)
            fila["X dist. mín."] = round(float(xs[j]), 2)
            fila["Cumple distancia"] = "Sí" if d[j] >= crit.distancia_minima_terreno_m else "NO"
            if d[j] < crit.distancia_minima_terreno_m:
                adv.append(f"Vano {i + 1} ({ap.nombre[i]}→{ap.nombre[i + 1]}): distancia al terreno "
                           f"{d[j]:.2f} m < {crit.distancia_minima_terreno_m:.2f} m "
                           f"en x = {xs[j]:.1f}.")
        filas.append(fila)
    df_vanos = pd.DataFrame(filas)

    # ------------------------------------------------------------- apoyos
    grav, eolo = [], []
    for i in range(len(ap)):
        izq = frias[i - 1] if i > 0 else None
        der = frias[i] if i < n else None
        g = (der.b if der else x[i]) - (izq.b if izq else x[i])
        e = ((a[i - 1] if i > 0 else 0) + (a[i] if i < n else 0)) / 2
        grav.append(g)
        eolo.append(e)
    df_ap = pd.DataFrame({
        "Apoyo": ap.nombre,
        "Abscisa (m)": (x - x[0]).round(2),
        "X (m)": x,
        "Cota Y (m)": ap.y,
        "Altura amarre (m)": ap.altura,
        "Cota amarre (m)": ya.round(3),
        "Tipo": np.where(ap.retencion, "Retención", "Suspensión"),
        "Eolovano (m)": np.round(eolo, 2),
        f"Gravivano {kf} (m)": np.round(grav, 2),
        "Peso conductor/fase (kgf)": np.round(np.array(grav) * cond.peso_kgf_m, 1),
        "Arrancamiento": ["SÍ" if (g < 0 and not r) else "" for g, r in zip(grav, ap.retencion)],
    })
    for i, (g, r) in enumerate(zip(grav, ap.retencion)):
        if g < 0 and not r:
            adv.append(f"Apoyo {ap.nombre[i]}: gravivano negativo ({g:.1f} m) a "
                       f"{hip[kf].temperatura_c:.0f} °C → el conductor tira hacia ARRIBA. "
                       "Use retención/contrapeso o reubique el apoyo.")

    long_total = float(sum(c.longitud for c in cats))
    resumen = {
        "Archivo": datos.archivo,
        "Modo de flecha": cfg.modo_flecha,
        "Conductor": cond.nombre,
        "Número de apoyos": len(ap),
        "Número de vanos": n,
        "Secciones de tendido": len(secciones),
        "Longitud horizontal (m)": round(float(x[-1] - x[0]), 2),
        "Longitud de conductor por fase (m)": round(long_total, 2),
        f"Conductor total {crit.n_fases} fases + {100 * crit.desperdicio_conductor:.0f}% (m)":
            round(long_total * crit.n_fases * (1 + crit.desperdicio_conductor), 1),
        "Flecha máxima (m)": round(float(df_vanos["Flecha máx. (m)"].max()), 3),
        "Vanos que no cumplen distancia": int((df_vanos.get("Cumple distancia", pd.Series()) == "NO").sum()),
        "Apoyos con arrancamiento": int((df_ap["Arrancamiento"] == "SÍ").sum()),
    }
    res = ResultadoPlantillado(proyecto, datos, secciones, cats, frias, df_vanos, df_ap, resumen, adv)
    # ---------------------------------------------- postes y templetes
    from .estructuras import verificar_estructuras
    estructuras = getattr(datos, "estructuras", None)
    if estructuras and any((e or {}).get("poste_altura") not in (None, "") or (e or {}).get("templetes")
                           for e in estructuras):
        df_p, adv_p, res_p = verificar_estructuras(res, estructuras, datos.deflexiones)
        res.postes = df_p
        res.advertencias.extend(adv_p)
        res.resumen.update(res_p)
    return res


def tabla_secciones(res: ResultadoPlantillado) -> pd.DataFrame:
    filas = []
    rot = res.proyecto.conductor.carga_rotura_kgf
    for s in res.secciones:
        f = {"Sección": s.numero,
             "Desde": res.datos.apoyos.nombre[s.i_ini],
             "Hasta": res.datos.apoyos.nombre[s.i_fin],
             "N° vanos": len(s.vanos),
             "Vano regulador (m)": round(s.vano_regulador, 2)}
        if s.estado:
            f["Gobierna"] = s.estado.hipotesis_gobernante
            for k, H in s.estado.tensiones.items():
                f[f"H {k} (kgf)"] = round(H, 1)
                f[f"%Rot {k}"] = round(100 * H / rot, 1)
        filas.append(f)
    return pd.DataFrame(filas)
