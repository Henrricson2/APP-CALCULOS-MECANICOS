// Cotas del terreno desde un modelo digital de elevación, a partir de latitud/longitud.
//   - Google (Elevation, el mismo modelo que muestra Google Earth): requiere la clave de Google Maps
//     con «Maps JavaScript API» y «Elevation API» habilitadas.
//   - Gratis sin clave: OpenTopoData SRTM 30 m; si falla, Open-Meteo (Copernicus DEM 90 m).
// Son modelos de SUPERFICIE: pueden medir sobre árboles o construcciones (error típico 2–10 m).
import { cargarGoogle } from './mapa.js?v=9';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const lotes = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, k) => arr.slice(k * n, k * n + n));

export const FUENTES = {
  google: 'Google (mismo modelo de Google Earth)',
  srtm: 'Gratis: SRTM 30 m (OpenTopoData)',
  openmeteo: 'Gratis: Copernicus 90 m (Open-Meteo)',
};

async function google(puntos, clave, avance) {
  if (!clave) throw new Error('Falta la clave de Google Maps (Parámetros → Mapa satelital).');
  await cargarGoogle(clave);
  const svc = new window.google.maps.ElevationService();
  const out = [];
  const grupos = lotes(puntos, 300);
  for (const [k, g] of grupos.entries()) {
    avance?.(`Consultando Google… ${k + 1}/${grupos.length}`);
    const res = await new Promise((ok, mal) => svc.getElevationForLocations(
      { locations: g.map((p) => ({ lat: p.lat, lng: p.lon })) },
      (r, estado) => (estado === 'OK' ? ok(r) : mal(new Error(estado === 'REQUEST_DENIED'
        ? 'Google negó la consulta: habilite «Elevation API» en su proyecto de Google Cloud para esta clave.'
        : `Google respondió: ${estado}`)))));
    out.push(...res.map((r) => r.elevation));
  }
  return out;
}

async function srtm(puntos, avance) {
  const out = [];
  const grupos = lotes(puntos, 100);
  for (const [k, g] of grupos.entries()) {
    avance?.(`Consultando SRTM 30 m… ${k + 1}/${grupos.length}`);
    const loc = g.map((p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`).join('|');
    const r = await fetch(`https://api.opentopodata.org/v1/srtm30m?interpolation=bilinear&locations=${loc}`);
    if (!r.ok) throw new Error(`OpenTopoData respondió ${r.status}`);
    const j = await r.json();
    if (j.status !== 'OK') throw new Error(j.error || 'OpenTopoData no devolvió datos');
    out.push(...j.results.map((x) => x.elevation));
    if (k < grupos.length - 1) await espera(1100); // límite del servicio público: 1 consulta/s
  }
  return out;
}

async function openmeteo(puntos, avance) {
  const out = [];
  const grupos = lotes(puntos, 100);
  for (const [k, g] of grupos.entries()) {
    avance?.(`Consultando Copernicus 90 m… ${k + 1}/${grupos.length}`);
    const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${g.map((p) => p.lat.toFixed(6)).join(',')}&longitude=${g.map((p) => p.lon.toFixed(6)).join(',')}`);
    if (!r.ok) throw new Error(`Open-Meteo respondió ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j.elevation)) throw new Error(j.reason || 'Open-Meteo no devolvió datos');
    out.push(...j.elevation);
  }
  return out;
}

/** Devuelve { cotas: number[], fuente: 'google'|'srtm'|'openmeteo' } en el mismo orden que `puntos`. */
export async function obtenerCotas(puntos, fuente, { clave, avance } = {}) {
  let cotas, usada = fuente;
  if (fuente === 'google') cotas = await google(puntos, clave, avance);
  else {
    try { cotas = await srtm(puntos, avance); usada = 'srtm'; }
    catch (e) { avance?.('SRTM no respondió; probando Copernicus 90 m…'); cotas = await openmeteo(puntos, avance); usada = 'openmeteo'; }
  }
  if (cotas.length !== puntos.length || cotas.some((z) => z == null || !Number.isFinite(+z))) {
    throw new Error('El modelo de elevación no tiene datos para algunos puntos.');
  }
  return { cotas: cotas.map((z) => +(+z).toFixed(2)), fuente: usada };
}
