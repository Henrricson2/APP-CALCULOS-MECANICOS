// Plano de la línea para AutoCAD: DXF (R12, lo abre cualquier versión) con la PLANTA (capas PLANTA_*,
// en el plano z = 0) y el MODELO 3D (capas 3D_*, con cotas reales). Coordenadas MAGNA-SIRGAS Origen
// Nacional (CTM12) cuando las estructuras las tienen. El DWG lo produce el servidor con AutoCAD.
import { modelo3D } from './earth3d.js?v=2';
import { CAPAS_BLOQUES, carasEstructura, carasPoste, nombreBloque, nombrePoste, dxfBloque } from './bloques3d.js?v=1';

const CAPAS = {
  PLANTA_EJE: 7, PLANTA_POSTES: 8, PLANTA_CRUCETAS: 30, PLANTA_FASES: 5, PLANTA_TEXTOS: 7, PLANTA_VANOS: 3, PLANTA_ANGULOS: 6,
  '3D_POSTES': 8, '3D_CRUCETAS': 30, '3D_CONDUCTORES': 5, '3D_CONDUCTOR_FRIO': 4, '3D_CABLE_GUARDA': 250, '3D_TERRENO': 32,
  '3D_DIST_MINIMA': 1, '3D_CIRCUITO_2': 6, '3D_CIRCUITO_3': 2, '3D_CIRCUITO_4': 3, '3D_CIRCUITO_5': 40, '3D_ALERTAS': 1, '3D_TEXTOS': 7,
};
Object.assign(CAPAS, CAPAS_BLOQUES, { BIBLIOTECA_TEXTOS: 7 });
const APAGADAS = new Set(['3D_CONDUCTOR_FRIO']);

// texto DXF R12: caracteres fuera de ASCII como \U+XXXX (AutoCAD los interpreta)
const txt = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, (c) => `\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
const f = (v) => (Number.isFinite(v) ? (+v).toFixed(4) : '0.0');

// ajuste de semejanza (escala, giro y traslación) del plano local a las coordenadas planas del proyecto
function ajusteSemejanza(locales, destino) {
  const n = locales.length; if (n < 2) return null;
  const mw = [0, 0], mz = [0, 0];
  locales.forEach((w, i) => { mw[0] += w[0] / n; mw[1] += w[1] / n; mz[0] += destino[i][0] / n; mz[1] += destino[i][1] / n; });
  let ar = 0, ai = 0, den = 0;
  locales.forEach((w, i) => {
    const wr = w[0] - mw[0], wi = w[1] - mw[1], zr = destino[i][0] - mz[0], zi = destino[i][1] - mz[1];
    ar += zr * wr + zi * wi; ai += zi * wr - zr * wi; den += wr * wr + wi * wi;
  });
  if (!den) return null;
  ar /= den; ai /= den;
  const br = mz[0] - (ar * mw[0] - ai * mw[1]), bi = mz[1] - (ar * mw[1] + ai * mw[0]);
  const T = (p) => [ar * p[0] - ai * p[1] + br, ar * p[1] + ai * p[0] + bi];
  const err = Math.max(...locales.map((w, i) => { const q = T(w); return Math.hypot(q[0] - destino[i][0], q[1] - destino[i][1]); }));
  return { T, giro: Math.atan2(ai, ar), err };
}

// encabezado + tablas + bloques; luego el llamador escribe ENTITIES
function escribirInicio(g, comentario, ext, bloques) {
  g(999, txt(comentario));
  g(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009',
    9, '$EXTMIN', 10, f(ext.x0), 20, f(ext.y0), 30, f(ext.z0), 9, '$EXTMAX', 10, f(ext.x1), 20, f(ext.y1), 30, f(ext.z1),
    9, '$LIMMIN', 10, f(ext.x0), 20, f(ext.y0), 9, '$LIMMAX', 10, f(ext.x1), 20, f(ext.y1), 0, 'ENDSEC');
  g(0, 'SECTION', 2, 'TABLES');
  g(0, 'TABLE', 2, 'LTYPE', 70, 1, 0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, '0.0', 0, 'ENDTAB');
  const capas = Object.keys(CAPAS);
  g(0, 'TABLE', 2, 'LAYER', 70, capas.length + 1, 0, 'LAYER', 2, '0', 70, 0, 62, 7, 6, 'CONTINUOUS');
  capas.forEach((c) => g(0, 'LAYER', 2, c, 70, 0, 62, APAGADAS.has(c) ? -CAPAS[c] : CAPAS[c], 6, 'CONTINUOUS'));
  g(0, 'ENDTAB');
  g(0, 'TABLE', 2, 'STYLE', 70, 1, 0, 'STYLE', 2, 'STANDARD', 70, 0, 40, '0.0', 41, '1.0', 50, '0.0', 71, 0, 42, '2.5', 3, 'txt', 4, '', 0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION', 2, 'BLOCKS');
  for (const [nombre, caras] of bloques) dxfBloque(g, nombre, caras);
  g(0, 'ENDSEC');
}
const insertar = (g, capa, bloque, p, rot) => g(0, 'INSERT', 8, capa, 2, bloque, 10, f(p[0]), 20, f(p[1]), 30, f(p[2]), 41, '1.0', 42, '1.0', 43, '1.0', 50, f(rot));
const longitudPoste = (p) => p.L || Math.max(6, Math.round(((p.cima - p.base) + 0.6) / 0.9 * 2) / 2);
const empotramiento = (L, crit) => (crit.empotramiento_coef ?? 0.1) * L + (crit.empotramiento_base_m ?? 0.6);

export function generarDXF({ S, catalogo }) {
  const M = modelo3D({ S, catalogo });
  const porNombre = new Map(S.apoyos.map((a) => [String(a.nombre), a]));
  const pares = M.postes.map((p) => [p.en, porNombre.get(String(p.nombre))]).filter(([, a]) => a && a.E != null && a.N != null);
  const aj = ajusteSemejanza(pares.map(([w]) => w), pares.map(([, a]) => [+a.E, +a.N]));
  const T = aj ? aj.T : (p) => p;
  const giro = aj ? aj.giro : 0;
  const ht = +(S.proyecto.salida?.altura_texto_dxf ?? 1.5) || 1.5;
  const out = [];
  const g = (...kv) => { for (let i = 0; i < kv.length; i += 2) out.push(String(kv[i]), String(kv[i + 1])); };
  const ext = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
  const usa = (x, y, z = 0) => { ext.x0 = Math.min(ext.x0, x); ext.y0 = Math.min(ext.y0, y); ext.z0 = Math.min(ext.z0, z); ext.x1 = Math.max(ext.x1, x); ext.y1 = Math.max(ext.y1, y); ext.z1 = Math.max(ext.z1, z); };
  const ent = [];
  const linea = (capa, a, b) => { usa(a[0], a[1], a[2] || 0); usa(b[0], b[1], b[2] || 0); ent.push(['LINE', capa, a, b]); };
  const poli = (capa, pts, tresD) => { pts.forEach((p) => usa(p[0], p[1], p[2] || 0)); ent.push(['POLY', capa, pts, tresD]); };
  const circulo = (capa, c, r) => { usa(c[0], c[1], c[2] || 0); ent.push(['CIRCLE', capa, c, r]); };
  const texto = (capa, p, s, h = ht, rot = 0) => { usa(p[0], p[1], p[2] || 0); ent.push(['TEXT', capa, p, s, h, rot]); };
  const en = (e, n) => T([e, n]);
  const angTexto = (d) => { let a = (Math.atan2(d[1], d[0]) + giro) * 180 / Math.PI; if (a > 90) a -= 180; if (a < -90) a += 180; return a; };

  // ---------------------------------------------------------------- PLANTA (z = 0)
  poli('PLANTA_EJE', M.postes.map((p) => [...en(p.en[0], p.en[1]), 0]), false);
  M.postes.forEach((p, k) => {
    for (const dx of p.postesDx) circulo('PLANTA_POSTES', [...en(p.en[0] + dx * p.perp[0], p.en[1] + dx * p.perp[1]), 0], 0.25);
    if (/^R/.test(p.tipo || '')) {   // retención: cuadro alrededor del poste
      const s = 0.6, d = p.dir, q = p.perp;
      const c = [[-s, -s], [s, -s], [s, s], [-s, s], [-s, -s]].map(([a, b]) => [...en(p.en[0] + a * d[0] + b * q[0], p.en[1] + a * d[1] + b * q[1]), 0]);
      poli('PLANTA_POSTES', c, false);
    }
    p.crucetas.forEach(([a, b]) => linea('PLANTA_CRUCETAS', [...en(a[0], a[1]), 0], [...en(b[0], b[1]), 0]));
    const o = 3 * ht, base = [p.en[0] - o * p.perp[0], p.en[1] - o * p.perp[1]];
    const rot = angTexto(p.dir);
    texto('PLANTA_TEXTOS', [...en(base[0], base[1]), 0], p.nombre, ht * 1.2, rot);
    const det = [p.estructura && String(p.estructura).replace(/^EH[-–\s]*/i, 'EH-'), p.L ? `${p.L} m${p.rotura ? `/${p.rotura} kgf` : ''}` : ''].filter(Boolean).join('  ');
    if (det) texto('PLANTA_TEXTOS', [...en(base[0] - 1.8 * ht * p.perp[0], base[1] - 1.8 * ht * p.perp[1]), 0], det, ht * 0.8, rot);
    if (p.deflexion != null && p.deflexion > 0.5) texto('PLANTA_ANGULOS', [...en(p.en[0] + 2 * ht * p.perp[0], p.en[1] + 2 * ht * p.perp[1]), 0], `a=${p.deflexion.toFixed(1)}°`, ht * 0.8, rot);
    if (k < M.postes.length - 1) {
      const B = M.postes[k + 1];
      const n = Math.min(p.fases.length, B.fases.length, 3);
      for (let j = 0; j < n; j++) {
        const a = [p.en[0] + p.fases[j][0] * p.perp[0], p.en[1] + p.fases[j][0] * p.perp[1]];
        const b = [B.en[0] + B.fases[j][0] * B.perp[0], B.en[1] + B.fases[j][0] * B.perp[1]];
        linea('PLANTA_FASES', [...en(a[0], a[1]), 0], [...en(b[0], b[1]), 0]);
      }
      const d = [B.en[0] - p.en[0], B.en[1] - p.en[1]], L = Math.hypot(d[0], d[1]);
      const m = [(p.en[0] + B.en[0]) / 2 + 1.2 * ht * p.perp[0], (p.en[1] + B.en[1]) / 2 + 1.2 * ht * p.perp[1]];
      texto('PLANTA_VANOS', [...en(m[0], m[1]), 0], `${L.toFixed(2)} m`, ht * 0.8, angTexto(d));
    }
  });

  // ---------------------------------------------------------------- MODELO 3D (cotas reales)
  M.lineas.filter((l) => l.capa !== 'POSTES' && l.capa !== 'CRUCETAS').forEach((l) => {
    const capa = `3D_${l.capa}`;
    const pts = l.pts.map(([e, n, z]) => [...en(e, n), z]);
    if (pts.length === 2) linea(capa, pts[0], pts[1]); else poli(capa, pts, true);
  });
  M.postes.forEach((p) => texto('3D_TEXTOS', [...en(p.en[0], p.en[1]), p.cima + 1.0], p.nombre, ht, angTexto(p.dir)));
  // estructuras y postes como BLOQUES 3D (sólidos), girados según la línea
  const crit = S.proyecto.criterios || {};
  const bloques = new Map(), inserts = [];
  M.postes.forEach((p) => {
    const nb = nombreBloque(p.ficha);
    if (!bloques.has(nb)) bloques.set(nb, carasEstructura(p.ficha, +(crit.amarre_bajo_cima_m ?? 0.7)));
    const L = longitudPoste(p), np = nombrePoste(L);
    if (!bloques.has(np)) bloques.set(np, carasPoste(L));
    const rot = (Math.atan2(p.perp[1], p.perp[0]) + giro) * 180 / Math.PI;
    const top = [...en(p.en[0], p.en[1]), p.cima];
    inserts.push(['3D_HERRAJES', nb, top, rot]);
    for (const dx of p.postesDx) {
      const pp = [...en(p.en[0] + dx * p.perp[0], p.en[1] + dx * p.perp[1]), p.cima - L];
      inserts.push(['3D_POSTES', np, pp, rot]);
      usa(pp[0], pp[1], pp[2]);
    }
  });
  M.alertas.forEach((a) => { const c = [...en(a.e, a.n), a.z]; circulo('3D_ALERTAS', c, 1.0); texto('3D_ALERTAS', [c[0] + 1.2, c[1], c[2]], a.texto, ht); });

  // ---------------------------------------------------------------- escritura DXF R12
  escribirInicio(g, `${M.nombre} - planta y 3D. App Calculos Mecanicos MT. ${aj ? `Coordenadas MAGNA-SIRGAS Origen Nacional (ajuste ${aj.err.toFixed(3)} m)` : 'Coordenadas locales (sin E/N)'}`, ext, bloques);
  g(0, 'SECTION', 2, 'ENTITIES');
  for (const [capa, b, p, rot] of inserts) insertar(g, capa, b, p, rot);

  for (const e of ent) {
    const [t, capa] = e;
    if (t === 'LINE') { const [, , a, b] = e; g(0, 'LINE', 8, capa, 10, f(a[0]), 20, f(a[1]), 30, f(a[2] || 0), 11, f(b[0]), 21, f(b[1]), 31, f(b[2] || 0)); }
    else if (t === 'POLY') {
      const [, , pts, tresD] = e;
      g(0, 'POLYLINE', 8, capa, 66, 1, 10, '0.0', 20, '0.0', 30, '0.0', 70, tresD ? 8 : 0);
      pts.forEach((p) => g(0, 'VERTEX', 8, capa, 10, f(p[0]), 20, f(p[1]), 30, f(tresD ? p[2] : 0), 70, tresD ? 32 : 0));
      g(0, 'SEQEND', 8, capa);
    } else if (t === 'CIRCLE') { const [, , c, r] = e; g(0, 'CIRCLE', 8, capa, 10, f(c[0]), 20, f(c[1]), 30, f(c[2] || 0), 40, f(r)); }
    else if (t === 'TEXT') { const [, , p, s, h, rot] = e; g(0, 'TEXT', 8, capa, 10, f(p[0]), 20, f(p[1]), 30, f(p[2] || 0), 40, f(h), 1, txt(s), 50, f(rot || 0)); }
  }
  g(0, 'ENDSEC', 0, 'EOF');
  return { dxf: out.join('\r\n') + '\r\n', georreferenciado: !!aj, error_ajuste: aj?.err ?? null, entidades: ent.length + inserts.length, bloques: bloques.size };
}

// ------------------------------------------------------------------ biblioteca de estructuras EH en 3D
// Todos los bloques (estructuras de la norma, subestaciones tipo poste y postes de 8 a 18 m), cada
// estructura montada sobre su poste en una cuadrícula con su código y nombre.
export function generarBibliotecaDXF(catalogo, { bajo = 0.7 } = {}) {
  const lista = (catalogo?.estructuras || []).slice().sort((a, b) => (a.nivel + a.funcion + a.codigo).localeCompare(b.nivel + b.funcion + b.codigo));
  const bloques = new Map(), ins = [], textos = [];
  const longitudes = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18];
  longitudes.forEach((L) => bloques.set(nombrePoste(L), carasPoste(L)));
  bloques.set('EH_GENERICA', carasEstructura(null, bajo));
  const paso = 9, porFila = 12;
  let fila = 0, col = 0, grupo = '';
  const ext = { x0: -10, y0: 10, z0: -3, x1: paso * porFila, y1: 0, z1: 20 };
  lista.forEach((e) => {
    const g2 = `${e.nivel} · ${e.funcion}`;
    if (g2 !== grupo) { if (col) { fila++; col = 0; } grupo = g2; textos.push([[-8, -fila * 14 - 2, 0], g2.toUpperCase(), 1.2]); }
    const nb = nombreBloque(e);
    bloques.set(nb, carasEstructura(e, bajo));
    const L = e.poste === 'H' ? 14 : e.nivel === 'BT' ? 9 : 12, libre = L - (0.1 * L + 0.6);
    const x = col * paso, y = -fila * 14 - 6;
    ins.push(['3D_HERRAJES', nb, [x, y, libre], 0]);
    for (const dx of e.geometria?.postes || [0]) ins.push(['3D_POSTES', nombrePoste(L), [x + dx, y, libre - L], 0]);
    textos.push([[x - 3, y - 4, 0], e.codigo, 0.45], [[x - 3, y - 4.7, 0], e.nombre.slice(0, 60), 0.22]);
    col++; if (col >= porFila) { col = 0; fila++; }
    ext.y0 = Math.min(ext.y0, y - 6);
  });
  const out = [];
  const g = (...kv) => { for (let i = 0; i < kv.length; i += 2) out.push(String(kv[i]), String(kv[i + 1])); };
  escribirInicio(g, `Biblioteca 3D de estructuras normalizadas de Electrohuila (${lista.length} estructuras). Bloques EH_<codigo> con origen en la cima del poste; POSTE_<L>M con origen en la base. App Calculos Mecanicos MT.`, ext, bloques);
  g(0, 'SECTION', 2, 'ENTITIES');
  for (const [capa, b, p, rot] of ins) insertar(g, capa, b, p, rot);
  for (const [p, s2, h] of textos) g(0, 'TEXT', 8, 'BIBLIOTECA_TEXTOS', 10, f(p[0]), 20, f(p[1]), 30, f(p[2]), 40, f(h), 1, txt(s2), 50, '0.0');
  g(0, 'ENDSEC', 0, 'EOF');
  return { dxf: out.join('\r\n') + '\r\n', estructuras: lista.length, bloques: bloques.size };
}
