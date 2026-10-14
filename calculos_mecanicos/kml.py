"""Exportación del proyecto a KML / KMZ (Google Earth), conservando identificadores."""
from __future__ import annotations

import io
import zipfile
from xml.sax.saxutils import escape


def _dato(nombre, valor):
    return f'<Data name="{escape(nombre)}"><value>{escape("" if valor is None else str(valor))}</value></Data>'


def proyecto_a_kml(proyecto: dict) -> str:
    """proyecto = {"nombre", "postes": [{id, nombre, lat, lon, z, altura, tipo, conductor, obs}]}."""
    postes = [p for p in proyecto.get("postes", []) if p.get("lat") is not None and p.get("lon") is not None]
    nombre = escape(proyecto.get("nombre") or "Proyecto")
    pm = []
    for p in postes:
        desc = (f"ID: {p.get('id')}<br>Tipo: {'Retención' if p.get('tipo') == 'R' else 'Suspensión'}"
                f"<br>Cota Z: {p.get('z') if p.get('z') is not None else 'sin dato'}"
                f"<br>Altura amarre: {p.get('altura') if p.get('altura') is not None else 'sin dato'}")
        pm.append(
            f"<Placemark><name>{escape(str(p.get('nombre', '')))}</name>"
            f"<description><![CDATA[{desc}]]></description><styleUrl>#{'ret' if p.get('tipo') == 'R' else 'sus'}</styleUrl>"
            f"<ExtendedData>{_dato('id', p.get('id'))}{_dato('cota_z', p.get('z'))}{_dato('altura', p.get('altura'))}"
            f"{_dato('tipo', p.get('tipo'))}{_dato('conductor', p.get('conductor'))}</ExtendedData>"
            f"<Point><coordinates>{p['lon']:.9f},{p['lat']:.9f},0</coordinates></Point></Placemark>")
    coords = " ".join(f"{p['lon']:.9f},{p['lat']:.9f},0" for p in postes)
    linea = (f"<Placemark><name>Trazado</name><styleUrl>#linea</styleUrl><LineString><tessellate>1</tessellate>"
             f"<altitudeMode>clampToGround</altitudeMode><coordinates>{coords}</coordinates></LineString></Placemark>"
             if len(postes) > 1 else "")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
            f"<name>{nombre}</name>"
            '<Style id="sus"><IconStyle><color>ff3f78e9</color><scale>0.8</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>'
            '<Style id="ret"><IconStyle><color>ff4c4cc8</color><scale>1.0</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon></IconStyle></Style>'
            '<Style id="linea"><LineStyle><color>ff3f78e9</color><width>3</width></LineStyle></Style>'
            f"<Folder><name>Postes</name>{''.join(pm)}</Folder>{linea}</Document></kml>")


def proyecto_a_kmz(proyecto: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("doc.kml", proyecto_a_kml(proyecto))
    return buf.getvalue()
