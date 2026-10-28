// Visor 3D (WebGL, three.js) dentro de la app: muestra los MISMOS bloques 3D de estructuras EH que van
// a la biblioteca y a los planos DXF/DWG, y los conductores del cálculo mecánico.
import { carasEstructura, carasPoste } from './bloques3d.js?v=2';
import { modelo3D } from './earth3d.js?v=3';

const URL_THREE = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
let THREE = null;
async function cargarThree() {
  if (!THREE) THREE = await import(URL_THREE);
  return THREE;
}
const COLOR = { '3D_POSTES': 0xa7a9ac, '3D_CRUCETAS': 0x8b5a2b, '3D_AISLADORES': 0xf2f2f2, '3D_HERRAJES': 0x555a60, '3D_TRANSFORMADOR': 0x5b8fb9, '3D_BT': 0xc97c2b };
const COLOR_LINEA = { CONDUCTORES: 0x1f6fb2, CONDUCTOR_FRIO: 0x7fb6df, CABLE_GUARDA: 0x333333, DIST_MINIMA: 0xc84c4c, TERRENO: 0xa07c4a,
  CIRCUITO_2: 0xd35400, CIRCUITO_3: 0x8e44ad, CIRCUITO_4: 0x16a085, CIRCUITO_5: 0xb03a2e };

// caras (en coordenadas del bloque) -> transformadas a coordenadas de escena (x = este, y = arriba, z = -norte)
function agregarCaras(acum, caras, T) {
  for (const c of caras) {
    const a = acum[c.capa] || (acum[c.capa] = []);
    const v = c.v.map(T);
    a.push(...v[0], ...v[1], ...v[2]);
    if (c.v.length === 4) a.push(...v[0], ...v[2], ...v[3]);
  }
}

async function crearEscena(contenedor, construir) {
  const T3 = await cargarThree();
  const ancho = contenedor.clientWidth || 600, alto = contenedor.clientHeight || 420;
  const renderer = new T3.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(ancho, alto);
  contenedor.innerHTML = '';
  contenedor.appendChild(renderer.domElement);
  const escena = new T3.Scene();
  escena.background = new T3.Color(0xeef3f7);
  escena.add(new T3.HemisphereLight(0xffffff, 0x8a7a66, 1.1));
  const sol = new T3.DirectionalLight(0xffffff, 1.4); sol.position.set(60, 120, 40); escena.add(sol);
  const camara = new T3.PerspectiveCamera(45, ancho / alto, 0.1, 50000);
  const { centro, radio, el = 0.3, az = -0.9, k = 1.8 } = construir(T3, escena);
  // cámara orbital propia (arrastrar = girar, rueda = acercar, clic derecho o Mayús+arrastrar = desplazar)
  const st = { az, el, d: radio * k, c: new T3.Vector3(...centro) };
  const pintar = () => {
    st.el = Math.max(-0.2, Math.min(1.5, st.el));
    camara.position.set(st.c.x + st.d * Math.cos(st.el) * Math.cos(st.az), st.c.y + st.d * Math.sin(st.el), st.c.z + st.d * Math.cos(st.el) * Math.sin(st.az));
    camara.lookAt(st.c); renderer.render(escena, camara);
  };
  let arr = null;
  const cv = renderer.domElement;
  cv.style.touchAction = 'none'; cv.style.cursor = 'grab';
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => { arr = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
  cv.addEventListener('pointermove', (e) => {
    if (!arr) return;
    const dx = e.clientX - arr.x, dy = e.clientY - arr.y; arr.x = e.clientX; arr.y = e.clientY;
    if (arr.pan) {
      const f = st.d / 600, der = new T3.Vector3(Math.sin(st.az), 0, -Math.cos(st.az));
      st.c.addScaledVector(der, -dx * f); st.c.y += dy * f;
    } else { st.az += dx * 0.008; st.el += dy * 0.006; }
    pintar();
  });
  cv.addEventListener('pointerup', () => { arr = null; cv.style.cursor = 'grab'; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); st.d *= Math.exp(e.deltaY * 0.001); st.d = Math.max(1, st.d); pintar(); }, { passive: false });
  const ro = new ResizeObserver(() => { const w = contenedor.clientWidth, h = contenedor.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camara.aspect = w / h; camara.updateProjectionMatrix(); pintar(); });
  ro.observe(contenedor);
  pintar();
  return {
    pintar, st, T3, camara,
    ir: (centro2, d) => { st.c.set(...centro2); if (d) st.d = d; pintar(); },
    imagen: () => renderer.domElement.toDataURL('image/png'),
    liberar: () => { ro.disconnect(); escena.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); renderer.dispose(); renderer.forceContextLoss?.(); contenedor.innerHTML = ''; },
  };
}

function mallas(T3, escena, acum) {
  for (const [capa, arr] of Object.entries(acum)) {
    if (!arr.length) continue;
    const g = new T3.BufferGeometry();
    g.setAttribute('position', new T3.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    escena.add(new T3.Mesh(g, new T3.MeshLambertMaterial({ color: COLOR[capa] ?? 0x999999, side: T3.DoubleSide })));
  }
}

// ------------------------------------------------------------------ vista previa de UNA estructura
export async function visorEstructura(contenedor, e, { L = null, bajo = 0.7 } = {}) {
  return crearEscena(contenedor, (T3, escena) => {
    const Lp = L || (e?.poste === 'H' ? 14 : e?.nivel === 'BT' ? 9 : 12);
    const libre = Lp - (0.1 * Lp + 0.6);
    const acum = {};
    const T = ([x, y, z]) => [x, z + libre, -y];
    agregarCaras(acum, carasEstructura(e, bajo), T);
    for (const dx of e?.geometria?.postes || [0]) for (const dy of e?.geometria?.postes_y || [0]) agregarCaras(acum, carasPoste(Lp), ([x, y, z]) => [x + dx, z - (Lp - libre), -(y + dy)]);
    mallas(T3, escena, acum);
    // tramos cortos de conductor en cada fase y suelo
    const mat = new T3.LineBasicMaterial({ color: COLOR_LINEA.CONDUCTORES });
    for (const [dx, dz] of e?.geometria?.fases || []) {
      const g = new T3.BufferGeometry().setFromPoints([new T3.Vector3(dx, libre - dz - 0.25, 6), new T3.Vector3(dx, libre - dz, 0), new T3.Vector3(dx, libre - dz - 0.25, -6)]);
      escena.add(new T3.Line(g, mat));
    }
    const suelo = new T3.Mesh(new T3.PlaneGeometry(14, 14), new T3.MeshLambertMaterial({ color: 0xc9d6b8, side: T3.DoubleSide }));
    suelo.rotation.x = -Math.PI / 2; escena.add(suelo);
    return { centro: [0, libre * 0.7, 0], radio: Math.max(6, libre * 0.75), el: 0.22, az: -1.15, k: 1.9 };
  });
}

// ------------------------------------------------------------------ vista 3D de TODO el proyecto
export async function visorProyecto(contenedor, { S, catalogo, opciones = {} }) {
  const M = modelo3D({ S, catalogo });
  const crit = S.proyecto.criterios || {};
  const zRef = Math.min(...M.postes.map((p) => p.base));
  const exV = opciones.exageracion || 1;
  const Tw = (e, n, z) => [e, (z - zRef) * exV, -n];
  let esc = null;
  const info = { postes: M.postes.length, alertas: M.alertas.length };
  esc = await crearEscena(contenedor, (T3, escena) => {
    const acum = {};
    for (const p of M.postes) {
      const L = p.L || Math.max(6, Math.round(((p.cima - p.base) + 0.6) / 0.9 * 2) / 2);
      const ang = Math.atan2(p.perp[1], p.perp[0]), c = Math.cos(ang), s = Math.sin(ang);
      const rot = ([x, y]) => [x * c - y * s, x * s + y * c];
      agregarCaras(acum, carasEstructura(p.ficha, +(crit.amarre_bajo_cima_m ?? 0.7)), ([x, y, z]) => { const [a, b] = rot([x, y]); return Tw(p.en[0] + a, p.en[1] + b, p.cima + z); });
      for (const dx of p.postesDx) for (const dy of p.postesDy || [0]) agregarCaras(acum, carasPoste(L), ([x, y, z]) => { const [a, b] = rot([x + dx, y + dy]); return Tw(p.en[0] + a, p.en[1] + b, p.cima - L + z); });
    }
    mallas(T3, escena, acum);
    for (const l of M.lineas) {
      if (l.capa === 'POSTES' || l.capa === 'CRUCETAS' || (l.capa === 'CONDUCTOR_FRIO' && !opciones.frio)) continue;
      const g = new T3.BufferGeometry().setFromPoints(l.pts.map(([e, n, z]) => new T3.Vector3(...Tw(e, n, z))));
      escena.add(new T3.Line(g, new T3.LineBasicMaterial({ color: COLOR_LINEA[l.capa] ?? 0x1f6fb2 })));
    }
    // marcas de vanos que no cumplen
    for (const a of M.alertas) {
      const m = new T3.Mesh(new T3.SphereGeometry(0.6, 12, 8), new T3.MeshBasicMaterial({ color: 0xff2a2a }));
      m.position.set(...Tw(a.e, a.n, a.z)); escena.add(m);
    }
    // terreno: franja a lo largo del eje
    const ter = M.lineas.find((l) => l.capa === 'TERRENO');
    if (ter) {
      const pos = [];
      for (let k = 0; k < ter.pts.length - 1; k++) {
        const [e0, n0, z0] = ter.pts[k], [e1, n1, z1] = ter.pts[k + 1];
        const d = [e1 - e0, n1 - n0], l = Math.hypot(...d) || 1, q = [d[1] / l * 8, -d[0] / l * 8];
        const A = Tw(e0 - q[0], n0 - q[1], z0), B = Tw(e0 + q[0], n0 + q[1], z0), C = Tw(e1 + q[0], n1 + q[1], z1), D = Tw(e1 - q[0], n1 - q[1], z1);
        pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      }
      const g = new T3.BufferGeometry(); g.setAttribute('position', new T3.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      escena.add(new T3.Mesh(g, new T3.MeshLambertMaterial({ color: 0xc9d6b8, side: T3.DoubleSide, transparent: true, opacity: 0.85 })));
    }
    const es = M.postes.map((p) => p.en[0]), ns = M.postes.map((p) => p.en[1]), zs = M.postes.map((p) => p.cima);
    const c = [(Math.min(...es) + Math.max(...es)) / 2, (Math.min(...ns) + Math.max(...ns)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
    const r = Math.max(30, Math.hypot(Math.max(...es) - Math.min(...es), Math.max(...ns) - Math.min(...ns)) / 2);
    return { centro: Tw(...c), radio: r, el: 0.35, az: -1.3, k: 1.15 };
  });
  const irPoste = (k) => { const p = M.postes[k]; if (p) esc.ir(Tw(p.en[0], p.en[1], p.cima - 4), 28); };
  return { ...esc, M, info, irPoste };
}
