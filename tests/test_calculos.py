"""Pruebas automáticas.  Ejecutar:  python -m pytest -q   (desde la carpeta del programa)"""
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from calculos_mecanicos.cambio_estado import (ErrorCalculo, calcular_estado, flecha_catenaria,
                                              flecha_parabolica, resolver_cambio_estado,
                                              vano_regulador)
from calculos_mecanicos.catenaria import catenaria_por_flecha, catenaria_por_parametro
from calculos_mecanicos.config import Conductor, Proyecto, hipotesis_por_defecto
from calculos_mecanicos.datos import leer_datos
from calculos_mecanicos.exportar import abscisa_k, exportar_dxf, exportar_todo
from calculos_mecanicos.plantillado import calcular_plantillado

EJ = RAIZ / "ejemplos"
COND = Conductor()


# ----------------------------------------------------------------- catenaria
@pytest.mark.parametrize("x1,y1,x2,y2,C", [(0, 100, 120, 100, 800), (0, 100, 150, 125, 600),
                                           (50, 380, 180, 340, 900), (0, 0, 30, 0.5, 300)])
def test_catenaria_pasa_por_apoyos(x1, y1, x2, y2, C):
    c = catenaria_por_parametro(x1, y1, x2, y2, C)
    assert c.y(x1) == pytest.approx(y1, abs=1e-8)
    assert c.y(x2) == pytest.approx(y2, abs=1e-8)
    assert c.longitud > math.hypot(x2 - x1, y2 - y1)


def test_flecha_vano_nivelado_coincide_con_formula():
    c = catenaria_por_parametro(0, 0, 200, 0, 700)
    assert c.flecha == pytest.approx(700 * (math.cosh(100 / 700) - 1), rel=1e-10)
    assert c.flecha == pytest.approx(flecha_parabolica(1, 200, 700), rel=5e-3)


@pytest.mark.parametrize("f", [0.15, 1.0, 2.5, 6.0])
@pytest.mark.parametrize("dy", [0, 5, -26, 30])
def test_catenaria_por_flecha_recupera_flecha(f, dy):
    c = catenaria_por_flecha(1650, 373, 1780, 373 + dy, f)
    assert c.flecha == pytest.approx(f, rel=1e-8)


def test_errores_claros():
    with pytest.raises(ErrorCalculo):
        catenaria_por_parametro(10, 0, 5, 0, 500)        # X decreciente
    with pytest.raises(ErrorCalculo):
        catenaria_por_flecha(0, 0, 100, 0, 0)            # flecha 0 (el original devolvía basura)
    with pytest.raises(ErrorCalculo):
        catenaria_por_parametro(0, 0, 100, float("nan"), 500)


# ------------------------------------------------------------ cambio estado
def test_cambio_estado_identidad_y_reversible():
    H1 = 480.0
    assert resolver_cambio_estado(H1, 0.5486, 20, 0.5486, 20, 120, COND) == pytest.approx(H1, rel=1e-9)
    H2 = resolver_cambio_estado(H1, 0.5486, 20, 0.89, 0, 120, COND)
    H1b = resolver_cambio_estado(H2, 0.89, 0, 0.5486, 20, 120, COND)
    assert H1b == pytest.approx(H1, rel=1e-9)


def test_temperatura_mayor_reduce_tension():
    a = resolver_cambio_estado(480, 0.5486, 20, 0.5486, 50, 120, COND)
    b = resolver_cambio_estado(480, 0.5486, 20, 0.5486, 0, 120, COND)
    assert a < 480 < b


def test_vano_regulador():
    assert vano_regulador([100]) == pytest.approx(100)
    assert vano_regulador([100, 200]) == pytest.approx(math.sqrt((1e6 + 8e6) / 300))


@pytest.mark.parametrize("ar", [30, 80, 130, 250, 400])
def test_hipotesis_gobernante_respeta_limites(ar):
    hip = hipotesis_por_defecto()
    e = calcular_estado(ar, COND, hip)
    rot = COND.carga_rotura_kgf
    for k, h in hip.items():
        if h.limite_fraccion_rotura:
            assert e.tensiones[k] <= h.limite_fraccion_rotura * rot * (1 + 1e-6)
    g = hip[e.hipotesis_gobernante]
    assert e.tensiones[e.hipotesis_gobernante] == pytest.approx(g.limite_fraccion_rotura * rot)


def test_viento_norma_eh_raa_004():
    # EH-RAA-004 §4.1: 2/0 ACSR D=11.354 mm, V=100 km/h -> fv = 0.477 kgf/m
    h = hipotesis_por_defecto()["TMAX"]
    c = Conductor(diametro_mm=11.354, peso_kgf_m=0.2725)
    assert h.presion_viento_kgf_m2() * c.diametro_m == pytest.approx(0.477, abs=1e-3)
    assert h.peso_aparente(c) == pytest.approx(0.549, abs=1e-3)   # valor de la norma


# ---------------------------------------------------------------- datos / flujo
def test_lectura_archivo_original():
    d = leer_datos(EJ / "DATOS.xlsx")
    assert d.ok and d.n_apoyos == 23
    assert d.conductor is not None and d.conductor.carga_rotura_kgf == 2404
    assert any("AP-145" in a for a in d.advertencias)          # cota sospechosa detectada


def test_x_no_creciente_es_error(tmp_path):
    f = tmp_path / "malo.xlsx"
    pd.DataFrame({"Apoyo": ["A", "B", "C"], "Coordenada en X": [0, 100, 90],
                  "Coordenada en Y": [10, 10, 10]}).to_excel(f, index=False)
    d = leer_datos(f)
    assert not d.ok and "creciente" in d.errores[0]


def test_hoja_vacia_no_revienta(tmp_path):
    f = tmp_path / "vacio.xlsx"
    pd.DataFrame().to_excel(f, index=False)
    assert not leer_datos(f).ok


def test_plantillado_invariantes():
    d = leer_datos(EJ / "DATOS_EJEMPLO_COMPLETO.xlsx")
    p = Proyecto(); p.conductor = d.conductor
    r = calcular_plantillado(d, p)
    assert len(r.secciones) == 4
    # H igual en todos los vanos de una sección
    for s in r.secciones:
        Cs = {round(r.catenarias[i].C, 9) for i in range(s.i_ini, s.i_fin)}
        assert len(Cs) == 1
    # Σ gravivanos = longitud horizontal total
    col = [c for c in r.apoyos.columns if c.startswith("Gravivano")][0]
    assert r.apoyos[col].sum() == pytest.approx(r.apoyos["X (m)"].iloc[-1] - r.apoyos["X (m)"].iloc[0], abs=0.05)
    # el lomo de terreno del ejemplo se detecta
    assert (r.vanos["Cumple distancia"] == "NO").sum() >= 1


def test_modo_excel_respeta_flechas_del_archivo():
    d = leer_datos(EJ / "DATOS.xlsx")
    p = Proyecto(modo_flecha="excel")
    r = calcular_plantillado(d, p)
    np.testing.assert_allclose([c.flecha for c in r.catenarias], d.flechas_excel, rtol=1e-8)


def test_exportaciones(tmp_path):
    d = leer_datos(EJ / "DATOS_EJEMPLO_COMPLETO.xlsx")
    p = Proyecto(); p.conductor = d.conductor
    r = calcular_plantillado(d, p)
    rutas = exportar_todo(r, tmp_path)
    for ruta in rutas.values():
        assert ruta.exists() and ruta.stat().st_size > 1000
    r12 = exportar_dxf(r, tmp_path / "r12.dxf", forzar_r12=True)
    txt = r12.read_text(encoding="cp1252")
    assert txt.strip().endswith("EOF") and "CONDUCTOR" in txt
    assert set(pd.ExcelFile(rutas["xlsx"]).sheet_names) >= {"Resumen", "Vanos", "Apoyos", "Secciones"}


def test_abscisa_k():
    assert abscisa_k(1780.5) == "K1+780.50"
    assert abscisa_k(26.2) == "K0+026.20"


# ------------------------------------------------------------- motor JSON (web)
def test_motor_importar_calcular_exportar():
    import json
    from calculos_mecanicos import motor
    imp = motor.importar_excel((EJ / "DATOS_EJEMPLO_COMPLETO.xlsx").read_bytes())
    assert imp["ok"] and len(imp["apoyos"]) == 23 and len(imp["terreno"]) > 100
    payload = json.loads(json.dumps({"proyecto": {"conductor": imp["conductor"]},
                                     "apoyos": imp["apoyos"], "terreno": imp["terreno"]}))
    r = motor.calcular(payload)
    assert r["ok"] and r["resumen"]["Número de vanos"] == 22
    assert len(r["perfil"]["vanos"]) == 22 and r["perfil"]["terreno"]
    json.dumps(r)  # serializable
    for fmt in ("xlsx", "pdf", "dxf"):
        datos, nombre, mime = motor.exportar(payload, fmt)
        assert len(datos) > 1000 and nombre.endswith(fmt)


def test_motor_errores_legibles():
    from calculos_mecanicos import motor
    r = motor.calcular({"apoyos": [{"nombre": "A", "x": 0, "y": 1}, {"nombre": "B", "x": -5, "y": 1}]})
    assert not r["ok"] and any("creciente" in e for e in r["errores"])
    r = motor.calcular({"apoyos": [{"nombre": "A", "x": "abc", "y": 1}, {"nombre": "B", "x": 5, "y": 1}]})
    assert not r["ok"]


def test_motor_coma_decimal_y_parametros_parciales():
    from calculos_mecanicos import motor
    r = motor.calcular({"proyecto": {"criterios": {"distancia_minima_terreno_m": 6.5}},
                        "apoyos": [{"nombre": "A", "x": "0", "y": "100,5", "altura": "10", "tipo": "R"},
                                   {"nombre": "B", "x": "120,0", "y": "101", "altura": 10, "tipo": "R"}]})
    assert r["ok"] and r["perfil"]["dmin"] == 6.5


# ===================================================================== ETAPA 1: geoespacial
from calculos_mecanicos import geo, importacion, kml  # noqa: E402
from calculos_mecanicos.almacen import Almacen  # noqa: E402

PUNTOS_CO = [(2.9273, -75.2819), (1.8537, -76.0507), (4.6097, -74.0817), (11.0, -74.8), (-4.2, -69.94), (7.1, -73.1)]


@pytest.mark.parametrize("codigo", ["ORIGEN_NACIONAL", "GK_BOGOTA", "GK_OESTE", "UTM18N"])
def test_tm_ida_y_vuelta_submilimetrica(codigo):
    for lat, lon in PUNTOS_CO:
        E, N = geo.desde_geograficas(codigo, lat, lon, motor="propio")
        la, lo = geo.a_geograficas(codigo, E, N, motor="propio")
        assert abs(la - lat) * 111_320 < 1e-4 and abs(lo - lon) * 111_320 < 1e-4


def test_tm_valores_de_control():
    # origen de cada proyección = falso Este / falso Norte (Res. IGAC 471 de 2020 para Origen Nacional)
    assert geo.desde_geograficas("ORIGEN_NACIONAL", 4.0, -73.0, motor="propio") == pytest.approx((5_000_000, 2_000_000), abs=1e-6)
    s = geo.SISTEMAS["GK_BOGOTA"]
    assert geo.desde_geograficas("GK_BOGOTA", s.lat0, s.lon0, motor="propio") == pytest.approx((1_000_000, 1_000_000), abs=1e-6)
    # UTM sobre el meridiano central: N = 0,9996 × arco de meridiano (10° N WGS84 = 1 105 854,833 m)
    E, N = geo.desde_geograficas("UTM18N", 10.0, -75.0, motor="propio")
    assert E == pytest.approx(500_000, abs=1e-6) and N == pytest.approx(0.9996 * 1_105_854.833, abs=0.01)


def test_distancia_geodesica_ecuador():
    assert geo._vincenty(0, 0, 0, 1) == pytest.approx(6378137 * math.pi / 180, abs=1e-6)


@pytest.mark.skipif(not geo.HAY_PYPROJ, reason="pyproj no instalado")
@pytest.mark.parametrize("codigo", ["ORIGEN_NACIONAL", "GK_BOGOTA", "GK_OESTE", "GK_OESTE_OESTE",
                                    "GK_ESTE_CENTRAL", "GK_ESTE", "UTM17N", "UTM18N", "UTM19N"])
def test_implementacion_propia_coincide_con_pyproj(codigo):
    """Verificación cruzada contra PROJ/EPSG: confirma parámetros y fórmulas (≤ 1 cm)."""
    for lat, lon in PUNTOS_CO:
        Ep, Np = geo.desde_geograficas(codigo, lat, lon, motor="auto")
        Eo, No = geo.desde_geograficas(codigo, lat, lon, motor="propio")
        if abs(Ep) > 1e8:  # fuera del dominio de la proyección
            continue
        assert math.hypot(Ep - Eo, Np - No) < 0.01, (codigo, lat, lon, Ep - Eo, Np - No)


@pytest.mark.skipif(not geo.HAY_PYPROJ, reason="pyproj no instalado")
def test_geodesica_karney_vs_vincenty():
    g = geo.distancia_geodesica(2.9273, -75.2819, 2.9473, -75.2619)
    assert g == pytest.approx(geo._vincenty(2.9273, -75.2819, 2.9473, -75.2619), abs=1e-4)


@pytest.mark.parametrize("texto,eje,valor", [
    ("2°55'38.28\"N", "lat", 2.9273), ("75 16 54.84 O", "lon", -75.2819), ("-75,2819", "lon", -75.2819),
    ("S 4 12 0", "lat", -4.2), ("75°16'54.84\"W", "lon", -75.2819), (2.9273, "lat", 2.9273)])
def test_leer_angulos(texto, eje, valor):
    assert geo.leer_angulo(texto, eje) == pytest.approx(valor, abs=1e-7)


@pytest.mark.parametrize("malo,eje", [("95", "lat"), ("2 61 0 N", "lat"), ("2 30 0 E", "lat"), ("abc", "lon")])
def test_angulos_invalidos(malo, eje):
    with pytest.raises(geo.ErrorGeo):
        geo.leer_angulo(malo, eje)


def test_deteccion_propone_y_no_decide():
    E, N = geo.desde_geograficas("GK_BOGOTA", 2.93, -75.28, motor="propio")
    cand = geo.detectar_sistema([(E, N)])
    assert cand and cand[0]["codigo"] == "GK_BOGOTA" and not cand[0]["ejes_invertidos"]
    cand = geo.detectar_sistema([(-75.28, 2.93)])            # lat/lon cruzados
    assert cand[0]["ejes_invertidos"]
    assert geo.detectar_sistema([(10.0, 20.0)]) == []          # fuera de Colombia: sin candidatos


def test_helmert_recupera_rotacion_y_escala():
    ang, k = math.radians(25), 1.0003
    pts = [{"id": i, "x": x, "y": y, "E": 4_746_000 + k * (x * math.cos(ang) - y * math.sin(ang)),
            "N": 1_881_000 + k * (x * math.sin(ang) + y * math.cos(ang))}
           for i, (x, y) in enumerate([(0, 0), (300, 50), (120, 400), (500, 500)])]
    g = geo.georreferenciar(pts)
    assert g.rotacion_grados == pytest.approx(25, abs=1e-9) and g.escala == pytest.approx(k, abs=1e-12)
    assert g.rms_m < 1e-6
    with pytest.raises(geo.ErrorGeo):
        geo.georreferenciar(pts[:1])


def _csv_postes():
    filas = ["Poste;Latitud;Longitud;Cota", "AP-1;2,9273;-75,2819;440", "AP-2;2,9279;-75,2814;",
             "AP-3;2,9285;-75,2809;442", "AP-3;2,9285;-75,2809;442"]
    return "\n".join(filas).encode("cp1252")


def test_importacion_csv_mapeo_y_validaciones():
    t = importacion.leer_tabla(_csv_postes(), "p.csv")
    m = importacion.sugerir_mapeo(t["columnas"])
    assert m == {"nombre": "Poste", "lat": "Latitud", "lon": "Longitud", "z": "Cota"}
    r = importacion.previsualizar(t, m, None)
    assert not r["ok"] and r["candidatos"][0]["codigo"] == "WGS84"     # pide el sistema
    r = importacion.previsualizar(t, m, "WGS84")
    p = r["postes"]
    assert p[1]["z"] is None and p[0]["z"] == 440                       # vacío ≠ 0
    assert any("duplicado" in e for e in p[3]["errores"])               # duplicado detectado
    assert any("sin cota" in a for a in r["avisos"])


def test_kml_ida_y_vuelta_conserva_ids_y_orden():
    postes = [{"id": f"P-{i}", "nombre": f"AP-{i}", "lat": 2.9273 + i * 0.0005, "lon": -75.2819 + i * 0.0004,
               "z": 440.0 + i, "tipo": "S", "altura": 10.0} for i in range(5)]
    t = importacion.leer_tabla(kml.proyecto_a_kmz({"nombre": "x", "postes": postes}), "x.kmz")
    r = importacion.previsualizar(t, importacion.sugerir_mapeo(t["columnas"]), "WGS84", orden="linea_kml")
    assert [q["id"] for q in r["postes"]] == [p["id"] for p in postes]
    assert r["postes"][2]["lat"] == pytest.approx(postes[2]["lat"], abs=1e-9)
    assert r["postes"][2]["z"] == 442.0


def test_calculo_con_coordenadas_geograficas():
    from calculos_mecanicos import motor
    ap = [{"id": f"P{i}", "nombre": f"AP-{i}", "lat": 2.9273 + i * 0.0007, "lon": -75.2819 + i * 0.0004,
           "z": 440.0 + i, "altura": 10.0, "tipo": "R" if i in (0, 5) else "S"} for i in range(6)]
    r = motor.calcular({"apoyos": ap})
    assert r["ok"]
    total = sum(geo.distancia_geodesica(a["lat"], a["lon"], b["lat"], b["lon"]) for a, b in zip(ap[:-1], ap[1:]))
    assert r["resumen"]["Longitud horizontal (m)"] == pytest.approx(total, abs=0.01)
    assert "Deflexión (°)" in r["apoyos"]["columnas"]
    ap[2]["z"] = None
    assert not motor.calcular({"apoyos": ap})["ok"]                     # sin cota: no calcula


def test_almacen_proyectos_y_versiones(tmp_path):
    a = Almacen(tmp_path / "app.db")
    r = a.guardar({"proyecto": {"nombre": "Piloto"}, "apoyos": [{"id": "P-1"}], "meta": {"municipio": "Neiva"}})
    pid = r["id"]
    a.crear_version(pid, "inicial")
    a.guardar({"proyecto": {"nombre": "Piloto"}, "apoyos": [{"id": "P-1"}, {"id": "P-2"}]}, pid)
    assert a.obtener(pid)["datos"]["apoyos"][1]["id"] == "P-2"
    v = a.versiones(pid)
    assert len(v) == 1 and len(a.obtener_version(pid, v[0]["id"])["datos"]["apoyos"]) == 1
    assert [b["accion"] for b in a.bitacora(pid)][-1] == "crear"
    assert a.listar()[0]["n_postes"] == 2
    a.archivar(pid)
    assert a.listar() == []



def test_almacen_guarda_calculo_completo_por_proyecto(tmp_path):
    """Cada proyecto conserva sus datos, el trazado y el último cálculo; los proyectos no se mezclan."""
    import json as _json
    from calculos_mecanicos import motor
    ej = _json.loads((Path(__file__).resolve().parents[1] / "web" / "ejemplo.json").read_text(encoding="utf-8"))
    res = motor.calcular(ej)
    assert res["ok"]
    a = Almacen(tmp_path / "app.db")
    calc = {"fecha": "2026-10-15T08:00:00", "desactualizado": False, "vanos": res["resumen"]["Número de vanos"],
            "longitud_m": res["resumen"]["Longitud horizontal (m)"], "no_cumplen": 0, "arrancamiento": 0,
            "advertencias": len(res["advertencias"])}
    pa = a.guardar({**ej, "meta": {"municipio": "Neiva"}, "resultado": res, "calculo": calc})["id"]
    pb = a.guardar({"proyecto": {"nombre": "Otro"}, "apoyos": [], "terreno": [], "meta": {}})["id"]
    datos = a.obtener(pa)["datos"]
    assert datos["resultado"]["resumen"] == res["resumen"] and len(datos["resultado"]["perfil"]["vanos"]) == len(res["perfil"]["vanos"])
    fila = {p["id"]: p for p in a.listar()}
    assert fila[pa]["calc_vanos"] == calc["vanos"] and fila[pa]["calc_longitud_m"] == pytest.approx(calc["longitud_m"])
    assert fila[pb]["calc_vanos"] is None and a.obtener(pb)["datos"].get("resultado") is None
    assert "con cálculo" in a.bitacora(pa)[0]["detalle"]

# ------------------------------------------------------------- mapa web gratuito (Leaflet / Folium)
_POSTES_MAPA = {"nombre": "Prueba <mapa>", "postes": [
    {"nombre": "P1", "lat": 2.9273, "lon": -75.2819, "z": 440.0, "altura": 10.5, "tipo": "R"},
    {"nombre": "P2", "lat": 2.9282, "lon": -75.2810, "z": 442.1, "altura": 10.5, "tipo": "S"},
    {"nombre": "P3</script>", "lat": 2.9290, "lon": -75.2800, "z": None, "altura": None, "tipo": "R"}]}


def test_mapa_html_plantilla_propia():
    from calculos_mecanicos.mapa_html import proyecto_a_html
    h = proyecto_a_html(_POSTES_MAPA, usar_folium=False)
    assert "leaflet@1.9.4" in h and "World_Imagery" in h and "openstreetmap" in h
    assert "Prueba &lt;mapa&gt;" in h and "P3</script>" not in h  # escapado
    assert h.count('"lat"') == 3


def test_mapa_html_sin_coordenadas():
    from calculos_mecanicos.mapa_html import proyecto_a_html
    with pytest.raises(ValueError):
        proyecto_a_html({"nombre": "x", "postes": [{"nombre": "P1"}]})


def test_exportar_html_desde_motor():
    from calculos_mecanicos import motor
    datos, nombre, mime = motor.exportar({"proyecto": {"nombre": "Linea 1"}, "apoyos": _POSTES_MAPA["postes"]}, "html")
    assert nombre.endswith("_MAPA.html") and mime.startswith("text/html") and b"<html" in datos.lower()


@pytest.mark.skipif(not __import__("calculos_mecanicos.mapa_html", fromlist=["x"]).HAY_FOLIUM, reason="folium no instalado")
def test_mapa_html_con_folium():
    from calculos_mecanicos.mapa_html import proyecto_a_html
    h = proyecto_a_html(_POSTES_MAPA, usar_folium=True)
    assert "World_Imagery" in h and "leaflet" in h.lower()


# ------------------------------------------------------------- postes y templetes
def _linea_postes(templete=None, rot_ext=750, rot_int=510, bajo_cima_primero=None, estructura_primero=None):
    ap = [{"nombre": "E1", "lat": 2.9273, "lon": -75.2819, "z": 440, "tipo": "R", "poste_altura": 12, "poste_rotura": rot_ext},
          {"nombre": "E2", "lat": 2.9281, "lon": -75.2819, "z": 441, "tipo": "S", "poste_altura": 12, "poste_rotura": rot_int},
          {"nombre": "E3", "lat": 2.9289, "lon": -75.2819, "z": 442, "tipo": "R", "poste_altura": 12, "poste_rotura": rot_ext,
           "poste_peso": 1111, "templetes": templete or []}]
    if bajo_cima_primero is not None:
        ap[0].update(bajo_cima_m=bajo_cima_primero, estructura=estructura_primero)
    from calculos_mecanicos import motor
    r = motor.calcular({"proyecto": {}, "apoyos": ap})
    assert r["ok"], r.get("errores")
    t = r["postes"]
    return r, [dict(zip(t["columnas"], f)) for f in t["filas"]]


def test_amarre_sale_de_la_altura_del_poste():
    r, filas = _linea_postes()
    # 12 m: empotramiento 0.1·12 + 0.6 = 1.8 m; libre 10.2; conductor 0.70 m bajo la cima (EH-RAA-004) -> 9.5 m
    assert filas[0]["Empotramiento (m)"] == pytest.approx(1.8) and filas[0]["Altura amarre (m)"] == pytest.approx(9.5)
    ap = dict(zip(r["apoyos"]["columnas"], r["apoyos"]["filas"][0]))
    assert ap["Altura amarre (m)"] == pytest.approx(9.5) and ap["Cota amarre (m)"] == pytest.approx(449.5)


def test_terminal_sin_templete_y_alineacion_sin_tiro():
    r, filas = _linea_postes()
    H = None
    sec = dict(zip(r["secciones"]["columnas"], r["secciones"]["filas"][0]))
    H = sec["H TMAX (kgf)"]
    assert filas[0]["Tiro conductores TMAX (kgf)"] == pytest.approx(3 * H, rel=1e-3)   # terminal: n·H
    assert filas[1]["Tiro conductores TMAX (kgf)"] == pytest.approx(0, abs=0.5)        # recta, igual H
    assert filas[0]["Estado"] == "REQUIERE TEMPLETE"
    assert r["resumen"]["Postes que requieren templete"] >= 1
    assert any("E1" in a and "templete" in a for a in r["advertencias"])


def test_templete_tension_geometria_y_peso():
    tp = [{"cantidad": 2, "cable": '3/8" EHS', "rotura_kgf": 6985, "distancia_m": 7.5, "altura_m": 10.0}]
    r, filas = _linea_postes(tp)
    f = filas[2]
    M = (f["Tiro conductores TMAX (kgf)"] ** 2 + f["Viento conductores (kgf)"] ** 2) ** 0.5 * 9.5 + f["Viento poste (kgf)"] * 10.2 / 2
    Ht = M / 10.0
    sen = 7.5 / (7.5 ** 2 + 10 ** 2) ** 0.5
    assert f["Tensión por templete (kgf)"] == pytest.approx(Ht / (2 * sen), rel=1e-3)
    assert f["Utilización templete (%)"] == pytest.approx(100 * f["Tensión por templete (kgf)"] / (6985 / 2.5), rel=1e-3)
    assert f["Estado"] in ("OK con templete", "TEMPLETE INSUFICIENTE")
    assert f["Peso poste (kg)"] == 1111 and f["Peso estimado"] == ""
    assert f["Carga vertical (kgf)"] > 1111 + Ht * 10 / 7.5          # peso + compresión del templete
    assert filas[1]["Peso estimado"] == "catálogo"


def test_importacion_reconoce_columnas_de_poste():
    from calculos_mecanicos import importacion as I
    m = I.sugerir_mapeo(["Poste", "Latitud", "Longitud", "Cota", "Altura poste", "Carga rotura", "Peso", "Tipo"])
    assert m["poste_altura"] == "Altura poste" and m["poste_rotura"] == "Carga rotura" and m["poste_peso"] == "Peso"
    assert "altura" not in m


# ------------------------------------------------------------- perfil del terreno desde lat/lon
def test_muestras_perfil_abscisas_y_estructuras():
    from calculos_mecanicos import geo
    pts = [(2.9273, -75.2819), (2.9281, -75.2812), (2.9290, -75.2805)]
    r = geo.muestras_perfil(pts, 10)
    m = r["muestras"]
    xs = [p["x"] for p in m]
    assert all(b > a for a, b in zip(xs, xs[1:])) and xs[0] == 0
    assert [p["apoyo"] for p in m if p["apoyo"] is not None] == [0, 1, 2]
    assert r["longitud_m"] == pytest.approx(geo.abscisas(pts)[-1], abs=1e-3)
    assert max(b - a for a, b in zip(xs, xs[1:])) <= 10.0 + 1e-6
    r2 = geo.muestras_perfil(pts, 1, max_muestras=50)
    assert len(r2["muestras"]) <= 50


def test_perfil_con_terreno_de_modelo_y_poste_sobre_el_terreno():
    from calculos_mecanicos import geo, motor
    pts = [(2.9273, -75.2819), (2.9281, -75.2812), (2.9290, -75.2805)]
    m = geo.muestras_perfil(pts, 10)["muestras"]
    # terreno con una loma a mitad del primer vano
    terreno = [{"x": p["x"], "cota": 440 + (8 if 50 < p["x"] < 70 else 0)} for p in m]
    ap = [{"nombre": f"E{i+1}", "lat": la, "lon": lo, "z": 440 + (3 if i == 1 else 0), "tipo": "R" if i != 1 else "S",
           "poste_altura": 12, "poste_rotura": 750} for i, (la, lo) in enumerate(pts)]
    r = motor.calcular({"proyecto": {}, "apoyos": ap, "terreno": terreno})
    assert r["ok"], r.get("errores")
    t = r["perfil"]["terreno"]
    x1 = r["perfil"]["apoyos"][1]["x"]
    k = min(range(len(t["x"])), key=lambda j: abs(t["x"][j] - x1))
    assert t["y"][k] == pytest.approx(443)           # el terreno pasa por la base del poste (Z corregida)
    v = dict(zip(r["vanos"]["columnas"], r["vanos"]["filas"][0]))
    assert 50 < v["X dist. mín."] < 70               # la loma intermedia gobierna la distancia


# ------------------------------------------------------------- carga masiva Name/Latitud/Longitud
def _xlsx(filas):
    import io as _io
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active
    for f in filas:
        ws.append(f)
    b = _io.BytesIO(); wb.save(b); return b.getvalue()


def test_carga_estructuras_excel_valida_y_nombra():
    from calculos_mecanicos.carga_estructuras import leer_estructuras
    r = leer_estructuras(_xlsx([["Name", "Latitud", "Longitud"],
                                ["P1", 2.9273, -75.2819],
                                [None, "2,9281", "-75,2812"],          # sin nombre, coma decimal
                                ["P3", "abc", -75.28],                 # latitud no numérica
                                ["P4", -75.2805, 2.9290],              # invertidas -> se corrigen
                                ["P5", 40.0, -3.7],                    # fuera de Colombia
                                ["P1", 2.93, -75.27]]),                # nombre repetido
                         "e.xlsx", ["AP-001"])
    f = {x["fila"]: x for x in r["filas"]}
    assert r["validas"] == 3 and r["con_error"] == 3 and r["filas_con_error"] == [4, 6, 7]
    assert f[3]["nombre"] == "AP-002" and f[3]["nombre_auto"] and f[3]["lat"] == pytest.approx(2.9281)
    assert f[5]["lat"] == pytest.approx(2.9290) and f[5]["lon"] == pytest.approx(-75.2805) and f[5]["avisos"]
    assert "Colombia" in f[6]["errores"][0] and "ya existe" in f[7]["errores"][0]


def test_carga_estructuras_respeta_encabezado_y_exige_tres_columnas():
    from calculos_mecanicos.carga_estructuras import leer_estructuras
    r = leer_estructuras(_xlsx([["Name", "Longitud", "Latitud"], ["A", -75.2819, 2.9273]]), "e.xlsx")
    assert r["filas"][0]["lat"] == pytest.approx(2.9273) and r["filas"][0]["lon"] == pytest.approx(-75.2819)
    r2 = leer_estructuras(_xlsx([["X1", 2.9273, -75.2819]]), "e.xlsx")     # sin encabezado
    assert r2["validas"] == 1 and r2["filas"][0]["nombre"] == "X1"
    with pytest.raises(ValueError):
        leer_estructuras(_xlsx([["Name", "Latitud"], ["A", 2.9]]), "e.xlsx")


def test_advertencia_estructura_mal_ubicada():
    from types import SimpleNamespace
    import pandas as pd
    from calculos_mecanicos import motor
    datos = SimpleNamespace(geo=[(2.0400, -75.9700), (2.0410, -75.9700), (2.0550, -75.9600), (2.0420, -75.9700)],
                            apoyos=pd.DataFrame({"nombre": ["A", "B", "C", "D"]}))
    res = SimpleNamespace(advertencias=[])
    motor._advertir_geometria(datos, res)
    assert len(res.advertencias) == 1 and "C" in res.advertencias[0] and "mal ubicada" in res.advertencias[0]
    datos.geo = [(2.0400, -75.9700), (2.0410, -75.9700), (2.0420, -75.9700), (2.0430, -75.9700)]
    res.advertencias = []
    motor._advertir_geometria(datos, res)
    assert res.advertencias == []


# ------------------------------------------------------------- varios circuitos en la misma estructura
def _linea_multi(circuitos, n=5, poste=14):
    from calculos_mecanicos import motor
    ap = [{"nombre": f"E{i+1}", "lat": 2.9273 + 0.0008 * i, "lon": -75.2819 + (0.0004 if i == 2 else 0), "z": 440 + i,
           "tipo": "R" if i in (0, n - 1) else "S", "poste_altura": poste, "poste_rotura": 1050} for i in range(n)]
    r = motor.calcular({"proyecto": {"circuitos": circuitos}, "apoyos": ap})
    assert r["ok"], r.get("errores")
    return r


def _filas(t):
    return [dict(zip(t["columnas"], f)) for f in t["filas"]]


def test_circuito_identico_duplica_cargas_del_poste():
    from dataclasses import asdict
    from calculos_mecanicos.config import Conductor
    base = _linea_multi([])
    # mismo conductor, mismo tramo y misma altura (bajo_cima = 0.20) que el principal
    dup = _linea_multi([{"nombre": "C2", "tension_kv": 13.2, "conductor": asdict(Conductor()), "bajo_cima_m": 0.2}])
    p0, p1 = _filas(base["postes"]), _filas(dup["postes"])
    for a, b in zip(p0, p1):
        assert b["Tiro conductores TMAX (kgf)"] == pytest.approx(2 * a["Tiro conductores TMAX (kgf)"], rel=1e-3, abs=0.2)
        assert b["Viento conductores (kgf)"] == pytest.approx(2 * a["Viento conductores (kgf)"], rel=1e-3)
        assert b["Circuitos"] == "Circuito 1, C2"
    # separación nula: circuitos superpuestos → no cumple
    sep = _filas(dup["separaciones"])
    assert len(sep) == 4 and all(s["Cumple separación"] == "NO" for s in sep)
    assert dup["resumen"]["Circuitos"] == 2


def test_circuito_por_tramo_y_altura_de_montaje():
    from dataclasses import asdict
    from calculos_mecanicos.config import BIBLIOTECA_CONDUCTORES
    rv = asdict(BIBLIOTECA_CONDUCTORES["1/0 ACSR RAVEN 6/1"])
    r = _linea_multi([{"nombre": "C2 13,8", "tension_kv": 13.8, "conductor": rv, "desde": "E2", "hasta": "E4", "bajo_cima_m": 1.6}])
    c = r["perfil"]["circuitos"][0]
    assert (c["i0"], c["i1"]) == (1, 3) and len(c["vanos"]) == 2 and c["vanos"][0]["i"] == 1
    # amarre: 14 − (0.1·14 + 0.6) − 1.6 = 10.4 m sobre el terreno (E2 en cota 441)
    assert c["ya"][0] == pytest.approx(441 + 10.4, abs=1e-3)
    cargas = _filas(r["cargas_circuitos"])
    e2 = [f for f in cargas if f["Apoyo"] == "E2"]
    assert {f["Circuito"] for f in e2} == {"Circuito 1", "C2 13,8"}
    c2 = next(f for f in e2 if f["Circuito"] == "C2 13,8")
    assert c2["Función"] == "Terminal" and c2["Altura amarre (m)"] == pytest.approx(10.4)
    assert c2["Tiro (kgf)"] == pytest.approx(3 * c2["H der. TMAX (kgf)"], rel=1e-3)   # terminal: n·H
    # E1 y E5 solo llevan el principal
    assert not any(f["Apoyo"] in ("E1", "E5") and f["Circuito"] != "Circuito 1" for f in cargas)
    # el momento del poste es la suma de los momentos de cada circuito
    p = {f["Apoyo"]: f for f in _filas(r["postes"])}
    suma = sum(f["Momento en la base (kgf·m)"] for f in e2)
    assert p["E2"]["Momento conductores (kgf·m)"] == pytest.approx(suma, abs=0.5)
    sep = _filas(r["separaciones"])
    assert [s["Vano"] for s in sep] == [2, 3]
    assert all(s["Circuito superior"] == "Circuito 1" for s in sep)
    assert sep[0]["Separación en apoyos (m)"] == pytest.approx(1.6 - 0.7, abs=1e-3)   # principal a 0.70 m bajo la cima


def test_circuito_con_estructura_inexistente_da_error_claro():
    from calculos_mecanicos import motor
    ap = [{"nombre": f"E{i+1}", "lat": 2.9273 + 0.0008 * i, "lon": -75.2819, "z": 440, "poste_altura": 12} for i in range(3)]
    r = motor.calcular({"proyecto": {"circuitos": [{"nombre": "C2", "desde": "X9"}]}, "apoyos": ap})
    assert not r["ok"] and "X9" in r["errores"][0]


def test_exportaciones_con_varios_circuitos():
    from dataclasses import asdict
    import io
    import openpyxl
    from calculos_mecanicos import motor
    from calculos_mecanicos.config import BIBLIOTECA_CONDUCTORES
    ap = [{"nombre": f"E{i+1}", "lat": 2.9273 + 0.0008 * i, "lon": -75.2819, "z": 440 + i, "poste_altura": 14, "poste_rotura": 1050} for i in range(4)]
    pl = {"proyecto": {"circuitos": [{"nombre": "C2/34,5", "tension_kv": 34.5, "bajo_cima_m": 1.4,
                                      "conductor": asdict(BIBLIOTECA_CONDUCTORES["4/0 ACSR PENGUIN 6/1"])}]}, "apoyos": ap}
    b, _, _ = motor.exportar(pl, "xlsx")
    hojas = openpyxl.load_workbook(io.BytesIO(b)).sheetnames
    assert {"Circuitos", "Separación circuitos", "Cargas por circuito", "Vanos C234,5"} <= set(hojas)
    d, _, _ = motor.exportar(pl, "dxf")
    assert b"CIRCUITOS" in d


# ------------------------------------------------------------ base de clima por municipio (IDEAM)
def test_base_clima_huila():
    import json
    from calculos_mecanicos.motor import MUNICIPIOS_HUILA
    base = json.loads((RAIZ / "web" / "clima_huila.json").read_text(encoding="utf-8"))
    regs = {m["municipio"]: m for m in base["municipios"]}
    assert set(regs) == set(MUNICIPIOS_HUILA)          # los 37 municipios del asistente «Nuevo proyecto»
    for m in regs.values():
        assert 250 < m["alt_m"] < 2500
        assert (m["t_min_absoluta_c"] < m["t_min_media_mes_frio_c"] < m["t_media_anual_c"]
                < m["t_max_media_mes_calido_c"] < m["t_max_absoluta_c"]), m["municipio"]
        assert 0 < m["t_min_absoluta_c"] and m["t_max_absoluta_c"] < 47
    # los sitios bajos y cálidos (Neiva, Villavieja) son más calientes que los altos (San Agustín)
    assert regs["Villavieja"]["t_media_anual_c"] > regs["Neiva"]["t_media_anual_c"] - 1 > regs["San Agustín"]["t_media_anual_c"]
    # el gradiente con la altura de las normales IDEAM 1991-2020 es el físico (~ -0.6 °C/100 m)
    for g in base["metodo"]["gradiente_c_por_100m"].values():
        assert -1.0 < g < -0.4


# ------------------------------------------------------------ estructuras normalizadas EH
def test_estructura_eh_fija_la_altura_del_conductor():
    r0, f0 = _linea_postes()
    # la misma línea, con la estructura S-120 (fases verticales, la más baja 2.7 m bajo la cima) en el primer poste
    r1, f1 = _linea_postes(bajo_cima_primero=2.7, estructura_primero="EH-S120 N2")
    assert f1[0]["Altura amarre (m)"] == pytest.approx(12 - 1.8 - 2.7)
    assert f1[0]["Estructura EH"] == "EH-S120 N2"
    assert f1[1]["Altura amarre (m)"] == pytest.approx(f0[1]["Altura amarre (m)"])   # los demás no cambian


def test_catalogo_estructuras_eh():
    import json
    ruta = RAIZ / "web" / "estructuras_eh.json"
    if not ruta.is_file():
        pytest.skip("catálogo no generado")
    cat = json.loads(ruta.read_text(encoding="utf-8"))["estructuras"]
    assert len(cat) > 150
    por = {c["codigo"]: c for c in cat}
    rh = por["EH-RH231 N2"]
    assert rh["tipo"] == "R" and rh["poste"] == "H" and rh["guarda"]
    assert rh["geometria"]["bajo_cima_m"] == pytest.approx(0.74)         # lámina RH-231: cruceta a 0.70 m + grapa
    assert por["EH-S120 N2"]["geometria"]["bajo_cima_m"] == pytest.approx(2.75)
    assert por["EH-R131 N2"]["geometria"]["bajo_cima_m"] == pytest.approx(2.94)   # lámina R-131: crucetas a 1.7 y 2.9 m
    assert all(c["geometria"] and c["geometria"]["fuente"] == "lámina" and "lamina" in c["geometria"] for c in cat)
    assert por["EH-521 N2"]["tipo"] == "S"
    for c in cat:
        g = c["geometria"]
        if g:
            assert g["bajo_cima_m"] == max(z for _, z in g["fases"]) and -1 < g["bajo_cima_m"] < 5
