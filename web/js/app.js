// App Cálculos Mecánicos MT — interfaz PWA (PC, web y celular).
import { detectarMotor } from './motor.js?v=6';
import { dibujarPerfil, paginas, abscisaK } from './perfil.js?v=6';
import { instalarGeo } from './geo-ui.js?v=6';

const CLAVE = 'cm-proyecto-v2';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 2) => (v == null || v === '' || Number.isNaN(+v)) ? '—' : (+v).toLocaleString('es-CO', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const num = (v) => { if (v == null) return null; const s = String(v).trim().replace(',', '.'); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };

const TITULOS = { resumen: 'Resumen', datos: 'Estructuras y mapa', parametros: 'Parámetros', perfil: 'Perfil / plantillado', resultados: 'Resultados', advertencias: 'Advertencias', exportar: 'Exportar', acerca: 'Normas y ayuda' };

const S = {
  vista: 'resumen', defaults: null, proyecto: null, apoyos: [], terreno: [], conductores: {},
  resultado: null, desactualizado: false, pagina: 0, tabRes: 'vanos', motor: null, archivo: '',
};

// ------------------------------------------------------------------ util UI
function toast(msg, tipo = '') {
  const t = document.createElement('div');
  t.className = `toast ${tipo}`; t.textContent = msg;
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), tipo === 'error' ? 7000 : 3800);
}
function modal(titulo, cuerpo, pie = '') {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>${h(titulo)}</h2><button class="modal-close" aria-label="Cerrar">×</button></div><div class="modal-body">${cuerpo}</div>${pie ? `<div class="modal-foot">${pie}</div>` : ''}</div>`;
  root.hidden = false;
  const cerrar = () => { root.hidden = true; root.innerHTML = ''; };
  $('.modal-close', root).onclick = cerrar;
  root.onclick = (e) => { if (e.target === root) cerrar(); };
  return { root, cerrar };
}
let loaderEl;
function cargando(msg) {
  if (!loaderEl) { loaderEl = document.createElement('div'); loaderEl.className = 'loader'; document.body.appendChild(loaderEl); }
  if (!msg) { loaderEl.hidden = true; return; }
  loaderEl.innerHTML = `<div class="loader-box"><div class="spinner"></div><div>${h(msg)}</div></div>`;
  loaderEl.hidden = false;
}
function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const clon = (o) => JSON.parse(JSON.stringify(o));

// --------------------------------------------------------------- persistencia
function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify({ proyecto: S.proyecto, apoyos: S.apoyos, terreno: S.terreno, archivo: S.archivo, meta: S.meta })); } catch { /* sin almacenamiento */ }
}
function restaurar() {
  try { const d = JSON.parse(localStorage.getItem(CLAVE) || 'null'); if (d && d.proyecto) return d; } catch { /* nada */ }
  return null;
}
function marcarCambio() { if (S.resultado) S.desactualizado = true; guardar(); actualizarCabecera(); }
function payload() { return { proyecto: S.proyecto, apoyos: S.apoyos, terreno: S.terreno, origen: S.archivo || 'web' }; }

// ------------------------------------------------------------------ motor
async function asegurarMotor() {
  if (S.motor.tipo === 'navegador' && !S.motor.py) {
    try { await S.motor.listo(); } catch (e) {
      cargando(''); modal('No se pudo cargar Python en el navegador',
        `<p>${h(e.message)}</p><p class="muted small">La primera vez se necesita internet para descargar Pyodide (~40 MB). Alternativa: ejecute <code>INICIAR_APP.bat</code> en el PC.</p>`);
      throw e;
    }
    pintarMotor();
  }
}
function pintarMotor() {
  const chip = $('#engine-chip'), dot = $('#motor-dot'), txt = $('#motor-texto');
  if (S.motor.tipo === 'servidor') {
    chip.className = 'engine-chip ok'; chip.innerHTML = `● <span class="txt">Servidor Python</span>`;
    dot.className = 'status-dot ok'; txt.textContent = `Motor Python v${S.motor.version} (servidor)`;
  } else if (S.motor.py) {
    chip.className = 'engine-chip ok'; chip.innerHTML = `● <span class="txt">Python en el navegador</span>`;
    dot.className = 'status-dot ok'; txt.textContent = `Motor Python v${S.motor.version} (navegador)`;
  } else {
    chip.className = 'engine-chip warn'; chip.innerHTML = `○ <span class="txt">Python en navegador (se carga al calcular)</span>`;
    dot.className = 'status-dot'; txt.textContent = 'Modo web: Python se carga al primer cálculo';
  }
}

// ------------------------------------------------------------- acciones
async function calcular({ irA } = {}) {
  if (S.apoyos.length < 2) { toast('Ingrese o importe al menos 2 apoyos.', 'warn'); ir('datos'); return; }
  const btn = $('#btn-calcular'); btn.classList.add('loading');
  try {
    cargando(S.motor.tipo === 'navegador' && !S.motor.py ? 'Preparando Python en el navegador…' : 'Calculando…');
    await asegurarMotor();
    cargando('Calculando…');
    const r = await S.motor.calcular(payload());
    cargando('');
    if (!r.ok) {
      modal('No se pudo calcular', `<ul class="adv-list">${(r.errores || []).filter(Boolean).map((e) => `<li class="err">✖ ${h(e)}</li>`).join('')}</ul>`);
      return;
    }
    S.resultado = r; S.desactualizado = false; S.pagina = Math.min(S.pagina, Math.max(0, paginas(r.perfil, porPagina()).length - 1));
    const res = r.resumen;
    toast(`Cálculo listo: ${res['Número de vanos']} vanos · ${res['Vanos que no cumplen distancia']} sin distancia · ${res['Apoyos con arrancamiento']} con arrancamiento`, 'success');
    actualizarCabecera();
    ir(irA || (S.vista === 'datos' || S.vista === 'parametros' ? 'resumen' : S.vista), true);
  } catch (e) {
    cargando(''); console.error(e); toast('Error: ' + e.message, 'error');
  } finally { btn.classList.remove('loading'); }
}

async function importarExcel(archivo) {
  if (!archivo) return;
  try {
    cargando(S.motor.tipo === 'navegador' && !S.motor.py ? 'Preparando Python en el navegador…' : 'Leyendo Excel…');
    await asegurarMotor();
    cargando('Leyendo Excel…');
    const r = await S.motor.importar(archivo);
    cargando('');
    if (!r.apoyos) { modal('No se pudo leer el archivo', `<ul class="adv-list">${(r.errores || []).map((e) => `<li class="err">✖ ${h(e)}</li>`).join('')}</ul>`); return; }
    S.apoyos = r.apoyos; S.terreno = r.terreno || []; S.archivo = archivo.name;
    if (r.conductor) { S.proyecto.conductor = { ...S.proyecto.conductor, ...r.conductor }; }
    if (!S.proyecto.nombre || S.proyecto.nombre === S.defaults.nombre) S.proyecto.nombre = archivo.name.replace(/\.[^.]+$/, '');
    S.resultado = null; guardar();
    toast(`${r.apoyos.length} apoyos y ${S.terreno.length} puntos de terreno importados${r.conductor ? ' · conductor leído del archivo' : ''}.`, 'success');
    if (r.errores?.length) toast(r.errores[0], 'warn');
    await calcular({ irA: 'resumen' });
  } catch (e) { cargando(''); toast('Error al importar: ' + e.message, 'error'); }
}

async function exportar(fmt) {
  if (S.apoyos.length < 2) return toast('No hay datos para exportar.', 'warn');
  try {
    cargando(`Generando ${fmt.toUpperCase()}…`);
    await asegurarMotor();
    const { blob, nombre } = await S.motor.exportar(payload(), fmt);
    cargando(''); descargar(blob, nombre); toast(`${nombre} descargado.`, 'success');
  } catch (e) { cargando(''); toast('No se pudo exportar: ' + e.message, 'error'); }
}

function guardarProyecto() {
  const blob = new Blob([JSON.stringify({ app: 'calculos-mecanicos-mt', version: 2, ...payload() }, null, 2)], { type: 'application/json' });
  descargar(blob, `${(S.proyecto.nombre || 'proyecto').replace(/[^\w\-]+/g, '_')}.cmt.json`);
}
async function abrirProyecto(archivo) {
  try {
    const d = JSON.parse(await archivo.text());
    if (!d.proyecto || !Array.isArray(d.apoyos)) throw new Error('El archivo no es un proyecto de esta app.');
    S.proyecto = fusionar(clon(S.defaults), d.proyecto); S.apoyos = d.apoyos; S.terreno = d.terreno || []; S.archivo = archivo.name;
    S.resultado = null; guardar(); toast('Proyecto abierto.', 'success'); await calcular({ irA: 'resumen' });
  } catch (e) { toast(e.message, 'error'); }
}
async function cargarEjemplo() {
  const d = await (await fetch('ejemplo.json')).json();
  S.proyecto = fusionar(clon(S.defaults), d.proyecto); S.apoyos = d.apoyos; S.terreno = d.terreno; S.archivo = 'ejemplo';
  S.resultado = null; guardar(); await calcular({ irA: 'resumen' });
}
function fusionar(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') base[k] = fusionar(base[k], v);
    else base[k] = v;
  }
  return base;
}

// ------------------------------------------------------------- navegación
function ir(vista, forzar = false) {
  if (!S.proyecto) return; // aún iniciando
  if (vista === 'mapa') vista = 'datos'; // la planta ahora está en la misma pestaña que la tabla
  if (!TITULOS[vista]) vista = 'resumen';
  if (S.vista === vista && !forzar && $('#view-container').childElementCount) return;
  S.vista = vista;
  if (location.hash !== '#' + vista) history.replaceState(null, '', '#' + vista);
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === vista));
  $('#breadcrumb-current').textContent = TITULOS[vista];
  cerrarMenu();
  const vc = $('#view-container');
  vc.innerHTML = VISTAS[vista]();
  ENLACES[vista]?.(vc);
  vc.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}
function actualizarCabecera() {
  $('#bc-proyecto').textContent = S.proyecto?.nombre || 'Proyecto';
  const n = S.resultado?.advertencias?.length || 0;
  const badge = $('#nav-adv'); badge.hidden = !n; badge.textContent = n;
  $('#btn-calcular').innerHTML = S.desactualizado ? '↻ Recalcular' : '▶ Calcular';
}
function abrirMenu() { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; }
function cerrarMenu() { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; }
const porPagina = () => Math.max(1, +(S.proyecto?.salida?.vanos_por_pagina) || 5);

function avisoDesactualizado() {
  return S.desactualizado ? `<ul class="adv-list" style="margin-bottom:14px"><li class="info">↻ Cambió los datos o parámetros. Pulse <b>Recalcular</b> para actualizar los resultados.</li></ul>` : '';
}
function sinResultado() {
  return `<div class="card empty"><div class="big">⌒</div><h3>Aún no hay cálculo</h3><p>Importe un Excel o ingrese los apoyos y pulse <b>Calcular</b>.</p>
  <div class="actions" style="justify-content:center;margin-top:14px"><button class="btn btn-primary" data-act="importar">Importar Excel</button><button class="btn" data-act="ejemplo">Cargar ejemplo</button><button class="btn btn-soft" data-act="ir-datos">Ingresar datos</button></div></div>`;
}
function enlazarAcciones(vc) {
  $$('[data-act]', vc).forEach((b) => b.addEventListener('click', () => ACCIONES[b.dataset.act]?.(b)));
}
const ACCIONES = {
  importar: () => $('#file-excel').click(),
  'ir-mapa': () => ir('mapa'),
  'ir-proyectos': () => ir('proyectos'),
  ejemplo: () => cargarEjemplo(),
  'ir-datos': () => ir('datos'),
  'ir-perfil': () => ir('perfil'),
  'ir-adv': () => ir('advertencias'),
  'ir-param': () => ir('parametros'),
  plantilla: async () => { try { cargando('Generando plantilla…'); await asegurarMotor(); const { blob, nombre } = await S.motor.plantilla(); cargando(''); descargar(blob, nombre); } catch (e) { cargando(''); toast(e.message, 'error'); } },
  'guardar-proyecto': guardarProyecto,
  'abrir-proyecto': () => $('#file-json').click(),
  xlsx: () => exportar('xlsx'), pdf: () => exportar('pdf'), dxf: () => exportar('dxf'),
  calcular: () => calcular(),
};

// ================================================================== VISTAS
const VISTAS = {
  resumen() {
    const r = S.resultado;
    if (!r) {
      return `<div class="page-head"><div><h1>Plantillado y cálculo mecánico</h1><p>Catenarias, cambio de estado por vano regulador, distancias de seguridad, gravivano/eolovano y exportación a Excel, PDF y DXF. Hipótesis por defecto según EH-RAA-004 (Electrohuila).</p></div></div>
      <div class="split"><div>${sinResultado()}</div>
      <div class="card"><div class="section-head"><h3>Cómo empezar</h3></div><ol class="steps">
        <li><span><b>Datos:</b> importe su Excel (mismo formato DATOS.xlsx) o descargue la plantilla.</span></li>
        <li><span><b>Parámetros:</b> revise conductor, hipótesis y distancia mínima.</span></li>
        <li><span><b>Calcular</b> y revise el <b>perfil</b> y las <b>advertencias</b>.</span></li>
        <li><span><b>Exportar</b> la memoria (Excel), el plano (PDF) y el DXF 1:1.</span></li></ol>
        <hr class="hr"><button class="btn btn-small" data-act="plantilla">⇩ Descargar plantilla Excel</button></div></div>`;
    }
    const s = r.resumen;
    const nNo = s['Vanos que no cumplen distancia'], nAr = s['Apoyos con arrancamiento'];
    const claveTotal = Object.keys(s).find((k) => k.startsWith('Conductor total'));
    return `${avisoDesactualizado()}<div class="page-head"><div><h1>${h(S.proyecto.nombre)}</h1><p>${h(s['Conductor'])} · modo <b>${h(s['Modo de flecha'])}</b> · ${s['Secciones de tendido']} sección(es) de tendido</p></div>
      <div class="actions"><button class="btn" data-act="ir-perfil">⌒ Ver perfil</button><button class="btn btn-navy" data-act="xlsx">⇩ Excel</button><button class="btn btn-navy" data-act="pdf">⇩ PDF</button><button class="btn btn-navy" data-act="dxf">⇩ DXF</button></div></div>
    <div class="grid grid-4">
      <div class="card stat"><span class="stat-label">Apoyos / vanos</span><span class="stat-value">${s['Número de apoyos']} / ${s['Número de vanos']}</span><span class="stat-note">${s['Secciones de tendido']} secciones de tendido</span></div>
      <div class="card stat"><span class="stat-label">Longitud horizontal</span><span class="stat-value">${nf(s['Longitud horizontal (m)'], 1)}<small>m</small></span><span class="stat-note">Conductor por fase: ${nf(s['Longitud de conductor por fase (m)'], 1)} m</span></div>
      <div class="card stat"><span class="stat-label">${h(claveTotal || 'Conductor total')}</span><span class="stat-value">${nf(s[claveTotal], 0)}<small>m</small></span><span class="stat-note">Cantidad para compra</span></div>
      <div class="card stat"><span class="stat-label">Flecha máxima</span><span class="stat-value">${nf(s['Flecha máxima (m)'], 2)}<small>m</small></span><span class="stat-note">Hipótesis ${h(S.proyecto.hipotesis_plantillado)}</span></div>
      <div class="card stat ${nNo ? 'alert' : 'good'}"><span class="stat-label">Vanos sin distancia mínima</span><span class="stat-value">${nNo}</span><span class="stat-note ${nNo ? 'note-warn' : 'note-good'}">${nNo ? 'Requieren ajuste de apoyos' : (r.perfil.terreno ? 'Todos cumplen' : 'Sin terreno: no verificado')}</span></div>
      <div class="card stat ${nAr ? 'alert' : 'good'}"><span class="stat-label">Apoyos con arrancamiento</span><span class="stat-value">${nAr}</span><span class="stat-note ${nAr ? 'note-warn' : 'note-good'}">${nAr ? 'Gravivano negativo en frío' : 'Ninguno'}</span></div>
      <div class="card stat"><span class="stat-label">Advertencias</span><span class="stat-value">${r.advertencias.length}</span><span class="stat-note"><a href="#advertencias">Ver detalle →</a></span></div>
      <div class="card stat"><span class="stat-label">Motor de cálculo</span><span class="stat-value" style="font-size:16px">${h(S.motor.etiqueta)}</span><span class="stat-note">Python v${h(S.motor.version || '')}</span></div>
    </div>
    <div class="card" style="margin-top:18px"><div class="section-head"><h2>Perfil completo</h2><button class="btn btn-small btn-soft" data-act="ir-perfil">Ver por páginas →</button></div><div class="perfil-wrap" id="perfil-mini"></div></div>`;
  },

  datos() {
    if (!S.apoyos.length || GEO.hayGeo()) return GEO.vistaEstructuras();
    const conFlecha = S.proyecto.modo_flecha === 'excel' || S.apoyos.some((a) => a.flecha != null && a.flecha !== '');
    const filas = S.apoyos.map((a, i) => `<tr data-i="${i}">
      <td class="idx">${i + 1}</td>
      <td><input class="name" data-k="nombre" value="${h(a.nombre)}"></td>
      <td><input data-k="x" inputmode="decimal" value="${h(a.x ?? '')}"></td>
      <td><input data-k="y" inputmode="decimal" value="${h(a.y ?? '')}"></td>
      <td><input data-k="altura" inputmode="decimal" placeholder="—" value="${h(a.altura ?? '')}"></td>
      <td><select data-k="tipo"><option value="S" ${a.tipo !== 'R' ? 'selected' : ''}>Suspensión</option><option value="R" ${a.tipo === 'R' ? 'selected' : ''}>Retención</option></select></td>
      ${conFlecha ? `<td><input data-k="flecha" inputmode="decimal" placeholder="—" value="${h(i === 0 ? '' : (a.flecha ?? ''))}" ${i === 0 ? 'disabled' : ''}></td>` : ''}
      <td><button class="del" title="Eliminar apoyo" data-del="${i}">✕</button></td></tr>`).join('');
    return `<div class="page-head"><div><h1>Estructuras (abscisa / cota)</h1><p>Proyecto sin coordenadas geográficas: un apoyo por fila con abscisa X creciente. Para verlas en el mapa, importe un archivo con coordenadas. Si escribe la <b>altura de amarre</b>, la cota Y se toma como <b>terreno</b> y se verifican las distancias de seguridad. Retención = inicio/fin de sección de tendido.</p></div>
      <div class="actions"><button class="btn btn-primary" data-act="importar">⇪ Importar Excel</button><button class="btn" id="btn-pegar">⎘ Pegar desde Excel</button><button class="btn" data-act="plantilla">⇩ Plantilla</button><button class="btn" data-act="ejemplo">Ejemplo</button></div></div>
    <div class="card"><div class="section-head"><h2>Apoyos <span class="badge">${S.apoyos.length}</span></h2>
      <div class="actions"><button class="btn btn-small btn-soft" id="btn-agregar">＋ Agregar apoyo</button><button class="btn btn-small" id="btn-limpiar">Vaciar</button></div></div>
      ${S.apoyos.length ? `<div class="table-wrap"><table class="grid-edit"><thead><tr><th>#</th><th>Apoyo</th><th>X (m)</th><th>Y cota (m)</th><th>Altura amarre (m)</th><th>Tipo</th>${conFlecha ? '<th>Flecha (m)</th>' : ''}<th></th></tr></thead><tbody>${filas}</tbody></table></div>`
        : `<div class="empty"><div class="big">▤</div><h3>Sin apoyos</h3><p>Importe un Excel, pegue datos o agregue apoyos manualmente.</p></div>`}
    </div>
    <div class="card" style="margin-top:18px"><div class="section-head"><h2>Perfil del terreno <span class="badge">${S.terreno.length} puntos</span></h2>
      <div class="actions"><button class="btn btn-small btn-soft" id="btn-pegar-terreno">⎘ Pegar terreno</button>${S.terreno.length ? '<button class="btn btn-small" id="btn-borrar-terreno">Borrar</button>' : ''}</div></div>
      <p class="muted small" style="margin:0">Opcional. Pares (abscisa, cota) de la topografía entre apoyos. Sin terreno, se interpola entre las cotas de los apoyos (si tienen altura de amarre).</p></div>`;
  },

  parametros() {
    const p = S.proyecto, c = p.conductor, cr = p.criterios;
    const campo = (path, etq, val, ayuda = '', tipo = 'decimal') => `<label class="field-group"><span class="field-label">${etq}</span><input class="input" data-path="${path}" inputmode="${tipo}" value="${h(val ?? '')}">${ayuda ? `<span class="field-help">${ayuda}</span>` : ''}</label>`;
    const hip = Object.entries(p.hipotesis).map(([k, v]) => `<tr><td><b>${k}</b><div class="small muted">${h(v.nombre)}</div></td>
      <td><input class="input" data-path="hipotesis.${k}.temperatura_c" inputmode="decimal" value="${h(v.temperatura_c)}"></td>
      <td><input class="input" data-path="hipotesis.${k}.viento_kmh" inputmode="decimal" value="${h(v.viento_kmh)}"></td>
      <td><input class="input" data-path="hipotesis.${k}.hielo_kgf_m" inputmode="decimal" value="${h(v.hielo_kgf_m)}"></td>
      <td><input class="input" data-path="hipotesis.${k}.limite_fraccion_rotura" data-escala="100" data-nulo="1" inputmode="decimal" placeholder="—" value="${v.limite_fraccion_rotura ? +(v.limite_fraccion_rotura * 100).toFixed(3) : ''}"></td></tr>`).join('');
    const opcCond = Object.keys(S.conductores).map((n) => `<option>${h(n)}</option>`).join('');
    return `<div class="page-head"><div><h1>Parámetros del proyecto</h1><p>Valores por defecto según EH-RAA-004 (0/20/50 °C, viento 100 km/h, q = 0.0042·V², distancia a tierra 5.80 m). El ingeniero responsable debe confirmarlos.</p></div>
      <div class="actions"><button class="btn" data-act="guardar-proyecto">⇩ Guardar proyecto</button><button class="btn" data-act="abrir-proyecto">⇪ Abrir proyecto</button><button class="btn" id="btn-restablecer">Restablecer</button></div></div>
    <div class="stack">
      <div class="card"><div class="section-head"><h2>Mapa satelital (Google Maps)</h2><span class="muted small">${S.motor.tipo === 'servidor' ? 'Se guarda en el servidor para todo el equipo' : 'Se guarda en este navegador'}</span></div>
        <div class="form-grid"><label class="field-group"><span class="field-label">Clave de API de Google Maps (Maps JavaScript API)</span><input class="input" id="gm-key" type="password" autocomplete="off" value="${h(S.config?.google_maps_key || '')}" placeholder="AIza…"><span class="field-help">Créela en Google Cloud Console y restrínjala por sitio (HTTP referrer) a la dirección de esta app. Cupo gratuito: 10 000 cargas de mapa por mes.</span></label>
        <div class="field-group"><span class="field-label">&nbsp;</span><div class="actions"><button class="btn btn-soft" id="gm-guardar">Guardar clave</button><button class="btn" id="gm-ver">Mostrar</button></div></div></div></div>
      <div class="card"><div class="section-head"><h2>Proyecto</h2></div><div class="form-grid cols-3">
        <label class="field-group"><span class="field-label">Nombre del proyecto</span><input class="input" data-path="nombre" data-texto="1" value="${h(p.nombre)}"></label>
        <label class="field-group"><span class="field-label">Modo de flecha</span><select class="select" data-path="modo_flecha" data-texto="1">
          <option value="cambio_estado" ${p.modo_flecha === 'cambio_estado' ? 'selected' : ''}>Cambio de estado (recomendado)</option>
          <option value="excel" ${p.modo_flecha === 'excel' ? 'selected' : ''}>Flechas del Excel (modo original)</option></select></label>
        ${campo('salida.vanos_por_pagina', 'Vanos por página (perfil/PDF)', p.salida.vanos_por_pagina, '', 'numeric')}
      </div></div>
      <div class="card"><div class="section-head"><h2>Conductor</h2><select class="select" id="sel-conductor" style="max-width:280px"><option value="">Biblioteca de conductores…</option>${opcCond}</select></div>
        <div class="form-grid cols-3">
          <label class="field-group"><span class="field-label">Nombre / calibre</span><input class="input" data-path="conductor.nombre" data-texto="1" value="${h(c.nombre)}"></label>
          ${campo('conductor.seccion_mm2', 'Sección (mm²)', c.seccion_mm2)}
          ${campo('conductor.carga_rotura_kgf', 'Carga de rotura (kgf)', c.carga_rotura_kgf)}
          ${campo('conductor.peso_kgf_m', 'Peso (kgf/m)', c.peso_kgf_m)}
          ${campo('conductor.modulo_elasticidad', 'Módulo E (kgf/mm²)', c.modulo_elasticidad)}
          ${campo('conductor.coef_dilatacion', 'Coef. dilatación α (1/°C)', c.coef_dilatacion)}
          ${campo('conductor.diametro_mm', 'Diámetro exterior (mm)', c.diametro_mm)}
        </div></div>
      <div class="card"><div class="section-head"><h2>Hipótesis de cálculo</h2><span class="muted small">Límite vacío = solo verificación</span></div>
        <div class="table-wrap" style="max-height:none"><table><thead><tr><th>Hipótesis</th><th>T (°C)</th><th>Viento (km/h)</th><th>Hielo (kgf/m)</th><th>Límite (% rotura)</th></tr></thead><tbody>${hip}</tbody></table></div></div>
      <div class="card"><div class="section-head"><h2>Criterios de diseño</h2></div><div class="form-grid cols-3">
        ${campo('criterios.tension_kv', 'Tensión nominal (kV)', cr.tension_kv)}
        ${campo('criterios.distancia_minima_terreno_m', 'Distancia mínima a terreno (m)', cr.distancia_minima_terreno_m, 'RETIE / EH-RAA-004 §7.1.1')}
        <label class="field-group"><span class="field-label">Altura de amarre por defecto (m)</span><input class="input" data-path="criterios.altura_amarre_defecto_m" data-nulo="1" inputmode="decimal" placeholder="vacío = Y es el amarre" value="${h(cr.altura_amarre_defecto_m ?? '')}"><span class="field-help">Poste 12 m: altura libre 10.2 m</span></label>
        ${campo('criterios.long_cadena_aisladores_m', 'Long. cadena de aisladores (m)', cr.long_cadena_aisladores_m, '0 = espigo / terminal')}
        ${campo('criterios.k_separacion', 'k separación de fases', cr.k_separacion, '0.75 para ACSR')}
        ${campo('criterios.fluencia_delta_t_c', 'Fluencia: Δt equivalente (°C)', cr.fluencia_delta_t_c)}
        ${campo('criterios.n_fases', 'Número de fases', cr.n_fases, '', 'numeric')}
        ${campo('criterios.desperdicio_conductor', 'Desperdicio de conductor (fracción)', cr.desperdicio_conductor, '0.03 = 3 %')}
        ${campo('salida.exageracion_vertical_dxf', 'Exageración vertical DXF', p.salida.exageracion_vertical_dxf, '1 = escala 1:1')}
      </div></div>
    </div>`;
  },

  perfil() {
    const r = S.resultado;
    if (!r) return sinResultado();
    const pags = paginas(r.perfil, porPagina());
    S.pagina = Math.min(S.pagina, pags.length - 1);
    const opts = pags.map(([a, b], i) => `<option value="${i}" ${i === S.pagina ? 'selected' : ''}>Vanos ${a + 1}–${b}</option>`).join('') + `<option value="-1" ${S.pagina === -1 ? 'selected' : ''}>Toda la línea</option>`;
    return `${avisoDesactualizado()}<div class="page-head"><div><h1>Perfil / plantillado</h1><p>Toque un apoyo o un vano para ver sus datos. ▲ = arrancamiento · ✕ = no cumple distancia mínima.</p></div></div>
    <div class="card"><div class="perfil-bar"><div class="perfil-nav"><button class="btn btn-small" id="pag-ant">◀</button><select class="select" id="pag-sel" style="width:auto">${opts}</select><button class="btn btn-small" id="pag-sig">▶</button></div>
      <span class="muted small">${r.perfil.vanos.length} vanos · ${pags.length} páginas</span></div>
      <div class="perfil-wrap" id="perfil-svg"></div>
      <div class="perfil-legend"><span><i style="border-color:#1f6fb2"></i>Conductor caliente (${h(S.proyecto.hipotesis_plantillado)})</span>${r.perfil.modo === 'cambio_estado' ? `<span><i style="border-color:#7fb6df;border-top-style:dashed"></i>Conductor frío (${h(S.proyecto.hipotesis_arrancamiento)})</span>` : ''}${r.perfil.terreno ? `<span><i style="border-color:#a07c4a"></i>Terreno</span><span><i style="border-color:#c84c4c;border-top-style:dashed"></i>Distancia mínima ${nf(r.perfil.dmin)} m</span>` : ''}<span>■ Retención · ● Suspensión</span></div></div>`;
  },

  resultados() {
    const r = S.resultado;
    if (!r) return sinResultado();
    const tabs = [['vanos', 'Vanos'], ['apoyos', 'Apoyos'], ['secciones', 'Secciones de tendido']];
    const t = r[S.tabRes];
    const alerta = (fila) => t.columnas.some((c, i) => (c === 'Cumple distancia' && fila[i] === 'NO') || (c === 'Arrancamiento' && fila[i] === 'SÍ'));
    const celda = (v) => typeof v === 'number' ? `<td class="num">${nf(v, 3)}</td>` : `<td>${h(v ?? '')}</td>`;
    return `${avisoDesactualizado()}<div class="page-head"><div><h1>Resultados</h1><p>Filas en rojo: no cumple distancia o tiene arrancamiento.</p></div><div class="actions"><button class="btn btn-navy" data-act="xlsx">⇩ Exportar Excel</button></div></div>
    <div class="tabs" role="tablist">${tabs.map(([k, n]) => `<button class="tab ${S.tabRes === k ? 'active' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
    <div class="card" style="padding:0"><div class="table-wrap" style="border:0"><table><thead><tr>${t.columnas.map((c) => `<th>${h(c)}</th>`).join('')}</tr></thead>
    <tbody>${t.filas.map((f) => `<tr class="${alerta(f) ? 'row-alert' : ''}">${f.map(celda).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  },

  advertencias() {
    const r = S.resultado;
    if (!r) return sinResultado();
    const tipo = (a) => /no cumple|distancia al terreno|ARRIBA|gravivano/i.test(a) ? 'err' : (/No hay columna|No se indicó/.test(a) ? 'info' : '');
    return `<div class="page-head"><div><h1>Advertencias <span class="badge badge-orange">${r.advertencias.length}</span></h1><p>Revise cada punto antes de emitir planos.</p></div></div>
      ${r.advertencias.length ? `<ul class="adv-list">${r.advertencias.map((a) => `<li class="${tipo(a)}">${tipo(a) === 'err' ? '✖' : tipo(a) === 'info' ? 'ⓘ' : '⚠'} <span>${h(a)}</span></li>`).join('')}</ul>` : '<div class="card empty"><div class="big">✓</div><h3>Sin advertencias</h3></div>'}`;
  },

  exportar() {
    const tarjeta = (fmt, color, titulo, texto) => `<div class="card export-card"><div class="ico" style="background:${color}">${fmt.toUpperCase()}</div><h3 style="margin:0;color:var(--navy)">${titulo}</h3><p class="muted small" style="margin:0;flex:1">${texto}</p><button class="btn btn-navy" data-act="${fmt}">⇩ Descargar ${fmt.toUpperCase()}</button></div>`;
    const url = location.origin + location.pathname;
    return `<div class="page-head"><div><h1>Exportar</h1><p>Los archivos se generan con el motor Python (los mismos de la versión de escritorio).</p></div></div>
    <div class="grid grid-3">
      ${tarjeta('xlsx', '#218c84', 'Memoria de cálculo', 'Resumen, vanos, apoyos, secciones, tabla de tendido, advertencias y parámetros.')}
      ${tarjeta('pdf', '#c84c4c', 'Plano de plantillado (A3)', 'Resumen, perfiles paginados con terreno y distancia mínima, y tabla de vanos.')}
      ${tarjeta('dxf', '#214e6b', 'DXF escala 1:1', 'Capas: terreno, seguridad, conductor, postes, textos y abscisas para AutoCAD.')}
    </div>
    <div class="grid grid-2" style="margin-top:18px">
      <div class="card"><div class="section-head"><h2>Proyecto</h2></div><p class="muted small">Guarde el proyecto completo (datos + parámetros) en un archivo <code>.cmt.json</code> para abrirlo en otro equipo o en el celular.</p>
        <div class="actions"><button class="btn" data-act="guardar-proyecto">⇩ Guardar proyecto</button><button class="btn" data-act="abrir-proyecto">⇪ Abrir proyecto</button></div></div>
      <div class="card"><div class="section-head"><h2>Usar en el celular</h2></div><ol class="steps">
        <li><span>En el PC ejecute <code>INICIAR_APP_RED.bat</code> (misma red Wi-Fi).</span></li>
        <li><span>En el celular abra la dirección que muestra la ventana negra, p. ej. <code>http://192.168.x.x:8766</code>.</span></li>
        <li><span>Menú del navegador → <b>Agregar a pantalla de inicio</b> / <b>Instalar app</b>.</span></li></ol>
        <p class="muted small">Dirección actual: <code>${h(url)}</code></p></div>
    </div>`;
  },

  acerca() {
    return `<div class="page-head"><div><h1>Normas y ayuda</h1><p>Base técnica del cálculo.</p></div></div>
    <div class="grid grid-2">
      <div class="card"><div class="section-head"><h2>Modelo de cálculo</h2></div><ol class="steps">
        <li><span>Secciones de tendido entre retenciones y <b>vano regulador</b> a<sub>r</sub> = √(Σa³/Σa).</span></li>
        <li><span><b>Ecuación de cambio de estado</b> con la hipótesis gobernante elegida automáticamente.</span></li>
        <li><span><b>Catenaria exacta</b> por vano con C = H/w; flecha medida desde la cuerda.</span></li>
        <li><span>Distancia al terreno, separación de fases e = k·√(F+L) + kV/150, tensiones en apoyos, eolovano, <b>gravivano</b> y arrancamiento.</span></li></ol></div>
      <div class="card"><div class="section-head"><h2>EH-RAA-004 (Electrohuila)</h2></div><dl class="kv">
        <dt>Temperaturas</dt><dd>0 °C mín. · 20 °C media · 50 °C máx.</dd>
        <dt>Viento</dt><dd>100 km/h · q = 0.0042·V² = 42 kgf/m²</dd>
        <dt>Distancia a tierra</dt><dd>5.80 m (RETIE)</dd>
        <dt>Separación</dt><dd>e = 0.75·√(F+L) + kV/150</dd>
        <dt>Empotramiento</dt><dd>10 m→1.6 · 12 m→1.8 · 14 m→2.0 · 16 m→2.2 m</dd>
        <dt>Tensión máx.</dt><dd>50 % de la rotura (FS = 2)</dd></dl>
        <p class="muted small">EDS 20 % y plantilla caliente 50 °C son valores por defecto: confírmelos para cada proyecto.</p></div>
    </div>`;
  },
};

// ================================================================== ENLACES
const ENLACES = {
  resumen(vc) {
    enlazarAcciones(vc);
    const mini = $('#perfil-mini', vc);
    if (mini && S.resultado) {
      const n = S.resultado.perfil.vanos.length;
      dibujarPerfil(mini, S.resultado.perfil, 0, n, { tipApoyo, tipVano });
    }
  },
  datos(vc) {
    if (vc.querySelector('#dm-tabla')) return GEO.enlazarEstructuras(vc);
    enlazarAcciones(vc);
    $$('.grid-edit input, .grid-edit select', vc).forEach((el) => el.addEventListener('change', () => {
      const i = +el.closest('tr').dataset.i, k = el.dataset.k;
      let v = el.value;
      if (['x', 'y', 'altura', 'flecha'].includes(k)) {
        const n = num(v); el.classList.toggle('bad', Number.isNaN(n)); v = Number.isNaN(n) ? v : n;
      }
      S.apoyos[i][k] = v; marcarCambio();
    }));
    $$('[data-del]', vc).forEach((b) => b.onclick = () => { S.apoyos.splice(+b.dataset.del, 1); marcarCambio(); ir('datos', true); });
    $('#btn-agregar', vc).onclick = () => {
      const ult = S.apoyos[S.apoyos.length - 1];
      S.apoyos.push({ nombre: `AP-${String(S.apoyos.length + 1).padStart(3, '0')}`, x: ult ? (+ult.x || 0) + 100 : 0, y: ult ? ult.y : 0, altura: ult?.altura ?? null, tipo: 'S' });
      marcarCambio(); ir('datos', true);
      const ins = $$('.grid-edit tbody tr:last-child input'); ins[0]?.focus(); ins[0]?.select();
    };
    $('#btn-limpiar', vc).onclick = () => {
      const m = modal('Vaciar apoyos', '<p>¿Eliminar todos los apoyos y el terreno?</p>', '<button class="btn" data-x>Cancelar</button><button class="btn btn-danger" data-ok>Vaciar</button>');
      $('[data-x]', m.root).onclick = m.cerrar;
      $('[data-ok]', m.root).onclick = () => { S.apoyos = []; S.terreno = []; S.resultado = null; guardar(); m.cerrar(); actualizarCabecera(); ir('datos', true); };
    };
    $('#btn-pegar', vc).onclick = () => modalPegar('apoyos');
    $('#btn-pegar-terreno', vc).onclick = () => modalPegar('terreno');
    const bt = $('#btn-borrar-terreno', vc); if (bt) bt.onclick = () => { S.terreno = []; marcarCambio(); ir('datos', true); };
  },
  parametros(vc) {
    enlazarAcciones(vc);
    $$('[data-path]', vc).forEach((el) => el.addEventListener('change', () => {
      const ruta = el.dataset.path.split('.');
      let v = el.value;
      if (!el.dataset.texto) {
        const n = num(v);
        if (n === null && el.dataset.nulo) v = null;
        else if (n === null || Number.isNaN(n)) { el.classList.add('bad'); toast(`Valor inválido: «${v}»`, 'warn'); return; }
        else v = el.dataset.escala ? n / +el.dataset.escala : n;
      }
      el.classList.remove('bad');
      let o = S.proyecto; ruta.slice(0, -1).forEach((k) => { o = o[k]; }); o[ruta[ruta.length - 1]] = v;
      marcarCambio();
      if (ruta[0] === 'modo_flecha' || ruta[0] === 'nombre') actualizarCabecera();
    }));
    $('#sel-conductor', vc).onchange = (e) => {
      const c = S.conductores[e.target.value]; if (!c) return;
      S.proyecto.conductor = clon(c); marcarCambio(); ir('parametros', true); toast(`Conductor ${c.nombre} cargado.`, 'success');
    };
    $('#gm-ver', vc).onclick = () => { const k = $('#gm-key', vc); k.type = k.type === 'password' ? 'text' : 'password'; };
    $('#gm-guardar', vc).onclick = async () => {
      S.config = { ...(S.config || {}), google_maps_key: $('#gm-key', vc).value.trim() };
      await S.motor.guardarConfig(S.config); toast('Clave guardada. Abra «Mapa / planta» para ver el satélite.', 'success');
    };
    $('#btn-restablecer', vc).onclick = () => { const n = S.proyecto.nombre; S.proyecto = clon(S.defaults); S.proyecto.nombre = n; marcarCambio(); ir('parametros', true); toast('Parámetros restablecidos (EH-RAA-004).'); };
  },
  perfil(vc) {
    enlazarAcciones(vc);
    const cont = $('#perfil-svg', vc); if (!cont) return;
    const pags = paginas(S.resultado.perfil, porPagina());
    const pintar = () => {
      const [a, b] = S.pagina === -1 ? [0, S.resultado.perfil.vanos.length] : pags[S.pagina];
      dibujarPerfil(cont, S.resultado.perfil, a, b, { tipApoyo, tipVano });
      $('#pag-sel', vc).value = String(S.pagina);
    };
    $('#pag-ant', vc).onclick = () => { S.pagina = S.pagina <= 0 ? pags.length - 1 : S.pagina - 1; pintar(); };
    $('#pag-sig', vc).onclick = () => { S.pagina = S.pagina === -1 || S.pagina >= pags.length - 1 ? 0 : S.pagina + 1; pintar(); };
    $('#pag-sel', vc).onchange = (e) => { S.pagina = +e.target.value; pintar(); };
    // deslizar con el dedo para cambiar de página
    let x0 = null;
    cont.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    cont.addEventListener('touchend', (e) => {
      if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 60) (dx < 0 ? $('#pag-sig', vc) : $('#pag-ant', vc)).click();
    });
    pintar();
  },
  resultados(vc) {
    enlazarAcciones(vc);
    $$('[data-tab]', vc).forEach((b) => b.onclick = () => { S.tabRes = b.dataset.tab; ir('resultados', true); });
  },
  exportar: enlazarAcciones,
  acerca: enlazarAcciones,
  advertencias: enlazarAcciones,
};

// ================================================================== ETAPA 1 (geo)
const GEO = instalarGeo({
  S, $, $$, h, nf, num, toast, modal, cargando, descargar, clon, fusionar,
  pegarTerreno: () => modalPegar('terreno'),
  ir, marcarCambio, guardar, calcular, actualizarCabecera, asegurarMotor, enlazarAcciones, importarExcel, exportar,
});
Object.assign(TITULOS, GEO.titulos); Object.assign(VISTAS, GEO.vistas); Object.assign(ENLACES, GEO.enlaces);

function filaTabla(tabla, i) {
  const o = {}; tabla.columnas.forEach((c, k) => { o[c] = tabla.filas[i][k]; }); return o;
}
function tipApoyo(i) {
  const a = filaTabla(S.resultado.apoyos, i);
  const g = Object.keys(a).find((k) => k.startsWith('Gravivano'));
  return `<strong>${h(a['Apoyo'])}</strong> · ${h(a['Tipo'])}<br>${abscisaK(a['Abscisa (m)'])}<br>Cota amarre: ${nf(a['Cota amarre (m)'])} m<br>Eolovano: ${nf(a['Eolovano (m)'], 1)} m<br>${h(g)}: ${nf(a[g], 1)} m${a['Arrancamiento'] === 'SÍ' ? '<br><b style="color:#ffb3b3">▲ Arrancamiento</b>' : ''}`;
}
function tipVano(i) {
  const v = filaTabla(S.resultado.vanos, i);
  return `<strong>Vano ${v['Vano']}</strong>: ${h(v['Apoyo inicial'])} → ${h(v['Apoyo final'])}<br>a = ${nf(v['Vano a (m)'])} m · Δh = ${nf(v['Desnivel (m)'])} m<br>Flecha máx.: ${nf(v['Flecha máx. (m)'], 3)} m<br>Longitud: ${nf(v['Longitud conductor (m)'])} m<br>T apoyos: ${nf(v['T apoyo ini (kgf)'], 0)} / ${nf(v['T apoyo fin (kgf)'], 0)} kgf${v['Dist. mín. terreno (m)'] != null ? `<br>Dist. terreno: <b>${nf(v['Dist. mín. terreno (m)'])} m</b> ${v['Cumple distancia'] === 'NO' ? '✖' : '✓'}` : ''}`;
}

// --------------------------------------------------------- pegar desde Excel
function modalPegar(tipo) {
  const esTer = tipo === 'terreno';
  const ayuda = esTer ? 'Columnas: Abscisa, Cota' : 'Columnas: Apoyo, X, Y [, Altura amarre] [, Tipo R/S] [, Flecha]';
  const m = modal(esTer ? 'Pegar perfil del terreno' : 'Pegar apoyos desde Excel',
    `<p class="muted small">Copie las celdas en Excel (Ctrl+C) y péguelas aquí. ${ayuda}. Se aceptan encabezados, tabulaciones, “;” y coma decimal.</p><textarea class="textarea" id="txt-pegar" placeholder="${esTer ? '0\t371\n10\t371.4' : 'AP-1\t0\t371\t9.6\tR\nAP-2\t26.2\t371\t10\tS'}"></textarea>
     <label class="small" style="display:flex;gap:6px;align-items:center;margin-top:10px"><input type="checkbox" id="chk-reemplazar" checked> Reemplazar los datos actuales</label>`,
    '<button class="btn" data-x>Cancelar</button><button class="btn btn-primary" data-ok>Importar</button>');
  $('[data-x]', m.root).onclick = m.cerrar;
  setTimeout(() => $('#txt-pegar').focus(), 50);
  $('[data-ok]', m.root).onclick = () => {
    const lineas = $('#txt-pegar').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const sep = (l) => l.includes('\t') ? l.split('\t') : l.includes(';') ? l.split(';') : l.split(/\s+/);
    const filas = lineas.map(sep).map((c) => c.map((x) => x.trim()));
    if (filas.length && Number.isNaN(num(filas[0][esTer ? 0 : 1]))) filas.shift(); // encabezado
    const nuevos = [];
    for (const c of filas) {
      if (esTer) { const x = num(c[0]), y = num(c[1]); if (Number.isFinite(x) && Number.isFinite(y)) nuevos.push({ x, cota: y }); continue; }
      const x = num(c[1]), y = num(c[2]); if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const alt = num(c[3]); const tipoC = (c[4] || '').toUpperCase().startsWith('R') ? 'R' : 'S';
      nuevos.push({ nombre: c[0] || `AP-${nuevos.length + 1}`, x, y, altura: Number.isFinite(alt) ? alt : null, tipo: tipoC, flecha: Number.isFinite(num(c[5])) ? num(c[5]) : null });
    }
    if (!nuevos.length) return toast('No se reconocieron filas válidas.', 'warn');
    const reemplazar = $('#chk-reemplazar').checked;
    if (esTer) S.terreno = reemplazar ? nuevos : S.terreno.concat(nuevos).sort((a, b) => a.x - b.x);
    else S.apoyos = reemplazar ? nuevos : S.apoyos.concat(nuevos);
    m.cerrar(); marcarCambio(); ir('datos', true); toast(`${nuevos.length} filas importadas.`, 'success');
  };
}

// ================================================================== INICIO
async function iniciar() {
  $$('.nav-item').forEach((b) => b.addEventListener('click', () => ir(b.dataset.view)));
  $('#menu-button').onclick = abrirMenu; $('#scrim').onclick = cerrarMenu;
  $('#btn-calcular').onclick = () => calcular();
  $('#file-excel').onchange = (e) => { GEO.asistente(e.target.files[0]); e.target.value = ''; };
  $('#file-json').onchange = (e) => { abrirProyecto(e.target.files[0]); e.target.value = ''; };
  window.addEventListener('hashchange', () => ir(location.hash.slice(1)));
  let tRes; window.addEventListener('resize', () => { clearTimeout(tRes); tRes = setTimeout(() => { if (['perfil', 'resumen'].includes(S.vista) && S.resultado) ir(S.vista, true); }, 200); });
  document.addEventListener('keydown', (e) => { if (e.key === 'F5' || (e.ctrlKey && e.key === 'Enter')) { e.preventDefault(); calcular(); } });

  // instalación PWA
  let evInstalar = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); evInstalar = e; $('#install-button').hidden = false; });
  $('#install-button').onclick = async () => { if (!evInstalar) return; evInstalar.prompt(); await evInstalar.userChoice; evInstalar = null; $('#install-button').hidden = true; };
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }

  const def = await (await fetch('defaults.json', { cache: 'no-cache' })).json();
  S.defaults = def.proyecto_defecto; S.conductores = def.conductores;
  const guardado = restaurar();
  S.proyecto = fusionar(clon(S.defaults), guardado?.proyecto || {});
  S.apoyos = guardado?.apoyos || []; S.terreno = guardado?.terreno || []; S.archivo = guardado?.archivo || '';
  S.meta = guardado?.meta || {};

  S.motor = await detectarMotor((msg) => { if (msg) cargando(msg); });
  S.config = await S.motor.config();
  pintarMotor(); actualizarCabecera();
  ir(location.hash.slice(1) || 'resumen', true);
  if (S.apoyos.length >= 2 && S.motor.tipo === 'servidor') calcular();
}

iniciar().catch((e) => { console.error(e); toast('No se pudo iniciar la app: ' + e.message, 'error'); });
