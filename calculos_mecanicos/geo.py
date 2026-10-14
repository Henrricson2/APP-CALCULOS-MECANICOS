"""
Motor geoespacial: sistemas de coordenadas de Colombia, transformaciones,
distancias geodésicas, georreferenciación de coordenadas locales y lectura de GMS.

Diseño
------
* Si `pyproj` (PROJ + base EPSG) está instalado, se usa para todas las
  transformaciones con código EPSG. Es la biblioteca de referencia.
* Además se incluye una implementación propia de la proyección Transversa de
  Mercator (series de Krüger de orden n⁶, Karney 2011, error < 1 mm en Colombia)
  y de la distancia geodésica (Vincenty). Sirve de respaldo donde pyproj no esté
  disponible (p. ej. Python en el navegador) y de VERIFICACIÓN CRUZADA: las
  pruebas comparan ambas implementaciones.
* MAGNA-SIRGAS y WGS84 usan el elipsoide GRS80/WGS84 y EPSG los relaciona con
  parámetros nulos; la diferencia real (decímetros, por la época de referencia)
  se documenta pero no se aplica.

Sistemas (parámetros oficiales):
* Origen Nacional (Res. IGAC 471 de 2020): TM, lat0 4° N, lon0 73° W,
  k0 0,9992, FE 5 000 000, FN 2 000 000, GRS80 — EPSG:9377.
* Gauss-Krüger MAGNA-SIRGAS (EPSG:3114–3118): lat0 4°35'46,3215" N,
  FE = FN = 1 000 000, k0 = 1, lon0 por origen.
* UTM WGS84 zonas 17N, 18N, 19N (EPSG:32617–32619).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import numpy as np

# ------------------------------------------------------------------ elipsoide
A_GRS80 = 6378137.0
F_GRS80 = 1 / 298.257222101
F_WGS84 = 1 / 298.257223563

try:  # biblioteca de referencia (opcional)
    import pyproj  # type: ignore
    HAY_PYPROJ = True
except Exception:  # pragma: no cover - depende del entorno
    pyproj = None
    HAY_PYPROJ = False


def _dms(g, m=0.0, s=0.0):
    return g + m / 60 + s / 3600


@dataclass(frozen=True)
class Sistema:
    codigo: str
    nombre: str
    tipo: str                 # "geografico" | "proyectado" | "local"
    epsg: int | None = None
    lat0: float = 0.0
    lon0: float = 0.0
    k0: float = 1.0
    fe: float = 0.0
    fn: float = 0.0
    f: float = F_GRS80
    ejes: tuple = ("E", "N")
    nota: str = ""

    def a_dict(self):
        return {"codigo": self.codigo, "nombre": self.nombre, "tipo": self.tipo,
                "epsg": self.epsg, "ejes": list(self.ejes), "nota": self.nota}


_LAT_GK = _dms(4, 35, 46.3215)
SISTEMAS: dict[str, Sistema] = {s.codigo: s for s in [
    Sistema("WGS84", "Latitud / longitud WGS84 (GPS, Google, KML)", "geografico", 4326,
            f=F_WGS84, ejes=("Latitud", "Longitud")),
    Sistema("MAGNA_GEO", "Latitud / longitud MAGNA-SIRGAS", "geografico", 4686,
            ejes=("Latitud", "Longitud")),
    Sistema("ORIGEN_NACIONAL", "MAGNA-SIRGAS Origen Nacional (CTM12)", "proyectado", 9377,
            lat0=4.0, lon0=-73.0, k0=0.9992, fe=5_000_000, fn=2_000_000,
            nota="Sistema oficial único (Res. IGAC 471 de 2020). Sistema interno de cálculo."),
    Sistema("GK_BOGOTA", "MAGNA-SIRGAS Gauss-Krüger origen Bogotá", "proyectado", 3116,
            lat0=_LAT_GK, lon0=-_dms(74, 4, 39.0285), fe=1_000_000, fn=1_000_000,
            nota="Usual en planos del Huila anteriores a 2020."),
    Sistema("GK_OESTE", "MAGNA-SIRGAS Gauss-Krüger origen Oeste", "proyectado", 3115,
            lat0=_LAT_GK, lon0=-_dms(77, 4, 39.0285), fe=1_000_000, fn=1_000_000),
    Sistema("GK_OESTE_OESTE", "MAGNA-SIRGAS Gauss-Krüger origen Oeste-Oeste", "proyectado", 3114,
            lat0=_LAT_GK, lon0=-_dms(80, 4, 39.0285), fe=1_000_000, fn=1_000_000),
    Sistema("GK_ESTE_CENTRAL", "MAGNA-SIRGAS Gauss-Krüger origen Este Central", "proyectado", 3117,
            lat0=_LAT_GK, lon0=-_dms(71, 4, 39.0285), fe=1_000_000, fn=1_000_000),
    Sistema("GK_ESTE", "MAGNA-SIRGAS Gauss-Krüger origen Este", "proyectado", 3118,
            lat0=_LAT_GK, lon0=-_dms(68, 4, 39.0285), fe=1_000_000, fn=1_000_000),
    Sistema("UTM18N", "UTM zona 18 Norte (WGS84)", "proyectado", 32618,
            lon0=-75.0, k0=0.9996, fe=500_000, f=F_WGS84, nota="Cubre todo el Huila."),
    Sistema("UTM17N", "UTM zona 17 Norte (WGS84)", "proyectado", 32617,
            lon0=-81.0, k0=0.9996, fe=500_000, f=F_WGS84),
    Sistema("UTM19N", "UTM zona 19 Norte (WGS84)", "proyectado", 32619,
            lon0=-69.0, k0=0.9996, fe=500_000, f=F_WGS84),
    Sistema("LOCAL", "Cartesianas locales de obra (requiere puntos de control)", "local",
            ejes=("X", "Y"), nota="Se georreferencian con Helmert 2D o afín y puntos de control."),
]}

INTERNO = "ORIGEN_NACIONAL"


class ErrorGeo(ValueError):
    pass


# ============================================================ Transversa Mercator
class TransversaMercator:
    """Series de Krüger hasta n⁶ (Karney, J. Geodesy 85, 2011)."""

    def __init__(self, s: Sistema, a: float = A_GRS80):
        f = s.f
        n = f / (2 - f)
        self.s, self.k0, self.fe, self.fn = s, s.k0, s.fe, s.fn
        self.lon0 = math.radians(s.lon0)
        self.e = math.sqrt(f * (2 - f))
        n2, n3, n4, n5, n6 = n ** 2, n ** 3, n ** 4, n ** 5, n ** 6
        self.A = a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256)
        self.alfa = [
            n / 2 - 2 / 3 * n2 + 5 / 16 * n3 + 41 / 180 * n4 - 127 / 288 * n5 + 7891 / 37800 * n6,
            13 / 48 * n2 - 3 / 5 * n3 + 557 / 1440 * n4 + 281 / 630 * n5 - 1983433 / 1935360 * n6,
            61 / 240 * n3 - 103 / 140 * n4 + 15061 / 26880 * n5 + 167603 / 181440 * n6,
            49561 / 161280 * n4 - 179 / 168 * n5 + 6601661 / 7257600 * n6,
            34729 / 80640 * n5 - 3418889 / 1995840 * n6,
            212378941 / 319334400 * n6]
        self.beta = [
            n / 2 - 2 / 3 * n2 + 37 / 96 * n3 - 1 / 360 * n4 - 81 / 512 * n5 + 96199 / 604800 * n6,
            1 / 48 * n2 + 1 / 15 * n3 - 437 / 1440 * n4 + 46 / 105 * n5 - 1118711 / 3870720 * n6,
            17 / 480 * n3 - 37 / 840 * n4 - 209 / 4480 * n5 + 5569 / 90720 * n6,
            4397 / 161280 * n4 - 11 / 504 * n5 - 830251 / 7257600 * n6,
            4583 / 161280 * n5 - 108847 / 3991680 * n6,
            20648693 / 638668800 * n6]
        self.delta = [
            2 * n - 2 / 3 * n2 - 2 * n3 + 116 / 45 * n4 + 26 / 45 * n5 - 2854 / 675 * n6,
            7 / 3 * n2 - 8 / 5 * n3 - 227 / 45 * n4 + 2704 / 315 * n5 + 2323 / 945 * n6,
            56 / 15 * n3 - 136 / 35 * n4 - 1262 / 105 * n5 + 73814 / 2835 * n6,
            4279 / 630 * n4 - 332 / 35 * n5 - 399572 / 14175 * n6,
            4174 / 315 * n5 - 144838 / 6237 * n6,
            601676 / 22275 * n6]
        self.xi0 = self._xi_eta(math.radians(s.lat0), 0.0)[0]

    def _xi_eta(self, phi, dl):
        e = self.e
        t = math.sinh(math.atanh(math.sin(phi)) - e * math.atanh(e * math.sin(phi)))
        xi_p = math.atan2(t, math.cos(dl))
        eta_p = math.atanh(math.sin(dl) / math.sqrt(1 + t * t))
        xi, eta = xi_p, eta_p
        for j, a in enumerate(self.alfa, start=1):
            xi += a * math.sin(2 * j * xi_p) * math.cosh(2 * j * eta_p)
            eta += a * math.cos(2 * j * xi_p) * math.sinh(2 * j * eta_p)
        return xi, eta

    def directa(self, lat, lon):
        """(lat, lon) en grados → (E, N) en metros."""
        xi, eta = self._xi_eta(math.radians(lat), math.radians(lon) - self.lon0)
        return (self.fe + self.k0 * self.A * eta,
                self.fn + self.k0 * self.A * (xi - self.xi0))

    def inversa(self, E, N):
        """(E, N) en metros → (lat, lon) en grados."""
        xi = (N - self.fn) / (self.k0 * self.A) + self.xi0
        eta = (E - self.fe) / (self.k0 * self.A)
        xi_p, eta_p = xi, eta
        for j, b in enumerate(self.beta, start=1):
            xi_p -= b * math.sin(2 * j * xi) * math.cosh(2 * j * eta)
            eta_p -= b * math.cos(2 * j * xi) * math.sinh(2 * j * eta)
        chi = math.asin(math.sin(xi_p) / math.cosh(eta_p))
        phi = chi + sum(d * math.sin(2 * j * chi) for j, d in enumerate(self.delta, start=1))
        lon = self.lon0 + math.atan2(math.sinh(eta_p), math.cos(xi_p))
        return math.degrees(phi), math.degrees(lon)


_TM_CACHE: dict[str, TransversaMercator] = {}


def _tm(codigo: str) -> TransversaMercator:
    if codigo not in _TM_CACHE:
        _TM_CACHE[codigo] = TransversaMercator(SISTEMAS[codigo])
    return _TM_CACHE[codigo]


# ============================================================ transformaciones
def _pyproj_tf(origen: int, destino: int):
    return pyproj.Transformer.from_crs(origen, destino, always_xy=True)


def a_geograficas(codigo: str, u: float, v: float, motor: str = "auto") -> tuple[float, float]:
    """Coordenadas en el sistema `codigo` → (lat, lon) en grados.

    Para sistemas geográficos u = latitud, v = longitud; para proyectados u = Este, v = Norte.
    """
    s = SISTEMAS.get(codigo)
    if s is None:
        raise ErrorGeo(f"Sistema desconocido: {codigo}")
    if s.tipo == "geografico":
        return float(u), float(v)
    if s.tipo == "local":
        raise ErrorGeo("Las coordenadas locales requieren georreferenciación con puntos de control.")
    if motor != "propio" and HAY_PYPROJ and s.epsg:
        lon, lat = _pyproj_tf(s.epsg, 4686).transform(u, v)
        return lat, lon
    return _tm(codigo).inversa(u, v)


def desde_geograficas(codigo: str, lat: float, lon: float, motor: str = "auto") -> tuple[float, float]:
    s = SISTEMAS.get(codigo)
    if s is None:
        raise ErrorGeo(f"Sistema desconocido: {codigo}")
    if s.tipo == "geografico":
        return lat, lon
    if s.tipo == "local":
        raise ErrorGeo("No se puede proyectar a un sistema local sin parámetros.")
    if motor != "propio" and HAY_PYPROJ and s.epsg:
        return _pyproj_tf(4686, s.epsg).transform(lon, lat)
    return _tm(codigo).directa(lat, lon)


def motor_activo() -> str:
    return f"pyproj {pyproj.__version__} (PROJ {pyproj.proj_version_str})" if HAY_PYPROJ \
        else "implementación propia (series de Krüger n⁶ + Vincenty)"


# ============================================================ geodesia
def distancia_geodesica(lat1, lon1, lat2, lon2) -> float:
    """Distancia sobre el elipsoide GRS80 (m). pyproj.Geod (Karney) si existe, si no Vincenty."""
    if HAY_PYPROJ:
        g = pyproj.Geod(a=A_GRS80, f=F_GRS80)
        return float(g.inv(lon1, lat1, lon2, lat2)[2])
    return _vincenty(lat1, lon1, lat2, lon2)


def _vincenty(lat1, lon1, lat2, lon2, a=A_GRS80, f=F_GRS80) -> float:
    if lat1 == lat2 and lon1 == lon2:
        return 0.0
    b = a * (1 - f)
    L = math.radians(lon2 - lon1)
    U1 = math.atan((1 - f) * math.tan(math.radians(lat1)))
    U2 = math.atan((1 - f) * math.tan(math.radians(lat2)))
    sU1, cU1, sU2, cU2 = math.sin(U1), math.cos(U1), math.sin(U2), math.cos(U2)
    lam = L
    for _ in range(200):
        sl, cl = math.sin(lam), math.cos(lam)
        ss = math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl)
        if ss == 0:
            return 0.0
        cs = sU1 * sU2 + cU1 * cU2 * cl
        sig = math.atan2(ss, cs)
        sa = cU1 * cU2 * sl / ss
        c2a = 1 - sa * sa
        c2sm = cs - 2 * sU1 * sU2 / c2a if c2a else 0.0
        C = f / 16 * c2a * (4 + f * (4 - 3 * c2a))
        lam_p = lam
        lam = L + (1 - C) * f * sa * (sig + C * ss * (c2sm + C * cs * (-1 + 2 * c2sm ** 2)))
        if abs(lam - lam_p) < 1e-13:
            break
    u2 = c2a * (a * a - b * b) / (b * b)
    A_ = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
    B_ = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
    ds = B_ * ss * (c2sm + B_ / 4 * (cs * (-1 + 2 * c2sm ** 2)
                                    - B_ / 6 * c2sm * (-3 + 4 * ss ** 2) * (-3 + 4 * c2sm ** 2)))
    return b * A_ * (sig - ds)


def azimut(lat1, lon1, lat2, lon2) -> float:
    """Azimut geodésico aproximado (grados desde el norte, sentido horario)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def deflexion(az_entrada: float, az_salida: float) -> float:
    """Ángulo de deflexión (grados, + a la derecha) entre dos azimuts."""
    d = (az_salida - az_entrada + 540) % 360 - 180
    return d


# ============================================================ GMS (grados, minutos, segundos)
_RX_GMS = re.compile(
    r"^\s*([NSEOW])?\s*(-?\d+(?:[.,]\d+)?)\s*(?:°|º|d|\s)\s*(?:(\d+(?:[.,]\d+)?)\s*(?:'|′|m|\s)\s*)?"
    r"(?:(\d+(?:[.,]\d+)?)\s*(?:\"|″|''|s)?\s*)?([NSEOW])?\s*$", re.I)


def leer_angulo(texto, eje: str = "lat") -> float:
    """Lee un ángulo en decimal o GMS ('2°55'38.3"N', '75 16 54.8 O', '-75,2819').

    Devuelve grados decimales con signo. Lanza ErrorGeo si es ambiguo o inválido.
    """
    if texto is None:
        raise ErrorGeo("Ángulo vacío.")
    if isinstance(texto, (int, float)) and not isinstance(texto, bool):
        v = float(texto)
    else:
        s = str(texto).strip().replace("’", "'").replace("”", '"').upper()
        if not s:
            raise ErrorGeo("Ángulo vacío.")
        try:
            v = float(s.replace(",", "."))
        except ValueError:
            m = _RX_GMS.match(s)
            if not m:
                raise ErrorGeo(f"No se reconoce el ángulo «{texto}».") from None
            h1, g, mi, se, h2 = m.groups()
            hemi = h1 or h2
            g = float(g.replace(",", "."))
            mi = float(mi.replace(",", ".")) if mi else 0.0
            se = float(se.replace(",", ".")) if se else 0.0
            if mi >= 60 or se >= 60:
                raise ErrorGeo(f"Minutos o segundos ≥ 60 en «{texto}».")
            v = abs(g) + mi / 60 + se / 3600
            neg = g < 0 or str(m.group(2)).startswith("-")
            if hemi:
                if hemi in ("S", "O", "W"):
                    v = -v
                if (eje == "lat" and hemi not in ("N", "S")) or (eje == "lon" and hemi not in ("E", "O", "W")):
                    raise ErrorGeo(f"Hemisferio «{hemi}» no corresponde a {('latitud', 'longitud')[eje == 'lon']}.")
            elif neg:
                v = -v
    lim = 90 if eje == "lat" else 180
    if not -lim <= v <= lim:
        raise ErrorGeo(f"{'Latitud' if eje == 'lat' else 'Longitud'} fuera de rango: {v}")
    return v


def a_gms(v: float, eje: str = "lat") -> str:
    hemi = ("N" if v >= 0 else "S") if eje == "lat" else ("E" if v >= 0 else "O")
    v = abs(v)
    g = int(v)
    m = int((v - g) * 60)
    s = (v - g - m / 60) * 3600
    if s >= 59.9995:
        s, m = 0.0, m + 1
    if m == 60:
        m, g = 0, g + 1
    return f"{g}°{m:02d}'{s:06.3f}\" {hemi}"


# ============================================================ detección del sistema
COLOMBIA = {"lat": (-4.3, 13.6), "lon": (-82.0, -66.8)}
REFERENCIA_HUILA = (2.9273, -75.2819)   # Neiva (dato de la especificación del proyecto)


def detectar_sistema(pares: list[tuple[float, float]], referencia=REFERENCIA_HUILA,
                     radio_km: float = 250.0) -> list[dict]:
    """Propone sistemas candidatos para una lista de pares (u, v).

    No decide: devuelve candidatos ordenados por la distancia entre el centro de los
    datos (transformado) y la ubicación esperada. El usuario debe confirmar.
    """
    arr = np.array([(float(a), float(b)) for a, b in pares if a is not None and b is not None])
    if arr.size == 0:
        return []
    u, v = float(np.median(arr[:, 0])), float(np.median(arr[:, 1]))
    out = []

    def agregar(codigo, lat, lon, invertido=False):
        if not (COLOMBIA["lat"][0] <= lat <= COLOMBIA["lat"][1] and COLOMBIA["lon"][0] <= lon <= COLOMBIA["lon"][1]):
            return
        d = distancia_geodesica(lat, lon, *referencia) / 1000
        if d <= radio_km:
            out.append({"codigo": codigo, "nombre": SISTEMAS[codigo].nombre, "ejes_invertidos": invertido,
                        "centro": {"lat": round(lat, 6), "lon": round(lon, 6)},
                        "distancia_km": round(d, 1)})

    if abs(u) <= 90 and abs(v) <= 180:
        agregar("WGS84", u, v)
        if abs(v) <= 90 and abs(u) <= 180:
            agregar("WGS84", v, u, invertido=True)
    elif min(abs(u), abs(v)) > 1000:
        for codigo, s in SISTEMAS.items():
            if s.tipo != "proyectado":
                continue
            for (e, n), inv in (((u, v), False), ((v, u), True)):
                try:
                    lat, lon = a_geograficas(codigo, e, n, motor="propio")
                except (ValueError, OverflowError):
                    continue
                agregar(codigo, lat, lon, inv)
    out.sort(key=lambda c: (c["distancia_km"], c["ejes_invertidos"]))
    return out


# ============================================================ georreferenciación local
@dataclass
class Georreferenciacion:
    metodo: str                       # "helmert" | "afin"
    parametros: list[float]
    residuales: list[dict] = field(default_factory=list)
    rms_m: float = 0.0
    escala: float | None = None
    rotacion_grados: float | None = None

    def aplicar(self, x: float, y: float) -> tuple[float, float]:
        p = self.parametros
        if self.metodo == "helmert":
            a, b, tx, ty = p
            return a * x - b * y + tx, b * x + a * y + ty
        a1, a2, tx, b1, b2, ty = p
        return a1 * x + a2 * y + tx, b1 * x + b2 * y + ty

    def a_dict(self):
        return {"metodo": self.metodo, "parametros": self.parametros, "residuales": self.residuales,
                "rms_m": self.rms_m, "escala": self.escala, "rotacion_grados": self.rotacion_grados,
                "sistema_destino": INTERNO}


def georreferenciar(puntos: list[dict], metodo: str = "helmert") -> Georreferenciacion:
    """Ajuste por mínimos cuadrados de coordenadas locales a Origen Nacional.

    puntos: [{"x","y","E","N", "id"?}] (E, N en Origen Nacional). Helmert 2D requiere ≥ 2
    puntos (≥ 3 para verificar residuales); afín ≥ 3 (≥ 4 para verificar).
    """
    minimo = 2 if metodo == "helmert" else 3
    if len(puntos) < minimo:
        raise ErrorGeo(f"{metodo}: se requieren al menos {minimo} puntos de control.")
    X = np.array([[p["x"], p["y"]] for p in puntos], float)
    T = np.array([[p["E"], p["N"]] for p in puntos], float)
    cx, ct = X.mean(0), T.mean(0)          # centrar para buen condicionamiento
    x, t = X - cx, T - ct
    if metodo == "helmert":
        Arows, L = [], []
        for (xi, yi), (ei, ni) in zip(x, t):
            Arows += [[xi, -yi, 1, 0], [yi, xi, 0, 1]]
            L += [ei, ni]
        sol, *_ = np.linalg.lstsq(np.array(Arows), np.array(L), rcond=None)
        a, b, tx, ty = sol
        tx, ty = tx + ct[0] - (a * cx[0] - b * cx[1]), ty + ct[1] - (b * cx[0] + a * cx[1])
        g = Georreferenciacion("helmert", [float(a), float(b), float(tx), float(ty)],
                               escala=float(math.hypot(a, b)),
                               rotacion_grados=float(math.degrees(math.atan2(b, a))))
    elif metodo == "afin":
        M = np.column_stack([x, np.ones(len(x))])
        pe, *_ = np.linalg.lstsq(M, t[:, 0], rcond=None)
        pn, *_ = np.linalg.lstsq(M, t[:, 1], rcond=None)
        a1, a2, te = pe
        b1, b2, tn = pn
        te += ct[0] - (a1 * cx[0] + a2 * cx[1])
        tn += ct[1] - (b1 * cx[0] + b2 * cx[1])
        g = Georreferenciacion("afin", [float(a1), float(a2), float(te), float(b1), float(b2), float(tn)])
    else:
        raise ErrorGeo(f"Método desconocido: {metodo}")
    res = []
    for p in puntos:
        e, n = g.aplicar(p["x"], p["y"])
        res.append({"id": p.get("id"), "dE": round(p["E"] - e, 4), "dN": round(p["N"] - n, 4),
                    "d": round(math.hypot(p["E"] - e, p["N"] - n), 4)})
    g.residuales = res
    g.rms_m = round(float(math.sqrt(np.mean([r["d"] ** 2 for r in res]))), 4)
    return g


# ============================================================ utilidades de alto nivel
def transformar_punto(codigo: str, u, v, georref: Georreferenciacion | None = None) -> dict:
    """Devuelve lat, lon (MAGNA/WGS84) y E, N Origen Nacional de un punto de entrada."""
    s = SISTEMAS[codigo]
    if s.tipo == "geografico":
        lat, lon = leer_angulo(u, "lat"), leer_angulo(v, "lon")
    elif s.tipo == "local":
        if georref is None:
            raise ErrorGeo("Coordenadas locales sin georreferenciación confirmada.")
        E, N = georref.aplicar(float(u), float(v))
        lat, lon = a_geograficas(INTERNO, E, N)
        return {"lat": lat, "lon": lon, "E": E, "N": N}
    else:
        lat, lon = a_geograficas(codigo, float(u), float(v))
    E, N = desde_geograficas(INTERNO, lat, lon)
    return {"lat": lat, "lon": lon, "E": E, "N": N}


def abscisas(puntos: list[tuple[float, float]]) -> list[float]:
    """Abscisa acumulada geodésica (m) a lo largo de una secuencia de (lat, lon)."""
    acc, out = 0.0, [0.0]
    for (la1, lo1), (la2, lo2) in zip(puntos[:-1], puntos[1:]):
        acc += distancia_geodesica(la1, lo1, la2, lo2)
        out.append(acc)
    return out
