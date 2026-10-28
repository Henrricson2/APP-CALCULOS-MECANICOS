"""Búsqueda de raíces sin SciPy (método de Brent), para que el motor corra también en el
navegador (Pyodide) sin descargar SciPy (~30 MB), que en celulares y tabletas no carga.

Es el mismo algoritmo de ``scipy.optimize.brentq`` (Brent 1973, versión de SciPy ``zeros.c``),
así que da los mismos resultados.
"""
from __future__ import annotations

_RTOL = 4 * 2.220446049250313e-16


def brentq(f, xa: float, xb: float, xtol: float = 2e-12, rtol: float = _RTOL, maxiter: int = 100) -> float:
    xpre, xcur = float(xa), float(xb)
    fpre, fcur = f(xpre), f(xcur)
    if fpre * fcur > 0:
        raise ValueError("f(a) y f(b) deben tener signos distintos")
    if fpre == 0:
        return xpre
    if fcur == 0:
        return xcur
    xblk = fblk = spre = scur = 0.0
    for _ in range(maxiter):
        if fpre != 0 and fcur != 0 and ((fpre < 0) != (fcur < 0)):
            xblk, fblk = xpre, fpre
            spre = scur = xcur - xpre
        if abs(fblk) < abs(fcur):
            xpre, xcur, xblk = xcur, xblk, xcur
            fpre, fcur, fblk = fcur, fblk, fcur
        delta = (xtol + rtol * abs(xcur)) / 2
        sbis = (xblk - xcur) / 2
        if fcur == 0 or abs(sbis) < delta:
            return xcur
        if abs(spre) > delta and abs(fcur) < abs(fpre):
            if xpre == xblk:                       # interpolación lineal
                stry = -fcur * (xcur - xpre) / (fcur - fpre)
            else:                                  # interpolación cuadrática inversa
                dpre = (fpre - fcur) / (xpre - xcur)
                dblk = (fblk - fcur) / (xblk - xcur)
                stry = -fcur * (fblk * dblk - fpre * dpre) / (dblk * dpre * (fblk - fpre))
            if 2 * abs(stry) < min(abs(spre), 3 * abs(sbis) - delta):
                spre, scur = scur, stry            # se acepta la interpolación
            else:
                spre, scur = sbis, sbis            # bisección
        else:
            spre, scur = sbis, sbis
        xpre, fpre = xcur, fcur
        xcur += scur if abs(scur) > delta else (delta if sbis > 0 else -delta)
        fcur = f(xcur)
    raise RuntimeError(f"Brent no convergió en {maxiter} iteraciones")
