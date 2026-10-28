// Funciones geográficas livianas en JavaScript (copia fiel de calculos_mecanicos/geo.py) para el modo web:
// crear proyectos, agregar estructuras, convertir coordenadas y armar el perfil del terreno funcionan al
// instante en celulares y tabletas, sin esperar a que cargue Python (que queda solo para el cálculo,
// la importación de archivos y las salidas).
const A_GRS80 = 6378137.0, F_GRS80 = 1 / 298.257222101, F_WGS84 = 1 / 298.257223563;
const dms = (g, m = 0, s = 0) => g + m / 60 + s / 3600;
const LAT_GK = dms(4, 35, 46.3215);
const S = (codigo, nombre, tipo, epsg, o = {}) => ({ codigo, nombre, tipo, epsg, lat0: 0, lon0: 0, k0: 1, fe: 0, fn: 0, f: F_GRS80, ejes: ['E', 'N'], nota: '', ...o });
export const SISTEMAS = Object.fromEntries([
  S('WGS84', 'Latitud / longitud WGS84 (GPS, Google, KML)', 'geografico', 4326, { f: F_WGS84, ejes: ['Latitud', 'Longitud'] }),
  S('MAGNA_GEO', 'Latitud / longitud MAGNA-SIRGAS', 'geografico', 4686, { ejes: ['Latitud', 'Longitud'] }),
  S('ORIGEN_NACIONAL', 'MAGNA-SIRGAS Origen Nacional (CTM12)', 'proyectado', 9377, { lat0: 4.0, lon0: -73.0, k0: 0.9992, fe: 5000000, fn: 2000000, nota: 'Sistema oficial único (Res. IGAC 471 de 2020). Sistema interno de cálculo.' }),
  S('GK_BOGOTA', 'MAGNA-SIRGAS Gauss-Krüger origen Bogotá', 'proyectado', 3116, { lat0: LAT_GK, lon0: -dms(74, 4, 39.0285), fe: 1000000, fn: 1000000, nota: 'Usual en planos del Huila anteriores a 2020.' }),
  S('GK_OESTE', 'MAGNA-SIRGAS Gauss-Krüger origen Oeste', 'proyectado', 3115, { lat0: LAT_GK, lon0: -dms(77, 4, 39.0285), fe: 1000000, fn: 1000000 }),
  S('GK_OESTE_OESTE', 'MAGNA-SIRGAS Gauss-Krüger origen Oeste-Oeste', 'proyectado', 3114, { lat0: LAT_GK, lon0: -dms(80, 4, 39.0285), fe: 1000000, fn: 1000000 }),
  S('GK_ESTE_CENTRAL', 'MAGNA-SIRGAS Gauss-Krüger origen Este Central', 'proyectado', 3117, { lat0: LAT_GK, lon0: -dms(71, 4, 39.0285), fe: 1000000, fn: 1000000 }),
  S('GK_ESTE', 'MAGNA-SIRGAS Gauss-Krüger origen Este', 'proyectado', 3118, { lat0: LAT_GK, lon0: -dms(68, 4, 39.0285), fe: 1000000, fn: 1000000 }),
  S('UTM18N', 'UTM zona 18 Norte (WGS84)', 'proyectado', 32618, { lon0: -75.0, k0: 0.9996, fe: 500000, f: F_WGS84, nota: 'Cubre todo el Huila.' }),
  S('UTM17N', 'UTM zona 17 Norte (WGS84)', 'proyectado', 32617, { lon0: -81.0, k0: 0.9996, fe: 500000, f: F_WGS84 }),
  S('UTM19N', 'UTM zona 19 Norte (WGS84)', 'proyectado', 32619, { lon0: -69.0, k0: 0.9996, fe: 500000, f: F_WGS84 }),
  S('LOCAL', 'Cartesianas locales de obra (requiere puntos de control)', 'local', null, { ejes: ['X', 'Y'], nota: 'Se georreferencian con Helmert 2D o afín y puntos de control.' }),
].map((s) => [s.codigo, s]));
const INTERNO = 'ORIGEN_NACIONAL';
export const MUNICIPIOS_HUILA = ['Neiva', 'Acevedo', 'Agrado', 'Aipe', 'Algeciras', 'Altamira', 'Baraya', 'Campoalegre', 'Colombia',
  'Elías', 'Garzón', 'Gigante', 'Guadalupe', 'Hobo', 'Íquira', 'Isnos', 'La Argentina', 'La Plata', 'Nátaga', 'Oporapa', 'Paicol',
  'Palermo', 'Palestina', 'Pital', 'Pitalito', 'Rivera', 'Saladoblanco', 'San Agustín', 'Santa María', 'Suaza', 'Tarqui', 'Tello',
  'Teruel', 'Tesalia', 'Timaná', 'Villavieja', 'Yaguará'];

const rad = (g) => g * Math.PI / 180, grad = (r) => r * 180 / Math.PI;
// Transversa de Mercator, series de Krüger n⁶ (Karney 2011)
class TM {
  constructor(s, a = A_GRS80) {
    const f = s.f, n = f / (2 - f), [n2, n3, n4, n5, n6] = [n ** 2, n ** 3, n ** 4, n ** 5, n ** 6];
    Object.assign(this, { k0: s.k0, fe: s.fe, fn: s.fn, lon0: rad(s.lon0), e: Math.sqrt(f * (2 - f)) });
    this.A = a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
    this.alfa = [n / 2 - 2 / 3 * n2 + 5 / 16 * n3 + 41 / 180 * n4 - 127 / 288 * n5 + 7891 / 37800 * n6,
      13 / 48 * n2 - 3 / 5 * n3 + 557 / 1440 * n4 + 281 / 630 * n5 - 1983433 / 1935360 * n6,
      61 / 240 * n3 - 103 / 140 * n4 + 15061 / 26880 * n5 + 167603 / 181440 * n6,
      49561 / 161280 * n4 - 179 / 168 * n5 + 6601661 / 7257600 * n6,
      34729 / 80640 * n5 - 3418889 / 1995840 * n6, 212378941 / 319334400 * n6];
    this.beta = [n / 2 - 2 / 3 * n2 + 37 / 96 * n3 - 1 / 360 * n4 - 81 / 512 * n5 + 96199 / 604800 * n6,
      1 / 48 * n2 + 1 / 15 * n3 - 437 / 1440 * n4 + 46 / 105 * n5 - 1118711 / 3870720 * n6,
      17 / 480 * n3 - 37 / 840 * n4 - 209 / 4480 * n5 + 5569 / 90720 * n6,
      4397 / 161280 * n4 - 11 / 504 * n5 - 830251 / 7257600 * n6,
      4583 / 161280 * n5 - 108847 / 3991680 * n6, 20648693 / 638668800 * n6];
    this.delta = [2 * n - 2 / 3 * n2 - 2 * n3 + 116 / 45 * n4 + 26 / 45 * n5 - 2854 / 675 * n6,
      7 / 3 * n2 - 8 / 5 * n3 - 227 / 45 * n4 + 2704 / 315 * n5 + 2323 / 945 * n6,
      56 / 15 * n3 - 136 / 35 * n4 - 1262 / 105 * n5 + 73814 / 2835 * n6,
      4279 / 630 * n4 - 332 / 35 * n5 - 399572 / 14175 * n6,
      4174 / 315 * n5 - 144838 / 6237 * n6, 601676 / 22275 * n6];
    this.xi0 = this._xiEta(rad(s.lat0), 0)[0];
  }
  _xiEta(phi, dl) {
    const e = this.e;
    const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
    const xp = Math.atan2(t, Math.cos(dl)), ep = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
    let xi = xp, eta = ep;
    this.alfa.forEach((a, k) => { const j = k + 1; xi += a * Math.sin(2 * j * xp) * Math.cosh(2 * j * ep); eta += a * Math.cos(2 * j * xp) * Math.sinh(2 * j * ep); });
    return [xi, eta];
  }
  directa(lat, lon) { const [xi, eta] = this._xiEta(rad(lat), rad(lon) - this.lon0); return [this.fe + this.k0 * this.A * eta, this.fn + this.k0 * this.A * (xi - this.xi0)]; }
  inversa(E, N) {
    const xi = (N - this.fn) / (this.k0 * this.A) + this.xi0, eta = (E - this.fe) / (this.k0 * this.A);
    let xp = xi, ep = eta;
    this.beta.forEach((b, k) => { const j = k + 1; xp -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); ep -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); });
    const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
    const phi = chi + this.delta.reduce((s, d, k) => s + d * Math.sin(2 * (k + 1) * chi), 0);
    return [grad(phi), grad(this.lon0 + Math.atan2(Math.sinh(ep), Math.cos(xp)))];
  }
}
const _tm = {};
const tm = (c) => (_tm[c] ||= new TM(SISTEMAS[c]));

export function distancia(lat1, lon1, lat2, lon2, a = A_GRS80, f = F_GRS80) { // Vincenty
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const b = a * (1 - f), L = rad(lon2 - lon1);
  const U1 = Math.atan((1 - f) * Math.tan(rad(lat1))), U2 = Math.atan((1 - f) * Math.tan(rad(lat2)));
  const [sU1, cU1, sU2, cU2] = [Math.sin(U1), Math.cos(U1), Math.sin(U2), Math.cos(U2)];
  let lam = L, ss, cs, sig, c2a, c2sm;
  for (let it = 0; it < 200; it++) {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    ss = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl);
    if (ss === 0) return 0;
    cs = sU1 * sU2 + cU1 * cU2 * cl; sig = Math.atan2(ss, cs);
    const sa = cU1 * cU2 * sl / ss; c2a = 1 - sa * sa;
    c2sm = c2a ? cs - 2 * sU1 * sU2 / c2a : 0;
    const C = f / 16 * c2a * (4 + f * (4 - 3 * c2a)), lp = lam;
    lam = L + (1 - C) * f * sa * (sig + C * ss * (c2sm + C * cs * (-1 + 2 * c2sm ** 2)));
    if (Math.abs(lam - lp) < 1e-13) break;
  }
  const u2 = c2a * (a * a - b * b) / (b * b);
  const A_ = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), B_ = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const ds = B_ * ss * (c2sm + B_ / 4 * (cs * (-1 + 2 * c2sm ** 2) - B_ / 6 * c2sm * (-3 + 4 * ss ** 2) * (-3 + 4 * c2sm ** 2)));
  return b * A_ * (sig - ds);
}

const RX_GMS = /^\s*([NSEOW])?\s*(-?\d+(?:[.,]\d+)?)\s*(?:°|º|d|\s)\s*(?:(\d+(?:[.,]\d+)?)\s*(?:'|′|m|\s)\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:"|″|''|s)?\s*)?([NSEOW])?\s*$/i;
export function leerAngulo(texto, eje = 'lat') {
  if (texto == null || texto === '') throw new Error('Ángulo vacío.');
  let v;
  if (typeof texto === 'number') v = texto;
  else {
    const s = String(texto).trim().replace(/’/g, "'").replace(/”/g, '"').toUpperCase();
    if (!s) throw new Error('Ángulo vacío.');
    const num = s.replace(',', '.');
    if (/^[+-]?(\d+\.?\d*|\.\d+)(E[+-]?\d+)?$/.test(num)) v = parseFloat(num);
    else {
      const m = RX_GMS.exec(s);
      if (!m) throw new Error(`No se reconoce el ángulo «${texto}».`);
      const [, h1, gS, miS, seS, h2] = m; const hemi = h1 || h2;
      const g = parseFloat(gS.replace(',', '.')), mi = miS ? parseFloat(miS.replace(',', '.')) : 0, se = seS ? parseFloat(seS.replace(',', '.')) : 0;
      if (mi >= 60 || se >= 60) throw new Error(`Minutos o segundos ≥ 60 en «${texto}».`);
      v = Math.abs(g) + mi / 60 + se / 3600;
      if (hemi) {
        if (['S', 'O', 'W'].includes(hemi)) v = -v;
        if ((eje === 'lat' && !['N', 'S'].includes(hemi)) || (eje === 'lon' && !['E', 'O', 'W'].includes(hemi))) throw new Error(`Hemisferio «${hemi}» no corresponde a ${eje === 'lon' ? 'longitud' : 'latitud'}.`);
      } else if (g < 0 || gS.startsWith('-')) v = -v;
    }
  }
  const lim = eje === 'lat' ? 90 : 180;
  if (!(v >= -lim && v <= lim)) throw new Error(`${eje === 'lat' ? 'Latitud' : 'Longitud'} fuera de rango: ${v}`);
  return v;
}

export function transformarPunto(codigo, u, v) {
  const s = SISTEMAS[codigo];
  if (!s) throw new Error(`Sistema desconocido: ${codigo}`);
  let lat, lon;
  if (s.tipo === 'geografico') { lat = leerAngulo(u, 'lat'); lon = leerAngulo(v, 'lon'); }
  else { const E0 = parseFloat(String(u).replace(',', '.')), N0 = parseFloat(String(v).replace(',', '.')); if (!Number.isFinite(E0) || !Number.isFinite(N0)) throw new Error('Coordenadas no numéricas.'); [lat, lon] = tm(codigo).inversa(E0, N0); }
  const [E, N] = tm(INTERNO).directa(lat, lon);
  return { lat, lon, E, N };
}

export function muestrasPerfil(puntos, pasoM = 10, maxMuestras = 2000) {
  if (puntos.length < 2) throw new Error('Se necesitan al menos 2 estructuras con coordenadas.');
  const xs = [0];
  for (let i = 1; i < puntos.length; i++) xs.push(xs[i - 1] + distancia(puntos[i - 1][0], puntos[i - 1][1], puntos[i][0], puntos[i][1]));
  const total = xs.at(-1), paso = Math.max(+pasoM, total / Math.max(maxMuestras - puntos.length, 1)), out = [];
  const r3 = (x) => Math.round(x * 1000) / 1000;
  for (let i = 0; i < puntos.length - 1; i++) {
    const [la1, lo1] = puntos[i], [la2, lo2] = puntos[i + 1];
    out.push({ lat: la1, lon: lo1, x: r3(xs[i]), apoyo: i });
    const largo = xs[i + 1] - xs[i], n = Math.floor(largo / paso);
    for (let k = 1; k <= n; k++) {
      if (largo - k * paso < paso * 0.3) break;
      const t = k * paso / largo;
      out.push({ lat: la1 + t * (la2 - la1), lon: lo1 + t * (lo2 - lo1), x: r3(xs[i] + k * paso), apoyo: null });
    }
  }
  out.push({ lat: puntos.at(-1)[0], lon: puntos.at(-1)[1], x: r3(total), apoyo: puntos.length - 1 });
  return { muestras: out, longitud_m: r3(total), paso_m: Math.round(paso * 100) / 100 };
}

const dict = (s) => ({ codigo: s.codigo, nombre: s.nombre, tipo: s.tipo, epsg: s.epsg, ejes: s.ejes, nota: s.nota });
// Devuelve la respuesta (igual a la del motor Python) o `undefined` si la función necesita Python.
export function rpcLigero(nombre, d = {}) {
  try {
    if (nombre === 'geo_sistemas') return { ok: true, sistemas: Object.values(SISTEMAS).map(dict), interno: INTERNO, motor: 'implementación propia (series de Krüger n⁶ + Vincenty)' };
    if (nombre === 'municipios') return { ok: true, departamentos: { Huila: MUNICIPIOS_HUILA }, nota: 'Lista del Huila. Coordenadas de referencia solo para Neiva (2.9273, -75.2819).' };
    if (nombre === 'geo_transformar') {
      if (d.georref || SISTEMAS[d.sistema]?.tipo === 'local') return undefined;   // georreferenciación local: Python
      return { ok: true, puntos: (d.puntos || []).map((p) => { try { return { ok: true, ...transformarPunto(d.sistema, p.u, p.v) }; } catch (e) { return { ok: false, error: e.message }; } }) };
    }
    if (nombre === 'geo_desde_latlon') return { ok: true, puntos: (d.puntos || []).map((p) => { const [E, N] = tm(INTERNO).directa(+p.lat, +p.lon); return { E, N }; }) };
    if (nombre === 'perfil_muestras') return { ok: true, ...muestrasPerfil((d.puntos || []).map((p) => [+p.lat, +p.lon]), +(d.paso_m || 10), +(d.max_muestras || 2000)) };
    if (nombre === 'geo_distancia') return { ok: true, distancia_m: distancia(+d.a.lat, +d.a.lon, +d.b.lat, +d.b.lon) };
  } catch (e) { return { ok: false, errores: [e.message] }; }
  return undefined;
}
