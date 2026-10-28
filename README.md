# App de Cálculos Mecánicos – Líneas de Media Tensión (versión 1.0)

Notas de la versión: [CAMBIOS.md](CAMBIOS.md).

Plantillado de catenarias, cambio de estado, distancias de seguridad, gravivano/eolovano y
exportación a Excel, PDF y DXF. **Multiplataforma: PC, web y celular**, con la misma
arquitectura y el mismo estilo visual de la app de APUs (PWA + motor Python).

## Arquitectura

```
                ┌──────────────── web/ (PWA: HTML + CSS + JS) ────────────────┐
  PC / celular  │ Resumen · Datos · Parámetros · Perfil · Resultados · Exportar │
                └───────────────┬───────────────────────────┬──────────────────┘
                     /api/* (JSON)                  Pyodide (Python en el navegador)
                ┌───────────────▼─────────┐   ┌──────────────▼───────────────────┐
                │ server.py (Python std.) │   │ mismo paquete calculos_mecanicos │
                │ PC y celulares en Wi-Fi │   │ web estática / GitHub Pages      │
                └───────────────┬─────────┘   └──────────────┬───────────────────┘
                                └──── calculos_mecanicos/motor.py ────┘
                       numpy · scipy · pandas · matplotlib · openpyxl · ezdxf
```

Un solo motor Python (`calculos_mecanicos/`) para todas las plataformas:
- **Con servidor** (`server.py`): rápido; el PC lo ejecuta y los celulares de la misma red lo usan.
- **Sin servidor** (web publicada o celular sin PC): la app detecta que no hay servidor y
  carga Python dentro del navegador (Pyodide). La primera vez descarga ~40 MB; luego funciona sin internet.

## Etapa 1 (coordenadas, mapa y proyectos)

- **Proyectos** guardados en el servidor (SQLite en `datos/app.db`) con versiones y bitácora; autoguardado.
- **Asistente de importación** de Excel, CSV, KML y KMZ: mapeo de columnas, sistema de coordenadas
  (lat/lon decimal o GMS, MAGNA-SIRGAS Origen Nacional, Gauss-Krüger, UTM, coordenadas locales con
  puntos de control Helmert/afín), candidatos detectados automáticamente que el usuario confirma,
  validación (fuera de Colombia, duplicados, cotas vacías ≠ 0), vista previa del trazado.
- **Perfil del terreno solo con latitud/longitud** (botón *⛰ Perfil del terreno*): la app toma puntos
  cada 10 m a lo largo del trazado y consulta la altura del terreno en **Google** (Elevation, el mismo
  modelo de Google Earth; requiere la clave con «Elevation API» habilitada) o gratis sin clave en
  **SRTM 30 m** (OpenTopoData; respaldo Copernicus 90 m de Open-Meteo). Llena la cota Z de cada estructura
  (el poste queda sobre el terreno) y el perfil entre estructuras; luego calcula y abre el perfil. Las
  cotas quedan marcadas «estimada»; las de topografía o escritas a mano se conservan. Avisa si se mueven
  estructuras después de obtenerlo.
- **Postes y templetes**: cada estructura lleva su poste (altura, carga de rotura, peso; catálogo
  referencial editable) y, solo donde se necesiten, sus templetes (cantidad, cable ASTM A475, distancia al
  anclaje, altura). La **altura de amarre sale de la altura del poste** (L − (0.10·L + 0.60) − 0.20 m).
  El cálculo verifica cada poste con la hipótesis TMAX (tiro por ángulo/terminal, viento sobre
  conductores y poste, carga equivalente a 0.20 m de la cima vs carga de rotura / FS), indica
  **«REQUIERE TEMPLETE»**, verifica la tensión del templete y da la carga vertical (peso del poste,
  conductores, herrajes y compresión del templete). Factores y empotramiento editables en Parámetros.
- El **perfil, plantillado y resultados** dependen solo de lo registrado en *Estructuras y mapa*; esas
  vistas solo exportan.
- **Proyectos independientes y completos**: cada proyecto guarda sus parámetros, estructuras, terreno,
  trazado georreferenciado y el **último cálculo con todos sus resultados** (resumen, vanos, apoyos,
  secciones, perfil y advertencias). Al abrirlo se ve tal como quedó, sin recalcular; si se cambia un dato
  queda marcado «Por recalcular». Un proyecto nuevo empieza vacío con los parámetros por defecto (o
  copiados, si se elige). Se guardan en el servidor (SQLite) o, sin servidor, en el dispositivo.
- **Estructuras y mapa** (una sola pestaña): tabla tipo CRUD donde se registra cada estructura con sus
  coordenadas (lat/lon decimal o GMS, Origen Nacional, Gauss-Krüger o UTM) y se dibuja de inmediato en el
  mapa. Editar en la celda, reordenar (↑ ↓), bloquear, eliminar, deshacer (Ctrl+Z), pegar varias filas
  desde Excel o importar un archivo completo. Lo que se mueve en el mapa se actualiza en la tabla.
- **Mapa** con tres motores:
  - **Satélite gratis (predeterminado)**: [Leaflet](https://leafletjs.com) — la librería que usa Folium —
    con imágenes Esri World Imagery, OpenStreetMap y OpenTopoMap. Sin clave ni costo; requiere internet.
  - Google Maps satelital (opcional, clave en *Parámetros → Mapa satelital*).
  - Planta vectorial propia sin fondo (funciona sin internet; se usa automáticamente si no hay conexión).
  Mover (arrastrar), insertar en un vano, agregar, duplicar, reordenar, bloquear,
  eliminar, medir (distancia geodésica), etiquetas y coordenadas, deshacer/rehacer (Ctrl+Z / Ctrl+Y).
- Cada poste conserva **identificador permanente** y **coordenadas originales**; internamente se usa
  MAGNA-SIRGAS Origen Nacional (Res. IGAC 471 de 2020) y la abscisa del perfil es la distancia
  geodésica acumulada. Las cotas indican su fuente (topografía, archivo, interpolada, por verificar).
- **Exportación KML/KMZ** para Google Earth conservando identificadores.
- **Mapa web HTML** (botón *⇩ Mapa web HTML*): un solo archivo con el trazado sobre satélite gratuito,
  hecho con **Folium** si está instalado (o con una plantilla Leaflet propia). Se abre en PC o celular y se
  puede enviar por correo.
- Transformaciones con **pyproj (PROJ/EPSG)**; respaldo propio (series de Krüger n⁶ + Vincenty)
  verificado contra pyproj en las pruebas (≤ 1 cm).

### Clave de Google Maps (opcional)
No es necesaria: el satélite gratuito funciona sin clave. Úsela solo si prefiere las imágenes de Google.
1. Google Cloud Console → crear proyecto → habilitar **Maps JavaScript API** → crear clave.
2. Restringir la clave por **sitio web** a la dirección de la app (p. ej. `http://127.0.0.1:8766/*` y la IP de la intranet).
3. Pegarla en *Parámetros → Mapa satelital*. Cupo gratuito: 10 000 cargas de mapa/mes.

## Uso

| Acción | Archivo |
|---|---|
| Instalar (una vez) | `INSTALAR.bat` |
| Abrir la app en el PC | `INICIAR_APP.bat` (o `EJECUTAR.bat`) |
| Usar desde el celular (misma Wi-Fi) | `INICIAR_APP_RED.bat` → abrir en el celular la dirección que muestra → menú del navegador → *Agregar a pantalla de inicio* |
| Probar el modo web sin servidor | `PROBAR_MODO_WEB.bat` |
| Versión de escritorio clásica (Tkinter) | `EJECUTAR_ESCRITORIO_CLASICO.bat` |
| Pruebas automáticas | `PRUEBAS.bat` |

Cerrar la ventana negra del servidor cierra la app.

### Publicar en internet (opcional, gratis)
Suba la carpeta a un repositorio de GitHub; el flujo `.github/workflows/deploy-pages.yml`
corre las pruebas, ejecuta `construir_web.py` y publica `web/` en GitHub Pages
(Settings → Pages → Source: GitHub Actions). En la web el cálculo corre con Pyodide,
por lo que **no** necesita servidor.

## Datos de entrada
Excel (mismo formato del `DATOS.xlsx` original), plantilla descargable desde la app,
pegado directo desde Excel o edición en la tabla de la app.

| Apoyo | Coordenada en X | Coordenada en Y | *Altura amarre (m)* | *Tipo* | *Flecha* |
|---|---|---|---|---|---|

- Con `Altura amarre`, la Y es cota del terreno y se verifican distancias de seguridad.
- `Tipo`: R = retención (corta secciones de tendido), S = suspensión.
- Hoja opcional `Terreno` (Abscisa, Cota). Hoja opcional `Tensionados` con el conductor.
- Los proyectos se guardan como `.cmt.json` (datos + parámetros) y se abren en cualquier dispositivo.

## Estructura
```
├─ server.py                 servidor (Python estándar, como la app de APUs)
├─ construir_web.py          prepara web/ (defaults, ejemplo, iconos, copia del motor)
├─ web/                      PWA: index.html, styles.css, js/, manifest, service-worker
├─ calculos_mecanicos/
│  ├─ motor.py               fachada JSON (servidor y navegador)
│  ├─ config.py · cambio_estado.py · catenaria.py · datos.py · plantillado.py · exportar.py
│  └─ gui.py                 versión de escritorio clásica
├─ tests/                    pruebas automáticas (pytest)
├─ ejemplos/                 DATOS.xlsx, ejemplo completo y salidas
└─ INFORME_REVISION.md       revisión técnica del código original
```

Si modifica el motor Python, ejecute `python construir_web.py` para actualizar la copia del
modo navegador.

> Valores por defecto según EH-RAA-004 (Electrohuila). El ingeniero responsable debe confirmar
> hipótesis, límites de tensión y datos del conductor en cada proyecto.


## Clima por municipio (IDEAM)

Al crear un proyecto (asistente «Nuevo proyecto»), las temperaturas de las hipótesis se llenan solas con el clima del municipio elegido. La tarjeta **Parámetros → Clima del sitio (IDEAM)** muestra los datos, permite cambiar el municipio, el criterio y el calentamiento del conductor, y volver a llenar. Todos los valores de la tabla de hipótesis siguen siendo editables.

| Hipótesis | Temperatura que se propone |
|---|---|
| TMAX (frío + viento) y FMIN | Temperatura mínima absoluta del municipio (redondeada hacia abajo) |
| EDS | Temperatura media anual |
| FMAX (plantilla caliente) | Temperatura máxima absoluta + calentamiento del conductor (10 °C por defecto) |

- El viento se deja en el valor de la norma (100 km/h): el IDEAM no publica viento de diseño con periodo de retorno.
- Criterio «El más exigente entre IDEAM y la norma»: toma el valor más desfavorable entre el IDEAM y EH-RAA-004 (0/20/0/50 °C).
- Base: `web/clima_huila.json` (37 municipios). Se genera con `python clima_ideam/construir_clima.py` a partir de `clima_ideam/ideam_huila_raw.json`: normales climatológicas IDEAM 1991-2020 (datos.gov.co, nsz2-kzcq), extremos diarios de las estaciones automáticas del IDEAM (afdg-3zpb, ccvq-rp9s), cabeceras DANE-DIVIPOLA y gradiente térmico con la altura ajustado con las estaciones del Huila. `clima_ideam/clima_huila.csv` sirve para revisarla en Excel.


## Estructuras normalizadas EH y diseño 3D

- **Estructuras y mapa → columna «Estructura EH»**: buscador de las 218 estructuras de redes aéreas de las Normas Técnicas de Construcción de Electrohuila (BT, 13,2 kV y 34,5 kV), con filtros, miniatura y lámina en PDF. Sugiere la función según el ángulo de deflexión del poste. Al elegirla se fija el tipo (retención/suspensión) y la **altura real del conductor más bajo** (distancia bajo la cima de la estructura).
- Sin estructura asignada, el conductor más bajo queda **0,70 m bajo la cima** (EH-RAA-004 §7.1: 11,3 m en poste de 14 m).
- Catálogo: `web/estructuras_eh.json`, generado con `python estructuras_eh/construir_catalogo.py "<carpeta App normativa>"`. La geometría de **cada una de las 218 estructuras se leyó de su propia lámina** y está en `estructuras_eh/laminas.py`: crucetas (longitud, altura bajo la cima, sencilla o doble), posición y tipo de aislamiento de cada fase (espigo, espigo doble, cadena de suspensión o retención, line post, red compacta con espaciador, perchas y red trenzada de BT), cable de guarda, separación de los postes en H (1.4 / 1.5 / 1.9 / 2.9 m), derivaciones, equipos de maniobra y subestaciones tipo poste (cortacircuitos, DPS, transformador, silleta/collarín/plataforma y BT). Tras editar ese archivo: `python estructuras_eh/construir_catalogo.py --solo-geometria`. Las láminas PDF se copian a `web/estructuras_eh/pdf/` (no se suben a GitHub).
- **Exportar → Google Earth 3D** (o el botón en Estructuras y mapa): KML con postes (sencillos o en H), crucetas, cada fase con su catenaria en caliente y en frío, cable de guarda, línea de distancia mínima al terreno, vanos que no cumplen y ficha de cada estructura.
- **Exportar → Plano en planta + 3D (AutoCAD)**: DXF R12 con capas `PLANTA_*` (eje, postes, crucetas, fases, nombres, estructura EH, longitud de vanos y ángulos, en z = 0) y `3D_*` (postes, crucetas, conductores con su catenaria, conductor en frío —capa apagada—, cable de guarda, terreno, distancia mínima y alertas, con cotas reales), en coordenadas MAGNA-SIRGAS Origen Nacional. **DWG** (AutoCAD 2018): el servidor lo convierte con `accoreconsole.exe` del AutoCAD instalado en el PC (o con ODA File Converter si no hay AutoCAD).
- **Bloques 3D (sólidos) de estructuras EH**: `web/js/bloques3d.js` genera, desde la geometría de lámina del catálogo, un bloque por estructura con sus crucetas reales, diagonales, aisladores según el tipo de cada fase, bayonetas o grapas del cable de guarda, riostras de las H, brazos y espaciadores de red compacta, equipos de maniobra y, en las subestaciones tipo poste, cortacircuitos, DPS, transformador con su montaje y la BT y bloques `POSTE_<L>M` con los diámetros de EH-RAA-004. Los planos DXF/DWG insertan estos bloques en cada poste, girados según la línea; los conductores son las catenarias del cálculo mecánico.
- **Biblioteca**: `estructuras_eh/BIBLIOTECA_ESTRUCTURAS_EH_3D.dwg` (y .dxf) con las 218 estructuras (incluidas 26 subestaciones tipo poste TRM/TRT) y los postes de 8 a 18 m. Se regenera desde Exportar → «Biblioteca 3D de estructuras EH». En AutoCAD los bloques se pueden insertar con INSERTAR / DesignCenter desde ese archivo.
