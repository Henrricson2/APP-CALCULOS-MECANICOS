// Cotas del terreno desde un modelo digital de elevación, a partir de latitud/longitud.
//   - Google (Elevation, el mismo modelo que muestra Google Earth): requiere la clave de Google Maps
//     con «Maps JavaScript API» y «Elevation API» habilitadas.
//   - Gratis sin clave: OpenTopoData SRTM 30 m (con el servidor de la app); en celular/tableta/web,
//     AWS Terrain Tiles (SRTM, sin límite de consultas); último respaldo Open-Meteo (Copernicus 90 m).
// Son modelos de SUPERFICIE: pueden medir sobre árboles o construcciones (error típico 2–10 m).
import { cargarGoogle } from './mapa.js?v=15';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const lotes = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, k) => arr.slice(k * n, k * n + n));

export const FUENTES = {
  google: 'Google (mismo modelo de Google Earth)',
  srtm: 'Gratis: SRTM 30 m (OpenTopoData)',
  terreno: 'Gratis: SRTM (AWS Terrain Tiles)',
  openmeteo: 'Gratis: Copernicus 90 m (Open-Meteo)',
};

// ---- AWS Terrain Tiles (formato «terrarium»): imágenes PNG públicas con CORS y sin límite de
// consultas. Cota = R·256 + G + B/256 − 32768. Se interpola bilinealmente dentro del mosaico.
const TERRARIO = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const mosaicos = new Map();
function mosaico(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (!mosaicos.has(k)) {
    mosaicos.set(k, new Promise((ok, mal) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const cx = c.getContext('2d', { willReadFrequently: true });
          cx.drawImage(img, 0, 0);
          const d = cx.getImageData(0, 0, c.width, c.height).data, n = c.width;
          const z16 = new Float32Array(n * n);
          for (let i = 0; i < n * n; i++) z16[i] = d[4 * i] * 256 + d[4 * i + 1] + d[4 * i + 2] / 256 - 32768;
          ok({ n, z: z16 });
        } catch (e) { mal(e); }
      };
      img.onerror = () => mal(new Error('No se pudo descargar el mosaico de elevación ' + k));
      img.src = `${TERRARIO}/${k}.png`;
    }).catch((e) => { mosaicos.delete(k); throw e; }));
  }
  return mosaicos.get(k);
}
function pixel(lat, lon, z) { // coordenadas de píxel globales (Web Mercator, mosaicos de 256)
  const n = 256 * 2 ** z, r = lat * Math.PI / 180;
  return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
}
async function cotaEn(px, py, z) {
  const val = async (X, Y) => {
    const t = await mosaico(z, Math.floor(X / 256), Math.floor(Y / 256));
    return t.z[(Y % 256) * t.n + (X % 256)];
  };
  const x0 = Math.floor(px - 0.5), y0 = Math.floor(py - 0.5), fx = px - 0.5 - x0, fy = py - 0.5 - y0;
  const [a, b, c, d] = await Promise.all([val(x0, y0), val(x0 + 1, y0), val(x0, y0 + 1), val(x0 + 1, y0 + 1)]);
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}
async function terreno(puntos, avance) {
  let z = 14;
  const cuenta = (zz) => new Set(puntos.map((p) => pixel(p.lat, p.lon, zz).map((v) => Math.floor(v / 256)).join())).size;
  while (z > 10 && cuenta(z) > 40) z--;
  const total = cuenta(z);
  avance?.(`Descargando el modelo de elevación… (${total} mosaico${total === 1 ? '' : 's'})`);
  const out = [];
  for (const [i, g] of lotes(puntos, 200).entries()) {
    out.push(...await Promise.all(g.map((p) => cotaEn(...pixel(p.lat, p.lon, z), z))));
    avance?.(`Calculando cotas… ${Math.min((i + 1) * 200, puntos.length)}/${puntos.length}`);
  }
  if (out.some((v) => !Number.isFinite(v) || v < -500)) throw new Error('El modelo de elevación no tiene datos en esta zona.');
  return out;
}

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

// Desde el servidor de la app (sin bloqueo CORS); si no hay servidor, directo desde el navegador.
async function consulta(fuente, g, rpc) {
  if (rpc) {
    try {
      const r = await rpc('elevacion', { fuente, puntos: g.map((p) => ({ lat: p.lat, lon: p.lon })) });
      if (r.ok && Array.isArray(r.cotas)) return r.cotas;
      console.warn('Elevación por el servidor:', (r.errores || []).join(' '));
    } catch (e) { console.warn('Elevación por el servidor:', e.message); }
    // si el servidor no pudo (sin salida a internet, versión vieja…), se intenta desde el navegador
  }
  if (fuente === 'srtm') {
    const loc = g.map((p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`).join('|');
    const r = await fetch(`https://api.opentopodata.org/v1/srtm30m?interpolation=bilinear&locations=${loc}`);
    if (!r.ok) throw new Error(`OpenTopoData respondió ${r.status}`);
    const j = await r.json();
    if (j.status !== 'OK') throw new Error(j.error || 'OpenTopoData no devolvió datos');
    return j.results.map((x) => x.elevation);
  }
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${g.map((p) => p.lat.toFixed(6)).join(',')}&longitude=${g.map((p) => p.lon.toFixed(6)).join(',')}`;
  let r;
  for (let intento = 0; ; intento++) { // 429 = demasiadas consultas: se espera y se reintenta
    r = await fetch(url);
    if (r.status !== 429 || intento >= 3) break;
    await espera(2000 * (intento + 1));
  }
  if (!r.ok) throw new Error(r.status === 429 ? 'Open-Meteo está saturado (429): intente en un minuto.' : `Open-Meteo respondió ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j.elevation)) throw new Error(j.reason || 'Open-Meteo no devolvió datos');
  return j.elevation;
}

async function srtm(puntos, avance, rpc) {
  const out = [];
  const grupos = lotes(puntos, 100);
  for (const [k, g] of grupos.entries()) {
    avance?.(`Consultando SRTM 30 m… ${k + 1}/${grupos.length}`);
    out.push(...await consulta('srtm', g, rpc));
    if (k < grupos.length - 1) await espera(1100); // límite del servicio público: 1 consulta/s
  }
  return out;
}

// Copernicus 90 m (Open-Meteo) entrega el valor de la celda: escalones de ~90 m. Se suaviza
// uniendo con rectas los centros de cada tramo de valor constante.
function suavizarEscalones(z) {
  const centros = [];
  let i = 0;
  while (i < z.length) { let j = i; while (j + 1 < z.length && z[j + 1] === z[i]) j++; centros.push([(i + j) / 2, z[i]]); i = j + 1; }
  if (centros.length < 2) return z;
  return z.map((_, k) => {
    if (k <= centros[0][0]) return centros[0][1];
    if (k >= centros.at(-1)[0]) return centros.at(-1)[1];
    let a = 0; while (centros[a + 1][0] < k) a++;
    const [x0, y0] = centros[a], [x1, y1] = centros[a + 1];
    return y0 + (y1 - y0) * (k - x0) / (x1 - x0);
  });
}

async function openmeteo(puntos, avance, rpc) {
  const out = [];
  const grupos = lotes(puntos, 100);
  for (const [k, g] of grupos.entries()) {
    avance?.(`Consultando Copernicus 90 m… ${k + 1}/${grupos.length}`);
    out.push(...await consulta('openmeteo', g, rpc));
    if (!rpc && k < grupos.length - 1) await espera(700);
  }
  return suavizarEscalones(out);
}

/** Devuelve { cotas: number[], fuente: 'google'|'srtm'|'terreno'|'openmeteo' } en el mismo orden que `puntos`. */
export async function obtenerCotas(puntos, fuente, { clave, avance, rpc } = {}) {
  let cotas, usada = fuente;
  if (fuente === 'google') cotas = await google(puntos, clave, avance);
  else {
    // sin el servidor de la app (web, celular, tableta) OpenTopoData no deja consultar desde el navegador
    // (bloqueo CORS): se va directo a Open-Meteo, que sí lo permite
    // (bloqueo CORS): se usan los mosaicos SRTM de AWS (sin límite de consultas) y, si fallan, Open-Meteo
    const respaldo = async (motivo) => {
      try { cotas = await terreno(puntos, avance); usada = 'terreno'; }
      catch (e) {
        console.warn('Terrain Tiles:', e.message, motivo || '');
        avance?.('Probando Copernicus 90 m (Open-Meteo)…');
        cotas = await openmeteo(puntos, avance, rpc); usada = 'openmeteo';
      }
    };
    if (!rpc) await respaldo();
    else try { cotas = await srtm(puntos, avance, rpc); usada = 'srtm'; }
    catch (e) { console.warn('SRTM:', e.message); avance?.('SRTM no respondió; probando otro modelo…'); await respaldo(e.message); }
  }
  if (cotas.length !== puntos.length || cotas.some((z) => z == null || !Number.isFinite(+z))) {
    throw new Error('El modelo de elevación no tiene datos para algunos puntos.');
  }
  return { cotas: cotas.map((z) => +(+z).toFixed(2)), fuente: usada };
}

// ---- muestreo del recorrido en el navegador (respaldo si el servidor no tiene «perfil_muestras»)
export function vincenty(la1, lo1, la2, lo2) { // distancia geodésica WGS84 (m)
  const a = 6378137, f = 1 / 298.257223563, b = a * (1 - f), r = Math.PI / 180;
  const L = (lo2 - lo1) * r, U1 = Math.atan((1 - f) * Math.tan(la1 * r)), U2 = Math.atan((1 - f) * Math.tan(la2 * r));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let l = L, lp, it = 0, sS, cS, s, sA, c2A, c2M;
  do {
    const sl = Math.sin(l), cl = Math.cos(l);
    sS = Math.sqrt((cU2 * sl) ** 2 + (cU1 * sU2 - sU1 * cU2 * cl) ** 2);
    if (sS === 0) return 0;
    cS = sU1 * sU2 + cU1 * cU2 * cl; s = Math.atan2(sS, cS);
    sA = cU1 * cU2 * sl / sS; c2A = 1 - sA * sA;
    c2M = c2A ? cS - 2 * sU1 * sU2 / c2A : 0;
    const C = f / 16 * c2A * (4 + f * (4 - 3 * c2A));
    lp = l; l = L + (1 - C) * f * sA * (s + C * sS * (c2M + C * cS * (-1 + 2 * c2M * c2M)));
  } while (Math.abs(l - lp) > 1e-12 && ++it < 200);
  const u2 = c2A * (a * a - b * b) / (b * b);
  const A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dS = B * sS * (c2M + B / 4 * (cS * (-1 + 2 * c2M * c2M) - B / 6 * c2M * (-3 + 4 * sS * sS) * (-3 + 4 * c2M * c2M)));
  return b * A * (s - dS);
}
export function muestrasRecorrido(puntos, pasoM = 10, maxMuestras = 2000) {
  const xs = [0];
  for (let i = 1; i < puntos.length; i++) xs.push(xs[i - 1] + vincenty(puntos[i - 1].lat, puntos[i - 1].lon, puntos[i].lat, puntos[i].lon));
  const total = xs.at(-1);
  const paso = Math.max(pasoM, total / Math.max(maxMuestras - puntos.length, 1));
  const out = [];
  for (let i = 0; i < puntos.length - 1; i++) {
    const p = puntos[i], q = puntos[i + 1], largo = xs[i + 1] - xs[i];
    out.push({ lat: p.lat, lon: p.lon, x: +xs[i].toFixed(3), apoyo: i });
    for (let k = 1; k <= Math.floor(largo / paso); k++) {
      if (largo - k * paso < paso * 0.3) break;
      const t = k * paso / largo;
      out.push({ lat: p.lat + t * (q.lat - p.lat), lon: p.lon + t * (q.lon - p.lon), x: +(xs[i] + k * paso).toFixed(3), apoyo: null });
    }
  }
  const u = puntos.at(-1);
  out.push({ lat: u.lat, lon: u.lon, x: +total.toFixed(3), apoyo: puntos.length - 1 });
  return { muestras: out, longitud_m: +total.toFixed(3), paso_m: +paso.toFixed(2) };
}
