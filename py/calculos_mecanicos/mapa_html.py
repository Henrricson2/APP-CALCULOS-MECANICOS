"""
Mapa web interactivo (HTML de un solo archivo) del trazado, con fondo satelital GRATUITO.

Usa Folium (librería Python de mapas web basada en Leaflet) cuando está instalada; si no,
genera el mismo mapa con una plantilla Leaflet propia, sin dependencias. El archivo se abre
en cualquier navegador (PC o celular) y se puede enviar por correo.
Fondos: Esri World Imagery (satélite), OpenStreetMap y OpenTopoMap — sin clave, con atribución.
"""
from __future__ import annotations

import json
from html import escape

SATELITE = ("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            "Imágenes &copy; Esri, Maxar, Earthstar Geographics y la comunidad de usuarios SIG")
CALLES = ("https://tile.openstreetmap.org/{z}/{x}/{y}.png", "&copy; colaboradores de OpenStreetMap")
TOPO = ("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", "&copy; OpenTopoMap (CC-BY-SA), datos &copy; OpenStreetMap")

try:  # opcional
    import folium  # type: ignore
    HAY_FOLIUM = True
except Exception:  # pragma: no cover - depende del entorno
    folium = None
    HAY_FOLIUM = False


def _postes(proyecto: dict) -> list[dict]:
    return [p for p in proyecto.get("postes", []) if p.get("lat") is not None and p.get("lon") is not None]


def _popup(p: dict) -> str:
    def v(x):
        return "sin dato" if x is None else escape(str(x))
    return (f"<b>{v(p.get('nombre'))}</b><br>Tipo: {'Retención' if p.get('tipo') == 'R' else 'Suspensión'}"
            f"<br>Cota Z: {v(p.get('z'))} m<br>Altura amarre: {v(p.get('altura'))} m"
            f"<br>Lat/Lon: {p['lat']:.6f}, {p['lon']:.6f}")


def _con_folium(nombre: str, postes: list[dict]) -> str:
    m = folium.Map(location=[postes[0]["lat"], postes[0]["lon"]], zoom_start=16, tiles=None, control_scale=True)
    folium.TileLayer(SATELITE[0], attr=SATELITE[1], name="Satélite (Esri)", max_zoom=20, max_native_zoom=19).add_to(m)
    folium.TileLayer(CALLES[0], attr=CALLES[1], name="Calles (OpenStreetMap)", max_zoom=20, max_native_zoom=19).add_to(m)
    folium.TileLayer(TOPO[0], attr=TOPO[1], name="Topográfico (OpenTopoMap)", max_zoom=20, max_native_zoom=17).add_to(m)
    if len(postes) > 1:
        folium.PolyLine([[p["lat"], p["lon"]] for p in postes], color="#e9783f", weight=4, tooltip="Trazado").add_to(m)
    for p in postes:
        folium.CircleMarker([p["lat"], p["lon"]], radius=7, color="#ffffff", weight=2, fill=True, fill_opacity=1,
                            fill_color="#c84c4c" if p.get("tipo") == "R" else "#1f6fb2",
                            tooltip=str(p.get("nombre", "")), popup=folium.Popup(_popup(p), max_width=260)).add_to(m)
    folium.LayerControl().add_to(m)
    m.fit_bounds([[min(p["lat"] for p in postes), min(p["lon"] for p in postes)],
                  [max(p["lat"] for p in postes), max(p["lon"] for p in postes)]])
    m.get_root().html.add_child(folium.Element(f"<title>{escape(nombre)}</title>"))
    return m.get_root().render()


_PLANTILLA = """<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITULO__</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#mapa{height:100%;margin:0}body{font-family:system-ui,sans-serif}
.titulo{position:absolute;z-index:1000;left:56px;top:10px;background:#17324d;color:#fff;padding:6px 12px;border-radius:8px;font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,.3)}</style>
</head><body><div class="titulo">__TITULO__</div><div id="mapa"></div>
<script>
const POSTES = __POSTES__;
const F = __FONDOS__;
const m = L.map('mapa');
const capas = {};
for (const f of F) capas[f.nombre] = L.tileLayer(f.url, {maxZoom: 20, maxNativeZoom: f.max, attribution: f.attr, subdomains: 'abc'});
capas[F[0].nombre].addTo(m);
L.control.layers(capas).addTo(m);
L.control.scale({imperial: false}).addTo(m);
const ll = POSTES.map(p => [p.lat, p.lon]);
if (ll.length > 1) L.polyline(ll, {color: '#e9783f', weight: 4}).bindTooltip('Trazado').addTo(m);
for (const p of POSTES) L.circleMarker([p.lat, p.lon], {radius: 7, color: '#fff', weight: 2, fillOpacity: 1,
  fillColor: p.tipo === 'R' ? '#c84c4c' : '#1f6fb2'}).bindTooltip(p.nombre).bindPopup(p.popup).addTo(m);
m.fitBounds(L.latLngBounds(ll), {padding: [40, 40], maxZoom: 18});
</script></body></html>
"""


def _plantilla(nombre: str, postes: list[dict]) -> str:
    datos = [{"lat": p["lat"], "lon": p["lon"], "tipo": p.get("tipo"), "nombre": str(p.get("nombre", "")),
              "popup": _popup(p)} for p in postes]
    fondos = [{"nombre": "Satélite (Esri)", "url": SATELITE[0], "attr": SATELITE[1], "max": 19},
              {"nombre": "Calles (OpenStreetMap)", "url": CALLES[0], "attr": CALLES[1], "max": 19},
              {"nombre": "Topográfico (OpenTopoMap)", "url": TOPO[0], "attr": TOPO[1], "max": 17}]
    js = lambda o: json.dumps(o, ensure_ascii=False).replace("</", "<\\/")  # noqa: E731
    return (_PLANTILLA.replace("__TITULO__", escape(nombre))
            .replace("__POSTES__", js(datos)).replace("__FONDOS__", js(fondos)))


def proyecto_a_html(proyecto: dict, usar_folium: bool | None = None) -> str:
    """proyecto = {"nombre", "postes": [{nombre, lat, lon, z, altura, tipo}]} -> HTML."""
    postes = _postes(proyecto)
    if not postes:
        raise ValueError("Los postes no tienen coordenadas geográficas.")
    nombre = proyecto.get("nombre") or "Proyecto"
    if (HAY_FOLIUM if usar_folium is None else usar_folium):
        return _con_folium(nombre, postes)
    return _plantilla(nombre, postes)
