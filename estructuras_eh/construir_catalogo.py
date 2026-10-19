"""Catálogo de estructuras normalizadas de Electrohuila para la app.

Lee el portal «App normativa» (data/normas.js, data/miniaturas.js, docs/*.pdf) y genera:
  web/estructuras_eh.json            catálogo que usa la app (buscador de estructuras)
  web/estructuras_eh/mini/<id>.jpg   miniatura de la primera hoja de cada estructura
  web/estructuras_eh/pdf/<id>.pdf    lámina original (copia local; no se sube a GitHub)

Uso:  python estructuras_eh/construir_catalogo.py  "C:/Normativa_Electrohuila"
      python estructuras_eh/construir_catalogo.py  --solo-geometria   (solo aplica estructuras_eh/laminas.py)
"""
from __future__ import annotations

import base64
import json
import re
import shutil
import sys
import unicodedata
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
FUENTE = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else RAIZ.parent / "App normativa"
WEB = RAIZ / "web"
SALIDA = WEB / "estructuras_eh"


def cargar_js(ruta: Path):
    s = ruta.read_text(encoding="utf-8")
    return json.loads(s[s.index("{"): s.rstrip().rstrip(";").rindex("}") + 1])


def sin_tildes(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower()


SECCIONES = {"REDES ABIERTAS", "ESTRUCTURAS", "REDES COMPACTAS", "RED TRENZADA", "EQUIPOS DE MANIOBRA",
             "MONTAJE DE TRANSFORMADORES EN POSTE"}   # subestaciones tipo poste (TRM/TRT)


def incluir(n: dict) -> bool:
    if n.get("capituloNombre") != "REDES AÉREAS" or n.get("soloIndice"):
        return False
    cod = n["codigo"].upper()
    if re.search(r"-\s*0+0\b|CONTENIDO", cod + " " + n["nombre"].upper()) or "RAA -00" in cod or "ABT" in cod:
        return False
    if "espaciadores" in sin_tildes(n["nombre"]) or "generalidades" in sin_tildes(n["nombre"]):
        return False
    sec = n.get("seccion")
    if sec in SECCIONES:
        return True
    # perchas de baja tensión (EH-613…623 N1)
    return n.get("nivel") == "BAJA TENSIÓN" and "estructura" in sin_tildes(n["nombre"])


def clasificar(n: dict) -> dict:
    t = sin_tildes(n["nombre"])
    cod = n["codigo"].upper().replace(" ", "")
    nivel = {"BAJA TENSIÓN": "BT", "13.2 kV": "13.2 kV", "34.5 kV": "34.5 kV"}.get(n.get("nivel"), n.get("nivel") or "")
    # función de la estructura
    trafo = None
    if n.get("seccion") == "MONTAJE DE TRANSFORMADORES EN POSTE":
        trafo = {"fases": 3 if "trifasico" in t else 1,
                 "montaje": "silleta" if "silleta" in t else "collarin" if "collarin" in t else "directo",
                 "autoprotegido": "autoprotegido" in t, "bt": "trenzada" if "trenzada" in t else "abierta",
                 "nivel_h": "superior" if "nivel superior" in t else "inferior" if "nivel inferior" in t else None}
        nivel = "13.2 kV"
    if trafo:
        funcion = "Subestación tipo poste"
    elif n.get("seccion") == "EQUIPOS DE MANIOBRA":
        funcion = "Equipo de maniobra"
    elif re.search(r"terminal|final de circuito", t):
        funcion = "Terminal"
    elif re.search(r"retencion", t):
        funcion = "Retención"
    elif re.search(r"derivacion", t):
        funcion = "Derivación"
    elif re.search(r"suspension", t):
        funcion = "Suspensión"
    elif re.search(r"angulo|esquina|90", t):
        funcion = "Ángulo"
    else:
        funcion = "Alineamiento"     # espigo, tangencial, line post, percha de alineamiento
    # tipo para el cálculo: R = retención (corta la sección de tendido), S = suspensión / paso
    tipo = {"Terminal": "R", "Retención": "R", "Suspensión": "S", "Alineamiento": "S"}.get(funcion)
    if trafo:
        tipo = "R" if "terminal" in t else "S"
    if funcion == "Ángulo":
        tipo = "R" if re.search(r"60|90|angulo", t) and "suspension" not in t else "S"
    # aislamiento y cadena (EH-RAA-004 §4.3.1.2: L = 0.43 m en 13.2 kV y 0.45 m en 34.5 kV con cadena de 3 aisladores)
    if "line post" in t:
        aisl = "Line post"
    elif "pin doble" in t:
        aisl = "Espigo doble"
    elif "pin + disco" in t:
        aisl = "Espigo + disco"
    elif "pin" in t or "espigo" in t:
        aisl = "Espigo"
    elif "percha" in t:
        aisl = "Percha"
    elif nivel == "BT":
        aisl = "Red trenzada" if "trenzad" in t else ""
    elif funcion == "Suspensión":
        aisl = "Cadena de suspensión"
    elif funcion in ("Retención", "Terminal"):
        aisl = "Cadena de retención"
    elif "percha" in t:
        aisl = "Percha"
    else:
        aisl = ""
    cadena = 0.0
    if aisl == "Cadena de suspensión":
        cadena = 0.45 if nivel == "34.5 kV" else 0.43
    circ = 1
    m = re.search(r"\b(dos|tres|cuatro)\s+circuitos?", t)
    if m:
        circ = {"dos": 2, "tres": 3, "cuatro": 4}[m.group(1)]
    elif re.search(r"circuito doble|doble trifasico|circuito trifasico doble|circuitos? doble", t):
        circ = 2
    elif "triple" in t:
        circ = 3
    disp = next((d for d in ("semibandera", "bandera", "triangular", "simetrica", "vertical", "horizontal") if d in t), "")
    disp = {"simetrica": "simétrica"}.get(disp, disp)
    poste = "H" if re.match(r"EH-(PH|RH|SH)", cod) or t.startswith("h ") or t.startswith("h –") or " en h " in f" {t} " else "Sencillo"
    crucetas = sorted({float(x.replace(",", ".")) for x in re.findall(r"(\d(?:[.,]\d)?)\s*m\b", t)})
    return {
        "nivel": nivel, "seccion": n.get("seccion") or "", "subgrupo": n.get("subgrupo") or "",
        "funcion": funcion, "tipo": tipo, "aislamiento": aisl, "cadena_m": cadena,
        "circuitos": circ, "disposicion": disp, "poste": poste,
        "guarda": "guarda" in t, "fases": 2 if "bifasico" in t else (None if nivel == "BT" else 3),
        "crucetas_m": crucetas, "trafo": trafo,
    }


# ----------------------------------------------------------------------------- geometría
# Posición de cada fase respecto al eje del poste: (dx, dz) en metros.
#   dx: horizontal, perpendicular a la línea (+ a la derecha en el sentido del abscisado)
#   dz: distancia vertical BAJO LA CIMA del poste hasta el conductor (negativo = por encima de la cima)
# Medidas leídas de las láminas EH (marcadas «lámina») y aplicadas por familia al resto (aprox.).
LEIDAS = {  # código compacto -> fuente
    "EH-521N2", "EH-522N2", "EH-541N2", "EH-P102N2", "EH-S120N2", "EH-SH225N2", "EH-RH231N2"}
H_SEP = 1.9            # separación entre los dos postes de las estructuras en H (láminas RH-231 y SH-225)
G_SENC = [(0.0, -0.66)]            # cable de guarda en bayoneta, poste sencillo (lámina P-102)
G_H_RET = [(-H_SEP / 2, -1.45), (H_SEP / 2, -1.45)]   # bayoneta doble en H de retención (lámina RH-231)
G_H = [(-H_SEP / 2, -0.35), (H_SEP / 2, -0.35)]       # bayoneta en H de alineamiento/suspensión (lámina SH-225)


def _fila(dz, xs):
    return [(x, dz) for x in xs]


def geometria(cod: str, t: str, c: dict) -> dict | None:
    """Geometría típica de la estructura (fases y cable de guarda)."""
    k = cod.upper().replace(" ", "").replace("–", "-")
    fun, aisl = c["funcion"], c["aislamiento"]
    ret = fun in ("Retención", "Terminal")
    fases, guarda, h = None, [], c["poste"] == "H"
    m = re.match(r"EH-?([A-Z]*)\s*-?(\d+)", k)
    pre, num = (m.group(1), int(m.group(2))) if m else ("", 0)
    brazo = {3.0: 1.4, 4.0: 1.9, 6.0: 2.9}
    cr = max(c["crucetas_m"]) if c["crucetas_m"] else 4.0
    b = brazo.get(cr, cr / 2 - 0.1)
    if fun == "Equipo de maniobra":
        return None
    tr = c.get("trafo")
    if tr:
        if c["poste"] == "H":
            fases = _fila(0.5, [-1.9, 0, 1.9]); guarda = []
        elif c["disposicion"] == "bandera":
            fases = _fila(0.0, [1.05, 1.6, 2.15])
        elif tr["fases"] == 1:
            fases = [(0, -0.2), (0.35, 0.5)]                   # lámina TRM-010 (aprox.)
        elif "terminal" in t:
            fases = _fila(0.15, [-0.9, 0, 0.9])
        else:
            fases = [(0, -0.2), (-0.65, 0.3), (0.65, 0.3)]      # lámina TRT-013 (aprox.)
        return {"fases": [(round(x, 2), round(z, 2)) for x, z in fases], "guarda": [],
                "postes": [-H_SEP / 2, H_SEP / 2] if c["poste"] == "H" else [0.0],
                "bajo_cima_m": max(z for _, z in fases), "fuente": "típica de la familia (aprox.)"}
    if c["nivel"] == "BT":
        n = 4 if "cuatro" in t else 3 if "tres" in t else 2 if "dos" in t else 1
        fases = [(0.15, 0.6 + 0.2 * i) for i in range(n)]
    elif pre == "RCP":
        if num in (434, 431):
            fases = _fila(0, []) + [(0.3, 0.3), (0.3, 0.9), (0.3, 1.5)]
        elif num in (435, 432):
            fases = [(0.3, 0.3), (0.3, 0.9), (0.3, 1.5), (-0.3, 0.3), (-0.3, 0.9), (-0.3, 1.5)]
        elif num in (436, 433):
            fases = [(0, -0.2), (-0.4, 0.4), (0.4, 0.4)]
        else:
            nc = c["circuitos"]
            fases = [p for i in range(nc) for p in [(-0.25, 0.4 + 0.8 * i), (0.25, 0.4 + 0.8 * i), (0, 0.7 + 0.8 * i)]]
    elif pre in ("PH", "RH", "SH"):
        dz0 = 0.7 if pre == "RH" else 0.5
        susp = 0.45 if pre == "SH" else 0.0
        guarda = G_H_RET if pre == "RH" else G_H
        if c["circuitos"] >= 2:
            if c["disposicion"] == "vertical" or num in (270, 271):
                fases = [(-b, dz0 + susp + i) for i in range(3)] + [(b, dz0 + susp + i) for i in range(3)]
            else:
                fases = _fila(dz0 + susp, [-b, -b / 3, b / 3]) + _fila(dz0 + 1.0 + susp, [-b, -b / 3, b / 3])
                fases = _fila(dz0 + susp, [-b, 0, b]) + _fila(dz0 + 1.0 + susp, [-b, 0, b])
        elif re.search(r"crucetas? (sencillas? )?de \d m y \d m|crucetas de \d y \d m", t):
            # triangular: fase central en cruceta corta superior, dos fases en la cruceta larga
            if pre == "SH":
                fases = [(0, 1.8), (-b, 3.2), (b, 3.2)]           # lámina SH-225 (cruceta 2 m + 4 m)
            else:
                fases = [(0, dz0), (-b, dz0 + 1.0), (b, dz0 + 1.0)]
        else:
            fases = _fila(dz0 + (1.15 - 0.5 if pre == "SH" else 0), [-b, 0, b]) if pre == "SH" else _fila(dz0, [-b, 0, b])
    elif pre in ("P", "R", "S", "RE"):
        guarda = G_SENC if c["guarda"] else []
        if pre == "RE":
            fases = [p for i in range(3) for p in _fila(0.4 + i, [-0.9, 0, 0.9])]
        elif num in (151, 161, 175, 181):
            base = 0.5 if pre == "P" else 1.1 if pre == "S" else 0.6
            fases = [(-0.9, base + 0.8 * i) for i in range(3)] + [(0.9, base + 0.8 * i) for i in range(3)]
        elif num in (120, 121):
            fases = [(-0.4, 1.1), (-0.4, 1.9), (-0.4, 2.7)]       # lámina S-120
            guarda = [(0.0, 0.1)]
        elif c["disposicion"] == "semibandera":
            fases = _fila(0.3 if not ret else 0.45, [-0.6, 0.6, 1.2])
        else:  # triangular (lámina P-102)
            fases = [(0.95, 0.3), (-0.9, 1.3), (0.9, 1.3)]
            if pre == "R":
                fases = [(0, 0.4), (-0.9, 1.4), (0.9, 1.4)]
            if pre == "S":
                fases = [(0, 0.9), (-0.9, 1.9), (0.9, 1.9)]
    else:  # redes urbanas sin cable de guarda (5xx)
        dzr = 0.15 if ret or fun == "Derivación" else 0.0
        bif = c.get("fases") == 2
        if c["disposicion"] == "vertical":
            fases = [(0.4, 0.4), (0.4, 1.0)] + ([] if bif else [(0.4, 1.6)])       # lámina EH-541
        elif c["disposicion"] == "bandera":
            fases = _fila(dzr, [0.75, 1.25, 1.75] if 2.0 in c["crucetas_m"] else [1.05, 1.6, 2.15])  # lámina EH-521
        elif c["disposicion"] == "semibandera":
            fases = _fila(dzr, [-0.6, 0.6, 1.2])
        elif c["disposicion"] in ("simétrica", "triangular"):
            fases = [(0, -0.2), (-0.65, 0.3), (0.65, 0.3)] if not ret else [(0, 0.1), (-0.65, 0.5), (0.65, 0.5)]  # lámina EH-522
            if num in (524, 525):
                fases = [(0, -0.2), (-1.0, 0.4), (1.0, 0.4)]
        else:  # horizontal centrada
            fases = [(-0.9, dzr), (0.9, dzr)] if bif else _fila(dzr, [-0.9, 0, 0.9])
        if c["circuitos"] >= 2:
            fases = fases + [(x, z + 1.0) for x, z in fases]
    if re.match(r"EH-SH-?225", k):   # lámina SH-225: fase central en cruceta de 2 m, dos fases en la de 4 m
        fases = [(0, 1.8), (-1.9, 3.2), (1.9, 3.2)]
    if not fases:
        fases = _fila(0.2, [-0.9, 0, 0.9])
    if c["nivel"] == "34.5 kV":   # mayores separaciones en 34.5 kV (aprox.)
        fases = [(x * 1.1, z if z <= 0.3 else round(0.3 + (z - 0.3) * 1.2, 2)) for x, z in fases]
    fases = [(round(x, 2), round(z, 2)) for x, z in fases]
    return {"fases": fases, "guarda": [(round(x, 2), round(z, 2)) for x, z in guarda],
            "postes": [-H_SEP / 2, H_SEP / 2] if h else [0.0],
            "bajo_cima_m": max(z for _, z in fases),
            "fuente": "lámina" if k in LEIDAS else "típica de la familia (aprox.)"}


# ----------------------------------------------------------------------------- medidas de las láminas
# estructuras_eh/laminas.py guarda, para cada una de las 218 estructuras, lo leído en su lámina: crucetas, fases
# con su tipo de aislamiento, cable de guarda, postes, equipos y transformador. De ahí salen las fases para el
# cálculo y la pieza «lamina» que usa web/js/bloques3d.js para dibujar el bloque 3D.
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from laminas import L as LAMINAS
except Exception:  # pragma: no cover
    LAMINAS = {}

# altura del conductor sobre la cara superior de la cruceta en aisladores de espigo
H_PIN = {"BT": 0.15, "13.2 kV": 0.22, "34.5 kV": 0.32}


def geometria_lamina(eid: str, nivel: str) -> dict | None:
    d = LAMINAS.get(eid)
    if not d:
        return None
    hp = H_PIN.get(nivel, 0.22)
    fases = []
    for x, z, t in d.get("f", []):
        if t in ("E", "E2"):
            z = z - hp
        elif t == "EP":
            z = z - (hp + 0.05)
        fases.append((round(x, 3), round(z, 3)))
    if "postes" in d:
        postes = [float(v) for v in d["postes"]]
    elif d.get("h"):
        postes = [-d["h"] / 2, d["h"] / 2]
    else:
        postes = [0.0]
    lam = {k: v for k, v in d.items() if k in ("cr", "f", "g", "d", "dv", "m", "brz", "eq", "tr") and v is not None}
    lam["hpin"] = hp
    g = {"fases": fases, "guarda": [(round(x, 3), round(z, 3)) for x, z in d.get("g", [])],
         "postes": [round(v, 3) for v in postes], "bajo_cima_m": round(max(z for _, z in fases), 3) if fases else 0.0,
         "fuente": "lámina", "lamina": lam}
    if d.get("py"):
        g["postes_y"] = [float(v) for v in d["py"]]
    return g


def solo_geometria():
    """Actualiza la geometría de web/estructuras_eh.json con las medidas de las láminas (sin el portal)."""
    ruta = WEB / "estructuras_eh.json"
    cat = json.loads(ruta.read_text(encoding="utf-8"))
    n = 0
    for r in cat["estructuras"]:
        g = geometria_lamina(r["id"], r["nivel"])
        if g:
            r["geometria"] = g
            n += 1
    cat["generado"] = date.today().isoformat()
    cat["nota"] = ("Función, aislamiento, circuitos y disposición se deducen del nombre de cada norma; "
                   "la geometría (crucetas, fases, guarda, postes, equipos) se tomó de cada lámina.")
    ruta.write_text(json.dumps(cat, ensure_ascii=False, indent=0), encoding="utf-8")
    print(n, "estructuras con geometría de lámina de", len(cat["estructuras"]))


def main():
    if "--solo-geometria" in sys.argv:
        return solo_geometria()
    normas = cargar_js(FUENTE / "data" / "normas.js")["normas"]
    mini = cargar_js(FUENTE / "data" / "miniaturas.js")
    (SALIDA / "mini").mkdir(parents=True, exist_ok=True)
    (SALIDA / "pdf").mkdir(parents=True, exist_ok=True)
    cat = []
    for n in normas:
        if not incluir(n):
            continue
        r = {"id": n["id"], "codigo": re.sub(r"\s+", " ", n["codigo"]).strip(), "nombre": re.sub(r"\s+", " ", n["nombre"]).strip(),
             "fecha": n.get("fecha"), **clasificar(n)}
        r["geometria"] = geometria_lamina(n["id"], r["nivel"]) or geometria(r["codigo"], sin_tildes(n["nombre"]), r)
        b64 = mini.get(n["id"], "")
        if b64.startswith("data:image"):
            (SALIDA / "mini" / f"{n['id']}.jpg").write_bytes(base64.b64decode(b64.split(",", 1)[1]))
            r["mini"] = True
        pdf = FUENTE / "docs" / f"{n['id']}.pdf"
        if pdf.is_file():
            shutil.copyfile(pdf, SALIDA / "pdf" / pdf.name)
            r["pdf"] = True
        cat.append(r)
    out = {"version": 1, "generado": date.today().isoformat(),
           "fuente": "Electrohuila S.A. E.S.P. – Normas Técnicas para Construcción (EH), redes aéreas; portal «App normativa»",
           "nota": "Función, aislamiento, circuitos y disposición se deducen del nombre de cada norma; confírmelos en la lámina.",
           "estructuras": cat}
    (WEB / "estructuras_eh.json").write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    from collections import Counter
    print(len(cat), "estructuras;", Counter((c["nivel"], c["funcion"]) for c in cat))


if __name__ == "__main__":
    main()
