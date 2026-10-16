"""Construye la base de datos de clima por municipio del Huila a partir de datos del IDEAM.

Entrada:  ideam_huila_raw.json (extraído de datos.gov.co el 2026-10-15).
Salida:   ../web/clima_huila.json (base que usa la app), clima_huila.json y clima_huila.csv (para revisar en Excel).
Uso:      python clima_ideam/construir_clima.py

Método (resumen):
1. Normales climatológicas IDEAM 1991-2020 (temperatura media, media de las mínimas y media de las
   máximas, mensuales). Se usan: media anual, mínima media del mes más frío y máxima media del mes
   más cálido.
2. Gradiente térmico con la altura ajustado por mínimos cuadrados con las estaciones del Huila.
3. Para cada cabecera municipal: promedio ponderado de las 3 estaciones más parecidas
   (distancia + diferencia de altura), cada una corregida a la altura de la cabecera.
4. Extremos absolutos = valor normal del mes extremo + margen. El margen es la diferencia observada,
   en las estaciones automáticas del IDEAM con datos válidos, entre el extremo diario registrado y la
   normal del mes extremo de la MISMA estación; se toma la envolvente (el margen más exigente).
   Si hay una estación automática válida en el mismo municipio y su extremo (corregido por altura)
   es más exigente, se usa ese.
"""
from __future__ import annotations

import csv
import json
import math
from datetime import date
from pathlib import Path
from statistics import mean

AQUI = Path(__file__).parent
raw = json.loads((AQUI / "ideam_huila_raw.json").read_text(encoding="utf-8"))

NOMBRES = {  # nombre como lo muestra la app (motor.py MUNICIPIOS_HUILA)
    "NEIVA": "Neiva", "ACEVEDO": "Acevedo", "AGRADO": "Agrado", "AIPE": "Aipe", "ALGECIRAS": "Algeciras",
    "ALTAMIRA": "Altamira", "BARAYA": "Baraya", "CAMPOALEGRE": "Campoalegre", "COLOMBIA": "Colombia",
    "ELÍAS": "Elías", "GARZÓN": "Garzón", "GIGANTE": "Gigante", "GUADALUPE": "Guadalupe", "HOBO": "Hobo",
    "ÍQUIRA": "Íquira", "ISNOS": "Isnos", "LA ARGENTINA": "La Argentina", "LA PLATA": "La Plata",
    "NÁTAGA": "Nátaga", "OPORAPA": "Oporapa", "PAICOL": "Paicol", "PALERMO": "Palermo",
    "PALESTINA": "Palestina", "PITAL": "Pital", "PITALITO": "Pitalito", "RIVERA": "Rivera",
    "SALADOBLANCO": "Saladoblanco", "SAN AGUSTÍN": "San Agustín", "SANTA MARÍA": "Santa María",
    "SUAZA": "Suaza", "TARQUI": "Tarqui", "TESALIA": "Tesalia", "TELLO": "Tello", "TERUEL": "Teruel",
    "TIMANÁ": "Timaná", "VILLAVIEJA": "Villavieja", "YAGUARÁ": "Yaguará"}


def km(a_lat, a_lon, b_lat, b_lon):
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


def regresion(xs, ys):
    mx, my = mean(xs), mean(ys)
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    a = my - b * mx
    pred = [a + b * x for x in xs]
    ss_res = sum((y - p) ** 2 for y, p in zip(ys, pred))
    ss_tot = sum((y - my) ** 2 for y in ys)
    return a, b, 1 - ss_res / ss_tot


# ---------------------------------------------------------------- 1. normales por estación
VAL = {"MED": lambda r: r["anual"], "MIN": lambda r: min(r["mes"]), "MAX": lambda r: max(r["mes"])}
est = {p: [dict(r, valor=VAL[p](r)) for r in raw["normales"] if r["p"] == p] for p in VAL}

# ---------------------------------------------------------------- 2. gradientes con la altura
grad = {}
for p, filas in est.items():
    a, b, r2 = regresion([f["alt"] for f in filas], [f["valor"] for f in filas])
    grad[p] = {"a": a, "b_por_m": b, "r2": r2, "n": len(filas)}

# ---------------------------------------------------------------- 4a. márgenes de los extremos
normal_por_cod = {}
for r in raw["normales"]:
    normal_por_cod.setdefault(r["cod"], {})[r["p"]] = VAL[r["p"]](r)
margen_min, margen_max, pares = [], [], []
for cod, s in raw["sensores"].items():
    n = normal_por_cod.get(cod)
    if not n:
        continue
    dmin = s["tmin_abs"] - n["MIN"] if "MIN" in n else None
    dmax = s["tmax_abs"] - n["MAX"] if "MAX" in n else None
    # descarta lecturas de sensor dañado (p. ej. 0.6 °C repetido, 49.9 °C)
    ok_min = dmin is not None and -9.0 <= dmin <= 0
    ok_max = dmax is not None and 0 <= dmax <= 9.0
    if ok_min:
        margen_min.append(dmin)
    if ok_max:
        margen_max.append(dmax)
    pares.append({"codigo": cod, "estacion": s["nombre"], "dias": s["dias"], "desde": s["desde"], "hasta": s["hasta"],
                  "dmin": None if dmin is None else round(dmin, 1), "dmin_valido": ok_min,
                  "dmax": None if dmax is None else round(dmax, 1), "dmax_valido": ok_max})
M_MIN = min(margen_min)   # envolvente: el más frío
M_MAX = max(margen_max)   # envolvente: el más caliente


def sensor_valido(cod):
    p = next((x for x in pares if x["codigo"] == cod), None)
    return p


# ---------------------------------------------------------------- 3. valor en cada cabecera
def estimar(p, lat, lon, alt):
    b = grad[p]["b_por_m"]
    cand = []
    for f in est[p]:
        d = km(lat, lon, f["lat"], f["lon"])
        score = d + abs(alt - f["alt"]) / 50.0      # 50 m de desnivel ~ 1 km
        cand.append((score, d, f, f["valor"] + b * (alt - f["alt"])))
    cand.sort(key=lambda c: c[0])
    top = cand[:3]
    w = [1 / max(c[0], 1.0) ** 2 for c in top]
    v = sum(wi * c[3] for wi, c in zip(w, top)) / sum(w)
    return v, [{"codigo": c[2]["cod"], "estacion": c[2]["est"], "municipio": c[2]["mun"], "alt_m": c[2]["alt"],
                "dist_km": round(c[1], 1), "valor_normal": c[2]["valor"], "corregido": round(c[3], 1),
                "peso": round(wi / sum(w), 2)} for wi, c in zip(w, top)]


salida = []
for m in raw["municipios"]:
    nombre = NOMBRES[m["nom"]]
    lat, lon, alt = m["lat"], m["lon"], m["alt"]
    tmed, rmed = estimar("MED", lat, lon, alt)
    tmin, rmin = estimar("MIN", lat, lon, alt)
    tmax, rmax = estimar("MAX", lat, lon, alt)
    tmin_abs, tmax_abs = tmin + M_MIN, tmax + M_MAX
    base_nota = "normal del mes extremo + margen de las estaciones automáticas IDEAM del Huila"
    nota_min = nota_max = base_nota
    # estación automática válida en el mismo municipio: envolvente
    for cod, s in raw["sensores"].items():
        if s["municipio"] != nombre:
            continue
        pr = sensor_valido(cod)
        if pr and pr["dmin_valido"]:
            v = s["tmin_abs"] + grad["MIN"]["b_por_m"] * (alt - s["alt"])
            if v < tmin_abs:
                tmin_abs, nota_min = v, f"extremo observado en {s['nombre']} ({s['desde'][:4]}–{s['hasta'][:4]}), corregido por altura"
        if pr and pr["dmax_valido"]:
            v = s["tmax_abs"] + grad["MAX"]["b_por_m"] * (alt - s["alt"])
            if v > tmax_abs:
                tmax_abs = v
                nota_max = f"extremo observado en {s['nombre']} ({s['desde'][:4]}–{s['hasta'][:4]}), corregido por altura"
    salida.append({
        "municipio": nombre, "departamento": "Huila", "cod_dane": m["cod"],
        "lat": lat, "lon": lon, "alt_m": round(alt),
        "t_media_anual_c": round(tmed, 1),
        "t_min_media_mes_frio_c": round(tmin, 1),
        "t_max_media_mes_calido_c": round(tmax, 1),
        "t_min_absoluta_c": round(tmin_abs, 1),
        "t_max_absoluta_c": round(tmax_abs, 1),
        "estacion_principal": rmed[0]["estacion"] + f" ({rmed[0]['municipio']}, {rmed[0]['alt_m']} m, {rmed[0]['dist_km']} km)",
        "referencias": {"media": rmed, "minima": rmin, "maxima": rmax},
        "nota_t_min_absoluta": nota_min,
        "nota_t_max_absoluta": nota_max,
    })

base = {
    "version": 1,
    "generado": date.today().isoformat(),
    "fuente": {
        "normales": "IDEAM – Normales Climatológicas de Colombia, periodo 1991-2020 (datos.gov.co, conjunto nsz2-kzcq)",
        "extremos": "IDEAM – Temperatura Mínima del Aire (afdg-3zpb) y Temperatura Máxima del Aire (ccvq-rp9s), estaciones automáticas del Huila, extremos diarios depurados",
        "cabeceras": "DANE – DIVIPOLA (gdxc-w37w); altura: modelo digital Copernicus DEM 90 m (Open-Meteo)",
    },
    "metodo": {
        "gradiente_c_por_100m": {p: round(g["b_por_m"] * 100, 3) for p, g in grad.items()},
        "r2": {p: round(g["r2"], 3) for p, g in grad.items()},
        "estaciones": {p: g["n"] for p, g in grad.items()},
        "margen_tmin_abs_c": round(M_MIN, 1),
        "margen_tmax_abs_c": round(M_MAX, 1),
        "pares_sensor_normal": pares,
        "descripcion": __doc__.strip(),
    },
    "municipios": salida,
}
# la app lee web/clima_huila.json; se deja también una copia junto a este script
WEB = AQUI.parent / "web"
for destino in [AQUI / "clima_huila.json"] + ([WEB / "clima_huila.json"] if WEB.is_dir() else []):
    destino.write_text(json.dumps(base, ensure_ascii=False, indent=1), encoding="utf-8")
with open(AQUI / "clima_huila.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f, delimiter=";")
    w.writerow(["Municipio", "Código DANE", "Altura cabecera (m)", "T media anual (°C)", "T mín media mes frío (°C)",
                "T máx media mes cálido (°C)", "T mín absoluta (°C)", "T máx absoluta (°C)", "Estación principal", "Origen T mín absoluta", "Origen T máx absoluta"])
    for s in salida:
        w.writerow([s["municipio"], s["cod_dane"], s["alt_m"], s["t_media_anual_c"], s["t_min_media_mes_frio_c"],
                    s["t_max_media_mes_calido_c"], s["t_min_absoluta_c"], s["t_max_absoluta_c"], s["estacion_principal"], s["nota_t_min_absoluta"], s["nota_t_max_absoluta"]])

print("gradientes °C/100 m:", base["metodo"]["gradiente_c_por_100m"], "r2:", base["metodo"]["r2"])
print("margen min:", M_MIN, "margen max:", M_MAX)
for p in pares:
    print(p)
print()
for s in salida:
    print(f"{s['municipio']:14s} {s['alt_m']:5d} m  Tmed {s['t_media_anual_c']:5.1f}  Tmin(mes) {s['t_min_media_mes_frio_c']:5.1f}  Tmax(mes) {s['t_max_media_mes_calido_c']:5.1f}  Tmin abs {s['t_min_absoluta_c']:5.1f}  Tmax abs {s['t_max_absoluta_c']:5.1f}  | {s['estacion_principal']}  | {s['nota_t_min_absoluta'][:30]} / {s['nota_t_max_absoluta'][:30]}")
