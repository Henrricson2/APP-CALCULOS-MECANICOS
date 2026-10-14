# App de Cálculos Mecánicos – Líneas de Media Tensión (v2.2 · Etapa 1)

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
- **Mapa / planta**: Google Maps satelital (clave en *Parámetros → Mapa satelital*) o planta vectorial
  propia sin fondo. Mover (arrastrar), insertar en un vano, agregar, duplicar, reordenar, bloquear,
  eliminar, medir (distancia geodésica), etiquetas y coordenadas, deshacer/rehacer (Ctrl+Z / Ctrl+Y).
- Cada poste conserva **identificador permanente** y **coordenadas originales**; internamente se usa
  MAGNA-SIRGAS Origen Nacional (Res. IGAC 471 de 2020) y la abscisa del perfil es la distancia
  geodésica acumulada. Las cotas indican su fuente (topografía, archivo, interpolada, por verificar).
- **Exportación KML/KMZ** para Google Earth conservando identificadores.
- Transformaciones con **pyproj (PROJ/EPSG)**; respaldo propio (series de Krüger n⁶ + Vincenty)
  verificado contra pyproj en las pruebas (≤ 1 cm).

### Clave de Google Maps
1. Google Cloud Console → crear proyecto → habilitar **Maps JavaScript API** → crear clave.
2. Restringir la clave por **sitio web** a la dirección de la app (p. ej. `http://127.0.0.1:8766/*` y la IP de la intranet).
3. Pegarla en *Parámetros → Mapa satelital*. Cupo gratuito: 10 000 cargas de mapa/mes.

## Uso

| Acción | Archivo |
|---|---|
| Instalar (una vez) | `INSTALAR.bat` |
| Abrir la app en el PC | `INICIAR_APP.bat` |
| Usar desde el celular (misma Wi-Fi) | `INICIAR_APP_RED.bat` → abrir en el celular la dirección que muestra → menú del navegador → *Agregar a pantalla de inicio* |
| Pruebas automáticas | `PRUEBAS.bat` |

Cerrar la ventana negra del servidor cierra la app.

### Publicar en internet (opcional)
Ejecute `python construir_web.py` y publique la carpeta `web/` en cualquier hosting estático:
el cálculo corre con Python en el navegador (Pyodide), sin servidor.

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
├─ tests/                    pruebas automáticas (pytest)
├─ ejemplos/                 DATOS.xlsx, ejemplo completo y salidas
└─ INFORME_REVISION.md       revisión técnica del código original
```

Si modifica el motor Python, ejecute `python construir_web.py` para actualizar la copia del
modo navegador.

> Valores por defecto según EH-RAA-004 (Electrohuila). El ingeniero responsable debe confirmar
> hipótesis, límites de tensión y datos del conductor en cada proyecto.
