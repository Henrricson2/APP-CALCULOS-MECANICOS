"""
Parámetros del proyecto: conductor, hipótesis de cálculo y criterios de diseño.

Los valores por defecto siguen la norma EH-RAA-004 de Electrohuila
("Cálculos mecánicos estructuras aéreas", 23-12-2016):
    - Temperatura mínima 0 °C, media 20 °C, máxima 50 °C
    - Velocidad máxima de viento 100 km/h, presión q = 0.0042·V² (kgf/m², V en km/h)
    - Distancia mínima conductor–tierra 5.80 m (RETIE)
    - Separación de conductores e = k·√(F + L) + kV/150, k = 0.75 (ACSR)
    - Empotramiento de postes: 10 m→1.6, 12 m→1.8, 14 m→2.0, 16 m→2.2 m

Unidades del programa: metros, kgf, kgf/m, °C.
TODO valor de esta hoja es editable desde la interfaz o desde un JSON.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
import json
from pathlib import Path


# ---------------------------------------------------------------------------
# CONDUCTOR
# ---------------------------------------------------------------------------
@dataclass
class Conductor:
    nombre: str = "2/0 ECO"
    seccion_mm2: float = 88.74            # S (mm²)
    carga_rotura_kgf: float = 2404.0      # Tensión de rotura (kgf)
    peso_kgf_m: float = 0.5486            # Peso propio (kgf/m)
    modulo_elasticidad: float = 8056.0    # E (kgf/mm²)
    coef_dilatacion: float = 1.91e-5      # α (1/°C)
    diametro_mm: float = 16.6969          # Diámetro exterior (mm)

    @property
    def ES(self) -> float:
        """Rigidez axial E·S en kgf."""
        return self.modulo_elasticidad * self.seccion_mm2

    @property
    def diametro_m(self) -> float:
        return self.diametro_mm / 1000.0

    def validar(self) -> list[str]:
        err = []
        for nombre, v in asdict(self).items():
            if nombre != "nombre" and (v is None or v <= 0):
                err.append(f"Conductor: el parámetro '{nombre}' debe ser > 0 (valor: {v}).")
        return err


# Biblioteca mínima de conductores (datos de catálogo; verificar con el fabricante)
BIBLIOTECA_CONDUCTORES: dict[str, Conductor] = {
    "2/0 ECO": Conductor(),
    "2/0 ACSR QUAIL (EH-RAA-004)": Conductor(
        nombre="2/0 ACSR QUAIL", seccion_mm2=78.645, carga_rotura_kgf=2425.0,
        peso_kgf_m=0.2725, modulo_elasticidad=8086.0, coef_dilatacion=1.89e-5,
        diametro_mm=11.354),
    # ACSR (ASTM B232), valores típicos de catálogo: confírmelos con la ficha del fabricante
    "2 ACSR SPARROW 6/1": Conductor(
        nombre="2 ACSR SPARROW", seccion_mm2=39.22, carga_rotura_kgf=1293.0,
        peso_kgf_m=0.1356, modulo_elasticidad=8086.0, coef_dilatacion=1.89e-5, diametro_mm=8.01),
    "1/0 ACSR RAVEN 6/1": Conductor(
        nombre="1/0 ACSR RAVEN", seccion_mm2=62.38, carga_rotura_kgf=1987.0,
        peso_kgf_m=0.2160, modulo_elasticidad=8086.0, coef_dilatacion=1.89e-5, diametro_mm=10.11),
    "3/0 ACSR PIGEON 6/1": Conductor(
        nombre="3/0 ACSR PIGEON", seccion_mm2=99.20, carga_rotura_kgf=3003.0,
        peso_kgf_m=0.3436, modulo_elasticidad=8086.0, coef_dilatacion=1.89e-5, diametro_mm=12.75),
    "4/0 ACSR PENGUIN 6/1": Conductor(
        nombre="4/0 ACSR PENGUIN", seccion_mm2=125.10, carga_rotura_kgf=3787.0,
        peso_kgf_m=0.4330, modulo_elasticidad=8086.0, coef_dilatacion=1.89e-5, diametro_mm=14.31),
    "266.8 ACSR PARTRIDGE 26/7": Conductor(
        nombre="266.8 ACSR PARTRIDGE", seccion_mm2=157.20, carga_rotura_kgf=5126.0,
        peso_kgf_m=0.5460, modulo_elasticidad=7700.0, coef_dilatacion=1.89e-5, diametro_mm=16.31),
    "336.4 ACSR LINNET 26/7": Conductor(
        nombre="336.4 ACSR LINNET", seccion_mm2=198.20, carga_rotura_kgf=6396.0,
        peso_kgf_m=0.6890, modulo_elasticidad=7700.0, coef_dilatacion=1.89e-5, diametro_mm=18.31),
}


# ---------------------------------------------------------------------------
# HIPÓTESIS DE CÁLCULO
# ---------------------------------------------------------------------------
@dataclass
class Hipotesis:
    nombre: str
    temperatura_c: float
    viento_kmh: float = 0.0
    hielo_kgf_m: float = 0.0
    # Límite de tensión horizontal como fracción de la carga de rotura.
    # None = hipótesis solo de verificación (no gobierna el tendido).
    limite_fraccion_rotura: float | None = None

    def presion_viento_kgf_m2(self) -> float:
        """q = 0.0042·V² (EH-RAA-004 §4.1 / §5.1), V en km/h."""
        return 0.0042 * self.viento_kmh ** 2

    def peso_aparente(self, c: Conductor) -> float:
        """Peso aparente (kgf/m): resultante de peso (+hielo) y viento."""
        vertical = c.peso_kgf_m + self.hielo_kgf_m
        horizontal = self.presion_viento_kgf_m2() * c.diametro_m
        return (vertical ** 2 + horizontal ** 2) ** 0.5


def hipotesis_por_defecto() -> dict[str, Hipotesis]:
    """Hipótesis según EH-RAA-004. Las claves son identificadores internos."""
    return {
        "TMAX": Hipotesis("Tensión máxima (0 °C + viento 100 km/h)", 0.0, 100.0,
                          limite_fraccion_rotura=0.50),
        "EDS": Hipotesis("Tensión de cada día EDS (20 °C)", 20.0,
                         limite_fraccion_rotura=0.20),
        "FMIN": Hipotesis("Flecha mínima (0 °C, sin viento)", 0.0),
        "FMAX": Hipotesis("Flecha máxima / plantilla caliente (50 °C)", 50.0),
    }


# ---------------------------------------------------------------------------
# CRITERIOS DE DISEÑO
# ---------------------------------------------------------------------------
@dataclass
class Criterios:
    tension_kv: float = 13.2
    distancia_minima_terreno_m: float = 5.80     # EH-RAA-004 §7.1.1 (RETIE)
    k_separacion: float = 0.75                    # ACSR
    long_cadena_aisladores_m: float = 0.0         # 0 = espigo/terminal
    altura_amarre_defecto_m: float | None = None  # None: la cota Y ya es el punto de amarre
    fluencia_delta_t_c: float = 0.0               # Temperatura equivalente de fluencia (creep)
    desperdicio_conductor: float = 0.03           # 3 % adicional para cantidades
    n_fases: int = 3
    vano_min_alerta_m: float = 15.0
    vano_max_alerta_m: float = 300.0
    pendiente_max_alerta: float = 0.15            # |Δy|/a por encima de la cual se alerta
    # --- estructuras: poste y templetes (verificar contra RETIE y la norma del OR) ---
    hipotesis_estructuras: str = "TMAX"           # hipótesis de cargas para postes y templetes
    empotramiento_coef: float = 0.10              # empotramiento = coef·L + base
    empotramiento_base_m: float = 0.60
    amarre_bajo_cima_m: float = 0.20              # punto de amarre bajo la cima del poste
    poste_diametro_medio_m: float = 0.25          # para el viento sobre el poste
    fs_poste: float = 2.5                         # factor de seguridad del poste
    fs_templete: float = 2.5                      # factor de seguridad del cable de templete
    peso_herrajes_kgf: float = 40.0               # crucetas, aisladores y herrajes por estructura
    # --- varios circuitos en la misma estructura ---
    nombre_circuito_principal: str = "Circuito 1"
    separacion_min_circuitos_m: float = 1.20      # vertical mínima entre circuitos (verificar RETIE / OR)
    separacion_vano_factor: float = 0.75          # en el vano se admite este factor × la mínima (NESC 235C2b)


@dataclass
class Circuito:
    """Circuito adicional montado en las mismas estructuras, en un tramo de la línea.

    El circuito principal es el de «Conductor» y «Criterios» (toda la línea, amarre a
    `amarre_bajo_cima_m` bajo la cima). Cada circuito adicional tiene su propio conductor,
    tensión y número de fases, y se amarra `bajo_cima_m` metros bajo la cima del poste.
    """
    nombre: str = "Circuito 2"
    tension_kv: float = 13.2
    conductor: Conductor = field(default_factory=Conductor)
    n_fases: int = 3
    desde: str = ""                     # estructura inicial ("" = la primera de la línea)
    hasta: str = ""                     # estructura final ("" = la última)
    bajo_cima_m: float = 1.40           # punto de amarre bajo la cima del poste
    peso_herrajes_kgf: float = 40.0     # crucetas, aisladores y herrajes de ESTE circuito
    long_cadena_aisladores_m: float = 0.0
    activo: bool = True

    @classmethod
    def desde_dict(cls, d: dict) -> "Circuito":
        base = asdict(cls())
        cond = Conductor(**{**asdict(Conductor()), **(d.get("conductor") or {})})
        datos = {k: d[k] for k in base if k in d and k != "conductor"}
        return cls(**{**{k: v for k, v in base.items() if k != "conductor"}, **datos}, conductor=cond)


@dataclass
class ConfigSalida:
    vanos_por_pagina: int = 5
    exageracion_vertical_dxf: float = 1.0         # 1.0 = escala 1:1 (como el original)
    intervalo_cotas_m: float = 5.0                # rejilla del eje Y del perfil (pantalla y PDF)
    exageracion_vertical_perfil: float = 5.0      # perfil: X 1:1 · Y 5:1 (alturas ×5); 0 = sin escala
    altura_texto_dxf: float = 1.5
    puntos_por_vano: int = 200


@dataclass
class Proyecto:
    nombre: str = "Proyecto de línea de media tensión"
    conductor: Conductor = field(default_factory=Conductor)
    hipotesis: dict[str, Hipotesis] = field(default_factory=hipotesis_por_defecto)
    criterios: Criterios = field(default_factory=Criterios)
    salida: ConfigSalida = field(default_factory=ConfigSalida)
    # "cambio_estado" (recomendado) o "excel" (usa la columna Flecha del archivo)
    modo_flecha: str = "cambio_estado"
    hipotesis_plantillado: str = "FMAX"   # flecha usada para distancias a tierra
    hipotesis_arrancamiento: str = "FMIN" # gravivanos (tiro hacia arriba)
    circuitos: list[Circuito] = field(default_factory=list)   # circuitos adicionales

    # ----------------------------- persistencia --------------------------
    def a_dict(self) -> dict:
        d = asdict(self)
        return d

    def guardar_json(self, ruta: str | Path) -> None:
        Path(ruta).write_text(json.dumps(self.a_dict(), indent=2, ensure_ascii=False),
                              encoding="utf-8")

    @classmethod
    def desde_json(cls, ruta: str | Path) -> "Proyecto":
        return cls.desde_dict(json.loads(Path(ruta).read_text(encoding="utf-8")))

    @classmethod
    def desde_dict(cls, d: dict | None) -> "Proyecto":
        """Crea un Proyecto desde un dict (JSON). Claves ausentes = valores por defecto."""
        d = d or {}
        p = cls()
        p.nombre = d.get("nombre", p.nombre)
        if d.get("conductor"):
            p.conductor = Conductor(**{**asdict(Conductor()), **d["conductor"]})
        if d.get("hipotesis"):
            base = hipotesis_por_defecto()
            p.hipotesis = {}
            for k, v in d["hipotesis"].items():
                ref = asdict(base[k]) if k in base else {"nombre": k, "temperatura_c": 20.0}
                p.hipotesis[k] = Hipotesis(**{**ref, **v})
        if d.get("criterios"):
            p.criterios = Criterios(**{**asdict(Criterios()), **d["criterios"]})
        if d.get("salida"):
            p.salida = ConfigSalida(**{**asdict(ConfigSalida()), **d["salida"]})
        p.modo_flecha = d.get("modo_flecha", p.modo_flecha)
        p.hipotesis_plantillado = d.get("hipotesis_plantillado", p.hipotesis_plantillado)
        p.hipotesis_arrancamiento = d.get("hipotesis_arrancamiento", p.hipotesis_arrancamiento)
        p.circuitos = [Circuito.desde_dict(c) for c in (d.get("circuitos") or []) if isinstance(c, dict)]
        return p

    def validar(self) -> list[str]:
        err = self.conductor.validar()
        for c in self.circuitos:
            if not c.activo:
                continue
            err += [f"{c.nombre}: {e}" for e in c.conductor.validar()]
            if not c.n_fases or c.n_fases < 1:
                err.append(f"{c.nombre}: el número de fases debe ser ≥ 1.")
            if c.bajo_cima_m is None or c.bajo_cima_m < 0:
                err.append(f"{c.nombre}: la distancia del amarre bajo la cima debe ser ≥ 0.")
        if self.modo_flecha not in ("cambio_estado", "excel"):
            err.append("modo_flecha debe ser 'cambio_estado' o 'excel'.")
        for k in (self.hipotesis_plantillado, self.hipotesis_arrancamiento):
            if k not in self.hipotesis:
                err.append(f"La hipótesis '{k}' no está definida.")
        if not any(h.limite_fraccion_rotura for h in self.hipotesis.values()):
            err.append("Al menos una hipótesis debe tener límite de tensión.")
        return err
