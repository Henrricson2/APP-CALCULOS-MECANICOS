// Gráfica del perfil (plantillado) en SVG. Se adapta al ancho de pantalla
// (el tamaño de texto se mantiene legible en celular).

const C = {
  conductor: '#1f6fb2', frio: '#7fb6df', terreno: '#a07c4a', terrenoFill: '#efe4d3',
  dmin: '#c84c4c', poste: '#33475a', apoyo: '#c84c4c', grid: '#e3eaef', texto: '#263746', muted: '#657684',
};

export const abscisaK = (m) => `K${Math.floor(m / 1000)}+${(m % 1000).toFixed(2).padStart(6, '0')}`;

function interp(xs, ys, x) {
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

export function dibujarPerfil(contenedor, perfil, inicio, fin, opciones = {}) {
  const anchoPx = Math.max(320, contenedor.clientWidth || 900);
  const movil = anchoPx < 640;
  const W = Math.min(Math.max(anchoPx, 340), 1500);
  const H = Math.round(movil ? W * 0.9 : Math.max(380, W * 0.42));
  const M = { l: movil ? 46 : 60, r: movil ? 30 : 44, t: 30, b: movil ? 58 : 46 };
  const fs = movil ? 10.5 : 11.5;

  const ap = perfil.apoyos.slice(inicio, fin + 1);
  const vanos = perfil.vanos.slice(inicio, fin);
  const x0 = ap[0].x, x1 = ap[ap.length - 1].x;
  const ter = perfil.terreno;

  // terreno dentro del rango
  let tx = [], ty = [];
  if (ter) {
    tx.push(x0); ty.push(interp(ter.x, ter.y, x0));
    ter.x.forEach((x, i) => { if (x > x0 && x < x1) { tx.push(x); ty.push(ter.y[i]); } });
    tx.push(x1); ty.push(interp(ter.x, ter.y, x1));
  }

  const ys = [];
  vanos.forEach((v) => { ys.push(...v.y); if (perfil.modo === 'cambio_estado') ys.push(...v.yf); });
  ap.forEach((a) => { ys.push(a.ya); if (ter) ys.push(a.yt); });
  ty.forEach((y) => { ys.push(y); ys.push(y + perfil.dmin); });
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  const marg = Math.max(2, 0.1 * (yMax - yMin));
  yMin -= marg; yMax += marg * 1.6;

  const sx = (x) => M.l + (x - x0) / (x1 - x0 || 1) * (W - M.l - M.r);
  const sy = (y) => H - M.b - (y - yMin) / (yMax - yMin || 1) * (H - M.t - M.b);
  const pts = (xs, yv) => xs.map((x, i) => `${sx(x).toFixed(1)},${sy(yv[i]).toFixed(1)}`).join(' ');

  const p = [];
  p.push(`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Perfil de la línea, vanos ${inicio + 1} a ${fin}" font-family="Inter, system-ui, Segoe UI, sans-serif">`);
  // rejilla Y
  const paso = pasoBonito(yMax - yMin, movil ? 5 : 7);
  for (let y = Math.ceil(yMin / paso) * paso; y <= yMax; y += paso) {
    p.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${sy(y)}" y2="${sy(y)}" stroke="${C.grid}"/>`);
    p.push(`<text x="${M.l - 6}" y="${sy(y) + 4}" text-anchor="end" font-size="${fs - 1}" fill="${C.muted}">${+y.toFixed(2)}</text>`);
  }
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
  // apoyos, nombres y abscisas (sin solapes; el último apoyo siempre se rotula)
  const minSep = movil ? 46 : 64;
  const rot = [];
  ap.forEach((a, k) => { const cx = sx(a.x); if (!rot.length || cx - sx(ap[rot[rot.length - 1]].x) >= minSep) rot.push(k); });
  const ultimo = ap.length - 1;
  if (rot[rot.length - 1] !== ultimo) {
    while (rot.length > 1 && sx(ap[ultimo].x) - sx(ap[rot[rot.length - 1]].x) < minSep) rot.pop();
    rot.push(ultimo);
  }
  const rotular = new Set(rot);
  ap.forEach((a, k) => {
    const i = inicio + k; const cx = sx(a.x), cy = sy(a.ya);
    const ret = a.tipo === 'Retención';
    p.push(ret ? `<rect x="${cx - 5}" y="${cy - 5}" width="10" height="10" fill="${C.apoyo}"/>`
      : `<circle cx="${cx}" cy="${cy}" r="5" fill="${C.apoyo}"/>`);
    if (a.arranc) p.push(`<text x="${cx + 8}" y="${cy + 4}" font-size="${fs + 1}" fill="${C.dmin}" font-weight="800">▲</text>`);
    if (rotular.has(k)) {
      const anc = cx > W - M.r - 24 ? 'end' : (cx < M.l + 24 ? 'start' : 'middle');
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
  p.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}" stroke="${C.muted}"/>`);
  p.push(`<text x="${M.l}" y="${M.t - 12}" font-size="${fs}" font-weight="700" fill="${C.texto}">Cota (m)</text>`);
  p.push('</svg>');

  contenedor.innerHTML = p.join('') + '<div class="tip" hidden></div>';
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
