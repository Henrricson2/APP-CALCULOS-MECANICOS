"""
Catenaria de un vano entre dos puntos de amarre (posiblemente a distinto nivel).

    y(x) = k + C·cosh((x − b)/C)        C = H / w  (parámetro, m)

Mejoras frente al notebook original:
  * Con C conocido (cambio de estado) la catenaria tiene SOLUCIÓN CERRADA:
        b = xm − C·asinh( Δy / (2·C·sinh(a / 2C)) )
    sin fsolve ni estimaciones iniciales.
  * Si se parte de una flecha, la flecha se mide como en la práctica de diseño:
    distancia vertical máxima entre la cuerda (recta entre amarres) y el
    conductor. El original usaba "apoyo más bajo − vértice", que es incorrecto en
    vanos inclinados y no tiene solución cuando el vértice cae fuera del vano.
  * Se verifica convergencia y dominio; los errores se reportan, no se ocultan.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from .raices import brentq

from .cambio_estado import ErrorCalculo

_LIM_ARG = 700.0  # cosh/sinh desbordan cerca de 710


@dataclass(frozen=True)
class Catenaria:
    x1: float
    y1: float
    x2: float
    y2: float
    C: float     # parámetro (m)
    b: float     # abscisa del vértice
    k: float     # desplazamiento vertical

    # ---------------------------------------------------------------- básicos
    @property
    def vano(self) -> float:
        return self.x2 - self.x1

    @property
    def desnivel(self) -> float:
        return self.y2 - self.y1

    def y(self, x):
        return self.k + self.C * np.cosh((np.asarray(x) - self.b) / self.C)

    def cuerda(self, x):
        return self.y1 + (np.asarray(x) - self.x1) * self.desnivel / self.vano

    @property
    def vertice(self) -> tuple[float, float]:
        return self.b, self.k + self.C

    @property
    def vertice_en_vano(self) -> bool:
        return self.x1 <= self.b <= self.x2

    # --------------------------------------------------------------- derivados
    @property
    def longitud(self) -> float:
        """Longitud real de conductor en el vano (m)."""
        C, b = self.C, self.b
        return C * (math.sinh((self.x2 - b) / C) - math.sinh((self.x1 - b) / C))

    @property
    def x_flecha_maxima(self) -> float:
        """Punto donde la tangente es paralela a la cuerda."""
        m = self.desnivel / self.vano
        return float(np.clip(self.b + self.C * math.asinh(m), self.x1, self.x2))

    @property
    def flecha(self) -> float:
        """Flecha máxima medida verticalmente desde la cuerda (m)."""
        x = self.x_flecha_maxima
        return float(self.cuerda(x) - self.y(x))

    @property
    def flecha_centro(self) -> float:
        xm = 0.5 * (self.x1 + self.x2)
        return float(self.cuerda(xm) - self.y(xm))

    def tension(self, x, w: float):
        """Tensión total del conductor (kgf) en la abscisa x, para peso w (kgf/m)."""
        return w * self.C * np.cosh((np.asarray(x) - self.b) / self.C)

    def tensiones_apoyos(self, w: float) -> tuple[float, float]:
        return float(self.tension(self.x1, w)), float(self.tension(self.x2, w))

    def muestrear(self, n: int = 200) -> tuple[np.ndarray, np.ndarray]:
        x = np.linspace(self.x1, self.x2, n)
        return x, self.y(x)

    def ecuacion(self) -> str:
        signo = "+" if self.k >= 0 else "-"
        return (f"y = {self.C:.4f}·cosh((x − {self.b:.4f})/{self.C:.4f}) "
                f"{signo} {abs(self.k):.4f}")


# ---------------------------------------------------------------------------
def _validar_puntos(x1, y1, x2, y2):
    vals = (x1, y1, x2, y2)
    if not all(math.isfinite(v) for v in vals):
        raise ErrorCalculo("Coordenadas no numéricas o vacías.")
    if x2 <= x1:
        raise ErrorCalculo(f"La abscisa final ({x2}) debe ser mayor que la inicial ({x1}).")


def catenaria_por_parametro(x1: float, y1: float, x2: float, y2: float,
                            C: float) -> Catenaria:
    """Catenaria que pasa por (x1,y1) y (x2,y2) con parámetro C = H/w (solución exacta)."""
    _validar_puntos(x1, y1, x2, y2)
    if not (C > 0 and math.isfinite(C)):
        raise ErrorCalculo(f"Parámetro de catenaria inválido: C = {C}.")
    a = x2 - x1
    if a / (2 * C) > _LIM_ARG:
        raise ErrorCalculo(f"Parámetro C = {C:.3f} m demasiado pequeño para un vano de {a:.1f} m.")
    xm = 0.5 * (x1 + x2)
    b = xm - C * math.asinh((y2 - y1) / (2 * C * math.sinh(a / (2 * C))))
    k = y1 - C * math.cosh((x1 - b) / C)
    return Catenaria(x1, y1, x2, y2, C, b, k)


def catenaria_por_flecha(x1: float, y1: float, x2: float, y2: float,
                         flecha: float) -> Catenaria:
    """Catenaria cuya flecha máxima (desde la cuerda) es la indicada."""
    _validar_puntos(x1, y1, x2, y2)
    if not (flecha > 0 and math.isfinite(flecha)):
        raise ErrorCalculo(f"Flecha inválida ({flecha}) en el vano {x1:.2f}–{x2:.2f}. "
                           "Debe ser mayor que cero.")
    a = x2 - x1

    def g(C):
        return catenaria_por_parametro(x1, y1, x2, y2, C).flecha - flecha

    c_lo = a / (2 * _LIM_ARG) * 1.01
    c_hi = max(a, 1.0)
    while g(c_hi) > 0:          # flecha aún grande → aumentar C
        c_hi *= 4
        if c_hi > 1e9:
            raise ErrorCalculo("No fue posible ajustar la catenaria a la flecha dada.")
    if g(c_lo) < 0:
        raise ErrorCalculo(f"Flecha {flecha:.2f} m excesiva para un vano de {a:.1f} m.")
    C = brentq(g, c_lo, c_hi, xtol=1e-10, maxiter=300)
    return catenaria_por_parametro(x1, y1, x2, y2, C)
