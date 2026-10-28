// Bloques 3D (sólidos de caras 3DFACE) de las estructuras normalizadas de Electrohuila y de los postes,
// para AutoCAD. Un mismo generador produce la biblioteca completa y los bloques que se insertan en cada plano.
//
// Ejes del bloque de ESTRUCTURA: origen en la cima del poste (en H, en el centro entre los dos postes);
//   x = transversal a la línea (+ a la derecha del abscisado), y = a lo largo de la línea, z hacia arriba.
// Bloque de POSTE: origen en la base enterrada, z hacia arriba hasta la longitud L.
// Medidas: las de cada lámina EH (estructuras_eh/laminas.py → geometria.lamina del catálogo): crucetas con su
// longitud y altura, tipo de aislamiento de cada fase, cable de guarda, diagonales, red compacta, equipos y
// subestaciones tipo poste. Herrajes (aisladores, cadenas, grapas) con dimensiones típicas.

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

// ------------------------------------------------------------------ estructura dibujada según su lámina
// g.lamina (ver estructuras_eh/laminas.py): crucetas, fases con su tipo de aislamiento, guarda, diagonales,
// derivación, red compacta, equipos y transformador. z en la lámina = metros BAJO la cima (positivo hacia abajo).
const ESP = 0.076;                                   // ángulo de la cruceta (76 mm)
function carasLamina(e, g) {
  const L = g.lamina, caras = [];
  const px = g.postes || [0], py = g.postes_y || [0];
  const rP = diametrosPoste(12)[1] / 2 + 0.01;
  const hp = L.hpin || 0.22;
  const add = (...c) => caras.push(...c);
  const poste = (x) => px.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a), px[0]);
  // ---- crucetas (en cada plano de postes a lo largo de la línea)
  const crs = (L.cr || []).map(([z, x0, x1, n]) => ({ z, x0, x1, ys: n === 2 ? [-0.12, 0.12] : [0] }));
  for (const yp of py) for (const c of crs) {
    for (const yy of c.ys) add(...caja('3D_CRUCETAS', c.x0, c.x1, yp + yy - ESP / 2, yp + yy + ESP / 2, -c.z - ESP, -c.z));
    if (c.ys.length === 2) for (const xs of [c.x0 + 0.05, c.x1 - 0.05]) add(...barra('3D_HERRAJES', [xs, yp - 0.12, -c.z - 0.04], [xs, yp + 0.12, -c.z - 0.04], 0.008));
    for (const p of px) if (p >= c.x0 - 0.01 && p <= c.x1 + 0.01)
      add(...caja('3D_HERRAJES', p - rP - 0.02, p + rP + 0.02, yp - rP - 0.02, yp + rP + 0.02, -c.z - ESP - 0.05, -c.z - ESP));
  }
  // ---- diagonales
  const diag = L.d != null ? L.d : (px.length === 1 ? crs.filter((c) => c.x1 - c.x0 > 1.4).flatMap((c) => [-1, 1]
    .filter((s) => (s < 0 ? -c.x0 : c.x1) > 0.6).map((s) => [s * Math.min(0.55, s < 0 ? -c.x0 - 0.2 : c.x1 - 0.2), c.z + 0.08, 0, c.z + 0.45])) : []);
  for (const yp of py) for (const [xc, zc, xp, zp] of diag) {
    const c = crs.find((k) => Math.abs(k.z - zc) < 0.2) || { ys: [0] };
    for (const yy of c.ys) add(...barra('3D_HERRAJES', [xc, yp + yy, -zc], [xp, yp + yy, -zp], 0.018));
  }
  // cruceta sobre la que se apoya un aislador en x (la más cercana por encima)
  const crEn = (x, z) => crs.filter((c) => x >= c.x0 - 0.05 && x <= c.x1 + 0.05 && c.z <= z + 0.06).sort((a, b) => b.z - a.z)[0];
  // ---- fases
  const grupos = [];
  (L.f || []).forEach(([x, z, t], i) => {
    for (const yp of py) {
      const zc = -z;
      if (t === 'E' || t === 'E2') {
        const c = crEn(x, z);
        for (const yy of (t === 'E2' || (c && c.ys.length === 2) ? [-0.12, 0.12] : [0])) add(...espigo(x, yp + yy, zc, zc + hp));
      } else if (t === 'EP') {
        add(...caja('3D_HERRAJES', x - 0.05, x + 0.05, yp - 0.05, yp + 0.05, zc - 0.25, zc), ...espigo(x, yp, zc, zc + hp + 0.05));
      } else if (t === 'S') {
        const c = crEn(x, z - 0.1);
        const z0 = c ? -c.z - ESP : Math.min(zc + 0.5, 0);
        add(...cadena([x, yp, z0], [x, yp, zc]), ...caja('3D_HERRAJES', x - 0.03, x + 0.03, yp - 0.05, yp + 0.05, zc - 0.05, zc));
      } else if (t === 'R' || t === 'T') {
        const c = crEn(x, z);
        if (!c) { const p = poste(x); add(...barra('3D_HERRAJES', [p, yp, zc], [x, yp, zc], 0.02), ...caja('3D_HERRAJES', p - rP - 0.02, p + rP + 0.02, yp - rP - 0.02, yp + rP + 0.02, zc - 0.03, zc + 0.03)); }
        for (const s of t === 'R' ? [-1, 1] : [1]) add(...cadena([x, yp + s * 0.14, zc], [x, yp + s * 0.62, zc]));
      } else if (t === 'H') {
        const p = poste(x), s = Math.sign(x - p) || 1;
        add(...caja('3D_HERRAJES', p - rP - 0.02, p + rP + 0.02, yp - rP - 0.02, yp + rP + 0.02, zc - 0.03, zc + 0.03),
          ...cadena([p + s * (rP + 0.05), yp, zc], [x, yp, zc - 0.05]));
      } else if (t === 'L') {
        const p = poste(x), s = Math.sign(x - p) || 1;
        add(...caja('3D_HERRAJES', p + s * rP, p + s * (rP + 0.06), yp - 0.06, yp + 0.06, zc - 0.25, zc - 0.05),
          ...cilindro('3D_AISLADORES', [p + s * (rP + 0.06), yp, zc - 0.18], [x, yp, zc], 0.05, 0.045, 10));
        for (let k = 1; k <= 4; k++) { const t2 = k / 5; add(...cilindro('3D_AISLADORES', [p + s * (rP + 0.06) + (x - p - s * (rP + 0.06)) * t2, yp, zc - 0.18 + 0.18 * t2], [p + s * (rP + 0.06) + (x - p - s * (rP + 0.06)) * t2 + s * 0.015, yp, zc - 0.18 + 0.18 * t2], 0.075, 0.075, 10)); }
      } else if (t === 'LV') {
        add(...caja('3D_HERRAJES', x - 0.05, x + 0.05, yp - 0.05, yp + 0.05, -0.15, 0), ...cilindro('3D_AISLADORES', [x, yp, 0], [x, yp, zc], 0.05, 0.045, 10));
        for (let k = 1; k <= 5; k++) add(...cilindro('3D_AISLADORES', [x, yp, zc * k / 6], [x, yp, zc * k / 6 + 0.015], 0.075, 0.075, 10));
      } else if (t === 'P' || t === 'PR') {
        add(...caja('3D_BT', rP, rP + 0.03, yp - 0.03, yp + 0.03, zc - 0.12, zc + 0.12),
          ...cilindro('3D_AISLADORES', [x + 0.02, yp - 0.04, zc], [x + 0.02, yp + 0.04, zc], 0.04, 0.04, 8));
        if (t === 'PR') for (const s of [-1, 1]) add(...barra('3D_BT', [x + 0.02, yp + s * 0.05, zc], [x + 0.02, yp + s * 0.35, zc], 0.012));
      } else if (t === 'TZ') {
        add(...caja('3D_BT', rP, x, yp - 0.025, yp + 0.025, zc + 0.02, zc + 0.06),
          ...cilindro('3D_BT', [x, yp - 0.35, zc], [x, yp + 0.35, zc], 0.035, 0.035, 8));
      } else if (t === 'C') {
        const k = Math.floor(i / 3); (grupos[k] = grupos[k] || []).push([x, zc]);
      }
    }
  });
  // ---- red compacta: brazo antibalanceo, mensajero, espaciador romboidal
  (L.brz || []).forEach(([zb, xt], k) => {
    const s = Math.sign(xt) || -1, z = -zb, m = (L.m || [])[k], gr = grupos[k] || [];
    add(...caja('3D_HERRAJES', s * rP, s * (rP + 0.05), -0.05, 0.05, z - 0.22, z + 0.02),
      ...barra('3D_HERRAJES', [s * rP, 0, z], [xt, 0, z], 0.022), ...barra('3D_HERRAJES', [s * rP, 0, z - 0.2], [xt * 0.7, 0, z - 0.01], 0.015));
    if (m) {
      add(...barra('3D_HERRAJES', [xt, 0, z], [m[0], 0, -m[1]], 0.012), ...cilindro('3D_HERRAJES', [m[0], -0.06, -m[1]], [m[0], 0.06, -m[1]], 0.03, 0.03, 8));
      if (gr.length === 3) {
        const cx = m[0], top = -m[1] - 0.05, bot = gr[2][1] - 0.04, mid = gr[0][1], xl = gr[0][0] - 0.05, xr = gr[1][0] + 0.05;
        const R = [[cx, 0, top], [xr, 0, mid], [cx, 0, bot], [xl, 0, mid]];
        for (let j = 0; j < 4; j++) add(...barra('3D_AISLADORES', R[j], R[(j + 1) % 4], 0.012));
        gr.forEach(([gx, gz]) => add(...cilindro('3D_AISLADORES', [gx, -0.05, gz], [gx, 0.05, gz], 0.03, 0.03, 8)));
        add(...barra('3D_HERRAJES', [s * rP, 0, bot - 0.02], [gr[2][0], 0, bot], 0.01));
      }
    }
  });
  if (!L.brz) (L.m || []).forEach(([x, z]) => add(...caja('3D_HERRAJES', x - 0.04, x + 0.04, -0.05, 0.05, -z - 0.04, -z + 0.04)));
  // ---- cable de guarda
  for (const [gx, gz] of L.g || []) {
    const p = poste(gx);
    if (gz < 0) add(...barra('3D_HERRAJES', [p + (gx >= p ? 1 : -1) * rP, 0, Math.max(-0.6, -gz - 1.5)], [gx + (Math.abs(gx - p) < 0.05 ? rP : 0), 0, -gz], 0.025),
      ...caja('3D_HERRAJES', p - rP - 0.02, p + rP + 0.02, -rP - 0.02, rP + 0.02, -0.3, -0.22), ...caja('3D_HERRAJES', gx + rP - 0.04, gx + rP + 0.06, -0.04, 0.04, -gz - 0.08, -gz));
    else add(...caja('3D_HERRAJES', p - rP - 0.02, p + rP + 0.02, -rP - 0.02, rP + 0.02, -gz - 0.04, -gz + 0.04),
      ...barra('3D_HERRAJES', [gx, -0.1, -gz], [gx, -0.4, -gz], 0.012), ...barra('3D_HERRAJES', [gx, 0.1, -gz], [gx, 0.4, -gz], 0.012));
  }
  // ---- derivación perpendicular (cruceta a lo largo de la línea, retenciones hacia +x)
  if (L.dv) {
    for (const [z, a0, a1, n] of L.dv.cr || []) for (const xx of n === 2 ? [-0.12, 0.12] : [0])
      add(...caja('3D_CRUCETAS', xx - ESP / 2, xx + ESP / 2, a0, a1, -z - ESP, -z));
    for (const [y, z, t] of L.dv.f || []) {
      if (t === 'TZ') add(...cilindro('3D_BT', [0.1, y, -z], [0.6, y, -z], 0.035, 0.035, 8));
      else add(...cadena([0.14, y, -z], [0.62, y, -z]));
    }
  }
  // ---- equipos de maniobra
  for (const q of L.eq || []) {
    const [t] = q;
    if (t === 'caja') { const [, x0, x1, y0, y1, z0, z1] = q; add(...caja('3D_TRANSFORMADOR', x0, x1, y0, y1, -z1, -z0)); }
    else if (t === 'cort') { const [, x, z] = q; add(...cortacircuito(x, 0.1, -z)); }
    else if (t === 'sec') { const [, x, z] = q; add(...cilindro('3D_AISLADORES', [x, 0.1, -z - 0.25], [x, 0.1, -z + 0.25], 0.05, 0.05, 10), ...caja('3D_HERRAJES', x - 0.03, x + 0.03, 0.06, 0.14, -z - 0.3, -z + 0.3)); }
    else if (t === 'dps') { const [, x, z] = q; add(...cilindro('3D_AISLADORES', [x, 0.12, -z - 0.35], [x, 0.12, -z], 0.045, 0.045, 10)); }
    else if (t === 'bajante') { const [, x, z0, z1] = q; add(...cilindro('3D_HERRAJES', [x, 0.12, -z1], [x, 0.12, -z0], 0.04, 0.04, 8)); }
  }
  if (L.tr) add(...transformador(L.tr, px, py, rP));
  // riostras en X entre postes (H a lo ancho, o H a lo largo de la línea en subestaciones)
  const zMin = Math.max(0.5, ...(L.cr || []).map((c) => c[0]), ...(L.f || []).map((f) => f[1])) + 0.9;
  if (px.length === 2 && (L.cr || []).length) for (let k = 0; k + 1 < px.length; k++) {
    const [a, b] = [px[k], px[k + 1]];
    add(...barra('3D_HERRAJES', [a, 0, -zMin], [b, 0, -zMin - 2.6], 0.02), ...barra('3D_HERRAJES', [b, 0, -zMin], [a, 0, -zMin - 2.6], 0.02));
  }
  if (py.length === 2 && !L.tr) add(...barra('3D_HERRAJES', [0, py[0], -zMin], [0, py[1], -zMin - 2.6], 0.02), ...barra('3D_HERRAJES', [0, py[1], -zMin], [0, py[0], -zMin - 2.6], 0.02));
  return caras;
}
function cortacircuito(x, y, z) {
  return [...caja('3D_HERRAJES', x - 0.03, x + 0.03, y - 0.04, y + 0.04, z - 0.3, z + 0.1),
    ...cilindro('3D_AISLADORES', [x + 0.04, y + 0.06, z - 0.28], [x + 0.12, y + 0.06, z + 0.12], 0.04, 0.04, 8),
    ...cilindro('3D_HERRAJES', [x + 0.1, y + 0.13, z - 0.3], [x + 0.18, y + 0.13, z + 0.08], 0.022, 0.022, 6)];
}
function transformador(T, px, py, rP) {
  const c = [], add = (...k) => c.push(...k);
  const ejeY = !!T.ejeY, [cx, cy] = T.c || [0, 0];
  const pos = (k, n, w) => (n === 1 ? 0 : -w / 2 + (w * k) / (n - 1));
  // cortacircuitos y DPS en cruceta (a lo largo de la línea en H)
  const nf = T.n === 3 ? 3 : 1;
  const filas = T.auto ? [] : [[T.cort, 'cort'], [T.dps, 'dps']];
  for (const [z, tipo] of filas) {
    if (ejeY) add(...caja('3D_CRUCETAS', -ESP / 2, ESP / 2, -1.25, 1.25, -z - ESP, -z));
    else add(...caja('3D_CRUCETAS', nf === 1 ? -0.3 : -0.6, nf === 1 ? 0.3 : 0.6, rP + 0.02, rP + 0.02 + ESP, -z - ESP, -z));
    for (let k = 0; k < nf; k++) {
      const a = pos(k, nf, ejeY ? 1.2 : 0.9);
      const [x, y] = ejeY ? [0.08, a] : [a, rP + 0.12];
      if (tipo === 'cort') add(...cortacircuito(x, y, -z + 0.25));
      else add(...cilindro('3D_AISLADORES', [x, y, -z], [x, y, -z + 0.35], 0.045, 0.045, 10));
    }
  }
  // cuba
  const zt = -T.top, zb = -T.top - T.alto;
  if (T.n === 1) {
    add(...cilindro('3D_TRANSFORMADOR', [cx, cy, zb], [cx, cy, zt], T.a / 2, T.a / 2, 16));
    add(...cilindro('3D_AISLADORES', [cx, cy, zt], [cx, cy, zt + 0.3], 0.045, 0.035, 8));
  } else {
    const [ax, by] = ejeY ? [T.b, T.a] : [T.b, T.a];       // fondo hacia el poste, ancho a lo largo de la línea
    const [w, d] = Math.abs(cx) > 0.01 && !ejeY ? [ax, by] : [by, ax];
    add(...caja('3D_TRANSFORMADOR', cx - w / 2 + 0.12, cx + w / 2 - 0.12, cy - d / 2, cy + d / 2, zb, zt));
    for (const s of [-1, 1]) add(...caja('3D_TRANSFORMADOR', s > 0 ? cx + w / 2 - 0.12 : cx - w / 2, s > 0 ? cx + w / 2 : cx - w / 2 + 0.12, cy - d / 2 + 0.08, cy + d / 2 - 0.08, zb + 0.12, zt - 0.12));
    add(...caja('3D_TRANSFORMADOR', cx - w / 2 + 0.08, cx + w / 2 - 0.08, cy - d / 2 + 0.04, cy + d / 2 - 0.04, zt, zt + 0.06));
    for (let k = 0; k < 3; k++) add(...cilindro('3D_AISLADORES', [cx + pos(k, 3, w * 0.5), cy, zt + 0.06], [cx + pos(k, 3, w * 0.5), cy, zt + 0.42], 0.05, 0.035, 8));
  }
  // montaje
  const yb = Math.max(...py.map(Math.abs));
  if (T.mont === 'silleta') {
    add(...caja('3D_HERRAJES', cx - 0.55, cx + 0.55, cy - 0.45, cy + 0.45, zb - 0.06, zb));
    for (const s of [-1, 1]) add(...barra('3D_HERRAJES', [cx + s * 0.45, cy + 0.4, zb - 0.03], [s * 0.1, rP, zb - 0.7], 0.02), ...barra('3D_HERRAJES', [cx + s * 0.45, cy - 0.4, zb - 0.03], [s * 0.1, rP, zb - 0.03], 0.02));
    add(...caja('3D_HERRAJES', -rP - 0.02, rP + 0.02, -rP - 0.02, rP + 0.02, zb - 0.75, zb - 0.65));
  } else if (T.mont === 'plataforma') {
    add(...caja('3D_HERRAJES', -0.6, 0.6, -yb - 0.1, yb + 0.1, zb - 0.08, zb));
    for (const s of [-1, 1]) add(...caja('3D_HERRAJES', -0.6, 0.6, s * yb - 0.05, s * yb + 0.05, zb - 0.16, zb - 0.08));
  } else {   // colgado / collarín: dos abrazaderas al poste
    const sx = Math.sign(cx) || 0, sy = Math.sign(cy) || 0;
    for (const zz of [zt - 0.15, zb + 0.2]) {
      add(...caja('3D_HERRAJES', -rP - 0.02, rP + 0.02, -rP - 0.02, rP + 0.02, zz - 0.05, zz + 0.05));
      add(...caja('3D_HERRAJES', sx ? Math.min(0, cx + sx * T.b / 2) : -0.05, sx ? Math.max(0, cx + sx * T.b / 2) : 0.05,
        sy ? Math.min(0, cy - sy * T.a / 2) : -0.05, sy ? Math.max(0, cy - sy * T.a / 2) : 0.05, zz - 0.03, zz + 0.03));
    }
  }
  // baja tensión
  const zbt = -T.bt;
  for (const yp of ejeY ? py : [0]) {
    const xp = ejeY ? rP : -rP, sx = ejeY ? 1 : -1;
    if (T.btn > 0) {
      add(...caja('3D_BT', xp, xp + sx * 0.03, yp - 0.03, yp + 0.03, zbt - 0.2 * (T.btn - 1) - 0.12, zbt + 0.12));
      for (let k = 0; k < T.btn; k++) add(...cilindro('3D_AISLADORES', [xp + sx * 0.05, yp - 0.04, zbt - 0.2 * k], [xp + sx * 0.05, yp + 0.04, zbt - 0.2 * k], 0.04, 0.04, 8));
    } else add(...caja('3D_BT', xp, xp + sx * 0.12, yp - 0.025, yp + 0.025, zbt + 0.02, zbt + 0.06), ...cilindro('3D_BT', [xp + sx * 0.12, yp - 0.35, zbt], [xp + sx * 0.12, yp + 0.35, zbt], 0.035, 0.035, 8));
  }
  return c;
}

export function carasEstructura(e, bajoDefecto = 0.7) {
  if (e?.geometria?.lamina) return carasLamina(e, e.geometria);
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
