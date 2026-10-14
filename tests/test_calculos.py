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
