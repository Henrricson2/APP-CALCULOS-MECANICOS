// App Cálculos Mecánicos MT — interfaz PWA (PC, web y celular).
import { detectarMotor } from './motor.js?v=18';
import { dibujarPerfil, paginas, paginasEscala, perfilInteractivo, abscisaK, COLORES_CIRCUITOS } from './perfil.js?v=15';
import { instalarGeo } from './geo-ui.js?v=25';
import { generarKML3D } from './earth3d.js?v=3';
import { generarDXF, generarBibliotecaDXF } from './cad.js?v=3';
import { visorProyecto } from './visor3d.js?v=2';
import { cargarCatalogo } from './estructuras-eh.js?v=6';
import { cargarClima, buscarMunicipio, propuesta, aplicarClima, editadas, menosExigente, renombrar, NORMA, MODOS, DELTA_CONDUCTOR } from './clima.js?v=1';
// celulares y tabletas con navegador antiguo
if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', { value(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return this[n]; }, configurable: true, writable: true });

const CLAVE = 'cm-proyecto-v2';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 2) => (v == null || v === '' || Number.isNaN(+v)) ? '—' : (+v).toLocaleString('es-CO', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const num = (v) => { if (v == null) return null; const s = String(v).trim().replace(',', '.'); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };

const TITULOS = { resumen: 'Resumen', datos: 'Estructuras y mapa', parametros: 'Parámetros', perfil: 'Perfil / plantillado', vista3d: 'Vista 3D', resultados: 'Resultados', advertencias: 'Advertencias', exportar: 'Exportar', acerca: 'Normas y ayuda' };

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
// Todo lo del proyecto viaja junto: entrada (parámetros, estructuras, terreno), trazado
// georreferenciado (meta) y el último cálculo con su resumen.
function resumenCalculo() {
  const r = S.resultado; if (!r) return null;
  const s = r.resumen || {};
  return { fecha: S.calculado || null, desactualizado: !!S.desactualizado, vanos: s['Número de vanos'] ?? null,
    longitud_m: s['Longitud horizontal (m)'] ?? null, no_cumplen: s['Vanos que no cumplen distancia'] ?? null,
    arrancamiento: s['Apoyos con arrancamiento'] ?? null, advertencias: (r.advertencias || []).length };
}
function estadoProyecto() {
  return { proyecto: S.proyecto, apoyos: S.apoyos, terreno: S.terreno, archivo: S.archivo, meta: S.meta,
    resultado: S.resultado, desactualizado: !!S.desactualizado, calculado: S.calculado || null, calculo: resumenCalculo() };
}
function aplicarEstado(d) {
  S.proyecto = fusionar(clon(S.defaults), d.proyecto || {});
  S.apoyos = d.apoyos || []; S.terreno = d.terreno || []; S.archivo = d.archivo || '';
  S.resultado = d.resultado || null; S.desactualizado = !!d.desactualizado; S.calculado = d.calculado || null; S.pagina = 0;
}
function guardar() {
  const d = estadoProyecto();
  try { localStorage.setItem(CLAVE, JSON.stringify(d)); }
  catch { try { localStorage.setItem(CLAVE, JSON.stringify({ ...d, resultado: null })); } catch { /* sin almacenamiento */ } }
}
function restaurar() {
  try { const d = JSON.parse(localStorage.getItem(CLAVE) || 'null'); if (d && d.proyecto) return d; } catch { /* nada */ }
  return null;
}
function marcarCambio() { if (S.resultado) S.desactualizado = true; guardar(); actualizarCabecera(); GEO.programarGuardado(); }
function payload() { return { proyecto: S.proyecto, apoyos: S.apoyos, terreno: S.terreno, origen: S.archivo || 'web' }; }

// ------------------------------------------------------------------ motor
async function asegurarMotor() {
  if (S.motor.tipo === 'navegador' && !S.motor.py) {
    S.esperandoMotor = true; progresoMotor(S.motor.msg || 'Preparando Python en el navegador…', S.motor.pct);
    try { await S.motor.listo(); } catch (e) {
      S.esperandoMotor = false;
      cargando(''); modal('No se pudo cargar Python en el navegador',
        `<p>${h(e.message)}</p><p class="muted small">La primera vez se necesita internet para descargar Python (Pyodide, unos 25 MB). Pulse «Calcular» para reintentar. En el PC también puede usar <code>INICIAR_APP.bat</code>.</p>`);
      throw e;
    }
    S.esperandoMotor = false;
    pintarMotor();
  }
}
// avance de la carga de Python (modo web): en el pie del menú y, si el usuario está esperando, en pantalla
function progresoMotor(msg, pct) {
  if (!S.motor) return;
  S.motor.msg = msg;
  const txt = $('#motor-texto'), chip = $('#engine-chip');
  if (msg) {
    const p = pct != null ? ` ${Math.round(pct)} %` : '';
    if (txt) txt.textContent = `${msg}${p}`;
    if (chip) chip.innerHTML = `○${p} <span class="txt">Cargando Python</span>`;
    if (S.esperandoMotor) cargando(`${msg}${p}`);
  } else if (S.motor.py) { pintarMotor(); if (S.esperandoMotor) cargando(''); }
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
    chip.className = 'engine-chip warn'; chip.innerHTML = `○ <span class="txt">Cargando Python…</span>`;
    dot.className = 'status-dot'; txt.textContent = S.motor.msg ? S.motor.msg + (S.motor.pct != null ? ` ${Math.round(S.motor.pct)} %` : '') : 'Modo web: cargando Python…';
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
    S.resultado = r; S.desactualizado = false; S.calculado = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19); // hora local
    guardar(); GEO.programarGuardado(0);
    S.pagina = Math.min(S.pagina, Math.max(0, paginas(r.perfil, porPagina()).length - 1));
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

// Diseño 3D para Google Earth (KML) a partir del último cálculo
async function exportar3D() {
  if (!S.resultado) return toast('Primero calcule el proyecto (▶ Calcular).', 'warn');
  if (S.desactualizado) toast('Ojo: el cálculo está desactualizado; recalcule para que el 3D refleje los últimos cambios.', 'warn');
  try {
    const kml = generarKML3D({ S, catalogo: await cargarCatalogo() });
    descargar(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), `${(S.proyecto.nombre || 'proyecto').replace(/[^\p{L}\p{N}\-]+/gu, '_')}_3D.kml`);
    toast('Diseño 3D descargado: ábralo con Google Earth (Pro o web → Proyectos → Importar).', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

// Plano CAD: planta (capas PLANTA_*) y modelo 3D (capas 3D_*) en DXF; DWG con el AutoCAD del PC servidor
async function exportarCAD(fmt) {
  if (!S.resultado) return toast('Primero calcule el proyecto (▶ Calcular).', 'warn');
  if (S.desactualizado) toast('Ojo: el cálculo está desactualizado; recalcule para que el plano refleje los últimos cambios.', 'warn');
  const base = (S.proyecto.nombre || 'proyecto').replace(/[^\p{L}\p{N}\-]+/gu, '_');
  try {
    const r = generarDXF({ S, catalogo: await cargarCatalogo() });
    if (fmt === 'dxf') {
      descargar(new Blob([r.dxf], { type: 'application/dxf' }), `${base}_planta_3D.dxf`);
      return toast(`DXF descargado (${r.entidades} entidades${r.georreferenciado ? ', MAGNA-SIRGAS Origen Nacional' : ', coordenadas locales'}).`, 'success');
    }
    if (S.motor?.tipo !== 'servidor' || !S.motor.dwg) throw new Error('El DWG necesita el servidor de la app en el PC con AutoCAD. Descargue el DXF.');
    cargando('Convirtiendo a DWG con AutoCAD… (puede tardar unos segundos)');
    const blob = await S.motor.dwg(r.dxf);
    cargando(''); descargar(blob, `${base}_planta_3D.dwg`); toast('DWG descargado.', 'success');
  } catch (e) { cargando(''); toast(e.message, 'error'); }
}

// Biblioteca 3D de todas las estructuras EH (bloques). En el PC servidor queda guardada en estructuras_eh/.
async function bibliotecaEH(fmt) {
  try {
    cargando('Generando la biblioteca 3D de estructuras EH…');
    const { dxf, estructuras, bloques } = generarBibliotecaDXF(await cargarCatalogo(), { bajo: +(S.proyecto.criterios.amarre_bajo_cima_m ?? 0.7) });
    if (S.motor?.tipo === 'servidor' && S.motor.guardarBiblioteca && ['127.0.0.1', 'localhost'].includes(location.hostname)) {
      cargando(fmt === 'dwg' ? 'Guardando y convirtiendo a DWG con AutoCAD… (puede tardar un minuto)' : 'Guardando…');
      const r = await S.motor.guardarBiblioteca(dxf);
      cargando('');
      toast(`Biblioteca guardada en ${r.carpeta} (${estructuras} estructuras, ${bloques} bloques)${r.dwg ? ' en DXF y DWG' : ` en DXF. ${r.aviso}`}.`, 'success');
      if (fmt === 'dwg' && r.dwg) return descargar(await (await fetch('api/biblioteca/dwg', { cache: 'no-store' })).blob(), 'BIBLIOTECA_ESTRUCTURAS_EH_3D.dwg');
    } else cargando('');
    descargar(new Blob([dxf], { type: 'application/dxf' }), 'BIBLIOTECA_ESTRUCTURAS_EH_3D.dxf');
  } catch (e) { cargando(''); toast(e.message, 'error'); }
}

function guardarProyecto() {
  const blob = new Blob([JSON.stringify({ app: 'calculos-mecanicos-mt', version: 3, ...estadoProyecto(), meta: { ...S.meta, id: undefined } }, null, 2)], { type: 'application/json' });
  descargar(blob, `${(S.proyecto.nombre || 'proyecto').replace(/[^\p{L}\p{N}\-]+/gu, '_')}.cmt.json`);
  toast('Proyecto guardado como archivo .cmt.json (ábralo con «Abrir proyecto» en otro equipo o en el celular).', 'success');
}
// Abrir un archivo .cmt.json crea un proyecto propio (no sobrescribe el abierto), con su cálculo si lo trae.
async function abrirProyecto(archivo) {
  try {
    const d = JSON.parse(await archivo.text());
    if (!d.proyecto || !Array.isArray(d.apoyos)) throw new Error('El archivo no es un proyecto de esta app.');
    // si ya hay un proyecto con ese nombre, el abierto queda como «(copia)» para no confundirlos en la lista
    let nombre = d.proyecto.nombre || archivo.name.replace(/\.[^.]+$/, '');
    try {
      const usados = new Set((await S.motor?.proyectos?.listar?.() || []).map((p) => p.nombre));
      if (usados.has(nombre)) { let k = 1; while (usados.has(`${nombre} (copia${k > 1 ? ` ${k}` : ''})`)) k++; nombre = `${nombre} (copia${k > 1 ? ` ${k}` : ''})`; }
    } catch { /* sin lista: se deja el nombre */ }
    d.proyecto.nombre = nombre;
    await GEO.crearProyecto({ nombre, meta: { ...(d.meta || {}), id: undefined },
      estado: { ...d, archivo: d.archivo || archivo.name } });
    toast('Proyecto abierto desde archivo.', 'success');
    if (S.resultado) ir('resumen', true); else await calcular({ irA: 'resumen' });
  } catch (e) { toast(e.message, 'error'); }
}
async function cargarEjemplo() {
  const d = await (await fetch('ejemplo.json')).json();
  await GEO.crearProyecto({ nombre: 'Ejemplo DATOS.xlsx', estado: { ...d, archivo: 'ejemplo' } });
  await calcular({ irA: 'resumen' });
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
  if (S.visor) { try { S.visor.liberar(); } catch { /* ya liberado */ } S.visor = null; }
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
  return `<div class="card empty"><div class="big">⌒</div><h3>Aún no hay cálculo</h3><p>El perfil, el plantillado y los resultados salen de las estructuras registradas en <b>Estructuras y mapa</b> (coordenadas, cota y altura del poste). Regístrelas y pulse <b>Calcular</b>.</p>
  <div class="actions" style="justify-content:center;margin-top:14px"><button class="btn btn-primary" data-act="ir-datos">📍 Ir a Estructuras y mapa</button>${S.apoyos.length >= 2 ? '<button class="btn" data-act="calcular">▶ Calcular</button>' : ''}</div></div>`;
}
// ---- colocar postes sobre el perfil (Resumen y Perfil)
function botonColocar() {
  return `<button class="btn btn-small ${S.colocando ? 'btn-primary' : 'btn-soft'}" id="btn-colocar" title="Toque el perfil entre dos estructuras para agregar un poste en ese punto">${S.colocando ? '✓ Terminar de colocar' : '＋ Colocar poste en el perfil'}</button>`;
}
function avisoColocar() {
  return S.colocando ? '<ul class="adv-list" style="margin:0 0 10px"><li class="info">ⓘ <span>Mueva el cursor sobre el perfil: la guía roja muestra la abscisa y la cota del terreno. <b>Haga clic</b> entre dos estructuras para colocar un poste ahí (queda de suspensión, con el poste de su vecino; ajústelo en Estructuras y mapa). Ctrl+Z deshace.</span></li></ul>' : '';
}
function enlazarColocar(vc) {
  const b = $('#btn-colocar', vc); if (!b) return;
  b.onclick = () => { S.colocando = !S.colocando; ir(S.vista, true); };
}
async function colocarEnPerfil(x, z) {
  const ap = S.resultado?.perfil?.apoyos; if (!ap) return;
  const i = ap.findIndex((a, k) => k < ap.length - 1 && x > a.x && x < ap[k + 1].x);
  if (i < 0) return toast('Haga clic entre dos estructuras.', 'warn');
  if (x - ap[i].x < 3 || ap[i + 1].x - x < 3) return toast('Muy cerca de una estructura existente (menos de 3 m).', 'warn');
  if (ap.length !== S.apoyos.length) return toast('Recalcule antes de colocar postes (la tabla cambió).', 'warn');
  try {
    const t = (x - ap[i].x) / (ap[i + 1].x - ap[i].x);
    const nuevo = await GEO.insertarEnPerfil(i, t, +(+z).toFixed(2));
    toast(`Poste ${nuevo.nombre} colocado entre ${ap[i].nombre} y ${ap[i + 1].nombre} (${abscisaK(x - ap[0].x)}, cota ${(+z).toFixed(1)} m). Recalculando…`, 'success');
    await calcular({ irA: S.vista });
  } catch (e) { toast(e.message, 'error'); }
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
  kml3d: () => exportar3D(),
  'cad-dxf': () => exportarCAD('dxf'),
  'cad-dwg': () => exportarCAD('dwg'),
  'bib-dxf': () => bibliotecaEH('dxf'),
  'bib-dwg': () => bibliotecaEH('dwg'),
  'abrir-proyecto': () => $('#file-json').click(),
  xlsx: () => exportar('xlsx'), pdf: () => exportar('pdf'), dxf: () => exportar('dxf'),
  calcular: () => calcular(),
};

// ================================================================== VISTAS
// ------------------------------------------------- clima del sitio (IDEAM) -> hipótesis
const ETQ_HIP = { TMAX: 'TMAX · frío + viento', EDS: 'EDS · tensión de cada día', FMIN: 'FMIN · flecha mínima', FMAX: 'FMAX · plantilla caliente' };
function tarjetaClima() {
  const base = S.clima || { municipios: [] }, p = S.proyecto, cl = p.clima || {};
  if (!base.municipios?.length) return `<div class="card"><div class="section-head"><h2>Clima del sitio (IDEAM)</h2></div><p class="small muted" style="margin:0">No se encontró la base <code>web/clima_huila.json</code>. Ejecute <code>python clima_ideam/construir_clima.py</code>.</p></div>`;
  const reg = buscarMunicipio(base, cl.municipio || S.meta?.municipio);
  const modo = cl.modo || 'ideam', delta = cl.delta_conductor_c ?? DELTA_CONDUCTOR;
  const prop = reg ? propuesta(reg, { modo, delta_conductor_c: delta }) : null;
  const ed = editadas(p);
  const filas = Object.keys(NORMA).filter((k) => p.hipotesis[k]).map((k) => {
    const t = p.hipotesis[k].temperatura_c, warn = menosExigente(k, t);
    return `<tr><td><b>${ETQ_HIP[k]}</b></td><td class="num">${NORMA[k]} °C</td><td class="num">${prop ? `${prop[k]} °C` : '—'}</td>
      <td class="num"><b>${h(t)} °C</b> ${ed.includes(k) ? '<span class="badge badge-gold" title="Cambiado a mano después de llenar con el IDEAM">editado</span>' : ''}${warn ? ' <span class="badge badge-orange" title="Menos exigente que el valor por defecto de la norma EH-RAA-004">&lt; norma</span>' : ''}</td></tr>`;
  }).join('');
  const estado = cl.aplicado
    ? `<span class="badge badge-green">Llenado con ${h(cl.municipio)} · ${h(cl.aplicado)}</span>`
    : '<span class="badge badge-orange">Hipótesis sin llenar con el clima del municipio</span>';
  return `<div class="card"><div class="section-head"><h2>Clima del sitio (IDEAM)</h2>${estado}</div>
    <p class="small muted" style="margin-top:0">Al crear un proyecto, las temperaturas de las hipótesis se llenan solas con el clima del municipio. Todas siguen siendo editables: si tiene un dato mejor (estación más cercana, estudio del sitio, exigencia del operador), escríbalo directamente en la tabla de hipótesis. El viento se mantiene en el valor de la norma (el IDEAM no publica viento de diseño con periodo de retorno).</p>
    <div class="form-grid cols-3">
      <label class="field-group"><span class="field-label">Municipio</span><select class="select" id="clima-mun"><option value="">— Elija el municipio —</option>${base.municipios.map((m) => `<option ${reg && m.municipio === reg.municipio ? 'selected' : ''}>${h(m.municipio)}</option>`).join('')}</select></label>
      <label class="field-group"><span class="field-label">Criterio</span><select class="select" id="clima-modo">${Object.entries(MODOS).map(([k, t]) => `<option value="${k}" ${k === modo ? 'selected' : ''}>${h(t)}</option>`).join('')}</select></label>
      <label class="field-group"><span class="field-label">Calentamiento del conductor sobre T máx. ambiente (°C)</span><input class="input" id="clima-delta" inputmode="decimal" value="${h(delta)}"><span class="field-help">FMAX = T máx. absoluta + este valor (sol y corriente)</span></label>
    </div>
    ${reg ? `<dl class="kv" style="margin-top:12px"><dt>Cabecera</dt><dd>${h(reg.municipio)} · ${nf(reg.alt_m, 0)} m s. n. m.</dd>
      <dt>T media anual</dt><dd>${nf(reg.t_media_anual_c, 1)} °C</dd>
      <dt>T mínima absoluta</dt><dd>${nf(reg.t_min_absoluta_c, 1)} °C <span class="small muted">(${h(reg.nota_t_min_absoluta)})</span></dd>
      <dt>T máxima absoluta</dt><dd>${nf(reg.t_max_absoluta_c, 1)} °C <span class="small muted">(${h(reg.nota_t_max_absoluta)})</span></dd>
      <dt>Estación de referencia</dt><dd>${h(reg.estacion_principal)}</dd></dl>
    <div class="table-wrap" style="max-height:none;margin-top:12px"><table><thead><tr><th>Hipótesis</th><th>Norma EH-RAA-004</th><th>IDEAM ${h(reg.municipio)}</th><th>En el proyecto</th></tr></thead><tbody>${filas}</tbody></table></div>
    <div class="actions" style="margin-top:12px"><button class="btn btn-soft" id="clima-aplicar">↻ Llenar hipótesis con el IDEAM</button></div>` : '<p class="small muted">Elija el municipio para ver sus datos.</p>'}
    <p class="small muted" style="margin-bottom:0">Fuente: ${h(base.fuente?.normales || 'IDEAM')}; extremos de las estaciones automáticas del IDEAM, corregidos por la altura de la cabecera. Revise que el clima del trazado (no solo de la cabecera) sea similar.</p></div>`;
}
function enlazarClima(vc) {
  const sel = $('#clima-mun', vc); if (!sel) return;
  const cl = () => (S.proyecto.clima = S.proyecto.clima || {});
  // elegir el municipio, el criterio o el calentamiento llena de una vez las hipótesis (siguen editables)
  const llenar = (msg = true) => {
    const reg = buscarMunicipio(S.clima, S.proyecto.clima?.municipio || S.meta?.municipio);
    const v = reg ? aplicarClima(S.proyecto, reg) : null;
    marcarCambio(); ir('parametros', true);
    if (v && msg) toast(`Hipótesis llenadas con ${reg.municipio}: TMAX ${v.TMAX} °C · EDS ${v.EDS} °C · FMIN ${v.FMIN} °C · FMAX ${v.FMAX} °C`, 'success');
  };
  sel.onchange = () => { cl().municipio = sel.value; if (sel.value) S.meta.municipio = sel.value; llenar(); };
  $('#clima-modo', vc).onchange = (e) => { cl().modo = e.target.value; llenar(); };
  $('#clima-delta', vc).onchange = (e) => {
    const n = num(e.target.value); if (n == null || Number.isNaN(n) || n < 0 || n > 40) { e.target.classList.add('bad'); return toast(`Valor inválido: «${e.target.value}»`, 'warn'); }
    cl().delta_conductor_c = n; llenar();
  };
  const ap = $('#clima-aplicar', vc);
  if (ap) ap.onclick = () => llenar();
}

// Proyecto con municipio cuyas hipótesis nunca se llenaron con el IDEAM (p. ej. creado antes de
// esta función): se llenan una sola vez. Después se respetan los cambios hechos a mano.
function asegurarClima() {
  if (!S.proyecto || S.proyecto.clima?.aplicado || !S.meta?.municipio) return null;
  const v = aplicarClima(S.proyecto, buscarMunicipio(S.clima, S.meta.municipio));
  if (v) { guardar(); toast(`Hipótesis llenadas con el clima de ${S.meta.municipio} (IDEAM). Puede editarlas en Parámetros.`, 'success'); }
  return v;
}

// ------------------------------------------------- varios circuitos en las mismas estructuras
const CAMPOS_CONDUCTOR = [['nombre', 'Nombre / calibre', 1], ['seccion_mm2', 'Sección (mm²)'], ['carga_rotura_kgf', 'Carga de rotura (kgf)'], ['peso_kgf_m', 'Peso (kgf/m)'], ['modulo_elasticidad', 'Módulo E (kgf/mm²)'], ['coef_dilatacion', 'Coef. dilatación α (1/°C)'], ['diametro_mm', 'Diámetro exterior (mm)']];
function tarjetaCircuitos() {
  const p = S.proyecto, cr = p.criterios, cs = p.circuitos || [];
  const nombres = S.apoyos.map((a) => String(a.nombre));
  const opAp = (sel, vacio) => `<option value="">${vacio}</option>${nombres.map((n) => `<option ${n === String(sel) ? 'selected' : ''}>${h(n)}</option>`).join('')}${sel && !nombres.includes(String(sel)) ? `<option selected>${h(sel)} (no existe)</option>` : ''}`;
  const opCond = (c) => `<option value="">${h(c.nombre)}${Object.values(S.conductores).some((x) => x.nombre === c.nombre) ? '' : ' (propio)'}</option>${Object.keys(S.conductores).map((k) => `<option value="${h(k)}">${h(k)}</option>`).join('')}`;
  const filas = cs.map((c, i) => `<tr data-c="${i}" class="${c.activo === false ? 'muted' : ''}">
    <td><input type="checkbox" data-ck="activo" ${c.activo === false ? '' : 'checked'} title="Incluir en el cálculo"></td>
    <td><span class="circ-color" style="background:${COLORES_CIRCUITOS[i % COLORES_CIRCUITOS.length]}"></span><input class="input" data-ck="nombre" data-texto="1" value="${h(c.nombre)}" style="min-width:120px"></td>
    <td><input class="input" data-ck="tension_kv" inputmode="decimal" value="${h(c.tension_kv)}" style="width:70px"></td>
    <td><div style="display:flex;gap:4px"><select class="select" data-ck="conductor" style="min-width:160px">${opCond(c.conductor || {})}</select><button class="btn btn-small" data-cedit="${i}" title="Ver o editar las propiedades del conductor">✎</button></div></td>
    <td><input class="input" data-ck="n_fases" inputmode="numeric" value="${h(c.n_fases)}" style="width:52px"></td>
    <td><select class="select" data-ck="desde" data-texto="1">${opAp(c.desde, 'Inicio de la línea')}</select></td>
    <td><select class="select" data-ck="hasta" data-texto="1">${opAp(c.hasta, 'Fin de la línea')}</select></td>
    <td><input class="input" data-ck="bajo_cima_m" inputmode="decimal" value="${h(c.bajo_cima_m)}" style="width:70px"></td>
    <td><input class="input" data-ck="peso_herrajes_kgf" inputmode="decimal" value="${h(c.peso_herrajes_kgf ?? 40)}" style="width:70px"></td>
    <td><button class="del" data-cdel="${i}" title="Quitar circuito">✕</button></td></tr>`).join('');
  return `<div class="card"><div class="section-head"><h2>Circuitos en las mismas estructuras <span class="badge">${1 + cs.length}</span></h2><button class="btn btn-small btn-soft" id="circ-add">＋ Agregar circuito</button></div>
    <p class="small muted" style="margin-top:0">Una misma estructura puede llevar varios circuitos (p. ej. un poste de 14 m con dos de 34,5 kV y dos de 13,8 kV). El <b>circuito principal</b> usa el conductor y los criterios de esta página y recorre toda la línea. Cada circuito adicional ocupa un <b>tramo</b> (desde–hasta) con su propio conductor, tensión, fases y altura de montaje. Se plantilla cada circuito, se verifica su distancia al terreno y la <b>separación entre circuitos</b>, y sus cargas se <b>suman</b> en la verificación de postes y templetes.</p>
    <div class="table-wrap" style="max-height:none"><table class="tabla-circ"><thead><tr><th></th><th>Circuito</th><th>kV</th><th>Conductor</th><th>Fases</th><th>Desde</th><th>Hasta</th><th title="Distancia del punto de amarre bajo la cima del poste">Amarre bajo cima (m)</th><th title="Crucetas, aisladores y herrajes de este circuito">Herrajes (kgf)</th><th></th></tr></thead>
    <tbody><tr class="fila-principal"><td></td><td><span class="circ-color" style="background:#1f6fb2"></span><input class="input" data-path="criterios.nombre_circuito_principal" data-texto="1" data-rerender="1" value="${h(cr.nombre_circuito_principal ?? 'Circuito 1')}" style="min-width:120px">
      <div class="small muted">Principal · toda la línea</div></td>
      <td><input class="input" data-path="criterios.tension_kv" data-rerender="1" inputmode="decimal" value="${h(cr.tension_kv)}" style="width:70px"></td>
      <td><select class="select" id="circ-ppal-cond" style="min-width:160px">${opCond(p.conductor || {})}</select></td>
      <td><input class="input" data-path="criterios.n_fases" data-rerender="1" inputmode="numeric" value="${h(cr.n_fases)}" style="width:52px"></td>
      <td class="small muted">Inicio</td><td class="small muted">Fin</td>
      <td><input class="input" data-path="criterios.amarre_bajo_cima_m" data-rerender="1" inputmode="decimal" value="${h(cr.amarre_bajo_cima_m ?? 0.7)}" style="width:70px"></td>
      <td><input class="input" data-path="criterios.peso_herrajes_kgf" data-rerender="1" inputmode="decimal" value="${h(cr.peso_herrajes_kgf ?? 40)}" style="width:70px"></td><td></td></tr>${filas}</tbody></table></div>
    <p class="small muted">${cs.length ? `La línea lleva ${1 + cs.length} circuitos: el principal más ${cs.length} adicional(es).` : 'La primera fila es el <b>circuito principal</b> de la línea (siempre existe; no es un circuito agregado). Puede editar sus datos aquí mismo. Use «＋ Agregar circuito» solo si las estructuras llevan otro circuito.'}</p>
    <div class="form-grid cols-3" style="margin-top:12px">
      <label class="field-group"><span class="field-label">Separación vertical mínima entre circuitos (m)</span><input class="input" data-path="criterios.separacion_min_circuitos_m" inputmode="decimal" value="${h(cr.separacion_min_circuitos_m ?? 1.2)}"><span class="field-help">Exigida en los apoyos. Verifíquela contra RETIE y la norma del operador de red.</span></label>
      <label class="field-group"><span class="field-label">Factor en el vano</span><input class="input" data-path="criterios.separacion_vano_factor" inputmode="decimal" value="${h(cr.separacion_vano_factor ?? 0.75)}"><span class="field-help">En el vano se admite factor × mínima (0.75, NESC 235C2b). Superior con flecha máxima, inferior a 20 °C (EDS).</span></label>
    </div></div>`;
}
function nuevoCircuito() {
  const cs = S.proyecto.circuitos || [];
  const ult = cs[cs.length - 1];
  const bajo = +((ult ? +ult.bajo_cima_m : +(S.proyecto.criterios.amarre_bajo_cima_m ?? 0.7)) + 1.2).toFixed(2);
  return { nombre: `Circuito ${cs.length + 2}`, tension_kv: 13.8, conductor: clon(S.proyecto.conductor), n_fases: 3, desde: '', hasta: '', bajo_cima_m: bajo, peso_herrajes_kgf: 40, long_cadena_aisladores_m: 0, activo: true };
}
function modalConductorCircuito(i) {
  const c = S.proyecto.circuitos[i];
  const m = modal(`Conductor · ${c.nombre}`, `<div class="form-grid cols-2">${CAMPOS_CONDUCTOR.map(([k, etq, txt]) => `<label class="field-group"><span class="field-label">${etq}</span><input class="input" data-k="${k}" ${txt ? '' : 'inputmode="decimal"'} value="${h(c.conductor?.[k] ?? '')}"></label>`).join('')}</div><p class="small muted">Datos de catálogo: confírmelos con la ficha técnica del fabricante.</p>`,
    '<button class="btn" data-x>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>');
  $('[data-x]', m.root).onclick = m.cerrar;
  $('[data-ok]', m.root).onclick = () => {
    const nuevo = { ...(c.conductor || {}) };
    for (const [k, etq, txt] of CAMPOS_CONDUCTOR) {
      const v = $(`[data-k="${k}"]`, m.root).value.trim();
      if (txt) { nuevo[k] = v || 'Conductor'; continue; }
      const n = num(v); if (n == null || Number.isNaN(n) || n <= 0) return toast(`${etq}: valor inválido.`, 'warn');
      nuevo[k] = n;
    }
    c.conductor = nuevo; m.cerrar(); marcarCambio(); ir('parametros', true); toast('Conductor del circuito actualizado.', 'success');
  };
}
function enlazarCircuitos(vc) {
  const add = $('#circ-add', vc); if (!add) return;
  const selPpal = $('#circ-ppal-cond', vc);
  if (selPpal) selPpal.onchange = (e) => {
    const c = S.conductores[e.target.value]; if (!c) return;
    S.proyecto.conductor = clon(c); marcarCambio(); ir('parametros', true); toast(`Conductor ${c.nombre} cargado en el circuito principal.`, 'success');
  };
  add.onclick = () => { S.proyecto.circuitos = S.proyecto.circuitos || []; S.proyecto.circuitos.push(nuevoCircuito()); marcarCambio(); ir('parametros', true); toast('Circuito agregado: elija su conductor, tramo y altura de montaje.', 'success'); };
  $$('[data-cdel]', vc).forEach((b) => b.onclick = () => { S.proyecto.circuitos.splice(+b.dataset.cdel, 1); marcarCambio(); ir('parametros', true); });
  $$('[data-cedit]', vc).forEach((b) => b.onclick = () => modalConductorCircuito(+b.dataset.cedit));
  $$('[data-ck]', vc).forEach((el) => el.addEventListener('change', () => {
    const c = S.proyecto.circuitos[+el.closest('tr').dataset.c], k = el.dataset.ck;
    if (k === 'activo') { c.activo = el.checked; marcarCambio(); return ir('parametros', true); }
    if (k === 'conductor') { const cc = S.conductores[el.value]; if (cc) { c.conductor = clon(cc); marcarCambio(); ir('parametros', true); } return; }
    if (['nombre', 'desde', 'hasta'].includes(k)) { c[k] = el.value.replace(/ \(no existe\)$/, '').trim(); if (k === 'nombre' && !c[k]) c[k] = 'Circuito'; marcarCambio(); return; }
    const n = num(el.value);
    if (n == null || Number.isNaN(n) || n < 0 || (k !== 'bajo_cima_m' && k !== 'peso_herrajes_kgf' && n === 0)) { el.classList.add('bad'); return toast(`Valor inválido: «${el.value}»`, 'warn'); }
    el.classList.remove('bad'); c[k] = k === 'n_fases' ? Math.round(n) : n; marcarCambio();
  }));
}

const VISTAS = {
  resumen() {
    const r = S.resultado;
    if (!r) {
      return `<div class="page-head"><div><h1>Plantillado y cálculo mecánico</h1><p>Catenarias, cambio de estado por vano regulador, distancias de seguridad, gravivano/eolovano y exportación a Excel, PDF y DXF. Hipótesis por defecto según EH-RAA-004 (Electrohuila).</p></div></div>
      <div class="split"><div>${sinResultado()}</div>
      <div class="card"><div class="section-head"><h3>Cómo empezar</h3></div><ol class="steps">
        <li><span><b>Estructuras y mapa:</b> registre cada estructura con coordenadas, cota, poste (altura, carga de rotura, peso) y, donde se necesiten, sus templetes.</span></li>
        <li><span><b>Parámetros:</b> revise conductor, hipótesis, distancia mínima y criterios de postes y templetes.</span></li>
        <li><span><b>Calcular</b> y revise el <b>perfil</b>, los <b>resultados</b> (postes y templetes) y las <b>advertencias</b>.</span></li>
        <li><span><b>Exportar</b> la memoria (Excel), el plano (PDF) y el DXF 1:1.</span></li></ol>
        <hr class="hr"><button class="btn btn-small btn-soft" data-act="ir-datos">📍 Ir a Estructuras y mapa</button></div></div>`;
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
      ${s['Postes que requieren templete'] != null ? `<div class="card stat ${s['Postes que requieren templete'] || s['Templetes insuficientes'] ? 'alert' : 'good'}"><span class="stat-label">Postes y templetes</span><span class="stat-value">${s['Postes que requieren templete']} / ${s['Templetes insuficientes']}</span><span class="stat-note ${s['Postes que requieren templete'] || s['Templetes insuficientes'] ? 'note-warn' : 'note-good'}">requieren templete / templetes insuficientes · <a href="#resultados" data-tabres="postes">ver</a></span></div>` : ''}
      ${s['Circuitos'] ? (() => { const ns = s['Separaciones entre circuitos que no cumplen'] || 0, nt = s['Vanos sin distancia a terreno (otros circuitos)'] || 0; return `<div class="card stat ${ns || nt ? 'alert' : 'good'}"><span class="stat-label">Circuitos en las estructuras</span><span class="stat-value">${s['Circuitos']}</span><span class="stat-note ${ns || nt ? 'note-warn' : 'note-good'}">${ns} separación(es) sin cumplir · ${nt} vano(s) de otros circuitos sin distancia · <a href="#resultados" data-tabres="circuitos">ver</a></span></div>`; })() : ''}
      <div class="card stat"><span class="stat-label">Advertencias</span><span class="stat-value">${r.advertencias.length}</span><span class="stat-note"><a href="#advertencias">Ver detalle →</a></span></div>
      <div class="card stat"><span class="stat-label">Motor de cálculo</span><span class="stat-value" style="font-size:16px">${h(S.motor.etiqueta)}</span><span class="stat-note">Python v${h(S.motor.version || '')}</span></div>
    </div>
    <div class="card" style="margin-top:18px"><div class="section-head"><h2>Perfil completo</h2><div class="actions">${botonColocar()}<button class="btn btn-small btn-soft" data-act="ir-perfil">Ver por páginas →</button></div></div>${avisoColocar()}
    <div class="zoom-bar"><div class="zoom-ctl"><button class="btn btn-small" id="zm-mas" title="Acercar">＋</button><button class="btn btn-small" id="zm-menos" title="Alejar">－</button><button class="btn btn-small" id="zm-todo" title="Ver toda la línea">⤢ Ver todo</button></div>
      <span class="small muted" id="zm-info"></span><span class="small muted zoom-ayuda">Rueda del ratón o pellizco: zoom · Arrastrar: mover · Doble clic: acercar</span></div>
    <div class="perfil-wrap" id="perfil-mini"></div></div>`;
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
      ${tarjetaCircuitos()}
      ${tarjetaClima()}
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
        ${campo('salida.exageracion_vertical_perfil', 'Escala vertical del perfil (Y n:1)', p.salida.exageracion_vertical_perfil ?? 5, 'X 1:1 · Y 5:1 (alturas ×5) en pantalla, PDF y DXF. En pantalla/PDF, si no cabe se parte en tramos')}
        ${campo('salida.intervalo_cotas_m', 'Intervalo de cotas del perfil (m)', p.salida.intervalo_cotas_m ?? 5, 'Líneas del eje Y cada 5 m (pantalla y PDF)')}

      </div></div>
      <div class="card"><div class="section-head"><h2>Postes y templetes</h2><span class="muted small">Verifíquelos contra RETIE y la norma del operador de red</span></div><div class="form-grid cols-3">
        <label class="field-group"><span class="field-label">Hipótesis de cargas</span><select class="select" data-path="criterios.hipotesis_estructuras" data-texto="1">${Object.keys(p.hipotesis).map((k) => `<option ${k === (cr.hipotesis_estructuras || 'TMAX') ? 'selected' : ''}>${k}</option>`).join('')}</select><span class="field-help">Viento máximo y tensión de esa hipótesis</span></label>
        ${campo('criterios.empotramiento_coef', 'Empotramiento: coeficiente × L', cr.empotramiento_coef ?? 0.1, 'e = 0.10·L + 0.60 m')}
        ${campo('criterios.empotramiento_base_m', 'Empotramiento: base (m)', cr.empotramiento_base_m ?? 0.6)}
        ${campo('criterios.amarre_bajo_cima_m', 'Amarre bajo la cima (m)', cr.amarre_bajo_cima_m ?? 0.7, 'Conductor más bajo. Amarre = L − e − este valor. EH-RAA-004 §7.1: 0,70 m. Si el poste tiene estructura EH asignada, se usa la de la estructura.')}
        ${campo('criterios.fs_poste', 'Factor de seguridad del poste', cr.fs_poste ?? 2.5, 'Carga de trabajo = rotura / FS')}
        ${campo('criterios.fs_templete', 'Factor de seguridad del templete', cr.fs_templete ?? 2.5)}
        ${campo('criterios.poste_diametro_medio_m', 'Diámetro medio del poste (m)', cr.poste_diametro_medio_m ?? 0.25, 'Para el viento sobre el poste')}
        ${campo('criterios.peso_herrajes_kgf', 'Peso de herrajes por estructura (kgf)', cr.peso_herrajes_kgf ?? 40)}
      </div></div>
    </div>`;
  },

  vista3d() {
    if (!S.resultado) return sinResultado();
    const ap = S.resultado.perfil?.apoyos || [];
    if (ap.some((a) => a.lat == null)) return `<div class="card empty"><div class="big">◆</div><h3>Faltan coordenadas</h3><p>La vista 3D necesita latitud y longitud de las estructuras (Estructuras y mapa).</p></div>`;
    const sinEst = S.apoyos.filter((a) => !a.estructura).length;
    return `${avisoDesactualizado()}<div class="page-head"><div><h1>Vista 3D</h1><p>Postes y estructuras EH como bloques 3D (los mismos de la biblioteca y de los planos DXF/DWG) y conductores con la catenaria del cálculo mecánico. Arrastre para girar, rueda para acercar, clic derecho o Mayús+arrastre para desplazar.${sinEst ? ` <b>${sinEst} estructura(s) sin estructura EH asignada</b> se dibujan con una cruceta genérica.` : ''}</p></div>
      <div class="actions"><button class="btn btn-navy" data-act="cad-dwg">⇩ DWG</button><button class="btn" data-act="cad-dxf">⇩ DXF</button><button class="btn" data-act="kml3d">⇩ Google Earth</button><button class="btn" id="v3-img">⇩ Imagen</button></div></div>
      <div class="card" style="padding:10px"><div class="actions" style="margin-bottom:8px;flex-wrap:wrap">
        <label class="small">Ir a <select class="select" id="v3-poste" style="width:auto">${ap.map((a, k) => `<option value="${k}">${h(a.nombre)}</option>`).join('')}</select></label>
        <button class="btn btn-small" id="v3-todo">Ver toda la línea</button>
        <label class="small" style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="v3-frio"> Conductor en frío</label>
        <label class="small">Escala vertical <select class="select" id="v3-ex" style="width:auto"><option value="1">1:1</option><option value="2">×2</option><option value="3">×3</option></select></label>
        <span class="small muted" id="v3-info"></span></div>
        <div id="visor3d" style="height:calc(100vh - 290px);min-height:380px;border-radius:8px;overflow:hidden;background:#eef3f7"><p class="muted" style="padding:20px">Cargando el visor 3D…</p></div></div>`;
  },

  perfil() {
    const r = S.resultado;
    if (!r) return sinResultado();
    const leyCirc = (r.perfil.circuitos || []).map((c, n) => `<span><i style="border-color:${COLORES_CIRCUITOS[n % COLORES_CIRCUITOS.length]}"></i>${h(c.nombre)} (${nf(c.tension_kv)} kV · ${h(c.conductor)})</span>`).join('');
    const opts = '';
    return `${avisoDesactualizado()}<div class="page-head"><div><h1>Perfil / plantillado</h1><p>Toque un apoyo o un vano para ver sus datos. ▲ = arrancamiento · ✕ = no cumple distancia mínima.</p></div></div>
    <div class="card"><div class="perfil-bar"><div class="perfil-nav"><button class="btn btn-small" id="pag-ant">◀</button><select class="select" id="pag-sel" style="width:auto">${opts}</select><button class="btn btn-small" id="pag-sig">▶</button></div>
      <div class="actions">${botonColocar()}<span class="muted small" id="pag-info"></span></div></div>${avisoColocar()}
      <div class="perfil-wrap" id="perfil-svg"></div>
      <div class="perfil-legend"><span><i style="border-color:#1f6fb2"></i>${(r.perfil.circuitos || []).length ? `${h(r.perfil.circuito_principal || 'Circuito 1')} · ` : ''}Conductor caliente (${h(S.proyecto.hipotesis_plantillado)})</span>${r.perfil.modo === 'cambio_estado' ? `<span><i style="border-color:#7fb6df;border-top-style:dashed"></i>Conductor frío (${h(S.proyecto.hipotesis_arrancamiento)})</span>` : ''}${r.perfil.terreno ? `<span><i style="border-color:#a07c4a"></i>Terreno</span><span><i style="border-color:#c84c4c;border-top-style:dashed"></i>Distancia mínima ${nf(r.perfil.dmin)} m</span>` : ''}${leyCirc}<span>■ Retención · ● Suspensión</span></div></div>`;
  },

  resultados() {
    const r = S.resultado;
    if (!r) return sinResultado();
    const pc = r.perfil.circuitos || [];
    const tabs = [['vanos', pc.length ? `Vanos ${r.perfil.circuito_principal || 'Circuito 1'}` : 'Vanos'], ...pc.map((c, n) => [`cv${n}`, `Vanos ${c.nombre}`]),
      ['apoyos', 'Apoyos'], ...(r.postes ? [['postes', 'Postes y templetes']] : []),
      ...(r.circuitos ? [['circuitos', 'Circuitos'], ...(r.separaciones ? [['separaciones', 'Separación entre circuitos']] : []), ...(r.cargas_circuitos ? [['cargas_circuitos', 'Cargas por circuito']] : [])] : []),
      ['secciones', 'Secciones de tendido']];
    const tabla = (k) => (/^cv\d+$/.test(k) ? pc[+k.slice(2)]?.vanos_tabla : r[k]);
    if (!tabla(S.tabRes)) S.tabRes = 'vanos';
    const t = tabla(S.tabRes);
    const alerta = (fila) => t.columnas.some((c, i) => (c === 'Cumple distancia' && fila[i] === 'NO') || (c === 'Cumple separación' && fila[i] === 'NO') || (c === 'Arrancamiento' && fila[i] === 'SÍ') || (c === 'Estado' && /REQUIERE|INSUFICIENTE/.test(fila[i] || '')));
    const celda = (v) => typeof v === 'number' ? `<td class="num">${nf(v, 3)}</td>` : `<td>${h(v ?? '')}</td>`;
    return `${avisoDesactualizado()}<div class="page-head"><div><h1>Resultados</h1><p>Filas en rojo: no cumple distancia${pc.length ? ' o separación entre circuitos' : ''}, tiene arrancamiento, el poste requiere templete o el templete es insuficiente.</p></div><div class="actions"><button class="btn btn-navy" data-act="xlsx">⇩ Exportar Excel</button></div></div>
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
      <div class="card export-card"><div class="ico" style="background:#7a4fa3">CAD</div><h3 style="margin:0;color:var(--navy)">Plano en planta + 3D (AutoCAD)</h3><p class="muted small" style="margin:0;flex:1">Planta (eje, postes, crucetas, fases, nombres, estructura EH, vanos y ángulos) y modelo 3D con cotas reales: cada poste y su estructura EH como <b>bloque 3D sólido</b> (poste con su diámetro, crucetas, aisladores, herrajes, transformador) girado según la línea, y los conductores con la catenaria del cálculo mecánico, cable de guarda, terreno y distancia mínima. Coordenadas MAGNA-SIRGAS Origen Nacional. El DWG se genera con el AutoCAD de este PC.</p><div class="actions"><button class="btn btn-navy" data-act="cad-dxf">⇩ DXF</button><button class="btn" data-act="cad-dwg">⇩ DWG</button></div></div>
      <div class="card export-card"><div class="ico" style="background:#a35a2f">EH</div><h3 style="margin:0;color:var(--navy)">Biblioteca 3D de estructuras EH</h3><p class="muted small" style="margin:0;flex:1">Todas las estructuras de la norma de Electrohuila (MT, BT, redes compactas, equipos y subestaciones tipo poste) y postes de 8 a 18 m como bloques 3D, en un solo archivo. Se guarda en la carpeta <code>estructuras_eh</code> de la app y los planos usan los mismos bloques.</p><div class="actions"><button class="btn btn-navy" data-act="bib-dwg">⇩ Generar DXF + DWG</button></div></div>
      <div class="card export-card"><div class="ico" style="background:#2f8f4e">3D</div><h3 style="margin:0;color:var(--navy)">Google Earth 3D</h3><p class="muted small" style="margin:0;flex:1">Postes y crucetas según la estructura EH de cada poste, fases con su catenaria (caliente y fría), cable de guarda, distancia mínima al terreno y vanos que no cumplen. Requiere coordenadas y un cálculo.</p><button class="btn btn-navy" data-act="kml3d">⇩ Descargar KML 3D</button></div>
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
        <li><span>Distancia al terreno, separación de fases e = k·√(F+L) + kV/150, tensiones en apoyos, eolovano, <b>gravivano</b> y arrancamiento.</span></li>
        <li><span><b>Varios circuitos</b> en la misma estructura: cada uno se plantilla en su tramo con su conductor; separación vertical entre circuitos (superior con flecha máxima, inferior a 20 °C) y suma de momentos M = Σ F<sub>c</sub>·h<sub>c</sub> en postes y templetes.</span></li></ol></div>
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
  async vista3d(vc) {
    enlazarAcciones(vc);
    const cont = $('#visor3d', vc); if (!cont) return;
    const abrir = async () => {
      if (S.visor) { try { S.visor.liberar(); } catch { /* */ } S.visor = null; }
      try {
        S.visor = await visorProyecto(cont, { S, catalogo: await cargarCatalogo(), opciones: { frio: $('#v3-frio', vc).checked, exageracion: +$('#v3-ex', vc).value } });
        $('#v3-info', vc).textContent = `${S.visor.info.postes} estructuras${S.visor.info.alertas ? ` · ${S.visor.info.alertas} vano(s) que no cumplen (esferas rojas)` : ''}`;
      } catch (e) { cont.innerHTML = `<p style="padding:20px;color:var(--danger)">No se pudo abrir el visor 3D: ${h(e.message)}. Se necesita conexión a internet la primera vez (librería three.js).</p>`; }
    };
    await abrir();
    $('#v3-poste', vc).onchange = (e) => S.visor?.irPoste(+e.target.value);
    $('#v3-todo', vc).onclick = abrir;
    $('#v3-frio', vc).onchange = abrir;
    $('#v3-ex', vc).onchange = abrir;
    $('#v3-img', vc).onclick = async () => { if (!S.visor) return; descargar(await (await fetch(S.visor.imagen())).blob(), `${(S.proyecto.nombre || 'proyecto').replace(/[^\p{L}\p{N}\-]+/gu, '_')}_3D.png`); };
  },
  resumen(vc) {
    enlazarAcciones(vc); enlazarColocar(vc);
    $$('[data-tabres]', vc).forEach((l) => l.addEventListener('click', () => { S.tabRes = l.dataset.tabres; }));
    const mini = $('#perfil-mini', vc);
    if (mini && S.resultado) {
      S.zoomResumen = S.zoomResumen || {};
      const info = $('#zm-info', vc);
      const ctl = perfilInteractivo(mini, S.resultado.perfil, {
        tipApoyo, tipVano, pasoY: S.proyecto.salida?.intervalo_cotas_m ?? 5, ...(S.colocando ? { onColocar: colocarEnPerfil } : {}),
        onVentana: (v, X0, X1) => { info.textContent = v ? `Mostrando ${abscisaK(v[0] - X0)} – ${abscisaK(v[1] - X0)} de ${abscisaK(X1 - X0)} (${nf(v[1] - v[0], 0)} m)` : `Toda la línea · ${abscisaK(X1 - X0)}`; },
      }, S.zoomResumen);
      $('#zm-mas', vc).onclick = ctl.acercar; $('#zm-menos', vc).onclick = ctl.alejar; $('#zm-todo', vc).onclick = ctl.todo;
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
      if (ruta[0] === 'hipotesis' && ['temperatura_c', 'viento_kmh'].includes(ruta[2])) { renombrar(ruta[1], S.proyecto.hipotesis[ruta[1]]); ir('parametros', true); return; }
      if (el.dataset.rerender) ir('parametros', true);
    }));
    $('#sel-conductor', vc).onchange = (e) => {
      const c = S.conductores[e.target.value]; if (!c) return;
      S.proyecto.conductor = clon(c); marcarCambio(); ir('parametros', true); toast(`Conductor ${c.nombre} cargado.`, 'success');
    };
    enlazarCircuitos(vc);
    enlazarClima(vc);
    $('#gm-ver', vc).onclick = () => { const k = $('#gm-key', vc); k.type = k.type === 'password' ? 'text' : 'password'; };
    $('#gm-guardar', vc).onclick = async () => {
      S.config = { ...(S.config || {}), google_maps_key: $('#gm-key', vc).value.trim() };
      await S.motor.guardarConfig(S.config); toast('Clave guardada. Abra «Mapa / planta» para ver el satélite.', 'success');
    };
    $('#btn-restablecer', vc).onclick = () => { const n = S.proyecto.nombre, circ = S.proyecto.circuitos || []; S.proyecto = clon(S.defaults); S.proyecto.nombre = n; S.proyecto.circuitos = circ; marcarCambio(); ir('parametros', true); toast('Parámetros restablecidos (EH-RAA-004).'); };
  },
  perfil(vc) {
    enlazarAcciones(vc); enlazarColocar(vc);
    const cont = $('#perfil-svg', vc); if (!cont) return;
    const perfil = S.resultado.perfil;
    const exV = +(S.proyecto.salida?.exageracion_vertical_perfil ?? 5);
    // escala fija X 1:1 · Y exV:1: el trazado se parte en tramos que quepan en pantalla
    const { pags, kx } = exV > 0 ? paginasEscala(perfil, cont, exV, porPagina()) : { pags: paginas(perfil, porPagina()), kx: 0 };
    S.pagina = Math.min(S.pagina, pags.length - 1);
    $('#pag-sel', vc).innerHTML = pags.map(([a, b], i) => `<option value="${i}">Tramo ${i + 1}: vanos ${a + 1}–${b}</option>`).join('') + '<option value="-1">Toda la línea (vista general, sin escala)</option>';
    $('#pag-info', vc).textContent = `${perfil.vanos.length} vanos · ${pags.length} tramo(s)${exV > 0 ? ` · escala X 1:1 · Y ${exV}:1` : ''}`;
    const pintar = () => {
      const [a, b] = S.pagina === -1 ? [0, perfil.vanos.length] : pags[S.pagina];
      const escala = S.pagina === -1 || !(exV > 0) ? {} : { exV, kx };
      dibujarPerfil(cont, perfil, a, b, { tipApoyo, tipVano, pasoY: S.proyecto.salida?.intervalo_cotas_m ?? 5, ...escala, ...(S.colocando ? { onColocar: colocarEnPerfil } : {}) });
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
  pegarTerreno: () => modalPegar('terreno'), estadoProyecto, aplicarEstado,
  ir, marcarCambio, guardar, calcular, actualizarCabecera, asegurarMotor, enlazarAcciones, importarExcel, exportar,
  climaProyecto: (proyecto, municipio) => aplicarClima(proyecto, buscarMunicipio(S.clima, municipio)),
  asegurarClima: () => asegurarClima(),
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
    if (esTer) { S.terreno = reemplazar ? nuevos : S.terreno.concat(nuevos).sort((a, b) => a.x - b.x); S.meta.terreno = null; }
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
  S.defaults = def.proyecto_defecto; S.conductores = def.conductores; S.catPostes = def.postes || []; S.catCables = def.cables_templete || [];
  S.clima = await cargarClima();
  const guardado = restaurar() || {};
  aplicarEstado(guardado);
  S.meta = guardado.meta || {};
  asegurarClima();

  S.motor = await detectarMotor((msg, pct) => progresoMotor(msg, pct));
  S.config = await S.motor.config();
  if (S.motor.tipo === 'servidor' && def.version && S.motor.version && S.motor.version !== def.version) {
    modal('Reinicie el servidor de la app', `<p>La app se actualizó a la versión <b>${h(def.version)}</b>, pero el servidor que está corriendo es la <b>${h(S.motor.version)}</b>. Algunas funciones nuevas no responderán hasta reiniciarlo.</p><ol class="steps"><li><span>Cierre la ventana negra del servidor (o pulse Ctrl+C en ella).</span></li><li><span>Ejecute de nuevo <code>INICIAR_APP.bat</code>.</span></li><li><span>Recargue esta página con <b>Ctrl+F5</b>.</span></li></ol>`);
  }
  const sincronizado = await GEO.sincronizarAlIniciar();
  pintarMotor(); actualizarCabecera();
  ir(location.hash.slice(1) || 'resumen', true);
  if (sincronizado) toast('Se cargó la versión más reciente guardada del proyecto.', 'success');
  if (!S.meta.id && S.apoyos.length) GEO.guardarServidor(); // todo proyecto queda registrado
  if (S.apoyos.length >= 2 && S.motor.tipo === 'servidor' && !S.resultado) calcular();
  // modo web: Python se descarga en segundo plano desde que abre la página (no hay que esperar al calcular)
  if (S.motor.tipo === 'navegador') S.motor.listo().then(pintarMotor).catch((e) => {
    const txt = $('#motor-texto'); if (txt) txt.textContent = 'No cargó Python: ' + e.message + ' · Toque «Calcular» para reintentar';
  });
}

iniciar().catch((e) => { console.error(e); toast('No se pudo iniciar la app: ' + e.message, 'error'); });
