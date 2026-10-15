// Gráfica del perfil (plantillado) en SVG. Se adapta al ancho de pantalla
// (el tamaño de texto se mantiene legible en celular).

const C = {
  conductor: '#1f6fb2', frio: '#7fb6df', terreno: '#a07c4a', terrenoFill: '#efe4d3',
  dmin: '#c84c4c', poste: '#33475a', apoyo: '#c84c4c', grid: '#e3eaef', texto: '#263746', muted: '#657684',
};

export const abscisaK = (m) => `K${Math.floor(m / 1000)}+${(m % 1000).toFixed(2).padStart(6, '0')}`;

export function interp(xs, ys, x) {
  if (!xs.length) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

function pasoBonito(rango, n) {
  const bruto = rango / Math.max(1, n);
  const p = Math.pow(10, Math.floor(Math.log10(bruto)));
  for (const k of [1, 2, 2.5, 5, 10]) if (bruto <= k * p) return k * p;
  return 10 * p;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function paginas(perfil, porPagina) {
  const n = perfil.vanos.length; const out = [];
  for (let i = 0; i < n; i += porPagina) out.push([i, Math.min(i + porPagina, n)]);
  return out;
}

export function dimensiones(contenedor) {
  const anchoPx = Math.max(320, contenedor.clientWidth || 900);
  const movil = anchoPx < 640;
  const W = Math.min(Math.max(anchoPx, 340), 1500);
  const M = { l: movil ? 46 : 60, r: movil ? 30 : 44, t: 30, b: movil ? 58 : 46 };
  const altoMax = movil ? W * 1.2 : Math.max(380, Math.min(720, (window.innerHeight || 900) * 0.72));
  return { W, M, movil, anchoPlot: W - M.l - M.r, altoMax: altoMax - M.t - M.b };
}

function rangoY(perfil, inicio, fin) {
  const ap = perfil.apoyos.slice(inicio, fin + 1), ter = perfil.terreno;
  const x0 = ap[0].x, x1 = ap[ap.length - 1].x, ys = [];
  perfil.vanos.slice(inicio, fin).forEach((v) => { ys.push(...v.y); if (perfil.modo === 'cambio_estado') ys.push(...v.yf); });
  ap.forEach((a) => { ys.push(a.ya); if (ter) ys.push(a.yt); });
  if (ter) {
    ys.push(interp(ter.x, ter.y, x0) + perfil.dmin, interp(ter.x, ter.y, x1));
    ter.x.forEach((x, i) => { if (x > x0 && x < x1) ys.push(ter.y[i], ter.y[i] + perfil.dmin); });
  }
  return [Math.min(...ys), Math.max(...ys)];
}

/**
 * Páginas del perfil a escala fija: X 1:1 y Y exV:1 (la altura se dibuja exV veces más grande).
 * La escala horizontal es la misma en todas las páginas; cuando el trazado no cabe (por ancho o
 * por alto) se parte en tramos. Devuelve { pags: [[ini, fin], …], kx (px por metro) }.
 */
export function paginasEscala(perfil, contenedor, exV, vanosRef = 5) {
  const { anchoPlot, altoMax } = dimensiones(contenedor);
  const ap = perfil.apoyos, n = perfil.vanos.length;
  const vanos = Array.from({ length: n }, (_, i) => ap[i + 1].x - ap[i].x).sort((a, b) => a - b);
  const mediana = vanos[Math.floor(n / 2)] || 100;
  // escala horizontal: que quepan ~vanosRef vanos típicos a lo ancho y, a la vez, a lo alto
  // (en terreno quebrado se reduce la escala para no partir en tramos muy cortos)
  const ref = Math.min(vanosRef, n);
  const desn = [];
  for (let i = 0; i + ref <= n; i++) { const [lo, hi] = rangoY(perfil, i, i + ref); desn.push(hi - lo + 6); }
  desn.sort((a, b) => a - b);
  const desnTipico = desn[Math.floor(desn.length / 2)] || 20;
  const kx = Math.min(anchoPlot / (mediana * vanosRef), altoMax / (desnTipico * exV));
  const pags = [];
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n) {
      const ancho = (ap[j + 1].x - ap[i].x) * kx;
      const [lo, hi] = rangoY(perfil, i, j + 1);
      const alto = (hi - lo + 6) * kx * exV;
      if (ancho > anchoPlot || alto > altoMax) break;
      j++;
    }
    pags.push([i, j]); i = j;
  }
  return { pags, kx };
}

export function dibujarPerfil(contenedor, perfil, inicio, fin, opciones = {}) {
  const { W, M, movil } = dimensiones(contenedor);
  let H = Math.round(movil ? W * 0.9 : Math.max(380, W * 0.42));
  const pasoY = +opciones.pasoY > 0 ? +opciones.pasoY : 5; // intervalo de cotas del eje Y (m)
  const exV = +opciones.exV > 0 && +opciones.kx > 0 ? +opciones.exV : 0; // escala fija X 1:1 · Y exV:1
  const fs = movil ? 10.5 : 11.5;

  let ap = perfil.apoyos.slice(inicio, fin + 1);
  let vanos = perfil.vanos.slice(inicio, fin);
  let x0 = ap[0].x, x1 = ap[ap.length - 1].x;
  const ter = perfil.terreno;
  // ventana de zoom [xa, xb] (abscisas X del perfil): se dibujan solo los vanos que la tocan
  const ventana = opciones.ventana && opciones.ventana[1] > opciones.ventana[0] ? opciones.ventana : null;
  if (ventana) {
    x0 = Math.max(x0, ventana[0]); x1 = Math.min(x1, ventana[1]);
    let a = 0; while (a + 1 < ap.length - 1 && ap[a + 1].x <= x0) a++;
    let b = ap.length - 1; while (b - 1 > a && ap[b - 1].x >= x1) b--;
    vanos = vanos.slice(a, b); ap = ap.slice(a, b + 1); inicio += a;
  }
  const dentro = (x) => x >= x0 - 1e-6 && x <= x1 + 1e-6;
  const apVis = ap.filter((a) => dentro(a.x));

  // terreno dentro del rango
  let tx = [], ty = [];
  if (ter) {
    tx.push(x0); ty.push(interp(ter.x, ter.y, x0));
    ter.x.forEach((x, i) => { if (x > x0 && x < x1) { tx.push(x); ty.push(ter.y[i]); } });
    tx.push(x1); ty.push(interp(ter.x, ter.y, x1));
  }

  const ys = [];
  vanos.forEach((v) => {
    v.x.forEach((x, j) => { if (dentro(x)) { ys.push(v.y[j]); if (perfil.modo === 'cambio_estado') ys.push(v.yf[j]); } });
    [x0, x1].forEach((x) => { if (x > v.x[0] && x < v.x[v.x.length - 1]) ys.push(interp(v.x, v.y, x)); });
  });
  apVis.forEach((a) => { ys.push(a.ya); if (ter) ys.push(a.yt); });
  if (!ter) ap.forEach((a) => ys.push(a.yt ?? a.ya));
  ty.forEach((y) => { ys.push(y); ys.push(y + perfil.dmin); });
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  const marg = Math.max(2, 0.1 * (yMax - yMin));
  yMin -= marg; yMax += marg * 1.6;

  yMin = Math.floor(yMin / pasoY) * pasoY; yMax = Math.ceil(yMax / pasoY) * pasoY;
  let kx = (W - M.l - M.r) / (x1 - x0 || 1), ky = (H - M.t - M.b) / (yMax - yMin || 1);
  if (exV) {
    // escala fija: misma escala horizontal en todas las páginas y vertical exV veces mayor
    kx = +opciones.kx; ky = kx * exV;
    const minAlto = movil ? 200 : 240;
    if ((yMax - yMin) * ky < minAlto) {
      const extra = Math.ceil((minAlto / ky - (yMax - yMin)) / 2 / pasoY) * pasoY; yMin -= extra; yMax += extra;
    }
    H = Math.round((yMax - yMin) * ky + M.t + M.b);
  }
  const sy = (y) => H - M.b - sy0(y);
  const sx = (x) => M.l + (x - x0) * kx;
  const sy0 = (y) => (y - yMin) * ky;
  const xDer = sx(x1);
  const pts = (xs, yv) => xs.map((x, i) => `${sx(x).toFixed(1)},${sy(yv[i]).toFixed(1)}`).join(' ');

  const p = [];
  p.push(`<svg data-ml="${M.l}" data-mr="${xDer}" data-x0="${x0}" data-kx="${kx}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Perfil de la línea, vanos ${inicio + 1} a ${fin}" font-family="Inter, system-ui, Segoe UI, sans-serif">`);
  // rejilla Y
  // rejilla Y cada `pasoY` m (5 m por defecto); si las líneas quedan muy juntas se rotula una de cada n
  const pxPaso = pasoY * ky;
  const cadaRotulo = Math.max(1, Math.ceil((fs + 4) / Math.max(pxPaso, 0.1)));
  if (pxPaso >= 3) {
    for (let k = 0, y = yMin; y <= yMax + 1e-9; y += pasoY, k++) {
      const fuerte = k % cadaRotulo === 0;
      p.push(`<line x1="${M.l}" x2="${xDer}" y1="${sy(y)}" y2="${sy(y)}" stroke="${C.grid}" ${fuerte ? '' : 'stroke-opacity="0.55"'}/>`);
      if (fuerte) p.push(`<text x="${M.l - 6}" y="${sy(y) + 4}" text-anchor="end" font-size="${fs - 1}" fill="${C.muted}">${+y.toFixed(2)}</text>`);
    }
  }
  const idClip = `cp${Math.random().toString(36).slice(2, 8)}`;
  p.push(`<defs><clipPath id="${idClip}"><rect x="${M.l}" y="0" width="${xDer - M.l}" height="${H - M.b}"/></clipPath></defs><g clip-path="url(#${idClip})">`);
  // terreno
  if (ter) {
    const base = H - M.b;
    p.push(`<polygon points="${sx(tx[0])},${base} ${pts(tx, ty)} ${sx(tx[tx.length - 1])},${base}" fill="${C.terrenoFill}"/>`);
    p.push(`<polyline points="${pts(tx, ty)}" fill="none" stroke="${C.terreno}" stroke-width="1.6"/>`);
    p.push(`<polyline points="${pts(tx, ty.map((y) => y + perfil.dmin))}" fill="none" stroke="${C.dmin}" stroke-width="1.2" stroke-dasharray="6 4"/>`);
  }
  // postes
  ap.forEach((a) => {
    if (perfil.y_es_terreno) p.push(`<line x1="${sx(a.x)}" x2="${sx(a.x)}" y1="${sy(a.yt)}" y2="${sy(a.ya)}" stroke="${C.poste}" stroke-width="3" stroke-linecap="butt"/>`);
  });
  // conductores
  vanos.forEach((v, k) => {
    const i = inicio + k;
    if (perfil.modo === 'cambio_estado') p.push(`<polyline points="${pts(v.x, v.yf)}" fill="none" stroke="${C.frio}" stroke-width="1.3" stroke-dasharray="3 3"/>`);
    p.push(`<polyline points="${pts(v.x, v.y)}" fill="none" stroke="${C.conductor}" stroke-width="2.4" stroke-linejoin="round"/>`);
    p.push(`<polyline class="svg-hit" data-vano="${i}" points="${pts(v.x, v.y)}" fill="none" stroke="transparent" stroke-width="16"/>`);
    const anchoVano = sx(v.x[v.x.length - 1]) - sx(v.x[0]);
    if (anchoVano > (movil ? 62 : 74)) {
      p.push(`<text x="${sx(v.xf)}" y="${sy(v.yfm) + 15}" text-anchor="middle" font-size="${fs - 1.5}" fill="${C.conductor}">a=${v.a.toFixed(1)} · f=${v.f.toFixed(2)}</text>`);
    }
    if (v.cumple === 'NO' && v.xmin != null) {
      const yx = interp(v.x, v.y, v.xmin); const cx = sx(v.xmin), cy = sy(yx);
      p.push(`<path d="M${cx - 6},${cy - 6}L${cx + 6},${cy + 6}M${cx - 6},${cy + 6}L${cx + 6},${cy - 6}" stroke="${C.dmin}" stroke-width="2.6"/>`);
    }
  });
  p.push('</g>');
  // apoyos, nombres y abscisas (sin solapes; el último apoyo siempre se rotula)
  ap = apVis;
  const minSep = movil ? 46 : 64;
  const rot = [];
  if (ap.length) ap.forEach((a, k) => { const cx = sx(a.x); if (!rot.length || cx - sx(ap[rot[rot.length - 1]].x) >= minSep) rot.push(k); });
  const ultimo = ap.length - 1;
  if (ap.length && rot[rot.length - 1] !== ultimo) {
    while (rot.length > 1 && sx(ap[ultimo].x) - sx(ap[rot[rot.length - 1]].x) < minSep) rot.pop();
    rot.push(ultimo);
  }
  const rotular = new Set(rot);
  ap.forEach((a, k) => {
    const i = perfil.apoyos.indexOf(a); const cx = sx(a.x), cy = sy(a.ya);
    const ret = a.tipo === 'Retención';
    p.push(ret ? `<rect x="${cx - 5}" y="${cy - 5}" width="10" height="10" fill="${C.apoyo}"/>`
      : `<circle cx="${cx}" cy="${cy}" r="5" fill="${C.apoyo}"/>`);
    if (a.arranc) p.push(`<text x="${cx + 8}" y="${cy + 4}" font-size="${fs + 1}" fill="${C.dmin}" font-weight="800">▲</text>`);
    if (rotular.has(k)) {
      const anc = cx > xDer - 24 ? 'end' : (cx < M.l + 24 ? 'start' : 'middle');
      const dx = anc === 'end' ? 6 : anc === 'start' ? -6 : 0;
      p.push(`<text x="${cx + dx}" y="${cy - 10}" text-anchor="${anc}" font-size="${fs}" font-weight="700" fill="${C.texto}">${esc(a.nombre)}</text>`);
      if (movil) {
        p.push(`<text transform="translate(${cx},${H - M.b + 10}) rotate(40)" font-size="${fs - 1.5}" fill="${C.muted}">${abscisaK(a.abscisa)}</text>`);
      } else {
        p.push(`<text x="${cx + dx}" y="${H - M.b + 16}" text-anchor="${anc}" font-size="${fs - 1.5}" fill="${C.muted}">${abscisaK(a.abscisa)}</text>`);
      }
    }
    p.push(`<line x1="${cx}" x2="${cx}" y1="${H - M.b}" y2="${H - M.b + 4}" stroke="${C.muted}"/>`);
    p.push(`<circle class="svg-hit" data-apoyo="${i}" cx="${cx}" cy="${cy}" r="14" fill="transparent"/>`);
  });
  if (ventana) { // abscisas de los bordes de la ventana
    const k0 = perfil.apoyos[0].x;
    p.push(`<text x="${M.l}" y="${H - M.b + 30}" font-size="${fs - 2}" fill="${C.muted}">◂ ${abscisaK(x0 - k0)}</text>`);
    p.push(`<text x="${xDer}" y="${H - M.b + 30}" text-anchor="end" font-size="${fs - 2}" fill="${C.muted}">${abscisaK(x1 - k0)} ▸</text>`);
  }
  p.push(`<line x1="${M.l}" x2="${xDer}" y1="${H - M.b}" y2="${H - M.b}" stroke="${C.muted}"/>`);
  p.push(`<text x="${M.l}" y="${M.t - 12}" font-size="${fs}" font-weight="700" fill="${C.texto}">Cota (m)</text>`);
  p.push(`<text x="${xDer}" y="${M.t - 12}" text-anchor="end" font-size="${fs - 1}" fill="${C.muted}">${exV ? `Escala X 1:1 · Y ${+exV.toFixed(2)}:1 · ` : ''}cotas cada ${+pasoY.toFixed(2)} m</text>`);
  // modo «colocar poste»: guía vertical que sigue al cursor y clic para insertar
  if (opciones.onColocar) {
    p.push(`<g class="guia-colocar" visibility="hidden" pointer-events="none"><line x1="0" x2="0" y1="${M.t}" y2="${H - M.b}" stroke="${C.apoyo}" stroke-width="1.5" stroke-dasharray="5 4"/><circle r="5" fill="${C.apoyo}"/><rect rx="4" fill="#17324d" opacity="0.92"/><text font-size="${fs}" fill="#fff" font-weight="700"></text></g>`);
    p.push(`<rect class="zona-colocar" x="${M.l}" y="${M.t}" width="${xDer - M.l}" height="${H - M.t - M.b}" fill="transparent" style="cursor:crosshair"/>`);
  }
  p.push('</svg>');

  contenedor.innerHTML = p.join('') + '<div class="tip" hidden></div>';
  if (opciones.onColocar) {
    const svgC = contenedor.querySelector('svg'), zona = svgC.querySelector('.zona-colocar'), guia = svgC.querySelector('.guia-colocar');
    const [gl, gc, gr, gt] = guia.children;
    const aSvg = (ev) => { const pt = svgC.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; return pt.matrixTransform(svgC.getScreenCTM().inverse()); };
    const cotaTer = (x) => (ter ? interp(ter.x, ter.y, x) : interp(perfil.apoyos.map((a) => a.x), perfil.apoyos.map((a) => a.yt ?? a.ya), x));
    const mover = (ev) => {
      const q = aSvg(ev); const x = x0 + (q.x - M.l) / kx;
      if (x <= x0 || x >= x1) { guia.setAttribute('visibility', 'hidden'); return null; }
      const z = cotaTer(x), px = sx(x), py = sy(z);
      gl.setAttribute('x1', px); gl.setAttribute('x2', px); gc.setAttribute('cx', px); gc.setAttribute('cy', py);
      gt.textContent = `${abscisaK(x - perfil.apoyos[0].x)} · cota ${z.toFixed(1)} m`;
      const ancho = gt.textContent.length * fs * 0.58 + 12, izq = px + ancho + 14 > xDer;
      const tx = izq ? px - ancho - 8 : px + 8, ty = Math.max(M.t + 4, py - 34);
      gr.setAttribute('x', tx); gr.setAttribute('y', ty); gr.setAttribute('width', ancho); gr.setAttribute('height', fs + 10);
      gt.setAttribute('x', tx + 6); gt.setAttribute('y', ty + fs + 3);
      guia.setAttribute('visibility', 'visible');
      return x;
    };
    zona.addEventListener('mousemove', mover);
    zona.addEventListener('mouseleave', () => guia.setAttribute('visibility', 'hidden'));
    zona.addEventListener('click', (ev) => { const x = mover(ev); if (x != null) opciones.onColocar(x, cotaTer(x)); });
  }
  const tip = contenedor.querySelector('.tip');
  const svg = contenedor.querySelector('svg');
  const mostrarTip = (ev) => {
    const el = ev.target.closest('.svg-hit'); if (!el) return;
    const html = el.dataset.apoyo != null ? opciones.tipApoyo?.(+el.dataset.apoyo) : opciones.tipVano?.(+el.dataset.vano);
    if (!html) return;
    tip.innerHTML = html; tip.hidden = false;
    const caja = contenedor.getBoundingClientRect();
    const px = (ev.clientX ?? ev.touches?.[0]?.clientX) - caja.left;
    const py = (ev.clientY ?? ev.touches?.[0]?.clientY) - caja.top;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(Math.max(6, px + 12), caja.width - tw - 6) + 'px';
    tip.style.top = (py - th - 12 < 4 ? py + 16 : py - th - 12) + 'px';
  };
  svg.addEventListener('mousemove', mostrarTip);
  svg.addEventListener('click', mostrarTip);
  svg.addEventListener('mouseleave', () => { tip.hidden = true; });
  contenedor.addEventListener('scroll', () => { tip.hidden = true; });
}

/**
 * Perfil con zoom y desplazamiento: rueda del ratón (zoom en el punto), arrastrar (mover),
 * doble clic (acercar), pellizco con dos dedos (celular). `estado.ventana` guarda la vista.
 * Devuelve { acercar, alejar, todo }.
 */
export function perfilInteractivo(cont, perfil, opciones = {}, estado = {}) {
  const ap = perfil.apoyos, X0 = ap[0].x, X1 = ap[ap.length - 1].x, L = X1 - X0 || 1;
  const minAncho = Math.min(15, L);
  let [a, b] = estado.ventana && estado.ventana[0] >= X0 - 1 && estado.ventana[1] <= X1 + 1 ? estado.ventana : [X0, X1];
  const limitar = () => {
    const w = Math.max(minAncho, Math.min(L, b - a));
    if (a < X0) a = X0;
    if (a + w > X1) a = X1 - w;
    b = a + w;
    estado.ventana = w >= L - 1e-6 ? null : [a, b];
  };
  const dibujar = () => {
    dibujarPerfil(cont, perfil, 0, perfil.vanos.length, { ...opciones, ventana: estado.ventana });
    opciones.onVentana?.(estado.ventana, X0, X1);
  };
  let pendiente = false;
  const pintar = () => { if (pendiente) return; pendiente = true; requestAnimationFrame(() => { pendiente = false; dibujar(); }); };
  const medida = () => {
    const svg = cont.querySelector('svg'); const ctm = svg.getScreenCTM();
    return { svg, ctm, ml: +svg.dataset.ml, x0: +svg.dataset.x0, kx: +svg.dataset.kx };
  };
  const xDato = (clientX) => {
    const g = medida(); const pt = g.svg.createSVGPoint(); pt.x = clientX; pt.y = 0;
    const q = pt.matrixTransform(g.ctm.inverse());
    return Math.min(X1, Math.max(X0, g.x0 + (q.x - g.ml) / g.kx));
  };
  const pxPorMetro = () => { const g = medida(); return g.ctm.a * g.kx; };
  const zoom = (f, cx) => { const c = cx ?? (a + b) / 2; a = c - (c - a) * f; b = c + (b - c) * f; limitar(); pintar(); };

  cont.style.touchAction = 'pan-y';
  cont.classList.add('perfil-zoom');
  cont.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0015), xDato(e.clientX)); }, { passive: false });
  cont.addEventListener('dblclick', (e) => { if (!opciones.onColocar) zoom(0.5, xDato(e.clientX)); });
  const punteros = new Map(); let arrastre = null, movido = false;
  cont.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    punteros.set(e.pointerId, e.clientX);
    if (punteros.size === 1) { arrastre = { x: e.clientX, a, b, ppm: pxPorMetro() }; movido = false; }
    if (punteros.size === 2) { const xs = [...punteros.values()]; arrastre = { pinch: Math.abs(xs[0] - xs[1]) || 1, a, b, c: xDato((xs[0] + xs[1]) / 2) }; }
  });
  cont.addEventListener('pointermove', (e) => {
    if (!punteros.has(e.pointerId) || !arrastre) return;
    punteros.set(e.pointerId, e.clientX);
    if (punteros.size >= 2 && arrastre.pinch) {
      const xs = [...punteros.values()]; const d = Math.abs(xs[0] - xs[1]) || 1;
      const f = arrastre.pinch / d; a = arrastre.c - (arrastre.c - arrastre.a) * f; b = arrastre.c + (arrastre.b - arrastre.c) * f;
      movido = true; limitar(); pintar(); return;
    }
    const dx = e.clientX - arrastre.x;
    if (Math.abs(dx) > 4) movido = true;
    if (!movido || !estado.ventana) return;
    const dm = dx / arrastre.ppm; a = arrastre.a - dm; b = arrastre.b - dm; limitar(); pintar();
    cont.classList.add('arrastrando');
  });
  const soltar = (e) => { punteros.delete(e.pointerId); if (!punteros.size) { arrastre = null; cont.classList.remove('arrastrando'); } };
  cont.addEventListener('pointerup', soltar); cont.addEventListener('pointercancel', soltar); cont.addEventListener('pointerleave', soltar);
  // un arrastre no debe contar como clic (p. ej. para «colocar poste»)
  cont.addEventListener('click', (e) => { if (movido) { e.stopPropagation(); e.preventDefault(); movido = false; } }, true);

  limitar(); dibujar();
  return {
    acercar: () => zoom(0.6),
    alejar: () => zoom(1 / 0.6),
    todo: () => { a = X0; b = X1; limitar(); pintar(); },
  };
}
