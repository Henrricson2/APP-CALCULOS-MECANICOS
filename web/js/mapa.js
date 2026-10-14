// Vista en planta interactiva con dos motores y la misma interfaz:
//   - PlantaSVG: dibujo vectorial propio en coordenadas MAGNA-SIRGAS Origen Nacional
//     (siempre disponible, sin internet ni claves).
//   - PlantaGoogle: Google Maps satelital (requiere clave de Google Maps Platform).
//   - PlantaLeaflet: satélite GRATIS con Leaflet (la librería de Folium) + Esri World Imagery / OSM.
// Eventos (opciones): onSelect(i), onMove(i, punto), onInsert(i, punto) -> inserta entre i e i+1,
// onAdd(punto), onMedir(a, b) -> Promise<metros>.  punto = {E, N} (planta) o {lat, lon} (Google).

const COL = { linea: '#e9783f', sus: '#1f6fb2', ret: '#c84c4c', sel: '#e8b44c', bloq: '#657684', texto: '#17324d' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

function pasoBonito(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 2, 5, 10]) if (v <= k * p) return k * p;
  return 10 * p;
}

// ===================================================================== SVG
export class PlantaSVG {
  constructor(cont, op) {
    this.cont = cont; this.op = op; this.tipo = 'planta';
    this.postes = []; this.sel = -1; this.modo = 'mover'; this.etiquetas = true; this.coords = false;
    this.s = 1; this.cE = 0; this.cN = 0; this.medida = null;
    cont.innerHTML = '<svg class="planta-svg" xmlns="http://www.w3.org/2000/svg"></svg><div class="planta-info"></div>';
    this.svg = cont.querySelector('svg'); this.info = cont.querySelector('.planta-info');
    this._eventos();
    this._ro = new ResizeObserver(() => this.dibujar()); this._ro.observe(cont);
  }
  destruir() { this._ro.disconnect(); this.cont.innerHTML = ''; }
  get W() { return this.cont.clientWidth || 800; }
  get H() { return this.cont.clientHeight || 500; }
  aPant(E, N) { return [this.W / 2 + (E - this.cE) * this.s, this.H / 2 - (N - this.cN) * this.s]; }
  aMundo(x, y) { return [this.cE + (x - this.W / 2) / this.s, this.cN - (y - this.H / 2) / this.s]; }

  setPostes(postes, sel = -1, ajustar = false) {
    this.postes = postes; this.sel = sel;
    if (ajustar || !this._ajustado) { this.ajustar(); this._ajustado = true; } else this.dibujar();
  }
  setModo(m) { this.modo = m; this.medida = null; this.cont.dataset.modo = m; this.dibujar(); }
  setCapas({ etiquetas, coords }) { if (etiquetas != null) this.etiquetas = etiquetas; if (coords != null) this.coords = coords; this.dibujar(); }
  enfocar(i) {
    const p = this.postes[i]; if (!p || p.E == null) return;
    this.cE = p.E; this.cN = p.N; this.dibujar();
  }
  ajustar() {
    const v = this.postes.filter((p) => p.E != null);
    if (!v.length) { this.dibujar(); return; }
    const Es = v.map((p) => p.E), Ns = v.map((p) => p.N);
    const e0 = Math.min(...Es), e1 = Math.max(...Es), n0 = Math.min(...Ns), n1 = Math.max(...Ns);
    this.cE = (e0 + e1) / 2; this.cN = (n0 + n1) / 2;
    this.s = Math.min((this.W - 80) / Math.max(e1 - e0, 20), (this.H - 80) / Math.max(n1 - n0, 20));
    this.dibujar();
  }

  dibujar() {
    const W = this.W, H = this.H, s = this.s, out = [];
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    // rejilla en coordenadas Origen Nacional
    const paso = pasoBonito(120 / s);
    const [eA, nB] = this.aMundo(0, H), [eB, nA] = this.aMundo(W, 0);
    out.push('<g class="rejilla">');
    for (let e = Math.ceil(eA / paso) * paso; e <= eB; e += paso) {
      const [x] = this.aPant(e, 0);
      out.push(`<line x1="${x}" x2="${x}" y1="0" y2="${H}"/><text x="${x + 3}" y="${H - 6}">E ${Math.round(e).toLocaleString('es-CO')}</text>`);
    }
    for (let n = Math.ceil(nB / paso) * paso; n <= nA; n += paso) {
      const [, y] = this.aPant(0, n);
      out.push(`<line x1="0" x2="${W}" y1="${y}" y2="${y}"/><text x="4" y="${y - 3}">N ${Math.round(n).toLocaleString('es-CO')}</text>`);
    }
    out.push('</g>');
    // trazado
    const v = this.postes.map((p, i) => ({ p, i })).filter((o) => o.p.E != null);
    for (let k = 0; k < v.length - 1; k++) {
      const [x1, y1] = this.aPant(v[k].p.E, v[k].p.N), [x2, y2] = this.aPant(v[k + 1].p.E, v[k + 1].p.N);
      out.push(`<line class="seg" data-seg="${v[k].i}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COL.linea}" stroke-width="3"/>`);
    }
    // postes
    for (const { p, i } of v) {
      const [x, y] = this.aPant(p.E, p.N);
      const color = i === this.sel ? COL.sel : p.tipo === 'R' ? COL.ret : COL.sus;
      const forma = p.tipo === 'R' ? `<rect x="${x - 7}" y="${y - 7}" width="14" height="14"` : `<circle cx="${x}" cy="${y}" r="7"`;
      out.push(`<g class="poste${p.bloqueado ? ' bloq' : ''}" data-i="${i}">${forma} fill="${color}" stroke="#fff" stroke-width="2"/>`);
      if (p.bloqueado) out.push(`<text x="${x + 9}" y="${y + 13}" class="candado">🔒</text>`);
      if (this.etiquetas) out.push(`<text x="${x + 10}" y="${y - 8}" class="etq">${esc(p.nombre)}</text>`);
      if (this.coords) out.push(`<text x="${x + 10}" y="${y + 6}" class="etq2">${p.lat?.toFixed(6)}, ${p.lon?.toFixed(6)}</text>`);
      out.push(`<circle cx="${x}" cy="${y}" r="15" fill="transparent"/></g>`);
    }
    if (this.medida?.a) {
      const [x1, y1] = this.aPant(...this.medida.a);
      const b = this.medida.b || this.medida.cursor;
      if (b) {
        const [x2, y2] = this.aPant(...b);
        out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COL.texto}" stroke-width="2" stroke-dasharray="6 4"/>`);
        if (this.medida.texto) out.push(`<text x="${(x1 + x2) / 2 + 8}" y="${(y1 + y2) / 2 - 8}" class="medida">${esc(this.medida.texto)}</text>`);
      }
      out.push(`<circle cx="${x1}" cy="${y1}" r="4" fill="${COL.texto}"/>`);
    }
    // escala y norte
    const barra = pasoBonito(100 / s), bp = barra * s;
    out.push(`<g class="escala" transform="translate(${W - bp - 24},${H - 30})"><rect x="-6" y="-16" width="${bp + 12}" height="26" rx="5"/><line x1="0" x2="${bp}" y1="0" y2="0"/><line x1="0" x2="0" y1="-4" y2="4"/><line x1="${bp}" x2="${bp}" y1="-4" y2="4"/><text x="${bp / 2}" y="-5">${barra >= 1000 ? barra / 1000 + ' km' : barra + ' m'}</text></g>`);
    out.push(`<g class="norte" transform="translate(${W - 30},34)"><path d="M0 -16 L7 6 L0 2 L-7 6 Z"/><text y="20">N</text></g>`);
    this.svg.innerHTML = out.join('');
    this.info.textContent = 'MAGNA-SIRGAS Origen Nacional · vista sin fondo';
  }

  _evPos(ev) { const r = this.svg.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
  _eventos() {
    const ptrs = new Map(); let arrastre = null, pan = null, pinch = null, movido = false;
    this.svg.addEventListener('pointerdown', (ev) => {
      this.svg.setPointerCapture(ev.pointerId); ptrs.set(ev.pointerId, this._evPos(ev)); movido = false;
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: this.s }; arrastre = pan = null; return; }
      const g = ev.target.closest('.poste');
      if (g && this.modo === 'mover') {
        const i = +g.dataset.i; this.op.onSelect?.(i);
        if (!this.postes[i].bloqueado) arrastre = { i, E: this.postes[i].E, N: this.postes[i].N };
      } else pan = { pos: this._evPos(ev), cE: this.cE, cN: this.cN, target: ev.target };
    });
    this.svg.addEventListener('pointermove', (ev) => {
      const pos = this._evPos(ev);
      if (ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, pos);
      if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; this.s = pinch.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d; this.dibujar(); return; }
      if (arrastre) {
        movido = true; const [E, N] = this.aMundo(...pos);
        this.postes[arrastre.i] = { ...this.postes[arrastre.i], E, N }; this.dibujar(); return;
      }
      if (pan) {
        const dx = pos[0] - pan.pos[0], dy = pos[1] - pan.pos[1];
        if (Math.abs(dx) + Math.abs(dy) > 3) movido = true;
        this.cE = pan.cE - dx / this.s; this.cN = pan.cN + dy / this.s; this.dibujar(); return;
      }
      if (this.modo === 'medir' && this.medida?.a && !this.medida.b) { this.medida.cursor = this.aMundo(...pos); this.dibujar(); }
    });
    const fin = (ev) => {
      ptrs.delete(ev.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (arrastre) {
        const p = this.postes[arrastre.i];
        if (movido) this.op.onMove?.(arrastre.i, { E: p.E, N: p.N });
        arrastre = null; return;
      }
      if (pan) { const t = pan.target; pan = null; if (!movido) this._click(this._evPos(ev), t); }
    };
    this.svg.addEventListener('pointerup', fin);
    this.svg.addEventListener('pointercancel', fin);
    this.svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const pos = this._evPos(ev), [E, N] = this.aMundo(...pos);
      this.s *= ev.deltaY < 0 ? 1.2 : 1 / 1.2;
      this.cE = E - (pos[0] - this.W / 2) / this.s; this.cN = N + (pos[1] - this.H / 2) / this.s;
      this.dibujar();
    }, { passive: false });
  }
  _click(pos, target) {
    const [E, N] = this.aMundo(...pos);
    const g = target?.closest?.('.poste');
    if (this.modo === 'mover' || this.modo === 'seleccionar') { this.op.onSelect?.(g ? +g.dataset.i : -1); return; }
    if (this.modo === 'agregar') { this.op.onAdd?.({ E, N }); return; }
    if (this.modo === 'insertar') {
      let mejor = { d: 14, i: -1 };
      const v = this.postes.map((p, i) => ({ p, i })).filter((o) => o.p.E != null);
      for (let k = 0; k < v.length - 1; k++) {
        const a = this.aPant(v[k].p.E, v[k].p.N), b = this.aPant(v[k + 1].p.E, v[k + 1].p.N);
        const r = distSeg(pos[0], pos[1], ...a, ...b);
        if (r.d < mejor.d) mejor = { d: r.d, i: v[k].i };
      }
      if (mejor.i >= 0) this.op.onInsert?.(mejor.i, { E, N });
      else this.op.onAviso?.('Toque sobre un vano (línea naranja) para insertar un poste.');
      return;
    }
    if (this.modo === 'medir') {
      if (!this.medida || this.medida.b) { this.medida = { a: [E, N] }; this.dibujar(); return; }
      this.medida.b = [E, N];
      const plano = Math.hypot(E - this.medida.a[0], N - this.medida.a[1]);
      this.medida.texto = `${plano.toFixed(2)} m (plano)`; this.dibujar();
      Promise.resolve(this.op.onMedir?.({ E: this.medida.a[0], N: this.medida.a[1] }, { E, N })).then((m) => {
        if (m != null && this.medida) { this.medida.texto = `${m.toFixed(2)} m (geodésica)`; this.dibujar(); }
      });
    }
  }
}

// ===================================================================== Google Maps
let cargaGoogle = null;
export function cargarGoogle(clave) {
  if (window.google?.maps?.Map) return Promise.resolve();
  if (cargaGoogle) return cargaGoogle;
  cargaGoogle = new Promise((ok, mal) => {
    window.__gmOk = () => ok();
    window.gm_authFailure = () => mal(new Error('Google rechazó la clave de Google Maps (verifique la clave y las restricciones).'));
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(clave)}&v=weekly&language=es&region=CO&callback=__gmOk`;
    s.async = true; s.onerror = () => { cargaGoogle = null; mal(new Error('No se pudo cargar Google Maps (¿sin internet?).')); };
    document.head.appendChild(s);
  });
  return cargaGoogle;
}

export class PlantaGoogle {
  constructor(cont, op) {
    this.cont = cont; this.op = op; this.tipo = 'google';
    this.postes = []; this.sel = -1; this.modo = 'mover'; this.etiquetas = true; this.marcas = []; this.medida = null;
    cont.innerHTML = '<div class="gmapa"></div><div class="planta-info">Google Maps · satélite</div>';
    const g = window.google.maps;
    this.mapa = new g.Map(cont.querySelector('.gmapa'), {
      center: { lat: 2.9273, lng: -75.2819 }, zoom: 15, mapTypeId: 'hybrid', tilt: 0,
      streetViewControl: false, fullscreenControl: true, gestureHandling: 'greedy',
    });
    this.linea = new g.Polyline({ map: this.mapa, strokeColor: COL.linea, strokeWeight: 4, clickable: true });
    this.lineaMed = new g.Polyline({ map: this.mapa, strokeColor: '#ffffff', strokeWeight: 2, strokeOpacity: 0.9, clickable: false });
    this.etqMed = new g.InfoWindow();
    this.mapa.addListener('click', (e) => this._click(e.latLng, -1));
    this.linea.addListener('click', (e) => this._click(e.latLng, 'linea'));
  }
  destruir() { this.marcas.forEach((m) => m.setMap(null)); this.linea.setMap(null); this.cont.innerHTML = ''; }
  setModo(m) { this.modo = m; this.medida = null; this.lineaMed.setPath([]); this.etqMed.close(); this._marcas(); }
  setCapas({ etiquetas }) { if (etiquetas != null) { this.etiquetas = etiquetas; this._marcas(); } }
  setPostes(postes, sel = -1, ajustar = false) {
    this.postes = postes; this.sel = sel; this._marcas();
    this.linea.setPath(postes.filter((p) => p.lat != null).map((p) => ({ lat: p.lat, lng: p.lon })));
    if (ajustar || !this._ajustado) { this.ajustar(); this._ajustado = true; }
  }
  ajustar() {
    const v = this.postes.filter((p) => p.lat != null); if (!v.length) return;
    const b = new window.google.maps.LatLngBounds(); v.forEach((p) => b.extend({ lat: p.lat, lng: p.lon }));
    this.mapa.fitBounds(b, 40);
  }
  enfocar(i) { const p = this.postes[i]; if (p?.lat != null) this.mapa.panTo({ lat: p.lat, lng: p.lon }); }
  dibujar() { this._marcas(); }
  _marcas() {
    const g = window.google.maps;
    this.marcas.forEach((m) => m.setMap(null)); this.marcas = [];
    this.postes.forEach((p, i) => {
      if (p.lat == null) return;
      const color = i === this.sel ? COL.sel : p.tipo === 'R' ? COL.ret : COL.sus;
      const m = new g.Marker({
        map: this.mapa, position: { lat: p.lat, lng: p.lon }, draggable: this.modo === 'mover' && !p.bloqueado,
        title: `${p.nombre}${p.bloqueado ? ' (bloqueado)' : ''}`,
        label: this.etiquetas ? { text: String(p.nombre), color: '#ffffff', fontSize: '11px', fontWeight: '700' } : null,
        icon: { path: p.tipo === 'R' ? 'M -6 -6 L 6 -6 L 6 6 L -6 6 Z' : g.SymbolPath.CIRCLE, scale: p.tipo === 'R' ? 1 : 7,
          fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, labelOrigin: new g.Point(0, -16) },
      });
      m.addListener('click', () => { if (this.modo === 'medir') this._click(m.getPosition(), i); else this.op.onSelect?.(i); });
      m.addListener('dragend', (e) => this.op.onMove?.(i, { lat: e.latLng.lat(), lon: e.latLng.lng() }));
      this.marcas.push(m);
    });
  }
  _click(ll, origen) {
    const pt = { lat: ll.lat(), lon: ll.lng() };
    if (this.modo === 'agregar' && origen !== 'linea') return this.op.onAdd?.(pt);
    if (this.modo === 'insertar') {
      const v = this.postes.map((p, i) => ({ p, i })).filter((o) => o.p.lat != null);
      const k = Math.cos(pt.lat * Math.PI / 180); let mejor = { d: Infinity, i: -1 };
      for (let j = 0; j < v.length - 1; j++) {
        const r = distSeg(pt.lon * k, pt.lat, v[j].p.lon * k, v[j].p.lat, v[j + 1].p.lon * k, v[j + 1].p.lat);
        if (r.d < mejor.d) mejor = { d: r.d, i: v[j].i };
      }
      if (mejor.i >= 0 && mejor.d < 0.0006) return this.op.onInsert?.(mejor.i, pt);
      return this.op.onAviso?.('Toque sobre un vano (línea naranja) para insertar un poste.');
    }
    if (this.modo === 'medir') {
      if (!this.medida || this.medida.b) { this.medida = { a: pt }; this.lineaMed.setPath([{ lat: pt.lat, lng: pt.lon }]); this.etqMed.close(); return; }
      this.medida.b = pt;
      this.lineaMed.setPath([{ lat: this.medida.a.lat, lng: this.medida.a.lon }, { lat: pt.lat, lng: pt.lon }]);
      Promise.resolve(this.op.onMedir?.(this.medida.a, pt)).then((m) => {
        if (m == null) return;
        this.etqMed.setContent(`<b>${m.toFixed(2)} m</b> (geodésica)`); this.etqMed.setPosition({ lat: pt.lat, lng: pt.lon }); this.etqMed.open(this.mapa);
      });
      return;
    }
    if (origen === -1) this.op.onSelect?.(-1);
  }
}

// ===================================================================== Leaflet (gratis)
// Leaflet es la librería JavaScript que usa Folium (Python) por dentro. Fondos sin clave:
// Esri World Imagery (satélite), OpenStreetMap y OpenTopoMap, con su atribución obligatoria.
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
let cargaLeaflet = null;
export function cargarLeaflet() {
  if (window.L?.map) return Promise.resolve();
  if (cargaLeaflet) return cargaLeaflet;
  cargaLeaflet = new Promise((ok, mal) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = LEAFLET + 'leaflet.js';
    s.onload = () => ok();
    s.onerror = () => { cargaLeaflet = null; mal(new Error('No se pudo cargar Leaflet (¿sin internet?). Use la planta sin fondo.')); };
    document.head.appendChild(s);
  });
  return cargaLeaflet;
}

export const FONDOS_GRATIS = {
  satelite: { nombre: 'Satélite (Esri World Imagery)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 19,
    attr: 'Imágenes &copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics y la comunidad de usuarios SIG' },
  calles: { nombre: 'Calles (OpenStreetMap)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19,
    attr: '&copy; colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  topo: { nombre: 'Topográfico (OpenTopoMap)', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', max: 17,
    attr: 'Mapa &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), datos &copy; OpenStreetMap' },
};

export class PlantaLeaflet {
  constructor(cont, op) {
    const L = window.L;
    this.cont = cont; this.op = op; this.tipo = 'leaflet';
    this.postes = []; this.sel = -1; this.modo = 'mover'; this.etiquetas = true; this.coords = false; this.marcas = []; this.medida = null;
    cont.innerHTML = '<div class="gmapa"></div>';
    this.mapa = L.map(cont.querySelector('.gmapa'), { zoomControl: true, maxZoom: 20 }).setView([2.9273, -75.2819], 15);
    const capas = {};
    for (const [k, f] of Object.entries(FONDOS_GRATIS)) {
      capas[f.nombre] = L.tileLayer(f.url, { maxZoom: 20, maxNativeZoom: f.max, attribution: f.attr, subdomains: 'abc' });
    }
    capas[FONDOS_GRATIS.satelite.nombre].addTo(this.mapa);
    this.etqSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 20, maxNativeZoom: 19, attribution: 'Etiquetas &copy; Esri' }).addTo(this.mapa);
    L.control.layers(capas, { 'Nombres y límites (Esri)': this.etqSat }, { position: 'topright' }).addTo(this.mapa);
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(this.mapa);
    this.capaPostes = L.layerGroup().addTo(this.mapa);
    this.linea = L.polyline([], { color: COL.linea, weight: 4 }).addTo(this.mapa);
    this.lineaMed = L.polyline([], { color: '#ffffff', weight: 2, dashArray: '6 4' }).addTo(this.mapa);
    this.mapa.on('click', (e) => this._click(e.latlng, -1));
    this.linea.on('click', (e) => { L.DomEvent.stopPropagation(e); this._click(e.latlng, 'linea'); });
    this._ro = new ResizeObserver(() => this.mapa.invalidateSize()); this._ro.observe(cont);
  }
  destruir() { this._ro.disconnect(); this.mapa.remove(); this.cont.innerHTML = ''; }
  setModo(m) { this.modo = m; this.medida = null; this.lineaMed.setLatLngs([]); this.mapa.closePopup(); this.cont.dataset.modo = m; this._marcas(); }
  setCapas({ etiquetas, coords }) { if (etiquetas != null) this.etiquetas = etiquetas; if (coords != null) this.coords = coords; this._marcas(); }
  setPostes(postes, sel = -1, ajustar = false) {
    this.postes = postes; this.sel = sel; this._marcas();
    this.linea.setLatLngs(postes.filter((p) => p.lat != null).map((p) => [p.lat, p.lon]));
    if (ajustar || !this._ajustado) { this.ajustar(); this._ajustado = true; }
  }
  ajustar() {
    const v = this.postes.filter((p) => p.lat != null); if (!v.length) return;
    this.mapa.fitBounds(window.L.latLngBounds(v.map((p) => [p.lat, p.lon])), { padding: [40, 40], maxZoom: 18 });
  }
  enfocar(i) { const p = this.postes[i]; if (p?.lat != null) this.mapa.panTo([p.lat, p.lon]); }
  dibujar() { this._marcas(); }
  _marcas() {
    const L = window.L;
    this.capaPostes.clearLayers();
    this.postes.forEach((p, i) => {
      if (p.lat == null) return;
      const color = i === this.sel ? COL.sel : p.tipo === 'R' ? COL.ret : COL.sus;
      const forma = p.tipo === 'R' ? 'border-radius:2px' : 'border-radius:50%';
      const etq = [this.etiquetas ? esc(p.nombre) : '', this.coords ? `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}` : ''].filter(Boolean).join('<br>');
      const icon = L.divIcon({ className: 'lf-poste', iconSize: [16, 16], iconAnchor: [8, 8],
        html: `<span class="lf-punto" style="background:${color};${forma}"></span>${p.bloqueado ? '<span class="lf-candado">🔒</span>' : ''}${etq ? `<span class="lf-etq">${etq}</span>` : ''}` });
      const m = L.marker([p.lat, p.lon], { icon, draggable: this.modo === 'mover' && !p.bloqueado, title: p.nombre, keyboard: false });
      m.on('click', (e) => { L.DomEvent.stopPropagation(e); if (this.modo === 'medir') this._click(e.latlng, i); else this.op.onSelect?.(i); });
      m.on('dragend', (e) => { const ll = e.target.getLatLng(); this.op.onMove?.(i, { lat: ll.lat, lon: ll.lng }); });
      m.addTo(this.capaPostes);
    });
  }
  _click(ll, origen) {
    const pt = { lat: ll.lat, lon: ll.lng };
    if (this.modo === 'agregar' && origen !== 'linea') return this.op.onAdd?.(pt);
    if (this.modo === 'insertar') {
      const v = this.postes.map((p, i) => ({ p, i })).filter((o) => o.p.lat != null);
      const a = this.mapa.latLngToContainerPoint(ll); let mejor = { d: 14, i: -1 };
      for (let j = 0; j < v.length - 1; j++) {
        const p1 = this.mapa.latLngToContainerPoint([v[j].p.lat, v[j].p.lon]), p2 = this.mapa.latLngToContainerPoint([v[j + 1].p.lat, v[j + 1].p.lon]);
        const r = distSeg(a.x, a.y, p1.x, p1.y, p2.x, p2.y);
        if (r.d < mejor.d) mejor = { d: r.d, i: v[j].i };
      }
      if (mejor.i >= 0) return this.op.onInsert?.(mejor.i, pt);
      return this.op.onAviso?.('Toque sobre un vano (línea naranja) para insertar un poste.');
    }
    if (this.modo === 'medir') {
      if (!this.medida || this.medida.b) { this.medida = { a: pt }; this.lineaMed.setLatLngs([[pt.lat, pt.lon]]); this.mapa.closePopup(); return; }
      this.medida.b = pt;
      this.lineaMed.setLatLngs([[this.medida.a.lat, this.medida.a.lon], [pt.lat, pt.lon]]);
      Promise.resolve(this.op.onMedir?.(this.medida.a, pt)).then((d) => {
        if (d != null) window.L.popup().setLatLng([pt.lat, pt.lon]).setContent(`<b>${d.toFixed(2)} m</b> (geodésica)`).openOn(this.mapa);
      });
      return;
    }
    if (origen === -1) this.op.onSelect?.(-1);
  }
}
