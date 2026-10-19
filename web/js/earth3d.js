// Modelo 3D de la línea (postes, crucetas, fases con su catenaria, cable de guarda, terreno y
// distancia mínima) a partir del último cálculo y de la estructura EH de cada poste.
// Lo usan el KML para Google Earth (generarKML3D) y el DXF/DWG para AutoCAD (cad.js).
const X = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const RT = 6378137;

export function interp(xs, ys, x) {
  if (!xs?.length) return null;
  if (x <= xs[0]) return ys[0];
  for (let k = 1; k < xs.length; k++) if (x <= xs[k]) { const t = (x - xs[k - 1]) / ((xs[k] - xs[k - 1]) || 1); return ys[k - 1] + t * (ys[k] - ys[k - 1]); }
  return ys[ys.length - 1];
}

// Devuelve { lineas: [{capa, nombre, pts: [[e, n, z, x]], visible}], postes: [...], alertas: [...], ... }
// e, n: metros en un plano local con origen en la primera estructura; z: cota absoluta; x: abscisa.
export function modelo3D({ S, catalogo }) {
  const r = S.resultado, pf = r?.perfil;
  if (!pf) throw new Error('Primero calcule el proyecto.');
  const ap = pf.apoyos;
  if (ap.length < 2 || ap.some((a) => a.lat == null || a.lon == null)) throw new Error('Las estructuras necesitan latitud y longitud para el diseño 3D.');
  const crit = S.proyecto.criterios;
  const porNombre = new Map(S.apoyos.map((a) => [String(a.nombre), a]));
  const catId = new Map((catalogo?.estructuras || []).map((e) => [e.id, e]));
  const verif = new Map();
  if (r.postes) r.postes.filas.forEach((f) => { const o = {}; r.postes.columnas.forEach((c, k) => { o[c] = f[k]; }); verif.set(String(o.Apoyo), o); });

  const lat0 = ap[0].lat, lon0 = ap[0].lon, kx = Math.PI / 180 * RT * Math.cos(lat0 * Math.PI / 180), ky = Math.PI / 180 * RT;
  const aEN = (la, lo) => [(lo - lon0) * kx, (la - lat0) * ky];
  const aLL = (e, n) => [lon0 + e / kx, lat0 + n / ky];
  const P = ap.map((a) => aEN(a.lat, a.lon));
  const uni = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const dir = P.map((p, k) => {
    const d1 = k > 0 ? uni([p[0] - P[k - 1][0], p[1] - P[k - 1][1]]) : null;
    const d2 = k < P.length - 1 ? uni([P[k + 1][0] - p[0], P[k + 1][1] - p[1]]) : null;
    return uni(d1 && d2 ? [d1[0] + d2[0], d1[1] + d2[1]] : (d1 || d2));
  });
  const perp = dir.map((d) => [d[1], -d[0]]);   // a la derecha en el sentido del abscisado
  const deflex = P.map((p, k) => {
    if (k === 0 || k === P.length - 1) return null;
    const a1 = Math.atan2(p[1] - P[k - 1][1], p[0] - P[k - 1][0]), a2 = Math.atan2(P[k + 1][1] - p[1], P[k + 1][0] - p[0]);
    let d = Math.abs(a2 - a1) * 180 / Math.PI; if (d > 180) d = 360 - d; return d;
  });

  const tx = pf.terreno?.x, ty = pf.terreno?.y;
  const conTerreno = !!(tx?.length && ty?.length && pf.y_es_terreno !== false);
  const terr = (x) => interp(tx, ty, x);

  const bajoDef = +(crit.amarre_bajo_cima_m ?? 0.7);
  const geo = ap.map((a) => {
    const s = porNombre.get(String(a.nombre)) || {};
    const e = s.estructura_id ? catId.get(s.estructura_id) : null;
    const g = e?.geometria || { fases: [[-0.9, bajoDef], [0, bajoDef], [0.9, bajoDef]], guarda: [], postes: [0], bajo_cima_m: bajoDef };
    const bajo = s.bajo_cima_m != null ? +s.bajo_cima_m : g.bajo_cima_m;
    const cima = a.ya + bajo;
    const L = s.poste_altura ? +s.poste_altura : null;
    const libre = L ? L - ((crit.empotramiento_coef ?? 0.1) * L + (crit.empotramiento_base_m ?? 0.6)) : null;
    const base = conTerreno ? terr(a.x) : (libre != null ? cima - libre : (a.yt ?? cima - 10));
    return { a, s, e, g, cima, base, L };
  });
  const posicion = (k, dx, dy = 0) => [P[k][0] + dx * perp[k][0] + dy * dir[k][0], P[k][1] + dx * perp[k][1] + dy * dir[k][1]];
  const lineas = [];
  const add = (capa, nombre, pts, visible = true) => { if (pts.length > 1) lineas.push({ capa, nombre, pts, visible }); };

  // postes y crucetas
  const postes = geo.map((G, k) => {
    const x = G.a.x;
    for (const dx of G.g.postes || [0]) for (const dy of G.g.postes_y || [0]) { const en = posicion(k, dx, dy); add('POSTES', G.a.nombre, [[en[0], en[1], G.base, x], [en[0], en[1], G.cima, x]]); }
    const crucetas = [];
    if (G.g.lamina?.cr?.length) {          // crucetas de la lámina (longitud y altura reales)
      for (const dy of G.g.postes_y || [0]) for (const [zc, x0, x1] of G.g.lamina.cr) {
        const p1 = posicion(k, x0, dy), p2 = posicion(k, x1, dy), z = G.cima - zc;
        crucetas.push([p1, p2]);
        add('CRUCETAS', `Cruceta ${G.a.nombre}`, [[p1[0], p1[1], z, x], [p2[0], p2[1], z, x]]);
      }
    }
    const niveles = new Map();
    for (const [dx, dz] of G.g.fases) if (dz >= 0) { const key = Math.round(dz * 10); (niveles.get(key) || niveles.set(key, []).get(key)).push(dx); }
    if (!G.g.lamina?.cr?.length) for (const [key, dxs] of niveles) {
      const xs = [...dxs, ...(G.g.postes || [0])];
      const mn = Math.min(...xs) - 0.1, mx = Math.max(...xs) + 0.1;
      if (mx - mn < 0.3) continue;
      const z = G.cima - key / 10 + 0.15, p1 = posicion(k, mn), p2 = posicion(k, mx);
      crucetas.push([p1, p2]);
      add('CRUCETAS', `Cruceta ${G.a.nombre}`, [[p1[0], p1[1], z, x], [p2[0], p2[1], z, x]]);
    }
    return { k, nombre: G.a.nombre, en: P[k], dir: dir[k], perp: perp[k], cima: G.cima, base: G.base, x, ya: G.a.ya, yt: G.a.yt,
      tipo: G.a.tipo, estructura: G.s.estructura || '', ficha: G.e, L: G.L, rotura: G.s.poste_rotura, postesDx: G.g.postes || [0], postesDy: G.g.postes_y || [0],
      fases: G.g.fases, crucetas, deflexion: deflex[k], verif: verif.get(String(G.a.nombre)) || {} };
  });

  // conductores: catenaria de cada fase
  const vano = (k, v, fa, fb, ya0, ya1, cima0, cima1, capa, pref, campoY = 'y', vis = true, escala = 1) => {
    const x0 = ap[k].x, x1 = ap[k + 1].x, span = (x1 - x0) || 1;
    const n = Math.min(fa.length, fb.length);
    for (let j = 0; j < n; j++) {
      const [dx0, dz0] = fa[j], [dx1, dz1] = fb[j];
      const h0 = cima0 - dz0, h1 = cima1 - dz1, p0 = posicion(k, dx0), p1 = posicion(k + 1, dx1);
      const pts = v.x.map((x, q) => {
        const t = (x - x0) / span, cuerda = ya0 + (ya1 - ya0) * t, flecha = escala * (cuerda - v[campoY][q]);
        return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, h0 + (h1 - h0) * t - flecha, x];
      });
      add(capa, `${pref} fase ${j + 1} · ${ap[k].nombre}–${ap[k + 1].nombre}`, pts, vis);
    }
  };
  const alertas = [];
  pf.vanos.forEach((v, k) => {
    const A = geo[k], B = geo[k + 1], fa = A.g.fases.slice(0, 3), fb = B.g.fases.slice(0, 3);
    vano(k, v, fa, fb, A.a.ya, B.a.ya, A.cima, B.cima, 'CONDUCTORES', pf.circuito_principal || 'Circuito 1');
    if (v.yf) vano(k, v, fa, fb, A.a.ya, B.a.ya, A.cima, B.cima, 'CONDUCTOR_FRIO', 'Frío', 'yf', false);
    if (A.g.guarda?.length && B.g.guarda?.length) {
      const igual = A.g.guarda.length === B.g.guarda.length;
      vano(k, v, igual ? A.g.guarda : [A.g.guarda[0]], igual ? B.g.guarda : [B.g.guarda[0]], A.a.ya, B.a.ya, A.cima, B.cima, 'CABLE_GUARDA', 'Cable de guarda', 'y', true, 0.8);
    }
    if (v.cumple === 'NO' && v.xmin != null) {
      const t = (v.xmin - A.a.x) / ((B.a.x - A.a.x) || 1);
      alertas.push({ e: P[k][0] + (P[k + 1][0] - P[k][0]) * t, n: P[k][1] + (P[k + 1][1] - P[k][1]) * t, z: interp(v.x, v.y, v.xmin), x: v.xmin,
        texto: `No cumple: ${v.dmin != null ? (+v.dmin).toFixed(2) + ' m' : ''}`, detalle: `Vano ${ap[k].nombre}–${ap[k + 1].nombre}: distancia al terreno menor que ${pf.dmin} m.` });
    }
  });
  (pf.circuitos || []).forEach((c, nc) => c.vanos.forEach((v, q) => {
    const k = v.i, sel = (G) => { const f = G.g.fases.slice(3 * (nc + 1), 3 * (nc + 2)); return (f.length ? f : [[-0.9, 0], [0, 0], [0.9, 0]]).map(([dx]) => [dx, 0]); };
    vano(k, v, sel(geo[k]), sel(geo[k + 1]), c.ya[q], c.ya[q + 1], c.ya[q], c.ya[q + 1], `CIRCUITO_${nc + 2}`, c.nombre);
  }));

  // terreno y distancia mínima a lo largo del eje
  const enEje = (x) => {
    let k = ap.findIndex((a, i) => i < ap.length - 1 && x <= ap[i + 1].x); if (k < 0) k = ap.length - 2;
    const t = (x - ap[k].x) / ((ap[k + 1].x - ap[k].x) || 1);
    return [P[k][0] + (P[k + 1][0] - P[k][0]) * t, P[k][1] + (P[k + 1][1] - P[k][1]) * t];
  };
  if (conTerreno) {
    const xs = [...new Set([...tx, ...ap.map((a) => a.x)])].filter((x) => x >= ap[0].x && x <= ap[ap.length - 1].x).sort((a, b) => a - b);
    add('TERRENO', 'Terreno por el eje', xs.map((x) => { const en = enEje(x); return [en[0], en[1], terr(x), x]; }));
    add('DIST_MINIMA', `Distancia mínima al terreno ${pf.dmin} m`, xs.map((x) => { const en = enEje(x); return [en[0], en[1], terr(x) + pf.dmin, x]; }));
  }
  return { lineas, postes, alertas, aLL, aEN, P, conTerreno, terr, dmin: pf.dmin, nombre: S.proyecto.nombre || 'Proyecto',
    hipotesis: [S.proyecto.hipotesis_plantillado || 'FMAX', S.proyecto.hipotesis_arrancamiento || 'FMIN'] };
}

// ------------------------------------------------------------------ Google Earth (KML)
const ESTILOS_KML = { POSTES: 'poste', CRUCETAS: 'cruceta', CONDUCTORES: 'conductor', CONDUCTOR_FRIO: 'frio', CABLE_GUARDA: 'guarda',
  DIST_MINIMA: 'dmin', TERRENO: 'terreno', CIRCUITO_2: 'circ0', CIRCUITO_3: 'circ1', CIRCUITO_4: 'circ2', CIRCUITO_5: 'circ3' };
const CARPETAS_KML = [['POSTES', 'Postes'], ['CRUCETAS', 'Crucetas'], ['CONDUCTORES', 'Conductores (caliente)'], ['CIRCUITO_2', 'Circuito 2'], ['CIRCUITO_3', 'Circuito 3'],
  ['CIRCUITO_4', 'Circuito 4'], ['CONDUCTOR_FRIO', 'Conductores en frío'], ['CABLE_GUARDA', 'Cable de guarda (aprox.)'], ['DIST_MINIMA', 'Distancia mínima']];

export function generarKML3D({ S, catalogo }) {
  const M = modelo3D({ S, catalogo });
  const modo = M.conTerreno ? 'relativeToGround' : 'absolute';
  const alt = (x, z) => (M.conTerreno ? Math.max(0, z - M.terr(x)) : z);
  const c3 = (e, n, z) => { const [lo, la] = M.aLL(e, n); return `${lo.toFixed(8)},${la.toFixed(8)},${z.toFixed(2)}`; };
  const pm = (l) => `<Placemark><name>${X(l.nombre)}</name><visibility>${l.visible ? 1 : 0}</visibility><styleUrl>#${ESTILOS_KML[l.capa] || 'conductor'}</styleUrl><LineString><altitudeMode>${modo}</altitudeMode><coordinates>${l.pts.map(([e, n, z, x]) => c3(e, n, alt(x, z))).join(' ')}</coordinates></LineString></Placemark>`;
  const carpetas = CARPETAS_KML.map(([capa, titulo]) => {
    const ls = M.lineas.filter((l) => l.capa === capa); if (!ls.length) return '';
    const vis = ls.some((l) => l.visible) ? 1 : 0;
    return `<Folder><name>${X(titulo)}</name><visibility>${vis}</visibility>${ls.map(pm).join('')}</Folder>`;
  }).join('');
  const fichas = M.postes.map((p) => {
    const v = p.verif;
    const filas = [['Estructura EH', p.estructura || '— (sin asignar)'], ['Función', p.ficha?.funcion], ['Tipo de cálculo', p.tipo],
      ['Poste', p.L ? `${p.L} m${p.rotura ? ` · ${p.rotura} kgf` : ''}` : '—'], ['Cota del terreno (m)', p.yt != null ? (+p.yt).toFixed(2) : '—'],
      ['Conductor más bajo (cota, m)', (+p.ya).toFixed(2)], ['Deflexión (°)', p.deflexion != null ? p.deflexion.toFixed(1) : null],
      ['Utilización del poste (%)', v['Utilización poste (%)']], ['Estado', v.Estado], ['Templetes', v.Templetes], ['Abscisa (m)', p.x]]
      .filter(([, val]) => val != null && val !== '');
    const desc = `<table>${filas.map(([k, val]) => `<tr><td><b>${X(k)}</b></td><td>${X(val)}</td></tr>`).join('')}</table>${p.ficha ? `<p>${X(p.ficha.nombre)}</p>` : ''}`;
    const est = /REQUIERE|INSUFICIENTE/.test(v.Estado || '') ? 'alerta' : /^R/.test(p.tipo || '') ? 'ret' : 'sus';
    return `<Placemark><name>${X(p.nombre)}${p.estructura ? ` · ${X(String(p.estructura).replace(/^EH[-–\s]*/i, ''))}` : ''}</name><description><![CDATA[${desc}]]></description><styleUrl>#${est}</styleUrl><Point><altitudeMode>${modo}</altitudeMode><coordinates>${c3(p.en[0], p.en[1], alt(p.x, p.cima) + 0.8)}</coordinates></Point></Placemark>`;
  }).join('');
  const alertas = M.alertas.map((a) => `<Placemark><name>${X(a.texto)}</name><description>${X(a.detalle)}</description><styleUrl>#alerta</styleUrl><Point><altitudeMode>${modo}</altitudeMode><coordinates>${c3(a.e, a.n, alt(a.x, a.z))}</coordinates></Point></Placemark>`).join('');
  const sty = (id, color, w) => `<Style id="${id}"><LineStyle><color>${color}</color><width>${w}</width></LineStyle></Style>`;
  const ico = (id, color, sc, href) => `<Style id="${id}"><IconStyle><color>${color}</color><scale>${sc}</scale><Icon><href>${href}</href></Icon></IconStyle><LabelStyle><scale>0.75</scale></LabelStyle></Style>`;
  const P = M.P, p0 = M.postes[0];
  const look = `<LookAt><longitude>${M.aLL(P[0][0], P[0][1])[0]}</longitude><latitude>${M.aLL(P[0][0], P[0][1])[1]}</latitude><altitude>0</altitude><heading>${(Math.atan2(P[1][0] - P[0][0], P[1][1] - P[0][1]) * 180 / Math.PI + 90).toFixed(1)}</heading><tilt>70</tilt><range>180</range><altitudeMode>relativeToGround</altitudeMode></LookAt>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${X(M.nombre)} – diseño 3D</name>
<description><![CDATA[Generado por la App Cálculos Mecánicos MT a partir de ${X(p0 ? 'las estructuras del proyecto' : '')}. Conductores con la flecha de la hipótesis ${X(M.hipotesis[0])} (caliente) y ${X(M.hipotesis[1])} (frío). Geometría de las estructuras según el catálogo EH (aproximada por familia; confirme con la lámina). Alturas ${M.conTerreno ? 'sobre el terreno del cálculo' : 'absolutas'}.]]></description>${look}
${sty('poste', 'ff9a9a9a', 7)}${sty('cruceta', 'ff3c5a78', 5)}${sty('conductor', 'ff2f8fe6', 2.5)}${sty('frio', 'ffdfb67f', 1.5)}${sty('guarda', 'ff505050', 1.5)}${sty('dmin', 'ff4c4cc8', 2)}${sty('terreno', 'ff2f5f8f', 1)}
${sty('circ0', 'ff0054d3', 2.5)}${sty('circ1', 'ffad448e', 2.5)}${sty('circ2', 'ff85a016', 2.5)}${sty('circ3', 'ff2e3ab0', 2.5)}
${ico('sus', 'ffffffff', 0.6, 'http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png')}${ico('ret', 'ff3f78e9', 0.7, 'http://maps.google.com/mapfiles/kml/shapes/square.png')}${ico('alerta', 'ff0000ff', 0.9, 'http://maps.google.com/mapfiles/kml/shapes/caution.png')}
<Folder><name>Estructuras (fichas)</name>${fichas}</Folder>${carpetas}${alertas ? `<Folder><name>Vanos que no cumplen</name>${alertas}</Folder>` : ''}
</Document></kml>`;
}
