# Cambios

## Versión 1.0 (2026-10-27)

Primera versión estable. Se probó una línea completa de principio a fin (12 estructuras en Garzón, 1.4 km, 13.2 kV):
proyecto nuevo con el clima del municipio (IDEAM), estructuras pegadas desde Excel, estructuras EH asignadas con el
buscador, postes y templetes, cálculo, resultados sin advertencias y todas las salidas.

**Qué incluye**
- Proyectos con versiones e historial (servidor SQLite) o en el dispositivo (modo web).
- Estructuras y mapa: registro, pegado masivo, importación de Excel / CSV / KML / KMZ con asistente de coordenadas,
  planta con satélite (Leaflet) o sin fondo, perfil del terreno, templetes.
- Hipótesis llenadas con el clima IDEAM de los 37 municipios del Huila (editables).
- Catálogo de las 218 estructuras normalizadas de Electrohuila con la geometría de cada lámina.
- Cálculo mecánico (cambio de estado, vano regulador, catenaria, distancia mínima, arrancamiento, postes y templetes,
  varios circuitos) según EH-RAA-004.
- Salidas: memoria Excel, plano de plantillado PDF A3, DXF del perfil, planta + 3D en DXF/DWG con bloques 3D,
  biblioteca 3D de estructuras EH, Google Earth 3D (KML), KMZ, mapa HTML y archivo de proyecto `.cmt.json`.

**Correcciones de esta versión**
- El mapa quedaba en blanco (ancho cero) en pantallas de 1500 px o menos, también sin internet.
- Faltaba el visor 3D (`web/js/visor3d.js`) y tenía un error que dejaba la app en «Conectando motor…».
- La ventana de templetes mostraba la altura de amarre por defecto en vez de la de la estructura EH asignada.
- Los nombres de los archivos descargados conservan las tildes (antes salía «L_nea_prueba» en algunos).
- Abrir un `.cmt.json` de un proyecto que ya existe lo guarda como «(copia)» para no repetir nombres.
- «Guardar proyecto» confirma la descarga; «Ver lámina» solo aparece donde están los PDF (PC o red local).

**Limitaciones conocidas**
- El DWG necesita AutoCAD u ODA File Converter en el PC; sin ellos, descargue el DXF.
- Mapa satelital, perfil del terreno automático, visor 3D y versión web necesitan internet.
