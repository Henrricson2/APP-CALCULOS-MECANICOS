# Informe de revisión técnica – App de cálculos mecánicos MT (Plantillado.ipynb)

**Fecha:** 14-10-2026 · **Revisado:** `Plantillado.ipynb` (16 celdas) y `DATOS.xlsx` (hojas *Hoja1* y *Tensionados*)
**Referencia normativa encontrada en el equipo:** `C:\Normativa_Electrohuila` → **EH-RAA-004 "Cálculos mecánicos estructuras aéreas"** (23-12-2016).

---

## 1. Resumen ejecutivo

El programa original dibuja correctamente una catenaria entre dos puntos y genera Excel, PDF y DXF, pero **el modelo físico tiene errores que cambian los resultados de diseño**, sobre todo en terreno ondulado:

| # | Hallazgo | Gravedad | Efecto en el ejemplo (DATOS.xlsx) |
|---|----------|----------|-----------------------------------|
| 1 | La flecha se define como "apoyo más bajo − vértice". En vanos inclinados esto **no es la flecha** y obliga a un conductor mucho más flojo de lo diseñado | **Crítica** | Vano AP-144→AP-145 (desnivel 26 m): flecha de diseño 2.53 m, **flecha real dibujada 12.13 m** (C = 179 m en vez de ≈ 850 m). Con solo 1 m de desnivel (vano 4) la flecha real sube un 22 % |
| 2 | Cada vano tiene una tensión distinta (parámetro C de 163 m a 884 m en la **misma** línea). Físicamente, los vanos entre dos retenciones comparten **una sola** tensión horizontal (vano regulador) | **Crítica** | Perfil y distancias a tierra no representativos |
| 3 | Hoja *Tensionados*: la carga de viento usada es **0.016 kgf/m**; la norma EH-RAA-004 exige q = 0.0042·V² = 42 kgf/m² → **0.70 kgf/m** para este conductor (≈ 44 veces más) | **Alta** | La hipótesis de carga máxima prácticamente no tiene viento |
| 4 | Hoja *Tensionados*: los valores están **pegados como números** (sin fórmulas); no es posible auditar ni cambiar temperaturas/conductor. La columna "UTS" usa 1987 kgf como rotura, pero el conductor declara **2404 kgf** | Alta | Porcentajes de tensión mal referidos |
| 5 | `VLOOKUP(ROUND(D,-1))` redondea el vano a **10 m** aunque la tabla viene cada 5 m, sin interpolar | Media | Vano 1 (26.2 m): flecha +29 %; vano 3 (74 m): −10 % |
| 6 | La "Coordenada en Y" se trata como punto de amarre del conductor. No hay altura de poste ni terreno → **no se verifica la distancia mínima de seguridad** (5.80 m, RETIE / EH-RAA-004 §7.1.1), que es el objetivo del plantillado | Alta | — |
| 7 | Dato sospechoso: **AP-145 cota 347 m** entre 373 m y 377 m (−26 m / +30 m). Posible error de digitación; además genera **arrancamiento** (gravivano −306 m a 0 °C) | Alta (dato) | Revisar en campo/topografía |
| 8 | No se comprueba la convergencia de `fsolve`; si falla, el programa dibuja y exporta resultados erróneos sin avisar | Media | — |

## 2. Revisión como ingeniería de software

| Problema en el original | Solución en la versión 2.0 |
|---|---|
| Mismo código copiado 4–5 veces (celdas 1, 3, 5, 7, 12, 15); la catenaria se recalcula **4 veces** por vano (pantalla, PDF, DXF, Excel) | Paquete `calculos_mecanicos/` con módulos únicos; las catenarias se calculan una vez y se reutilizan |
| Variables globales (`puntos`, `flechas`, `resultados`…) que se acumulan entre ejecuciones | Objetos inmutables `DatosLinea` y `ResultadoPlantillado`; la interfaz guarda el estado en la clase `App` |
| Lectura del Excel por **posición fija** (columna 4, fila 3…); falla si se agrega una columna | Columnas reconocidas por **nombre** (con o sin tildes), fila de encabezados detectada |
| Copia el Excel a la carpeta del programa (`shutil.copy2`) y exporta allí, sobrescribiendo sin aviso | Se lee el archivo donde está; el usuario elige la carpeta de salida; aviso si un archivo está abierto |
| Interfaz con coordenadas fijas (`x=1800, y=1000`) y pantalla completa: en portátiles los botones quedan fuera de pantalla | Interfaz con `grid/pack`, ventana maximizada redimensionable, pestañas y barra de estado |
| Botones de exportar activos sin cálculo previo → error | Exportar se habilita solo con un cálculo válido |
| `except Exception` que oculta errores; mensajes crípticos | Validación previa con mensajes claros (fila, apoyo, valor) |
| `!pip install` dentro del código | `requirements.txt` + `INSTALAR.bat` |
| Sin pruebas | 38 pruebas automáticas (`tests/`) que incluyen el valor de viento de la norma |
| Sin parámetros editables | Conductor, hipótesis y criterios editables y guardables en JSON por proyecto |

## 3. Qué calcula ahora (modelo técnico)

1. **Secciones de tendido** entre apoyos de retención (columna opcional `Tipo`: R/S).
2. **Vano regulador** por sección: aᵣ = √(Σa³/Σa).
3. **Ecuación de cambio de estado** con hipótesis EH-RAA-004 (editables):
   - TMAX: 0 °C + viento 100 km/h, límite 50 % rotura (factor de seguridad 2).
   - EDS: 20 °C, límite 20 % rotura (*valor de práctica; confirmar con el operador de red*).
   - FMIN: 0 °C sin viento (verificación de arrancamiento).
   - FMAX: 50 °C sin viento (**plantilla caliente**, distancias a tierra).
   - Se determina automáticamente la hipótesis que gobierna.
4. **Catenaria exacta** de cada vano con C = H/w (solución cerrada, sin `fsolve`).
5. **Flecha** medida como en diseño: distancia vertical máxima entre cuerda y conductor.
6. **Verificaciones:** distancia mínima al terreno (con hoja `Terreno` o con cota de terreno + altura de amarre), separación mínima entre fases e = 0.75·√(F+L) + kV/150, tensión en apoyos (TMAX), **eolovano**, **gravivano** y **arrancamiento**, longitud real de conductor (3 fases + desperdicio).
7. **Modo "excel"** para compatibilidad: usa la columna Flecha del archivo, pero con la definición correcta de flecha.

## 4. Cómo usar los datos nuevos (opcionales, retro-compatibles)

En la primera hoja del Excel se pueden agregar:

| Columna | Ejemplo | Significado |
|---|---|---|
| `Altura amarre (m)` | 10.0 | Altura del conductor sobre el terreno. Si existe, **Y pasa a ser cota de terreno** |
| `Tipo` | R / S | Retención o suspensión (define las secciones de tendido) |

Hoja opcional `Terreno` (Abscisa, Cota) con el perfil topográfico entre apoyos. Ver `ejemplos/DATOS_EJEMPLO_COMPLETO.xlsx` (poste de 12 m: altura libre 10.2 m según EH-RAA-004 §5.2).

## 5. Pendientes que debe confirmar el ingeniero responsable

1. Porcentaje EDS y temperatura de plantilla caliente exigidos por Electrohuila para el proyecto (la norma usa 40 °C en la tabla de separaciones y 50 °C como temperatura máxima).
2. Datos de catálogo del conductor "2/0 ECO" (diámetro 16.7 mm parece de conductor semiaislado/ecológico; verificar E y α).
3. Cota real del apoyo **AP-145**.
4. Distancias de seguridad particulares (cruces de vías, ríos, edificaciones – RETIE Tabla 22/23) si aplican; hoy se usa un único valor configurable.
5. Próximas etapas sugeridas: cálculo de momentos en postes (EH-RAA-004 §6, ya están eolovano y tensiones), ángulos de deflexión con coordenadas planas (Este/Norte), selección automática de estructura y retenidas.
