// Bloques 3D (sólidos de caras 3DFACE) de las estructuras normalizadas de Electrohuila y de los postes,
// para AutoCAD. Un mismo generador produce la biblioteca completa y los bloques que se insertan en cada plano.
//
// Ejes del bloque de ESTRUCTURA: origen en la cima del poste (en H, en el centro entre los dos postes);
//   x = transversal a la línea (+ a la derecha del abscisado), y = a lo largo de la línea, z hacia arriba.
// Bloque de POSTE: origen en la base enterrada, z hacia arriba hasta la longitud L.
// Medidas: geometría del catálogo EH (fases, cable de guarda, postes en H) + herrajes típicos (crucetas
// de ángulo 76×76 mm, aisladores de espigo, cadenas de 3 discos, bayonetas, transformadores). Aproximado.

export const CAPAS_BLOQUES = { '3D_POSTES': 8, '3D_CRUCETAS': 30, '3D_AISLADORES': 254, '3D_HERRAJES': 251, '3D_TRANSFORMADOR': 150, '3D_BT': 34 };

// ------------------------------------------------------------------ primitivas (listas de caras)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

function caja(capa, x0, x1, y0, y1, z0, z1) {
  const p = (x, y, z) => [x, y, z];
  const v = [p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0), p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)];
  return [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]].map((f) => ({ capa, v: f.map((i) => v[i]) }));
}
// cilindro (o tronco de cono) entre los puntos A y B
function cilindro(capa, A, B, r0, r1 = r0, n = 8, tapas = true) {
  const eje = norma(sub(B, A));
  const ref = Math.abs(eje[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norma(cruz(eje, ref)), w = cruz(eje, u);
  const anillo = (C, r) => Array.from({ length: n }, (_, k) => {
    const t = 2 * Math.PI * k / n, c = Math.cos(t) * r, s = Math.sin(t) * r;
    return [C[0] + u[0] * c + w[0] * s, C[1] + u[1] * c + w[1] * s, C[2] + u[2] * c + w[2] * s];
  });
  const a = anillo(A, r0), b = anillo(B, r1), caras = [];
  for (let k = 0; k < n; k++) { const j = (k + 1) % n; caras.push({ capa, v: [a[k], a[j], b[j], b[k]] }); }
  if (tapas) for (let k = 1; k < n - 1; k += 2) {
    const j = k + 1, m = Math.min(k + 2, n - 1);
    caras.push({ capa, v: [a[0], a[k], a[j], a[m]] }, { capa, v: [b[0], b[k], b[j], b[m]] });
  }
  return caras;
}
const barra = (capa, A, B, r = 0.02) => cilindro(capa, A, B, r, r, 4, false);
// cadena de aisladores de disco entre A y B (3 discos)
function cadena(A, B) {
  const caras = barra('3D_HERRAJES', A, B, 0.012);
  for (let k = 1; k <= 3; k++) {
    const t = k / 4, C = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    const d = norma(sub(B, A)), C2 = [C[0] + d[0] * 0.05, C[1] + d[1] * 0.05, C[2] + d[2] * 0.05];
    caras.push(...cilindro('3D_AISLADORES', C, C2, 0.076, 0.076, 10));
  }
  return caras;
}
// aislador de espigo (pin): base en z0, conductor en z1
function espigo(x, y, z0, z1) {
  const h = z1 - z0;
  return [...barra('3D_HERRAJES', [x, y, z0], [x, y, z0 + h * 0.4], 0.01),
    ...cilindro('3D_AISLADORES', [x, y, z0 + h * 0.35], [x, y, z1], 0.05, 0.065, 10),
    ...cilindro('3D_AISLADORES', [x, y, z1 - h * 0.25], [x, y, z1 - h * 0.15], 0.09, 0.09, 10)];
}

// ------------------------------------------------------------------ poste
// diámetros (base / punta) de postes de concreto según EH-RAA-004 §5.2; interpolados para otras longitudes
const DIAM = [[8, 0.25, 0.12], [10, 0.27, 0.12], [12, 0.32, 0.14], [14, 0.37, 0.16], [16, 0.43, 0.22], [18, 0.47, 0.22]];
export function diametrosPoste(L) {
  if (L <= DIAM[0][0]) return [DIAM[0][1], DIAM[0][2]];
  for (let k = 1; k < DIAM.length; k++) if (L <= DIAM[k][0]) {
    const t = (L - DIAM[k - 1][0]) / (DIAM[k][0] - DIAM[k - 1][0]);
    return [DIAM[k - 1][1] + t * (DIAM[k][1] - DIAM[k - 1][1]), DIAM[k - 1][2] + t * (DIAM[k][2] - DIAM[k - 1][2])];
  }
  return [DIAM[DIAM.length - 1][1], DIAM[DIAM.length - 1][2]];
}
export const nombrePoste = (L) => `POSTE_${String(Math.round(L * 10) / 10).replace('.', '_')}M`;
export function carasPoste(L) {
  const [db, dp] = diametrosPoste(L);
  return cilindro('3D_POSTES', [0, 0, 0], [0, 0, L], db / 2, dp / 2, 12);
}

// ------------------------------------------------------------------ estructura
export const nombreBloque = (e) => (e ? `EH_${e.id.replace(/^eh-/i, '')}` : 'EH_GENERICA').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 31);

export function carasEstructura(e, bajoDefecto = 0.7) {
  const g = e?.geometria || { fases: [[-0.9, bajoDefecto], [0, bajoDefecto], [0.9, bajoDefecto]], guarda: [], postes: [0] };
  const t = (e?.nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const aisl = e?.aislamiento || 'Espigo';
  const postes = g.postes || [0];
  const doble = /cruceta doble|crucetas dobles|doble cruceta|pin doble/.test(t) || aisl === 'Espigo doble';
  const caras = [];
  const rPunta = (diametrosPoste(12)[1]) / 2 + 0.01;

  // niveles de fases bajo la cima (las que van sobre la cima se montan en espigo de punta)
  const niveles = new Map();
  for (const [dx, dz] of g.fases) {
    if (dz < 0) { caras.push(...espigo(dx, 0, 0, -dz), ...caja('3D_HERRAJES', dx - 0.06, dx + 0.06, -0.06, 0.06, -0.15, 0)); continue; }
    const key = Math.round(dz * 20) / 20; (niveles.get(key) || niveles.set(key, []).get(key)).push(dx);
  }
  const susp = /suspension/.test(aisl.toLowerCase()) || aisl === 'Cadena de suspensión';
  const ret = aisl === 'Cadena de retención';
  const lp = aisl === 'Line post';
  const percha = aisl === 'Percha' || aisl === 'Red trenzada';
  const cad = e?.cadena_m || (susp ? 0.45 : 0);
  for (const [dz, dxs] of niveles) {
    const zc = -dz;                                   // altura del conductor
    if (percha) {                                     // BT: percha vertical con carretes
      caras.push(...caja('3D_HERRAJES', rPunta, rPunta + 0.03, -0.03, 0.03, zc - 0.12, zc + 0.12));
      dxs.forEach((dx) => caras.push(...cilindro('3D_AISLADORES', [rPunta + 0.03, -0.04, zc], [rPunta + 0.03, 0.04, zc], 0.04, 0.04, 8)));
      continue;
    }
    // altura de la cruceta según el aislamiento
    const zArm = susp ? zc + cad : ret ? zc : lp ? zc - 0.05 : zc - 0.22;
    const xs = [...dxs, ...postes];
    let x0 = Math.min(...xs) - 0.1, x1 = Math.max(...xs) + 0.1;
    const corto = x1 - x0 < 0.6 && dxs.every((d) => Math.abs(d) < 0.6) && postes.length === 1;
    if (corto && !lp) {                              // fases al costado del poste (disposición vertical)
      dxs.forEach((dx) => caras.push(...caja('3D_CRUCETAS', Math.min(0, dx) - 0.05, Math.max(0, dx) + 0.05, -0.04, 0.04, zArm - 0.076, zArm)));
    } else if (!lp) {
      for (const yy of doble ? [-0.12, 0.12] : [0]) caras.push(...caja('3D_CRUCETAS', x0, x1, yy - 0.038, yy + 0.038, zArm - 0.076, zArm));
      // diagonales en V desde la cruceta al poste
      if (x1 - x0 > 1.4) for (const p of postes) for (const s of [-1, 1]) {
        const xb = p + s * Math.min(0.9, (s < 0 ? p - x0 : x1 - p) * 0.6);
        if (xb > x0 && xb < x1 && Math.abs(xb - p) > 0.2) caras.push(...barra('3D_HERRAJES', [xb, 0, zArm - 0.076], [p, 0, zArm - 0.7], 0.018));
      }
      for (const p of postes) caras.push(...caja('3D_HERRAJES', p - rPunta - 0.02, p + rPunta + 0.02, -rPunta - 0.02, rPunta + 0.02, zArm - 0.12, zArm - 0.076)); // collarín
    }
    // aisladores
    dxs.forEach((dx) => {
      if (susp) caras.push(...cadena([dx, 0, zArm - 0.076], [dx, 0, zc]));
      else if (ret) for (const s of [-1, 1]) caras.push(...cadena([dx, s * 0.12, zc], [dx, s * 0.6, zc]));
      else if (lp) caras.push(...cilindro('3D_AISLADORES', [Math.sign(dx) * rPunta, 0, zc], [dx, 0, zc], 0.05, 0.05, 10), ...cilindro('3D_AISLADORES', [dx * 0.5, -0.0, zc], [dx * 0.5 + 0.001, 0, zc], 0.08, 0.08, 10));
      else for (const yy of doble ? [-0.12, 0.12] : [0]) caras.push(...espigo(dx, yy, zArm, zc));
    });
  }
  // cable de guarda: bayoneta (sobre la cima) o soporte lateral
  for (const [gx, gz] of g.guarda || []) {
    const ztop = -gz;
    if (ztop > 0) caras.push(...caja('3D_HERRAJES', gx + rPunta, gx + rPunta + 0.05, -0.025, 0.025, -0.6, ztop), ...caja('3D_HERRAJES', gx + rPunta - 0.05, gx + rPunta + 0.1, -0.04, 0.04, ztop - 0.08, ztop));
    else caras.push(...barra('3D_HERRAJES', [0, 0, ztop], [gx || -0.4, 0, ztop], 0.02));
  }
  // H: riostras en X entre los dos postes
  if (postes.length === 2) {
    const [pa, pb] = postes, zs = Math.min(...[...niveles.keys()].map((d) => -d), 0) - 0.9;
    caras.push(...barra('3D_HERRAJES', [pa, 0, zs], [pb, 0, zs - 2.6], 0.02), ...barra('3D_HERRAJES', [pb, 0, zs], [pa, 0, zs - 2.6], 0.02));
  }
  // subestación tipo poste: cortacircuitos, DPS, transformador y BT
  const tr = e?.trafo;
  if (tr) {
    const yo = postes.length === 2 ? 0 : 0.18;                     // al costado del poste (lado de la calle)
    const zCor = tr.fases === 3 ? -1.1 : -1.6, zDps = zCor - 0.4;
    const xsF = tr.fases === 3 ? [-0.45, 0, 0.45] : [-0.3, 0.3];
    caras.push(...caja('3D_CRUCETAS', -0.6, 0.6, yo - 0.038, yo + 0.038, zCor - 0.076, zCor));
    xsF.forEach((x) => caras.push(...caja('3D_HERRAJES', x - 0.04, x + 0.04, yo + 0.04, yo + 0.12, zCor - 0.35, zCor + 0.1), ...cilindro('3D_AISLADORES', [x, yo + 0.08, zDps - 0.2], [x, yo + 0.08, zDps + 0.05], 0.04, 0.04, 8)));
    const ztop = tr.fases === 3 ? -2.2 : -2.6;
    if (tr.fases === 3) {
      const yt0 = postes.length === 2 ? -0.45 : 0.25, yt1 = yt0 + 0.75;
      caras.push(...caja('3D_TRANSFORMADOR', -0.5, 0.5, yt0, yt1, ztop - 1.1, ztop));
      for (const x of [-0.42, 0.42]) caras.push(...caja('3D_TRANSFORMADOR', x - 0.08, x + 0.08, yt0 + 0.05, yt1 - 0.05, ztop - 1.0, ztop - 0.15)); // radiadores
      [-0.25, 0, 0.25].forEach((x) => caras.push(...cilindro('3D_AISLADORES', [x, (yt0 + yt1) / 2, ztop], [x, (yt0 + yt1) / 2, ztop + 0.3], 0.04, 0.03, 8)));
      if (tr.montaje === 'silleta' || postes.length === 2) caras.push(...caja('3D_HERRAJES', -0.6, 0.6, yt0 - 0.05, yt1 + 0.05, ztop - 1.16, ztop - 1.1));
    } else {
      const yc = 0.48;
      caras.push(...cilindro('3D_TRANSFORMADOR', [0, yc, ztop - 0.95], [0, yc, ztop], 0.28, 0.28, 14));
      caras.push(...cilindro('3D_AISLADORES', [0, yc, ztop], [0, yc, ztop + 0.3], 0.04, 0.03, 8));
      if (tr.montaje === 'silleta') caras.push(...caja('3D_HERRAJES', -0.4, 0.4, 0.15, 0.85, ztop - 1.0, ztop - 0.95));
    }
    // red de BT: percha bajo el transformador
    const zbt = ztop - (tr.fases === 3 ? 1.9 : 1.6);
    caras.push(...caja('3D_BT', rPunta, rPunta + 0.03, -0.03, 0.03, zbt - 0.65, zbt));
    for (let k = 0; k < 4; k++) caras.push(...cilindro('3D_BT', [rPunta + 0.03, -0.04, zbt - 0.05 - 0.18 * k], [rPunta + 0.03, 0.04, zbt - 0.05 - 0.18 * k], 0.04, 0.04, 8));
  }
  // equipos de maniobra: caja representativa
  if (e?.funcion === 'Equipo de maniobra') {
    caras.push(...caja('3D_CRUCETAS', -1.2, 1.2, -0.04, 0.04, -0.6, -0.52));
    [-0.8, 0, 0.8].forEach((x) => caras.push(...caja('3D_HERRAJES', x - 0.06, x + 0.06, -0.15, 0.15, -0.52, -0.1)));
    if (/reconectador/.test(t)) caras.push(...caja('3D_TRANSFORMADOR', -0.45, 0.45, 0.2, 0.75, -2.4, -1.5));
  }
  return caras;
}

// ------------------------------------------------------------------ escritura DXF R12
const f = (v) => (Number.isFinite(v) ? (+v).toFixed(4) : '0.0');
export function dxf3DFace(g, capa, v) {
  const w = v.length === 3 ? [...v, v[2]] : v;
  g(0, '3DFACE', 8, capa, 10, f(w[0][0]), 20, f(w[0][1]), 30, f(w[0][2]), 11, f(w[1][0]), 21, f(w[1][1]), 31, f(w[1][2]),
    12, f(w[2][0]), 22, f(w[2][1]), 32, f(w[2][2]), 13, f(w[3][0]), 23, f(w[3][1]), 33, f(w[3][2]));
}
export function dxfBloque(g, nombre, caras, extra = null) {
  g(0, 'BLOCK', 8, '0', 2, nombre, 70, 0, 10, '0.0', 20, '0.0', 30, '0.0', 3, nombre);
  for (const c of caras) dxf3DFace(g, c.capa, c.v);
  if (extra) extra(g);
  g(0, 'ENDBLK', 8, '0');
}
