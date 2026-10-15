// Etapa 1: proyectos persistentes, asistente de importación con sistemas de coordenadas,
// pestaña «Estructuras y mapa»: tabla CRUD sincronizada con el mapa (Leaflet, Google o planta propia), deshacer/rehacer.
import { PlantaSVG, PlantaGoogle, PlantaLeaflet, cargarGoogle, cargarLeaflet } from './mapa.js?v=6';

export function instalarGeo(C) {
  const { S, $, $$, h, nf, num, toast, modal, cargando } = C;
  S.meta = S.meta || {};
  S.hist = { pila: [], futuro: [] };
  S.sel = -1;
  S.mapaModo = 'mover';
  S.capas = { etiquetas: true, coords: false };
  let planta = null, sistemas = null, tGuardar = null;

  // ------------------------------------------------------------- utilidades
  const hayGeo = () => S.apoyos.some((a) => a.lat != null && a.lat !== '');
  const servidor = () => S.motor?.tipo === 'servidor';
  async function rpc(nombre, datos) {
    await C.asegurarMotor();
    const r = await S.motor.rpc(nombre, datos || {});
    if (!r.ok && r.errores) throw new Error(r.errores.join(' '));
    return r;
  }
  async function listaSistemas() {
    if (!sistemas) sistemas = await rpc('geo_sistemas');
    return sistemas;
  }
  const nuevoId = () => 'P-' + Math.random().toString(16).slice(2, 12);
  function nombreUnico(base) {
    const usados = new Set(S.apoyos.map((a) => String(a.nombre)));
    if (!usados.has(base)) return base;
    for (let k = 1; ; k++) if (!usados.has(`${base}.${k}`)) return `${base}.${k}`;
  }

  // ------------------------------------------------------------- historial
  function cambiar(fn, desc = '') {
    S.hist.pila.push(JSON.stringify(S.apoyos));
    if (S.hist.pila.length > 150) S.hist.pila.shift();
    S.hist.futuro = [];
    fn();
    C.marcarCambio();
    programarGuardado(desc);
    refrescar();
  }
  function deshacer() {
    if (!S.hist.pila.length) return toast('Nada para deshacer.');
    S.hist.futuro.push(JSON.stringify(S.apoyos)); S.apoyos = JSON.parse(S.hist.pila.pop());
    C.marcarCambio(); programarGuardado('deshacer'); refrescar(); toast('Cambio deshecho.');
  }
  function rehacer() {
    if (!S.hist.futuro.length) return toast('Nada para rehacer.');
    S.hist.pila.push(JSON.stringify(S.apoyos)); S.apoyos = JSON.parse(S.hist.futuro.pop());
    C.marcarCambio(); programarGuardado('rehacer'); refrescar();
  }
  function refrescar() {
    if (S.vista === 'datos' && $('#dm-tabla')) { pintarPlanta(); pintarTabla(); }
    else if (S.vista === 'datos') C.ir('datos', true);
    pintarEstadoProyecto();
  }

  // ------------------------------------------------------------- persistencia en servidor
  function datosProyecto() {
    return { proyecto: S.proyecto, apoyos: S.apoyos, terreno: S.terreno, meta: S.meta };
  }
  function programarGuardado() {
    if (!servidor() || !S.meta.id) return;
    clearTimeout(tGuardar);
    tGuardar = setTimeout(guardarServidor, 1200);
  }
  async function guardarServidor(silencioso = true) {
    if (!servidor()) return;
    try {
      const r = await S.motor.proyectos.guardar(datosProyecto(), S.meta.id);
      S.meta.id = r.id; S.meta.guardado = r.actualizado; C.guardar(); pintarEstadoProyecto();
      if (!silencioso) toast('Proyecto guardado en el servidor.', 'success');
    } catch (e) { toast('No se pudo guardar: ' + e.message, 'error'); }
  }
  function pintarEstadoProyecto() {
    const el = $('#estado-guardado'); if (!el) return;
    el.textContent = S.meta.id ? (S.meta.guardado ? `Guardado ${S.meta.guardado.replace('T', ' ')}` : 'Sin guardar') : 'Proyecto local (no guardado en el servidor)';
  }
  function cargarProyecto(p) {
    const d = p.datos || {};
    S.proyecto = C.fusionar(C.clon(S.defaults), d.proyecto || {});
    S.apoyos = d.apoyos || []; S.terreno = d.terreno || [];
    S.meta = { ...(d.meta || {}), id: p.id, guardado: p.actualizado };
    S.resultado = null; S.hist = { pila: [], futuro: [] }; S.sel = -1; C.guardar(); C.actualizarCabecera();
  }

  // ===================================================================== PROYECTOS
  function vistaProyectos() {
    return `<div class="page-head"><div><h1>Proyectos</h1><p>${servidor() ? 'Los proyectos se guardan en el servidor (base de datos SQLite), con versiones e historial de cambios.' : 'Modo navegador: los proyectos se guardan en este dispositivo y como archivo <code>.cmt.json</code>.'}</p></div>
      <div class="actions"><button class="btn btn-primary" id="btn-nuevo-proy">＋ Nuevo proyecto</button>${servidor() ? '<button class="btn" id="btn-guardar-ver">⎘ Guardar versión</button>' : ''}<button class="btn" data-act="abrir-proyecto">⇪ Abrir archivo</button></div></div>
      <div class="card"><div class="section-head"><h2>Proyecto actual</h2><span class="muted small" id="estado-guardado"></span></div>
        <dl class="kv"><dt>Nombre</dt><dd>${h(S.proyecto.nombre)}</dd><dt>Ubicación</dt><dd>${h([S.meta.municipio, S.meta.departamento].filter(Boolean).join(', ') || '—')}</dd>
        <dt>Sistema de los datos</dt><dd>${h(S.meta.sistemaNombre || S.meta.sistema || '—')}</dd><dt>Postes</dt><dd>${S.apoyos.length}${hayGeo() ? ' (georreferenciados)' : ''}</dd></dl></div>
      ${servidor() ? '<div class="card" style="margin-top:18px"><div class="section-head"><h2>Proyectos en el servidor</h2></div><div id="lista-proy" class="muted">Cargando…</div></div>' : ''}`;
  }
  async function enlazarProyectos(vc) {
    C.enlazarAcciones(vc); pintarEstadoProyecto();
    $('#btn-nuevo-proy', vc).onclick = asistenteNuevo;
    const bv = $('#btn-guardar-ver', vc);
    if (bv) bv.onclick = async () => {
      if (!S.meta.id) await guardarServidor(false);
      const com = prompt('Comentario de la versión (opcional):', '') ?? null;
      if (com === null) return;
      await guardarServidor(); await S.motor.proyectos.version(S.meta.id, com);
      toast('Versión guardada.', 'success'); C.ir('proyectos', true);
    };
    if (!servidor()) return;
    try {
      const lista = await S.motor.proyectos.listar();
      const el = $('#lista-proy', vc); if (!el) return;
      if (!lista.length) { el.innerHTML = '<div class="empty"><h3>Sin proyectos guardados</h3><p>Cree uno nuevo o guarde el actual.</p><button class="btn btn-soft" id="btn-guardar-actual">Guardar el proyecto actual</button></div>'; $('#btn-guardar-actual', vc).onclick = () => guardarServidor(false).then(() => C.ir('proyectos', true)); return; }
      el.className = '';
      el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Proyecto</th><th>Municipio</th><th>Postes</th><th>Versiones</th><th>Actualizado</th><th></th></tr></thead><tbody>${lista.map((p) => `<tr class="${p.id === S.meta.id ? 'row-actual' : ''}"><td><b>${h(p.nombre)}</b></td><td>${h(p.municipio || '')}</td><td class="num">${p.n_postes ?? 0}</td><td class="num">${p.n_versiones}</td><td>${h((p.actualizado || '').replace('T', ' '))}</td>
        <td><button class="btn btn-small btn-soft" data-abrir="${p.id}">Abrir</button> <button class="btn btn-small" data-vers="${p.id}">Versiones</button> <button class="btn btn-small" data-arch="${p.id}" title="Archivar">Archivar</button></td></tr>`).join('')}</tbody></table></div>`;
      $$('[data-abrir]', el).forEach((b) => b.onclick = async () => { const p = await S.motor.proyectos.obtener(b.dataset.abrir); cargarProyecto(p); toast(`Proyecto «${p.nombre}» abierto.`, 'success'); C.ir('datos'); });
      $$('[data-vers]', el).forEach((b) => b.onclick = () => modalVersiones(b.dataset.vers));
      $$('[data-arch]', el).forEach((b) => b.onclick = async () => { if (!confirm('¿Archivar el proyecto? Deja de aparecer en la lista (no se borra).')) return; await S.motor.proyectos.archivar(b.dataset.arch); if (b.dataset.arch === S.meta.id) S.meta.id = null; C.ir('proyectos', true); });
    } catch (e) { const el = $('#lista-proy', vc); if (el) el.textContent = 'No se pudo cargar la lista: ' + e.message; }
  }
  async function modalVersiones(pid) {
    const v = await S.motor.proyectos.versiones(pid);
    const m = modal('Versiones guardadas', v.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Fecha</th><th>Comentario</th><th></th></tr></thead><tbody>${v.map((x) => `<tr><td>${x.id}</td><td>${h(x.fecha.replace('T', ' '))}</td><td>${h(x.comentario || '')}</td><td><button class="btn btn-small btn-soft" data-rest="${x.id}">Restaurar</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Este proyecto no tiene versiones guardadas.</p>');
    $$('[data-rest]', m.root).forEach((b) => b.onclick = async () => {
      const ver = await S.motor.proyectos.version_obtener(pid, b.dataset.rest);
      cargarProyecto({ id: pid, datos: ver.datos }); m.cerrar();
      await guardarServidor(); toast(`Versión ${b.dataset.rest} restaurada (el estado anterior sigue en el historial).`, 'success'); C.ir('proyectos', true);
    });
  }
  async function asistenteNuevo() {
    let info = { departamentos: { Huila: [] } }, sist = { sistemas: [] };
    try { info = await rpc('municipios'); sist = await listaSistemas(); } catch (e) { toast(e.message, 'error'); }
    const muni = info.departamentos.Huila;
    const m = modal('Nuevo proyecto', `<div class="form-grid">
      <label class="field-group full"><span class="field-label">Nombre del proyecto</span><input class="input" id="np-nombre" placeholder="Ej. Red MT vereda El Caguán"></label>
      <label class="field-group"><span class="field-label">Departamento</span><select class="select" id="np-dep"><option>Huila</option></select></label>
      <label class="field-group"><span class="field-label">Municipio</span><select class="select" id="np-mun">${muni.map((x) => `<option ${x === 'Neiva' ? 'selected' : ''}>${h(x)}</option>`).join('')}</select></label>
      <label class="field-group full"><span class="field-label">¿Qué tipo de coordenadas tiene?</span><select class="select" id="np-sis">${sist.sistemas.map((s) => `<option value="${s.codigo}">${h(s.nombre)}</option>`).join('')}<option value="DESCONOCIDO">No sé — que la app lo identifique al importar</option></select><span class="field-help">Se puede cambiar en cada importación. Los cálculos internos usan MAGNA-SIRGAS Origen Nacional.</span></label>
      <label class="field-group full" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="np-vaciar" checked> <span class="small">Empezar con la lista de postes vacía (el proyecto actual queda guardado si ya estaba en el servidor)</span></label></div>`,
    '<button class="btn" data-x>Cancelar</button><button class="btn btn-primary" data-ok>Crear proyecto</button>');
    $('[data-x]', m.root).onclick = m.cerrar;
    $('[data-ok]', m.root).onclick = async () => {
      const nombre = $('#np-nombre').value.trim(); if (!nombre) return toast('Escriba un nombre.', 'warn');
      if ($('#np-vaciar').checked) { S.apoyos = []; S.terreno = []; S.resultado = null; }
      const sel = $('#np-sis');
      S.proyecto.nombre = nombre;
      S.meta = { departamento: $('#np-dep').value, municipio: $('#np-mun').value, sistema: sel.value, sistemaNombre: sel.selectedOptions[0].textContent };
      S.hist = { pila: [], futuro: [] }; C.guardar(); C.actualizarCabecera(); m.cerrar();
      if (servidor()) await guardarServidor(false);
      toast('Proyecto creado. Ahora importe o ingrese las coordenadas de los postes.', 'success');
      C.ir('datos');
    };
  }

  // ===================================================================== ASISTENTE DE IMPORTACIÓN
  async function aBase64(archivo) {
    return new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = mal; r.readAsDataURL(archivo); });
  }
  async function asistente(archivo) {
    if (!archivo) return;
    let leido;
    try {
      cargando('Leyendo archivo…');
      leido = await rpc('importar_leer', { nombre: archivo.name, contenido: await aBase64(archivo) });
      await listaSistemas(); cargando('');
    } catch (e) { cargando(''); return modal('No se pudo leer el archivo', `<p>${h(e.message)}</p>`); }
    const st = { tabla: leido.tabla, mapeo: { ...leido.mapeo }, sistema: leido.tabla.sistema_declarado || (S.meta.sistema !== 'DESCONOCIDO' ? S.meta.sistema : '') || '', orden: leido.tabla.linea?.length ? 'linea_kml' : 'archivo', georref: { metodo: 'helmert', puntos: [], tolerancia_m: 0.10 }, previa: null, excluir: true };
    const esOriginal = /\.(xlsx|xlsm|xls)$/i.test(archivo.name) && leido.tabla.columnas.some((c) => /coordenada en x/i.test(c)) && leido.tabla.columnas.some((c) => /vano|flecha/i.test(c));
    const m = modal(`Importar ${archivo.name}`, '<div id="asis"></div>', '<button class="btn" data-x>Cancelar</button><button class="btn btn-soft" id="asis-prev">Revisar</button><button class="btn btn-primary" id="asis-ok" disabled>Importar postes</button>');
    $('.modal', m.root).style.width = 'min(1000px, 100%)';
    $('[data-x]', m.root).onclick = m.cerrar;
    const cuerpo = $('#asis', m.root);
    const opcCol = (sel) => `<option value="">—</option>${st.tabla.columnas.map((c) => `<option ${c === sel ? 'selected' : ''}>${h(c)}</option>`).join('')}`;
    function pintar() {
      const s = sistemas.sistemas.find((x) => x.codigo === st.sistema);
      const geoCampos = !s ? ['lat', 'lon', 'este', 'norte'] : s.tipo === 'geografico' ? ['lat', 'lon'] : ['este', 'norte'];
      const campos = ['nombre', 'id', ...geoCampos, 'z', 'altura', 'tipo', 'conductor', 'obs'];
      const cand = st.previa?.candidatos || [];
      cuerpo.innerHTML = `
        ${esOriginal ? `<div class="adv-list" style="margin-bottom:12px"><li class="info">ⓘ <span>Este Excel parece del formato original (abscisa X + cota Y, sin coordenadas geográficas). <button class="btn btn-small btn-soft" id="asis-orig">Importar como abscisa y cota</button></span></li></div>` : ''}
        <div class="form-grid cols-3">
          <label class="field-group full"><span class="field-label">1. Sistema de coordenadas de los datos</span>
            <select class="select" id="asis-sis"><option value="">— Seleccione —</option>${sistemas.sistemas.map((x) => `<option value="${x.codigo}" ${x.codigo === st.sistema ? 'selected' : ''}>${h(x.nombre)}${x.epsg ? ` (EPSG:${x.epsg})` : ''}</option>`).join('')}</select>
            ${cand.length ? `<span class="field-help">Probable según los valores y la ubicación esperada (Huila): ${cand.slice(0, 3).map((c) => `<a href="#" data-cand="${c.codigo}" data-inv="${c.ejes_invertidos ? 1 : 0}"><b>${h(c.nombre)}</b>${c.ejes_invertidos ? ' con ejes invertidos' : ''} (a ${c.distancia_km} km)</a>`).join(' · ')}. Confirme usted el sistema.</span>` : '<span class="field-help">Pulse «Revisar» para que la app proponga candidatos; usted confirma.</span>'}
            ${s?.nota ? `<span class="field-help">${h(s.nota)}</span>` : ''}</label>
          ${campos.map((c) => `<label class="field-group"><span class="field-label">${h(leido.campos[c] || c)}</span><select class="select" data-campo="${c}">${opcCol(st.mapeo[c])}</select></label>`).join('')}
          <label class="field-group"><span class="field-label">Orden de los postes</span><select class="select" id="asis-orden">
            <option value="archivo" ${st.orden === 'archivo' ? 'selected' : ''}>Orden de las filas del archivo</option>
            <option value="nombre" ${st.orden === 'nombre' ? 'selected' : ''}>Por nombre (AP-1, AP-2…)</option>
            ${st.tabla.linea?.length ? `<option value="linea_kml" ${st.orden === 'linea_kml' ? 'selected' : ''}>Según la línea del KML</option>` : ''}</select></label>
        </div>
        ${s?.tipo === 'local' ? `<div class="card" style="margin-top:12px;box-shadow:none"><div class="section-head"><h3>Puntos de control (georreferenciación local)</h3><span class="muted small">≥ 2 Helmert / ≥ 3 afín; con un punto más se verifican residuales</span></div>
          <p class="small muted">Una línea por punto: <code>x_local; y_local; Este; Norte</code> en MAGNA-SIRGAS Origen Nacional, o <code>x_local; y_local; latitud; longitud</code>. No se ubica nada sin estos puntos.</p>
          <textarea class="textarea" id="asis-ctrl" style="min-height:90px" placeholder="1000; 5000; 4746445.11; 1881735.44">${h(st.ctrlTexto || '')}</textarea>
          <div class="form-grid cols-3" style="margin-top:8px"><label class="field-group"><span class="field-label">Método</span><select class="select" id="asis-met"><option value="helmert" ${st.georref.metodo === 'helmert' ? 'selected' : ''}>Helmert 2D (4 parámetros)</option><option value="afin" ${st.georref.metodo === 'afin' ? 'selected' : ''}>Afín (6 parámetros)</option></select></label>
          <label class="field-group"><span class="field-label">Tolerancia RMS (m)</span><input class="input" id="asis-tol" value="${st.georref.tolerancia_m}"></label></div></div>` : ''}
        <div id="asis-res" style="margin-top:14px"></div>`;
      $('#asis-sis', cuerpo).onchange = (e) => { st.sistema = e.target.value; leerMapeo(); pintar(); };
      $$('[data-campo]', cuerpo).forEach((el) => el.onchange = () => { st.mapeo[el.dataset.campo] = el.value || undefined; });
      $('#asis-orden', cuerpo).onchange = (e) => { st.orden = e.target.value; };
      $$('[data-cand]', cuerpo).forEach((a) => a.onclick = (ev) => {
        ev.preventDefault(); st.sistema = a.dataset.cand;
        if (a.dataset.inv === '1') { // intercambiar columnas
          const [k1, k2] = sistemas.sistemas.find((x) => x.codigo === st.sistema).tipo === 'geografico' ? ['lat', 'lon'] : ['este', 'norte'];
          const o1 = st.mapeo.lat || st.mapeo.este, o2 = st.mapeo.lon || st.mapeo.norte;
          delete st.mapeo.lat; delete st.mapeo.lon; delete st.mapeo.este; delete st.mapeo.norte;
          st.mapeo[k1] = o2; st.mapeo[k2] = o1;
        }
        pintar(); revisar();
      });
      const bo = $('#asis-orig', cuerpo); if (bo) bo.onclick = () => { m.cerrar(); C.importarExcel(archivo); };
      if (st.previa) pintarPrevia();
    }
    function leerMapeo() {
      // pasar columnas asignadas entre lat/lon y este/norte al cambiar de tipo de sistema
      const s = sistemas.sistemas.find((x) => x.codigo === st.sistema);
      if (!s) return;
      if (s.tipo === 'geografico' && !st.mapeo.lat && st.mapeo.este) { st.mapeo.lat = st.mapeo.este; st.mapeo.lon = st.mapeo.norte; }
      if (s.tipo !== 'geografico' && !st.mapeo.este && st.mapeo.lat) { st.mapeo.este = st.mapeo.lat; st.mapeo.norte = st.mapeo.lon; }
    }
    async function controles() {
      const txt = $('#asis-ctrl', cuerpo)?.value || ''; st.ctrlTexto = txt;
      st.georref.metodo = $('#asis-met', cuerpo)?.value || 'helmert';
      st.georref.tolerancia_m = num($('#asis-tol', cuerpo)?.value) || 0.10;
      const filas = txt.split(/\r?\n/).map((l) => l.split(/[;\t]/).map((x) => x.trim())).filter((f) => f.length >= 4);
      const pts = [];
      for (const [i, f] of filas.entries()) {
        const x = num(f[0]), y = num(f[1]);
        let E = num(f[2]), N = num(f[3]);
        if (Math.abs(E) <= 90 && Math.abs(N) <= 180) { // lat/lon → Origen Nacional
          const r = await rpc('geo_transformar', { sistema: 'WGS84', puntos: [{ u: f[2], v: f[3] }] }); E = r.puntos[0].E; N = r.puntos[0].N;
        }
        pts.push({ id: `C${i + 1}`, x, y, E, N });
      }
      st.georref.puntos = pts;
    }
    async function revisar() {
      const s = sistemas.sistemas.find((x) => x.codigo === st.sistema);
      try {
        if (s?.tipo === 'local') await controles();
        const mapeo = Object.fromEntries(Object.entries(st.mapeo).filter(([, v]) => v));
        st.previa = await S.motor.rpc('importar_previa', { tabla: st.tabla, mapeo, sistema: st.sistema || null, georref: s?.tipo === 'local' ? st.georref : null, orden: st.orden });
      } catch (e) { st.previa = { ok: false, errores: [e.message], postes: [], avisos: [], candidatos: [] }; }
      pintar();
    }
    function pintarPrevia() {
      const r = st.previa, el = $('#asis-res', cuerpo);
      const conErr = r.postes.filter((p) => p.errores?.length).length;
      const validos = r.postes.filter((p) => !p.errores?.length);
      el.innerHTML = `${(r.errores || []).length ? `<ul class="adv-list">${r.errores.map((e) => `<li class="err">✖ ${h(e)}</li>`).join('')}</ul>` : ''}
        ${(r.avisos || []).length ? `<ul class="adv-list" style="margin-top:8px">${r.avisos.map((e) => `<li>⚠ ${h(e)}</li>`).join('')}</ul>` : ''}
        ${r.georref ? `<p class="small"><b>Georreferenciación ${h(r.georref.metodo)}:</b> RMS ${nf(r.georref.rms_m, 4)} m${r.georref.escala ? ` · escala ${nf(r.georref.escala, 7)} · rotación ${nf(r.georref.rotacion_grados, 4)}°` : ''} · residuales: ${r.georref.residuales.map((x) => `${h(x.id)} ${nf(x.d, 3)} m`).join(', ')}</p>` : ''}
        ${r.postes.length ? `<div class="grid grid-2" style="margin-top:10px;align-items:start"><div class="table-wrap" style="max-height:300px"><table><thead><tr><th>#</th><th>Poste</th><th>Latitud</th><th>Longitud</th><th>Cota Z</th><th>Vano</th><th>Estado</th></tr></thead><tbody>${r.postes.map((p, i) => `<tr class="${p.errores?.length ? 'row-alert' : ''}"><td>${i + 1}</td><td><b>${h(p.nombre)}</b></td><td class="num">${p.lat != null ? p.lat.toFixed(7) : '—'}</td><td class="num">${p.lon != null ? p.lon.toFixed(7) : '—'}</td><td class="num">${p.z ?? '—'}</td><td class="num">${p.vano_previo_m != null ? nf(p.vano_previo_m, 1) : ''}</td><td>${p.errores?.length ? h(p.errores.join('; ')) : '✓'}</td></tr>`).join('')}</tbody></table></div>
          <div><div class="perfil-wrap" id="asis-mini" style="height:300px;border:1px solid var(--border)"></div><p class="small muted">Vista previa del trazado en el orden elegido · ${h(r.motor_geo || '')}</p></div></div>
          <label class="small" style="display:flex;gap:6px;align-items:center;margin-top:10px"><input type="checkbox" id="asis-excl" ${st.excluir ? 'checked' : ''}> Excluir las ${conErr} fila(s) con errores</label>
          <label class="small" style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="asis-reempl" checked> Reemplazar los postes actuales del proyecto (${S.apoyos.length})</label>` : ''}`;
      if (r.postes.length) {
        const mini = new PlantaSVG($('#asis-mini', el), {});
        mini.setPostes(validos, -1, true);
        $('#asis-excl', el).onchange = (e) => { st.excluir = e.target.checked; habilitar(); };
      }
      habilitar();
      function habilitar() {
        const ok = r.postes.length && (st.excluir ? validos.length >= 1 : conErr === 0);
        $('#asis-ok', m.root).disabled = !ok;
      }
    }
    $('#asis-prev', m.root).onclick = revisar;
    $('#asis-ok', m.root).onclick = () => {
      const r = st.previa; if (!r) return;
      const nuevos = r.postes.filter((p) => !(st.excluir && p.errores?.length)).map((p) => {
        const { errores, fila, vano_previo_m, ...resto } = p; return resto;
      });
      const reemplazar = $('#asis-reempl', m.root)?.checked ?? true;
      cambiar(() => { S.apoyos = reemplazar ? nuevos : S.apoyos.concat(nuevos); }, 'importar');
      const s = sistemas.sistemas.find((x) => x.codigo === st.sistema);
      S.meta.sistema = st.sistema; S.meta.sistemaNombre = s?.nombre; S.meta.georref = r.georref || null;
      S.archivo = archivo.name; S.resultado = null; C.guardar(); programarGuardado();
      m.cerrar(); toast(`${nuevos.length} postes importados y ubicados.`, 'success');
      C.ir('datos', true); planta?.ajustar();
    };
    pintar(); revisar();
  }

  // ===================================================================== ESTRUCTURAS Y MAPA (una sola pestaña)
  // Tabla CRUD de estructuras (crear, leer, editar, eliminar, reordenar) enlazada al mapa:
  // cada fila registrada se dibuja de inmediato y lo que se haga en el mapa se ve en la tabla.
  const SIS_DEF = 'WGS84';
  const sisEntrada = () => S.meta.sisEntrada || SIS_DEF;
  function siguienteNombre() {
    const ult = S.apoyos[S.apoyos.length - 1];
    if (!ult) return 'AP-001';
    const m = String(ult.nombre).match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return nombreUnico(`AP-${String(S.apoyos.length + 1).padStart(3, '0')}`);
    return nombreUnico(`${m[1]}${String(+m[2] + 1).padStart(m[2].length, '0')}${m[3]}`);
  }
  function vistaEstructuras() {
    const herr = [['mover', '✥ Mover', 'Arrastrar y seleccionar estructuras'], ['insertar', '⊕ Insertar', 'Clic sobre un vano para insertar una estructura'], ['agregar', '＋ Nueva', 'Clic en el mapa para agregar una estructura al final'], ['medir', '📏 Medir', 'Medir distancia geodésica']];
    return `<div class="page-head" style="margin-bottom:12px"><div><h1>Estructuras y mapa</h1><p>Registre cada estructura con sus coordenadas: se agrega a la tabla y se dibuja en el mapa al instante. Edite en la tabla o arrastre en el mapa; todo queda sincronizado.</p></div>
      <div class="actions"><button class="btn" data-act="importar">⇪ Importar archivo</button><button class="btn" id="dm-pegar">⎘ Pegar varias</button><button class="btn" id="m-kmz">⇩ KMZ</button><button class="btn" id="m-html" title="Mapa satelital en un solo archivo HTML (Folium/Leaflet, gratis)">⇩ Mapa HTML</button></div></div>
      <div class="dm-layout">
        <div class="dm-izq">
          <div class="card dm-form-card">
            <div class="section-head"><h2>Registrar estructura</h2>
              <select class="select" id="f-sis" title="Sistema en que escribe las coordenadas" style="width:auto;max-width:100%"><option value="WGS84">Latitud / longitud (GPS)</option></select></div>
            <form id="f-nueva" class="dm-form" autocomplete="off">
              <label class="field-group"><span class="field-label">Estructura</span><input class="input" name="nombre" value="${h(siguienteNombre())}" required></label>
              <label class="field-group"><span class="field-label" id="f-e1">Latitud</span><input class="input" name="u" placeholder="2.927222 o 2°55'38&quot;N" required></label>
              <label class="field-group"><span class="field-label" id="f-e2">Longitud</span><input class="input" name="v" placeholder="-75.281944 o 75°16'55&quot;W" required></label>
              <label class="field-group"><span class="field-label">Cota Z (m)</span><input class="input" name="z" inputmode="decimal" placeholder="opcional"></label>
              <label class="field-group"><span class="field-label">Altura amarre (m)</span><input class="input" name="altura" inputmode="decimal" placeholder="opcional" value="${h(S.apoyos[S.apoyos.length - 1]?.altura ?? '')}"></label>
              <label class="field-group"><span class="field-label">Tipo</span><select class="select" name="tipo"><option value="S">Suspensión</option><option value="R" ${S.apoyos.length ? '' : 'selected'}>Retención</option></select></label>
              <button class="btn btn-primary dm-agregar" type="submit">＋ Agregar</button>
            </form>
            <p class="small muted" style="margin:6px 0 0">Enter = agregar y seguir con la siguiente. Las coordenadas aceptan decimal o grados-minutos-segundos.</p>
          </div>
          <div class="card" style="margin-top:12px"><div class="section-head"><h2>Estructuras <span class="badge" id="dm-n">${S.apoyos.length}</span></h2>
            <span class="small muted" id="dm-resumen"></span></div>
            <div id="dm-tabla"></div></div>
          <div class="card" style="margin-top:12px"><div class="section-head"><h3>Perfil del terreno <span class="badge">${S.terreno.length} puntos</span></h3>
            <button class="btn btn-small btn-soft" id="btn-pegar-terreno">⎘ Pegar terreno</button></div>
            <p class="muted small" style="margin:0">Opcional: pares (abscisa, cota) de topografía entre estructuras.</p></div>
        </div>
        <div class="dm-der">
          <div class="mapa-toolbar card">
            <div class="tool-grupo">${herr.map(([k, t, ay]) => `<button class="tool ${S.mapaModo === k ? 'active' : ''}" data-modo="${k}" title="${ay}">${t}</button>`).join('')}</div>
            <div class="tool-grupo"><button class="tool" id="m-undo" title="Deshacer (Ctrl+Z)">↶</button><button class="tool" id="m-redo" title="Rehacer (Ctrl+Y)">↷</button><button class="tool" id="m-fit" title="Ajustar vista">⤢</button>
              <label class="tool chk" title="Etiquetas"><input type="checkbox" id="m-etq" ${S.capas.etiquetas ? 'checked' : ''}> Nombres</label><label class="tool chk" title="Coordenadas"><input type="checkbox" id="m-coord" ${S.capas.coords ? 'checked' : ''}> Coord.</label>
              <select class="select" id="m-motor" style="width:auto"><option value="leaflet">Satélite gratis</option><option value="google">Google Maps</option><option value="planta">Planta sin fondo</option></select></div>
          </div>
          <div class="card mapa-card"><div class="mapa-cont dm-mapa" id="mapa-cont"></div></div>
        </div>
      </div>`;
  }

  function pintarTabla() {
    const el = $('#dm-tabla'); if (!el) return;
    const act = document.activeElement, foco = el.contains(act) && act.dataset.k ? { i: act.closest('tr')?.dataset.i, k: act.dataset.k } : null;
    const n = S.apoyos.length;
    $('#dm-n').textContent = n;
    const sinZ = S.apoyos.filter((a) => a.z == null).length;
    let total = 0; for (let k = 1; k < n; k++) { const a = S.apoyos[k - 1], b = S.apoyos[k]; if (a.E != null && b.E != null) total += Math.hypot(b.E - a.E, b.N - a.N); }
    $('#dm-resumen').innerHTML = n ? `${nf(total, 1)} m en planta${sinZ ? ` · <span style="color:var(--danger)">${sinZ} sin cota Z</span>` : ''}` : '';
    if (!n) {
      el.innerHTML = '<div class="empty" style="padding:22px"><div class="big">📍</div><h3>Aún no hay estructuras</h3><p>Escriba las coordenadas de la primera estructura arriba, importe un archivo (Excel, CSV, KML/KMZ) o active <b>＋ Nueva</b> y toque el mapa.</p></div>';
      return;
    }
    const filas = S.apoyos.map((a, i) => {
      const prev = S.apoyos[i - 1];
      const vano = prev && prev.E != null && a.E != null ? nf(Math.hypot(a.E - prev.E, a.N - prev.N), 1) : '—';
      const bl = a.bloqueado ? 'disabled' : '';
      return `<tr data-i="${i}" class="${i === S.sel ? 'row-actual' : ''} ${a.z == null ? 'row-warn' : ''}">
        <td class="idx">${i + 1}</td>
        <td><input class="name" data-k="nombre" value="${h(a.nombre)}"></td>
        <td><input data-k="lat" value="${h(a.lat != null ? (+a.lat).toFixed(7) : '')}" ${bl}></td>
        <td><input data-k="lon" value="${h(a.lon != null ? (+a.lon).toFixed(7) : '')}" ${bl}></td>
        <td><input data-k="z" inputmode="decimal" placeholder="sin dato" value="${h(a.z ?? '')}" title="${h(a.z_fuente || '')}"></td>
        <td><input data-k="altura" inputmode="decimal" placeholder="—" value="${h(a.altura ?? '')}"></td>
        <td><select data-k="tipo"><option value="S" ${a.tipo !== 'R' ? 'selected' : ''}>Susp.</option><option value="R" ${a.tipo === 'R' ? 'selected' : ''}>Ret.</option></select></td>
        <td class="num muted small">${vano}</td>
        <td class="dm-acc"><button class="del" data-a="sube" title="Mover antes" ${i === 0 ? 'disabled' : ''}>↑</button><button class="del" data-a="baja" title="Mover después" ${i === n - 1 ? 'disabled' : ''}>↓</button><button class="del" data-a="bloq" title="${a.bloqueado ? 'Desbloquear' : 'Bloquear coordenadas'}">${a.bloqueado ? '🔒' : '🔓'}</button><button class="del" data-a="del" title="Eliminar" ${bl}>✕</button></td></tr>`;
    }).join('');
    el.innerHTML = `<div class="table-wrap dm-tabla-wrap"><table class="grid-edit"><thead><tr><th>#</th><th>Estructura</th><th>Latitud</th><th>Longitud</th><th>Cota Z (m)</th><th>Altura (m)</th><th>Tipo</th><th>Vano (m)</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`;
    $$('input[data-k], select[data-k]', el).forEach((inp) => inp.addEventListener('change', () => editarCampo(+inp.closest('tr').dataset.i, inp.dataset.k, inp.value)));
    $$('tbody tr', el).forEach((tr) => tr.addEventListener('focusin', () => seleccionar(+tr.dataset.i, true, false)));
    $$('[data-a]', el).forEach((b) => b.onclick = () => {
      const i = +b.closest('tr').dataset.i;
      if (b.dataset.a === 'del') return eliminar(i);
      if (b.dataset.a === 'bloq') return cambiar(() => { S.apoyos[i].bloqueado = !S.apoyos[i].bloqueado; }, 'bloqueo');
      const j = b.dataset.a === 'sube' ? i - 1 : i + 1;
      cambiar(() => { [S.apoyos[j], S.apoyos[i]] = [S.apoyos[i], S.apoyos[j]]; S.sel = j; }, 'reordenar');
    });
    if (foco) { const x = el.querySelector(`tr[data-i="${foco.i}"] [data-k="${foco.k}"]`); if (x) x.focus(); }
  }
  function seleccionar(i, enMapa = true, enTabla = true) {
    if (S.sel === i) return;
    S.sel = i;
    if (enMapa) { planta?.setPostes(S.apoyos, S.sel); if (i >= 0) planta?.enfocar?.(i); }
    $$('#dm-tabla tbody tr').forEach((tr) => tr.classList.toggle('row-actual', +tr.dataset.i === i));
    if (enTabla && i >= 0) $(`#dm-tabla tr[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function prepararFormulario(vc) {
    const sel = $('#f-sis', vc), f = $('#f-nueva', vc);
    try {
      const lista = (await listaSistemas()).sistemas.filter((s) => s.tipo !== 'local');
      sel.innerHTML = lista.map((s) => `<option value="${s.codigo}">${h(s.nombre)}</option>`).join('');
    } catch { /* sin motor: solo lat/lon */ }
    sel.value = sisEntrada(); if (!sel.value) sel.value = SIS_DEF;
    const ejes = () => {
      const geo = ['WGS84', 'MAGNA_GEO'].includes(sel.value);
      $('#f-e1', vc).textContent = geo ? 'Latitud' : 'Este (m)'; $('#f-e2', vc).textContent = geo ? 'Longitud' : 'Norte (m)';
      f.u.placeholder = geo ? "2.927222 o 2°55'38\"N" : 'p. ej. 4746440.15'; f.v.placeholder = geo ? "-75.281944 o 75°16'55\"W" : 'p. ej. 1881726.85';
    };
    sel.onchange = () => { S.meta.sisEntrada = sel.value; C.guardar(); ejes(); };
    ejes();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      try {
        const nuevo = await crearEstructura(d, sel.value);
        cambiar(() => { S.apoyos.push(nuevo); S.sel = S.apoyos.length - 1; }, 'agregar');
        planta?.enfocar?.(S.sel);
        f.nombre.value = siguienteNombre(); f.u.value = ''; f.v.value = ''; f.z.value = ''; f.tipo.value = 'S';
        f.u.focus();
        toast(`${nuevo.nombre} registrada y dibujada en el mapa.`, 'success');
      } catch (err) { toast(err.message, 'error'); }
    };
  }
  async function crearEstructura(d, sistema, base = null) {
    if (!String(d.u ?? '').trim() || !String(d.v ?? '').trim()) throw new Error('Escriba las dos coordenadas.');
    const r = await rpc('geo_transformar', { sistema, puntos: [{ u: String(d.u).trim(), v: String(d.v).trim() }] });
    const q = r.puntos[0]; if (!q.ok) throw new Error(`${d.nombre || 'Estructura'}: ${q.error}`);
    const z = num(d.z ?? ''), alt = num(d.altura ?? '');
    if (Number.isNaN(z)) throw new Error(`Cota Z no numérica: «${d.z}»`);
    if (Number.isNaN(alt)) throw new Error(`Altura no numérica: «${d.altura}»`);
    const nombre = String(d.nombre || '').trim() || siguienteNombre();
    if (S.apoyos.some((a) => String(a.nombre) === nombre) || base?.has(nombre)) throw new Error(`Ya existe la estructura «${nombre}».`);
    return { id: nuevoId(), nombre, lat: +q.lat.toFixed(9), lon: +q.lon.toFixed(9), E: +q.E.toFixed(4), N: +q.N.toFixed(4),
      z: z ?? null, z_fuente: z != null ? 'manual' : null, altura: alt ?? null, tipo: String(d.tipo || 'S').toUpperCase().startsWith('R') ? 'R' : 'S',
      bloqueado: false, orig: { sistema, u: String(d.u).trim(), v: String(d.v).trim(), nota: 'registrada en la tabla' } };
  }
  function pegarVarias() {
    const sis = sisEntrada();
    const m = modal('Pegar varias estructuras',
      `<p class="muted small">Copie las filas desde Excel y péguelas. Columnas: <b>Estructura, ${['WGS84', 'MAGNA_GEO'].includes(sis) ? 'Latitud, Longitud' : 'Este, Norte'}</b> [, Cota Z] [, Altura] [, Tipo R/S]. Sistema: el elegido en «Registrar estructura». Se agregan al final.</p>
       <textarea class="textarea" id="dm-txt" placeholder="AP-001\t2.927222\t-75.281944\t440.2\t10.5\tR\nAP-002\t2.928100\t-75.281000\t441.0\t10.5\tS"></textarea>`,
      '<button class="btn" data-x>Cancelar</button><button class="btn btn-primary" data-ok>Agregar</button>');
    $('[data-x]', m.root).onclick = m.cerrar;
    setTimeout(() => $('#dm-txt').focus(), 50);
    $('[data-ok]', m.root).onclick = async () => {
      const lineas = $('#dm-txt').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const sep = (l) => (l.includes('\t') ? l.split('\t') : l.split(';')).map((x) => x.trim());
      const nuevos = [], errores = [], usados = new Set();
      for (const [k, l] of lineas.entries()) {
        const c = sep(l);
        if (k === 0 && /estructura|poste|nombre|apoyo/i.test(c[0]) && Number.isNaN(num(c[1]))) continue; // encabezado
        try { const p = await crearEstructura({ nombre: c[0], u: c[1], v: c[2], z: c[3] ?? '', altura: c[4] ?? '', tipo: c[5] || 'S' }, sis, usados); usados.add(p.nombre); nuevos.push(p); }
        catch (e) { errores.push(`Fila ${k + 1}: ${e.message}`); }
      }
      if (!nuevos.length) return toast(errores[0] || 'No se reconocieron filas.', 'warn');
      m.cerrar();
      cambiar(() => { S.apoyos.push(...nuevos); }, 'pegar');
      planta?.ajustar();
      toast(`${nuevos.length} estructuras agregadas${errores.length ? `; ${errores.length} con error: ${errores.slice(0, 3).join(' · ')}` : ''}.`, errores.length ? 'warn' : 'success');
    };
  }

  async function enlazarEstructuras(vc) {
    C.enlazarAcciones(vc);
    const cont = $('#mapa-cont', vc);
    const op = {
      onSelect: (i) => seleccionar(i, true, true),
      onMove: (i, pt) => moverPoste(i, pt),
      onInsert: (i, pt) => insertarPoste(i, pt),
      onAdd: (pt) => agregarPoste(pt),
      onMedir: async (a, b) => medir(a, b),
      onAviso: (t) => toast(t, 'warn'),
    };
    const sel = $('#m-motor', vc);
    const clave = S.config?.google_maps_key;
    let preferido = 'leaflet'; try { preferido = localStorage.getItem('cm-mapa') || 'leaflet'; } catch { /* */ }
    sel.value = preferido;
    async function montar(tipo) {
      planta?.destruir?.(); planta = null;
      if (tipo === 'google') {
        if (!clave) {
          cont.innerHTML = `<div class="empty"><div class="big">🛰</div><h3>Falta la clave de Google Maps</h3><p>Configúrela en <b>Parámetros → Mapa satelital</b>, o use el satélite gratuito, que no requiere clave.</p><button class="btn btn-soft" id="m-a-planta">Usar satélite gratis</button></div>`;
          $('#m-a-planta', cont).onclick = () => { sel.value = 'leaflet'; sel.onchange(); };
          return;
        }
        try { cargando('Cargando Google Maps…'); await cargarGoogle(clave); cargando(''); planta = new PlantaGoogle(cont, op); }
        catch (e) { cargando(''); toast(e.message, 'error'); sel.value = 'planta'; return montar('planta'); }
      } else if (tipo === 'leaflet') {
        try { cargando('Cargando mapa satelital gratuito…'); await cargarLeaflet(); cargando(''); planta = new PlantaLeaflet(cont, op); }
        catch (e) { cargando(''); toast(e.message, 'warn'); sel.value = 'planta'; return montar('planta'); }
      } else planta = new PlantaSVG(cont, op);
      planta.setModo(S.mapaModo); planta.setCapas(S.capas); planta.setPostes(S.apoyos, S.sel, true);
    }
    sel.onchange = () => { try { localStorage.setItem('cm-mapa', sel.value); } catch { /* */ } montar(sel.value); };
    $$('[data-modo]', vc).forEach((b) => b.onclick = () => {
      S.mapaModo = b.dataset.modo; $$('[data-modo]', vc).forEach((x) => x.classList.toggle('active', x === b)); planta?.setModo(S.mapaModo);
    });
    $('#m-undo', vc).onclick = deshacer; $('#m-redo', vc).onclick = rehacer; $('#m-fit', vc).onclick = () => planta?.ajustar();
    $('#m-etq', vc).onchange = (e) => { S.capas.etiquetas = e.target.checked; planta?.setCapas(S.capas); };
    $('#m-coord', vc).onchange = (e) => { S.capas.coords = e.target.checked; planta?.setCapas(S.capas); };
    $('#m-kmz', vc).onclick = () => C.exportar('kmz');
    $('#m-html', vc).onclick = () => C.exportar('html');
    $('#dm-pegar', vc).onclick = pegarVarias;
    $('#btn-pegar-terreno', vc).onclick = () => C.pegarTerreno?.();
    pintarTabla();
    await Promise.all([prepararFormulario(vc), montar(preferido)]);
  }

  function pintarPlanta() { planta?.setPostes(S.apoyos, S.sel); }

  async function ubicar(pt) { // completa lat/lon/E/N desde lo que venga
    const r = pt.E != null
      ? await rpc('geo_transformar', { sistema: 'ORIGEN_NACIONAL', puntos: [{ u: pt.E, v: pt.N }] })
      : await rpc('geo_transformar', { sistema: 'WGS84', puntos: [{ u: pt.lat, v: pt.lon }] });
    const p = r.puntos[0]; if (!p.ok) throw new Error(p.error);
    return { lat: +p.lat.toFixed(9), lon: +p.lon.toFixed(9), E: +p.E.toFixed(4), N: +p.N.toFixed(4) };
  }
  async function moverPoste(i, pt) {
    const p = S.apoyos[i]; if (!p || p.bloqueado) return pintarPlanta();
    try {
      const u = await ubicar(pt);
      cambiar(() => {
        Object.assign(S.apoyos[i], u, { orig: { sistema: 'ORIGEN_NACIONAL', u: String(u.E), v: String(u.N), nota: 'movido en el mapa' } });
        if (S.apoyos[i].z != null) S.apoyos[i].z_fuente = 'por verificar (poste movido)';
      }, 'mover');
      S.sel = i; pintarTabla(); toast(`${p.nombre} movido. Verifique su cota Z en el nuevo sitio.`, 'warn');
    } catch (e) { toast(e.message, 'error'); pintarPlanta(); }
  }
  async function insertarPoste(i, pt) {
    const a = S.apoyos[i], b = S.apoyos[i + 1]; if (!a || !b) return;
    try {
      const u = await ubicar(pt);
      const da = Math.hypot(u.E - a.E, u.N - a.N), db = Math.hypot(u.E - b.E, u.N - b.N);
      const t = da / (da + db || 1);
      const z = a.z != null && b.z != null ? +(a.z + t * (b.z - a.z)).toFixed(3) : null;
      const nuevo = { id: nuevoId(), nombre: nombreUnico(`${a.nombre}A`), ...u, z, z_fuente: z != null ? 'interpolada (verificar)' : null,
        altura: a.altura ?? b.altura ?? null, tipo: 'S', bloqueado: false, conductor: a.conductor ?? null, orig: { sistema: 'ORIGEN_NACIONAL', u: String(u.E), v: String(u.N), nota: 'insertado en el mapa' } };
      cambiar(() => { S.apoyos.splice(i + 1, 0, nuevo); }, 'insertar');
      S.sel = i + 1; pintarPlanta(); pintarTabla(); toast(`Poste ${nuevo.nombre} insertado entre ${a.nombre} y ${b.nombre}.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function agregarPoste(pt) {
    try {
      const u = await ubicar(pt); const ult = S.apoyos[S.apoyos.length - 1];
      const nuevo = { id: nuevoId(), nombre: nombreUnico(`AP-${String(S.apoyos.length + 1).padStart(3, '0')}`), ...u, z: null, z_fuente: null,
        altura: ult?.altura ?? null, tipo: 'S', bloqueado: false, orig: { sistema: 'ORIGEN_NACIONAL', u: String(u.E), v: String(u.N), nota: 'agregado en el mapa' } };
      cambiar(() => { S.apoyos.push(nuevo); }, 'agregar');
      S.sel = S.apoyos.length - 1; pintarPlanta(); pintarTabla(); toast(`Poste ${nuevo.nombre} agregado. Ingrese su cota Z.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function medir(a, b) {
    const pa = a.lat != null ? a : await ubicar(a), pb = b.lat != null ? b : await ubicar(b);
    const r = await S.motor.rpc('geo_distancia', { a: pa, b: pb });
    return r.ok ? r.distancia_m : null;
  }

  async function editarCampo(i, k, v) {
    const p = S.apoyos[i];
    try {
      if (['lat', 'lon'].includes(k)) {
        const r = await rpc('geo_transformar', { sistema: 'WGS84', puntos: [{ u: k === 'lat' ? v : p.lat, v: k === 'lon' ? v : p.lon }] });
        const q = r.puntos[0]; if (!q.ok) throw new Error(q.error);
        return cambiar(() => Object.assign(S.apoyos[i], { lat: +q.lat.toFixed(9), lon: +q.lon.toFixed(9), E: +q.E.toFixed(4), N: +q.N.toFixed(4), orig: { sistema: 'WGS84', u: String(k === 'lat' ? v : p.lat), v: String(k === 'lon' ? v : p.lon), nota: 'editado' } }), 'coordenadas');
      }
      if (['E', 'N'].includes(k)) {
        const u = await ubicar({ E: k === 'E' ? num(v) : p.E, N: k === 'N' ? num(v) : p.N });
        return cambiar(() => Object.assign(S.apoyos[i], u, { orig: { sistema: 'ORIGEN_NACIONAL', u: String(u.E), v: String(u.N), nota: 'editado' } }), 'coordenadas');
      }
      if (['z', 'altura'].includes(k)) {
        const n = num(v); if (Number.isNaN(n)) throw new Error(`Valor no numérico: «${v}»`);
        return cambiar(() => { S.apoyos[i][k] = n; if (k === 'z' && n != null && !S.apoyos[i].z_fuente) S.apoyos[i].z_fuente = 'manual'; if (k === 'z' && n == null) S.apoyos[i].z_fuente = null; }, k);
      }
      cambiar(() => { S.apoyos[i][k] = v === '' ? null : v; }, k);
    } catch (e) { toast(e.message, 'error'); pintarTabla(); }
  }
  async function duplicar(i) {
    const p = S.apoyos[i];
    const u = await ubicar({ E: p.E + 5, N: p.N + 5 });
    const nuevo = { ...C.clon(p), ...u, id: nuevoId(), nombre: nombreUnico(`${p.nombre}-copia`), bloqueado: false, z_fuente: p.z != null ? 'por verificar (poste movido)' : null, orig: { sistema: 'ORIGEN_NACIONAL', u: String(u.E), v: String(u.N), nota: 'duplicado' } };
    cambiar(() => { S.apoyos.splice(i + 1, 0, nuevo); S.sel = i + 1; }, 'duplicar');
  }
  function eliminar(i) {
    const p = S.apoyos[i]; if (!p) return;
    if (p.bloqueado) return toast('El poste está bloqueado. Desbloquéelo para eliminarlo.', 'warn');
    cambiar(() => { S.apoyos.splice(i, 1); S.sel = -1; }, 'eliminar');
    toast(`Poste ${p.nombre} eliminado (Ctrl+Z para deshacer).`);
  }

  // ------------------------------------------------------------- atajos
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); deshacer(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); rehacer(); }
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); guardarServidor(false); }
    if (e.key === 'Delete' && S.vista === 'datos' && S.sel >= 0) eliminar(S.sel);
  });

  return {
    titulos: { proyectos: 'Proyectos' },
    vistas: { proyectos: vistaProyectos },
    enlaces: { proyectos: enlazarProyectos },
    vistaEstructuras, enlazarEstructuras,
    asistente, cambiar, deshacer, rehacer, guardarServidor, editar: editarCampo, eliminar, programarGuardado, hayGeo, rpc, listaSistemas,
  };
}
