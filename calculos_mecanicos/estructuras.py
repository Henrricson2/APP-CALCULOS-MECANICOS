"""
Verificación mecánica de las estructuras: poste (altura, carga de rotura, peso) y templetes.

Para cada estructura, con la hipótesis de cargas de diseño (por defecto TMAX: 0 °C + viento máximo):

  Cargas horizontales a la altura de amarre (n fases):
    - Tiro por cambio de dirección o desequilibrio: resultante vectorial de las tensiones
      horizontales H a cada lado,  R = n·√(H1² + H2² − 2·H1·H2·cos α)   (α = deflexión).
      En un terminal R = n·H. En alineación con igual H, R = 0.
    - Viento sobre conductores:  Fv = n·q·d·eolovano      (q = 0.0042·V², EH-RAA-004).
      Se suma a R (caso conservador: viento en la dirección de la resultante); en terminal
      se combina en cuadratura (viento ⟂ a la línea).
    - Viento sobre el poste: Fp = q·D_medio·h_libre, aplicado a h_libre/2.

  Poste:  empotramiento e = a·L + b (por defecto 0.10·L + 0.60 m),  h_libre = L − e.
    Carga equivalente en el punto de prueba (a 0.20 m de la cima, como la carga de rotura
    nominal):  F_eq = (F·h_amarre + Fp·h_libre/2) / (h_libre − 0.20).
    Carga de trabajo = carga de rotura / FS_poste.  Utilización = F_eq / carga de trabajo.

  Templetes (opcionales, solo donde se registren): se suponen orientados contra la
    resultante.  Con altura de amarre ht y distancia al anclaje d:  sen θ = d/√(d²+ht²).
    Fuerza horizontal que toman: Ht = (F·h_amarre + Fp·h_libre/2)/ht.
    Tensión por templete: T = Ht/(k·sen θ) (k templetes);  compresión adicional al poste
    V = Ht/tan θ.  Verificación: T ≤ rotura del cable / FS_templete.

  Carga vertical (cimentación): peso del poste + n·w·gravivano(+) + herrajes + V templetes.

Los factores de seguridad, el empotramiento y los catálogos son parámetros editables:
verifíquelos contra RETIE y la norma del operador de red (EH-RAA-004) antes de emitir planos.
"""
from __future__ import annotations

import math

import pandas as pd

# Catálogo referencial de postes de concreto (longitud m, carga de rotura kgf, peso aprox. kg).
# Los pesos varían por fabricante: confírmelos con la ficha técnica.
CATALOGO_POSTES = [
    {"nombre": "8 m · 510 kgf", "altura": 8, "rotura": 510, "peso": 500},
    {"nombre": "9 m · 510 kgf", "altura": 9, "rotura": 510, "peso": 580},
    {"nombre": "10 m · 510 kgf", "altura": 10, "rotura": 510, "peso": 680},
    {"nombre": "10 m · 750 kgf", "altura": 10, "rotura": 750, "peso": 800},
    {"nombre": "11 m · 510 kgf", "altura": 11, "rotura": 510, "peso": 780},
    {"nombre": "12 m · 510 kgf", "altura": 12, "rotura": 510, "peso": 900},
    {"nombre": "12 m · 750 kgf", "altura": 12, "rotura": 750, "peso": 1050},
    {"nombre": "12 m · 1050 kgf", "altura": 12, "rotura": 1050, "peso": 1250},
    {"nombre": "12 m · 1350 kgf", "altura": 12, "rotura": 1350, "peso": 1450},
    {"nombre": "14 m · 750 kgf", "altura": 14, "rotura": 750, "peso": 1350},
    {"nombre": "14 m · 1050 kgf", "altura": 14, "rotura": 1050, "peso": 1550},
    {"nombre": "14 m · 1350 kgf", "altura": 14, "rotura": 1350, "peso": 1750},
    {"nombre": "16 m · 1050 kgf", "altura": 16, "rotura": 1050, "peso": 1900},
]

# Cable de acero galvanizado para templetes (ASTM A475), carga de rotura mínima en kgf.
CABLES_TEMPLETE = [
    {"nombre": '1/4" Siemens-Martin', "rotura": 1429},
    {"nombre": '1/4" alta resistencia (HS)', "rotura": 2155},
    {"nombre": '1/4" extra alta resistencia (EHS)', "rotura": 3016},
    {"nombre": '5/16" Siemens-Martin', "rotura": 2427},
    {"nombre": '5/16" alta resistencia (HS)', "rotura": 3629},
    {"nombre": '5/16" extra alta resistencia (EHS)', "rotura": 5080},
    {"nombre": '3/8" Siemens-Martin', "rotura": 3152},
    {"nombre": '3/8" alta resistencia (HS)', "rotura": 4899},
    {"nombre": '3/8" extra alta resistencia (EHS)', "rotura": 6985},
    {"nombre": '1/2" alta resistencia (HS)', "rotura": 8528},
    {"nombre": '1/2" extra alta resistencia (EHS)', "rotura": 12202},
]


def _f(v):
    if v in (None, ""):
        return None
    try:
        x = float(str(v).replace(",", "."))
    except ValueError:
        return None
    return None if math.isnan(x) else x


def peso_catalogo(altura, rotura):
    """Peso referencial de catálogo para (altura, rotura) o None."""
    for p in CATALOGO_POSTES:
        if altura is not None and rotura is not None and abs(p["altura"] - altura) < 0.01 \
                and abs(p["rotura"] - rotura) < 0.5:
            return p["peso"]
    return None


def empotramiento(L: float, crit) -> float:
    return crit.empotramiento_coef * L + crit.empotramiento_base_m


def altura_amarre_desde_poste(L: float, crit) -> float:
    """Altura del punto de amarre sobre el terreno a partir de la longitud del poste."""
    return L - empotramiento(L, crit) - crit.amarre_bajo_cima_m


def verificar_estructuras(res, estructuras: list[dict], deflexiones=None):
    """Devuelve (DataFrame, advertencias, resumen) de la verificación de postes y templetes."""
    p, crit, cond = res.proyecto, res.proyecto.criterios, res.proyecto.conductor
    ap = res.datos.apoyos
    n_ap = len(ap)
    if not estructuras or len(estructuras) != n_ap:
        estructuras = [{} for _ in range(n_ap)]
    hk = crit.hipotesis_estructuras if crit.hipotesis_estructuras in p.hipotesis else \
        next((k for k, h in p.hipotesis.items() if h.viento_kmh), p.hipotesis_plantillado)
    hip = p.hipotesis[hk]
    q = hip.presion_viento_kgf_m2()
    nf = crit.n_fases
    x = ap["x"].to_numpy()
    a = [x[i + 1] - x[i] for i in range(n_ap - 1)]
    seccion = {}
    for s in res.secciones:
        for i in range(s.i_ini, s.i_fin):
            seccion[i] = s

    def H_vano(i):  # tensión horizontal del vano i en la hipótesis de cargas
        s = seccion.get(i)
        if s is not None and s.estado is not None and hk in s.estado.tensiones:
            return float(s.estado.tensiones[hk])
        c = res.catenarias[i]
        return float(c.C * p.hipotesis[p.hipotesis_plantillado].peso_aparente(cond))

    filas, adv = [], []
    sin_poste, req, insuf = [], 0, 0
    for i in range(n_ap):
        e = estructuras[i] or {}
        L, rot, peso = _f(e.get("poste_altura")), _f(e.get("poste_rotura")), _f(e.get("poste_peso"))
        peso_est = False
        if peso is None and L is not None and rot is not None:
            peso = peso_catalogo(L, rot)
            peso_est = peso is not None
        alfa = abs(float(deflexiones[i])) if deflexiones and deflexiones[i] is not None else 0.0
        H1 = H_vano(i - 1) if i > 0 else 0.0
        H2 = H_vano(i) if i < n_ap - 1 else 0.0
        terminal = i == 0 or i == n_ap - 1
        R = nf * math.sqrt(max(H1 ** 2 + H2 ** 2 - 2 * H1 * H2 * math.cos(math.radians(alfa)), 0.0))
        eolo = ((a[i - 1] if i > 0 else 0) + (a[i] if i < n_ap - 1 else 0)) / 2
        Fv = nf * q * cond.diametro_m * eolo
        F = math.hypot(R, Fv) if terminal else R + Fv
        h_am = float(ap["altura"][i]) if float(ap["altura"][i]) > 0 else None
        fila = {"Apoyo": ap["nombre"][i], "Tipo": "Retención" if ap["retencion"][i] else "Suspensión",
                "Deflexión (°)": round(alfa, 2),
                "Poste L (m)": L, "Carga rotura (kgf)": rot,
                "Peso poste (kg)": None if peso is None else round(peso, 0),
                "Peso estimado": "catálogo" if peso_est else "",
                "Empotramiento (m)": None, "Altura libre (m)": None, "Altura amarre (m)": h_am,
                f"Tiro conductores {hk} (kgf)": round(R, 1), "Viento conductores (kgf)": round(Fv, 1),
                "Viento poste (kgf)": None, "Carga equivalente cima (kgf)": None,
                "Carga de trabajo (kgf)": None, "Utilización poste (%)": None,
                "Templetes": 0, "Cable templete": "", "Tensión por templete (kgf)": None,
                "Utilización templete (%)": None, "Carga vertical (kgf)": None, "Estado": ""}
        momento = None
        if L is not None and L > 0:
            emp = empotramiento(L, crit)
            hl = L - emp
            h_am = h_am if h_am is not None else hl - crit.amarre_bajo_cima_m
            Fp = q * crit.poste_diametro_medio_m * hl
            h_ref = max(hl - 0.20, 0.1)
            momento = F * h_am + Fp * hl / 2
            Feq = momento / h_ref
            fila.update({"Empotramiento (m)": round(emp, 2), "Altura libre (m)": round(hl, 2),
                         "Altura amarre (m)": round(h_am, 2), "Viento poste (kgf)": round(Fp, 1),
                         "Carga equivalente cima (kgf)": round(Feq, 1)})
            if rot:
                trab = rot / crit.fs_poste
                fila["Carga de trabajo (kgf)"] = round(trab, 1)
                fila["Utilización poste (%)"] = round(100 * Feq / trab, 1)
        # templetes
        tps = [t for t in (e.get("templetes") or []) if (_f(t.get("cantidad")) or 0) > 0]
        V_t = 0.0
        if tps:
            k = sum(int(_f(t.get("cantidad")) or 0) for t in tps)
            t0 = tps[0]
            ht = _f(t0.get("altura_m")) or h_am or (fila["Altura libre (m)"] or 0)
            d = _f(t0.get("distancia_m")) or (0.5 * ht if ht else None)
            rot_c = min(_f(t.get("rotura_kgf")) or 0 for t in tps) or None
            fila["Templetes"] = k
            fila["Cable templete"] = ", ".join(sorted({str(t.get("cable") or "sin especificar") for t in tps}))
            if momento is None and h_am:
                momento = F * h_am
            if momento is not None and ht and d:
                sen = d / math.hypot(d, ht)
                Ht = momento / ht
                T = Ht / (k * sen)
                V_t = Ht * ht / d
                fila["Tensión por templete (kgf)"] = round(T, 1)
                if rot_c:
                    fila["Utilización templete (%)"] = round(100 * T / (rot_c / crit.fs_templete), 1)
        # carga vertical
        g = 0.0
        izq = res.catenarias[i - 1] if i > 0 else None
        der = res.catenarias[i] if i < n_ap - 1 else None
        g = (der.b if der else x[i]) - (izq.b if izq else x[i])
        V = (peso or 0) + nf * cond.peso_kgf_m * max(g, 0) + crit.peso_herrajes_kgf + V_t
        fila["Carga vertical (kgf)"] = round(V, 1) if (peso is not None or V_t) else None
        # estado
        up, ut = fila["Utilización poste (%)"], fila["Utilización templete (%)"]
        if tps:
            if ut is None:
                estado = "Templete sin datos completos"
            elif ut > 100:
                estado = "TEMPLETE INSUFICIENTE"; insuf += 1
                adv.append(f"Estructura {fila['Apoyo']}: templete al {ut:.0f} % de su carga de trabajo "
                           f"({fila['Tensión por templete (kgf)']:.0f} kgf por templete). Use cable de mayor "
                           "resistencia, más templetes o mayor distancia al anclaje.")
            else:
                estado = "OK con templete"
        elif up is None:
            estado = "Sin datos de poste"
            sin_poste.append(str(fila["Apoyo"]))
        elif up > 100:
            estado = "REQUIERE TEMPLETE"; req += 1
            adv.append(f"Estructura {fila['Apoyo']}: el poste trabaja al {up:.0f} % "
                       f"({fila['Carga equivalente cima (kgf)']:.0f} kgf vs {fila['Carga de trabajo (kgf)']:.0f} kgf "
                       f"de trabajo). Agregue templete o use un poste de mayor carga de rotura.")
        else:
            estado = "OK"
        fila["Estado"] = estado
        filas.append(fila)
    if sin_poste and len(sin_poste) < n_ap:
        adv.append(f"{len(sin_poste)} estructura(s) sin poste o sin carga de rotura: no se verificó su "
                   f"flexión ({', '.join(sin_poste[:8])}{'…' if len(sin_poste) > 8 else ''}).")
    resumen = {"Postes que requieren templete": req, "Templetes insuficientes": insuf}
    df = pd.DataFrame(filas)
    primero = ["Apoyo", "Tipo", "Estado", "Poste L (m)", "Carga rotura (kgf)", "Utilización poste (%)", "Templetes",
               "Cable templete", "Tensión por templete (kgf)", "Utilización templete (%)", "Carga vertical (kgf)",
               "Peso poste (kg)", "Peso estimado", "Altura amarre (m)"]
    df = df[primero + [c for c in df.columns if c not in primero]]
    return df, adv, resumen
