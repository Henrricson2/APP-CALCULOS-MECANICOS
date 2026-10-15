"""
Persistencia de proyectos en SQLite (como la app de APUs): proyectos, versiones
guardadas y bitácora de cambios. Ubicación: <carpeta de la app>/datos/app.db
(o la variable de entorno CALCULOS_DATA_DIR).
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime
from pathlib import Path

_LOCK = threading.Lock()

ESQUEMA = """
CREATE TABLE IF NOT EXISTS proyectos (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    departamento TEXT,
    municipio TEXT,
    sistema TEXT,
    creado TEXT NOT NULL,
    actualizado TEXT NOT NULL,
    datos TEXT NOT NULL,
    archivado INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS versiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proyecto_id TEXT NOT NULL REFERENCES proyectos(id),
    fecha TEXT NOT NULL,
    comentario TEXT,
    datos TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bitacora (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proyecto_id TEXT NOT NULL,
    fecha TEXT NOT NULL,
    accion TEXT NOT NULL,
    detalle TEXT
);
CREATE INDEX IF NOT EXISTS ix_versiones ON versiones(proyecto_id);
CREATE INDEX IF NOT EXISTS ix_bitacora ON bitacora(proyecto_id);
"""


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


class Almacen:
    def __init__(self, ruta: str | Path | None = None):
        if ruta is None:
            base = Path(os.environ.get("CALCULOS_DATA_DIR") or Path(__file__).resolve().parents[1] / "datos")
            base.mkdir(parents=True, exist_ok=True)
            ruta = base / "app.db"
        self.ruta = str(ruta)
        with self._con() as c:
            c.executescript(ESQUEMA)

    def _con(self):
        con = sqlite3.connect(self.ruta, timeout=10)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA journal_mode=WAL")
        return con

    # ----------------------------------------------------------- proyectos
    def listar(self) -> list[dict]:
        with self._con() as c:
            filas = c.execute("""SELECT p.id, p.nombre, p.departamento, p.municipio, p.sistema, p.creado,
                                        p.actualizado, json_array_length(json_extract(p.datos,'$.apoyos')) AS n_postes,
                                        json_extract(p.datos,'$.calculo.fecha') AS calc_fecha,
                                        json_extract(p.datos,'$.calculo.desactualizado') AS calc_desactualizado,
                                        json_extract(p.datos,'$.calculo.longitud_m') AS calc_longitud_m,
                                        json_extract(p.datos,'$.calculo.vanos') AS calc_vanos,
                                        json_extract(p.datos,'$.calculo.no_cumplen') AS calc_no_cumplen,
                                        json_extract(p.datos,'$.calculo.arrancamiento') AS calc_arrancamiento,
                                        json_extract(p.datos,'$.calculo.advertencias') AS calc_advertencias,
                                        (SELECT COUNT(*) FROM versiones v WHERE v.proyecto_id = p.id) AS n_versiones
                                 FROM proyectos p WHERE archivado = 0 ORDER BY actualizado DESC""").fetchall()
        return [dict(f) for f in filas]

    def obtener(self, pid: str) -> dict | None:
        with self._con() as c:
            f = c.execute("SELECT * FROM proyectos WHERE id = ?", (pid,)).fetchone()
        if not f:
            return None
        d = dict(f)
        d["datos"] = json.loads(d["datos"])
        return d

    def guardar(self, datos: dict, pid: str | None = None, accion: str = "guardar") -> dict:
        """Crea o actualiza un proyecto. `datos` = {proyecto, apoyos, terreno, meta, resultado, calculo}:
        datos de entrada, trazado georreferenciado y el último cálculo con su resumen."""
        meta = datos.get("meta") or {}
        nombre = (datos.get("proyecto") or {}).get("nombre") or "Proyecto sin nombre"
        ahora = _ahora()
        with _LOCK, self._con() as c:
            if pid and c.execute("SELECT 1 FROM proyectos WHERE id = ?", (pid,)).fetchone():
                c.execute("""UPDATE proyectos SET nombre=?, departamento=?, municipio=?, sistema=?, actualizado=?, datos=?
                             WHERE id=?""", (nombre, meta.get("departamento"), meta.get("municipio"),
                                             meta.get("sistema"), ahora, json.dumps(datos, ensure_ascii=False), pid))
            else:
                pid = pid or uuid.uuid4().hex[:12]
                c.execute("""INSERT INTO proyectos (id, nombre, departamento, municipio, sistema, creado, actualizado, datos)
                             VALUES (?,?,?,?,?,?,?,?)""", (pid, nombre, meta.get("departamento"), meta.get("municipio"),
                                                           meta.get("sistema"), ahora, ahora,
                                                           json.dumps(datos, ensure_ascii=False)))
                accion = "crear"
            c.execute("INSERT INTO bitacora (proyecto_id, fecha, accion, detalle) VALUES (?,?,?,?)",
                      (pid, ahora, accion, f"{len(datos.get('apoyos') or [])} postes" + (" · con cálculo" if datos.get("resultado") else "")))
        return {"id": pid, "actualizado": ahora}

    def archivar(self, pid: str) -> bool:
        with _LOCK, self._con() as c:
            n = c.execute("UPDATE proyectos SET archivado = 1, actualizado = ? WHERE id = ?", (_ahora(), pid)).rowcount
            c.execute("INSERT INTO bitacora (proyecto_id, fecha, accion) VALUES (?,?,?)", (pid, _ahora(), "archivar"))
        return n > 0

    # ----------------------------------------------------------- versiones
    def crear_version(self, pid: str, comentario: str = "") -> dict:
        p = self.obtener(pid)
        if not p:
            raise KeyError(pid)
        with _LOCK, self._con() as c:
            cur = c.execute("INSERT INTO versiones (proyecto_id, fecha, comentario, datos) VALUES (?,?,?,?)",
                            (pid, _ahora(), comentario, json.dumps(p["datos"], ensure_ascii=False)))
            c.execute("INSERT INTO bitacora (proyecto_id, fecha, accion, detalle) VALUES (?,?,?,?)",
                      (pid, _ahora(), "versión", comentario))
        return {"version": cur.lastrowid}

    def versiones(self, pid: str) -> list[dict]:
        with self._con() as c:
            return [dict(f) for f in c.execute(
                "SELECT id, fecha, comentario FROM versiones WHERE proyecto_id = ? ORDER BY id DESC", (pid,))]

    def obtener_version(self, pid: str, vid: int) -> dict | None:
        with self._con() as c:
            f = c.execute("SELECT * FROM versiones WHERE proyecto_id = ? AND id = ?", (pid, vid)).fetchone()
        return {**dict(f), "datos": json.loads(f["datos"])} if f else None

    def bitacora(self, pid: str, limite: int = 200) -> list[dict]:
        with self._con() as c:
            return [dict(f) for f in c.execute(
                "SELECT fecha, accion, detalle FROM bitacora WHERE proyecto_id = ? ORDER BY id DESC LIMIT ?", (pid, limite))]
