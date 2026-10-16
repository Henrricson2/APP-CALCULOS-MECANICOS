// Clima del sitio por municipio (base IDEAM en web/clima_huila.json) -> temperaturas de las hipótesis.
// La base se genera con clima_ideam/construir_clima.py (normales IDEAM 1991-2020 + extremos de las
// estaciones automáticas del Huila, corregidos por la altura de cada cabecera municipal).

let BASE = null;
export async function cargarClima() {
  if (!BASE) {
    try { BASE = await (await fetch('clima_huila.json', { cache: 'no-cache' })).json(); }
    catch { BASE = { municipios: [] }; }
  }
  return BASE;
}

const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export function buscarMunicipio(base, municipio) {
  return (base?.municipios || []).find((m) => sinTildes(m.municipio) === sinTildes(municipio)) || null;
}

// Valores por defecto de la norma EH-RAA-004 (referencia para comparar)
export const NORMA = { TMAX: 0, EDS: 20, FMIN: 0, FMAX: 50 };
export const MODOS = {
  ideam: 'Datos IDEAM del municipio',
  exigente: 'El más exigente entre IDEAM y la norma EH-RAA-004',
};
export const DELTA_CONDUCTOR = 10; // °C sobre la temperatura ambiente máxima (sol + corriente)

// Temperaturas propuestas para cada hipótesis a partir del registro del municipio.
//   TMAX y FMIN: temperatura mínima absoluta (hacia abajo)  · EDS: media anual
//   FMAX: máxima absoluta + calentamiento del conductor (hacia arriba)
export function propuesta(reg, { modo = 'ideam', delta_conductor_c = DELTA_CONDUCTOR } = {}) {
  const tmin = Math.floor(reg.t_min_absoluta_c);
  const v = { TMAX: tmin, EDS: Math.round(reg.t_media_anual_c), FMIN: tmin, FMAX: Math.ceil(reg.t_max_absoluta_c + (+delta_conductor_c || 0)) };
  if (modo === 'exigente') {
    v.TMAX = Math.min(v.TMAX, NORMA.TMAX); v.FMIN = Math.min(v.FMIN, NORMA.FMIN);
    v.EDS = Math.min(v.EDS, NORMA.EDS); v.FMAX = Math.max(v.FMAX, NORMA.FMAX);
  }
  return v;
}

// ¿El valor es menos exigente que la norma? (más caliente en frío/EDS, más frío en flecha máxima)
export function menosExigente(k, t) {
  if (!(k in NORMA) || t == null || t === '') return false;
  return k === 'FMAX' ? +t < NORMA.FMAX : +t > NORMA[k];
}

const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmt = (t) => (Number.isFinite(+t) ? String(+t) : '?');
// Nombre descriptivo de las hipótesis estándar según su temperatura y viento actuales.
export function renombrar(k, hip) {
  if (!hip) return;
  const T = fmt(hip.temperatura_c), V = +hip.viento_kmh || 0;
  const conViento = V ? ` + viento ${fmt(V)} km/h` : ', sin viento';
  const n = {
    TMAX: `Tensión máxima (${T} °C${V ? ` + viento ${fmt(V)} km/h` : ''})`,
    EDS: `Tensión de cada día EDS (${T} °C)`,
    FMIN: `Flecha mínima (${T} °C${conViento})`,
    FMAX: `Flecha máxima / plantilla caliente (${T} °C)`,
  }[k];
  if (n) hip.nombre = n;
}

// Rellena las temperaturas de las hipótesis del proyecto. Devuelve los valores aplicados o null.
export function aplicarClima(proyecto, reg, opciones = {}) {
  if (!proyecto || !reg) return null;
  const modo = opciones.modo || proyecto.clima?.modo || 'ideam';
  const delta = opciones.delta_conductor_c ?? proyecto.clima?.delta_conductor_c ?? DELTA_CONDUCTOR;
  const v = propuesta(reg, { modo, delta_conductor_c: delta });
  for (const [k, t] of Object.entries(v)) {
    const hip = proyecto.hipotesis?.[k];
    if (!hip) continue;
    hip.temperatura_c = t;
    renombrar(k, hip);
  }
  proyecto.clima = {
    municipio: reg.municipio, modo, delta_conductor_c: +delta, aplicado: hoy(), valores: v,
    fuente: `IDEAM · cabecera ${reg.alt_m} m · ${reg.estacion_principal}`,
  };
  return v;
}

// Hipótesis cuya temperatura ya no coincide con la última aplicación del IDEAM (editadas a mano).
export function editadas(proyecto) {
  const v = proyecto?.clima?.valores; if (!v) return [];
  return Object.keys(v).filter((k) => proyecto.hipotesis?.[k] && +proyecto.hipotesis[k].temperatura_c !== +v[k]);
}
