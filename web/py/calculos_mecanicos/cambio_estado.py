"""
Ecuación de cambio de estado y vano regulador.

Ecuación (tensiones horizontales H en kgf, vano a en m):

    H2² · [ H2 − H1 + α·E·S·(θ2 − θ1) + w1²·a²·E·S / (24·H1²) ] = w2²·a²·E·S / 24

Reemplaza la hoja "Tensionados" del Excel original, que tenía valores pegados
(sin fórmulas) y una carga de viento ~44 veces menor que la exigida por EH-RAA-004.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.optimize import brentq

from .config import Conductor, Hipotesis


class ErrorCalculo(Exception):
    """Error de cálculo con mensaje legible para el usuario."""


# ---------------------------------------------------------------------------
def vano_regulador(vanos: list[float] | np.ndarray) -> float:
    """Vano regulador (ideal de regulación): ar = √(Σa³ / Σa)."""
    a = np.asarray(vanos, dtype=float)
    if a.size == 0 or np.any(a <= 0):
        raise ErrorCalculo("Los vanos de la sección de tendido deben ser positivos.")
    return float(math.sqrt(np.sum(a ** 3) / np.sum(a)))


def resolver_cambio_estado(H1: float, w1: float, t1: float,
                           w2: float, t2: float, a: float,
                           conductor: Conductor) -> float:
    """Devuelve la tensión horizontal H2 (kgf) en el estado 2.

    La cúbica H³ + A·H² − B = 0 tiene exactamente una raíz positiva
    (regla de Descartes), que se acota y se resuelve con Brent.
    """
    ES = conductor.ES
    A = conductor.coef_dilatacion * ES * (t2 - t1) + (w1 * a) ** 2 * ES / (24 * H1 ** 2) - H1
    B = (w2 * a) ** 2 * ES / 24.0

    def f(H):
        return H ** 3 + A * H ** 2 - B

    lo = 1e-6
    hi = max(1.0, abs(A)) + B ** (1 / 3) + 1.0
    while f(hi) < 0:
        hi *= 2
    return brentq(f, lo, hi, xtol=1e-9, maxiter=200)


def flecha_parabolica(w: float, a: float, H: float) -> float:
    return w * a * a / (8.0 * H)


def flecha_catenaria(w: float, a: float, H: float) -> float:
    C = H / w
    return C * (math.cosh(a / (2 * C)) - 1.0)


# ---------------------------------------------------------------------------
@dataclass
class EstadoTendido:
    """Resultado del cambio de estado para un vano regulador."""
    vano_regulador: float
    hipotesis_gobernante: str
    tensiones: dict[str, float]      # H (kgf) por hipótesis
    pesos: dict[str, float]          # w aparente (kgf/m) por hipótesis

    def parametro(self, clave: str) -> float:
        """Parámetro de la catenaria C = H/w (m)."""
        return self.tensiones[clave] / self.pesos[clave]


def calcular_estado(ar: float, conductor: Conductor,
                    hipotesis: dict[str, Hipotesis],
                    fluencia_delta_t: float = 0.0,
                    clave_fluencia: str = "FMAX") -> EstadoTendido:
    """Encuentra la hipótesis gobernante y las tensiones de todas las hipótesis.

    Método clásico: se supone cada hipótesis con límite a su tensión máxima
    admisible, se trasladan las demás por cambio de estado y se elige la que
    no viola ningún otro límite.
    """
    if ar <= 0:
        raise ErrorCalculo("El vano regulador debe ser positivo.")
    rot = conductor.carga_rotura_kgf
    pesos = {k: h.peso_aparente(conductor) for k, h in hipotesis.items()}
    temps = {k: h.temperatura_c + (fluencia_delta_t if k == clave_fluencia else 0.0)
             for k, h in hipotesis.items()}
    limitadas = {k: h.limite_fraccion_rotura * rot
                 for k, h in hipotesis.items() if h.limite_fraccion_rotura}
    if not limitadas:
        raise ErrorCalculo("Ninguna hipótesis tiene límite de tensión definido.")

    mejor = None
    for kref, Href in limitadas.items():
        T = {kref: Href}
        for k in hipotesis:
            if k != kref:
                T[k] = resolver_cambio_estado(Href, pesos[kref], temps[kref],
                                              pesos[k], temps[k], ar, conductor)
        viola = any(T[k] > lim * (1 + 1e-6) for k, lim in limitadas.items())
        if not viola:
            mejor = (kref, T)
            break
    if mejor is None:  # numéricamente no debería ocurrir
        raise ErrorCalculo(f"No se encontró hipótesis gobernante para ar={ar:.1f} m.")
    return EstadoTendido(ar, mejor[0], mejor[1], pesos)


def tabla_tendido(conductor: Conductor, hipotesis: dict[str, Hipotesis],
                  vanos: list[float], fluencia_delta_t: float = 0.0):
    """Tabla de tendido (equivalente corregido de la hoja 'Tensionados')."""
    import pandas as pd
    filas = []
    for a in vanos:
        e = calcular_estado(a, conductor, hipotesis, fluencia_delta_t)
        fila = {"Vano (m)": a, "Gobierna": e.hipotesis_gobernante}
        for k in hipotesis:
            H, w = e.tensiones[k], e.pesos[k]
            fila[f"{k} H (kgf)"] = round(H, 2)
            fila[f"{k} %Rot"] = round(100 * H / conductor.carga_rotura_kgf, 2)
            fila[f"{k} Flecha (m)"] = round(flecha_catenaria(w, a, H), 3)
        filas.append(fila)
    return pd.DataFrame(filas)
