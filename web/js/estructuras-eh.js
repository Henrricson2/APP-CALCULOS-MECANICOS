// Buscador de estructuras normalizadas de Electrohuila (web/estructuras_eh.json) para cada poste.
import { visorEstructura } from './visor3d.js?v=2';
// las láminas PDF solo están en el PC (no se publican en la web): el enlace se muestra cuando la app corre en el PC o la red local
const LAMINAS_LOCALES = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
let CAT = null;
export async function cargarCatalogo() {
  if (!CAT) {
    try { CAT = await (await fetch('estructuras_eh.json', { cache: 'no-cache' })).json(); }
    catch { CAT = { estructuras: [] }; }
  }
  return CAT;
}
export const buscarPorId = (id) => (CAT?.estructuras || []).find((e) => e.id === id) || null;

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const compacto = (s) => norm(s).replace(/[^a-z0-9]/g, '');

// Ángulo de deflexión (°) en el poste i a partir de las coordenadas planas E/N
export function deflexion(apoyos, i) {
  const a = apoyos[i - 1], b = apoyos[i], c = apoyos[i + 1];
  if (!a || !b || !c || [a.E, b.E, c.E].some((v) => v == null)) return null;
  const r1 = Math.atan2(b.N - a.N, b.E - a.E), r2 = Math.atan2(c.N - b.N, c.E - b.E);
  let d = Math.abs(r2 - r1) * 180 / Math.PI; if (d > 180) d = 360 - d;
  return d;
}
// Función sugerida según la posición y el ángulo (criterio práctico; el diseñador decide)
export function sugerencia(apoyos, i) {
  const n = apoyos.length;
  if (i === 0 || i === n - 1) return { funcion: 'Terminal', texto: i === 0 ? 'Inicio de la línea → estructura terminal' : 'Fin de la línea → estructura terminal' };
  const d = deflexion(apoyos, i);
  if (d == null) return { funcion: null, texto: 'Sin coordenadas para calcular el ángulo' };
  if (d <= 5) return { funcion: 'Alineamiento', ang: d, texto: `Ángulo ${d.toFixed(1)}° → alineamiento o suspensión` };
  if (d <= 30) return { funcion: 'Suspensión', ang: d, texto: `Ángulo ${d.toFixed(1)}° → ángulo pequeño (espigo doble / suspensión en ángulo) o retención con templete` };
  return { funcion: 'Retención', ang: d, texto: `Ángulo ${d.toFixed(1)}° → retención (con templete)` };
}

function coincide(e, q) {
  if (!q) return true;
  const txt = norm(`${e.codigo} ${e.nombre} ${e.funcion} ${e.aislamiento} ${e.disposicion} ${e.poste === 'H' ? 'poste en h' : ''} ${e.guarda ? 'cable de guarda' : ''} ${e.nivel}`);
  const cod = compacto(e.codigo);
  return norm(q).split(/\s+/).filter(Boolean).every((p) => (p === 'h' ? e.poste === 'H' : (txt.includes(p) || cod.includes(compacto(p)))));
}

export function abrirSelector(C, i, { onElegir }) {
  const { S, $, $$, h, modal } = C;
  const cat = CAT?.estructuras || [];
  const ap = S.apoyos[i];
  const sug = sugerencia(S.apoyos, i);
  const kv = +S.proyecto?.criterios?.tension_kv;
  const nivelProy = kv > 20 ? '34.5 kV' : kv > 1 ? '13.2 kV' : 'BT';
  const st = { q: '', nivel: nivelProy, funcion: '', poste: '', todas: false };
  const FUN = ['Alineamiento', 'Suspensión', 'Retención', 'Terminal', 'Ángulo', 'Derivación', 'Subestación tipo poste', 'Equipo de maniobra'];
  const chips = (k, opciones, todasTxt) => `<div class="eh-chips" data-f="${k}"><button class="chip ${!st[k] ? 'on' : ''}" data-v="">${todasTxt}</button>${opciones.map((o) => `<button class="chip ${st[k] === o ? 'on' : ''}" data-v="${h(o)}">${h(o)}</button>`).join('')}</div>`;
  const m = modal(`Estructura · ${ap.nombre}`, `
    <div class="eh-sel">
      <div class="eh-sug ${sug.funcion ? '' : 'muted'}">💡 ${h(sug.texto)}${ap.estructura ? ` · Actual: <b>${h(ap.estructura)}</b>` : ''}</div>
      <div id="eh-prev" class="eh-prev" hidden><div class="eh-prev-head"><b id="eh-prev-tit"></b><span class="small muted">Bloque 3D (el mismo de la biblioteca y los planos) · arrastre para girar</span><button class="btn btn-small" id="eh-prev-x">Cerrar 3D</button></div><div id="eh-prev-v" style="height:320px"></div></div>
      <input class="input" id="eh-q" placeholder="Buscar: código o palabras (ej. «RH231», «retención H 4 m», «semibandera guarda»)" autocomplete="off">
      <div id="eh-filtros"></div>
      <div class="small muted" id="eh-cuenta"></div>
      <div class="eh-lista" id="eh-lista"></div>
      <label class="small" style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="eh-todas"> Aplicar también a las demás estructuras que aún no tienen estructura asignada</label>
    </div>`, `${ap.estructura ? '<button class="btn" data-quitar>Quitar estructura</button>' : ''}<button class="btn" data-x>Cerrar</button>`);
  $('.modal', m.root).style.width = 'min(980px, 100%)';
  $('[data-x]', m.root).onclick = m.cerrar;
  const qb = $('[data-quitar]', m.root); if (qb) qb.onclick = () => { m.cerrar(); onElegir(null, false); };
  const filtrar = () => cat.filter((e) => (!st.nivel || e.nivel === st.nivel) && (!st.funcion || e.funcion === st.funcion) && (!st.poste || e.poste === st.poste) && coincide(e, st.q));
  function pintar() {
    $('#eh-filtros', m.root).innerHTML = chips('nivel', ['BT', '13.2 kV', '34.5 kV'], 'Todas las tensiones') + chips('funcion', FUN, 'Todas las funciones') + chips('poste', ['Sencillo', 'H'], 'Poste sencillo y H');
    $$('.eh-chips', m.root).forEach((g) => $$('button', g).forEach((b) => b.onclick = () => { st[g.dataset.f] = b.dataset.v; pintar(); }));
    let lista = filtrar();
    if (sug.funcion && !st.funcion) lista = [...lista.filter((e) => e.funcion === sug.funcion), ...lista.filter((e) => e.funcion !== sug.funcion)];
    $('#eh-cuenta', m.root).textContent = `${lista.length} estructura(s)${sug.funcion && !st.funcion ? ` · primero las de ${sug.funcion.toLowerCase()}` : ''}`;
    $('#eh-lista', m.root).innerHTML = lista.slice(0, 120).map((e) => `
      <div class="eh-card ${ap.estructura_id === e.id ? 'sel' : ''}" data-id="${h(e.id)}" tabindex="0">
        ${e.mini ? `<img loading="lazy" src="estructuras_eh/mini/${h(e.id)}.jpg" alt="">` : '<div class="eh-noimg">sin imagen</div>'}
        <div class="eh-info"><b>${h(e.codigo)}</b><div class="small">${h(e.nombre)}</div>
          <div class="eh-tags"><span class="badge">${h(e.nivel)}</span><span class="badge ${e.tipo === 'R' ? 'badge-orange' : 'badge-green'}">${h(e.funcion)}</span>${e.aislamiento ? `<span class="badge">${h(e.aislamiento)}</span>` : ''}${e.poste === 'H' ? '<span class="badge">Poste en H</span>' : ''}${e.circuitos > 1 ? `<span class="badge badge-gold">${e.circuitos} circuitos</span>` : ''}${e.guarda ? '<span class="badge">Cable de guarda</span>' : ''}</div>
          <div class="eh-acc"><button class="btn btn-small btn-primary" data-usar>Usar</button><button class="btn btn-small" data-3d>3D</button>${e.pdf && LAMINAS_LOCALES ? `<a class="btn btn-small" href="estructuras_eh/pdf/${h(e.id)}.pdf" target="_blank" rel="noopener">Ver lámina</a>` : ''}</div></div></div>`).join('') || '<p class="muted">Sin resultados. Pruebe con menos palabras o quite filtros.</p>';
    $$('.eh-card', m.root).forEach((c) => {
      const usar = () => { const e = cat.find((x) => x.id === c.dataset.id); const todas = !!$('#eh-todas', m.root)?.checked; m.cerrar(); onElegir(e, todas); };
      $('[data-usar]', c).onclick = usar;
      $('[data-3d]', c).onclick = async (ev) => {
        ev.stopPropagation();
        const e = cat.find((x) => x.id === c.dataset.id), box = $('#eh-prev', m.root);
        box.hidden = false; $('#eh-prev-tit', m.root).textContent = `${e.codigo} · ${e.nombre}`;
        if (window.__ehPrev) { try { window.__ehPrev.liberar(); } catch { /* */ } }
        try { window.__ehPrev = await visorEstructura($('#eh-prev-v', m.root), e, { L: +ap.poste_altura || null }); }
        catch (er) { $('#eh-prev-v', m.root).innerHTML = `<p class="small" style="padding:12px">No se pudo abrir el 3D: ${h(er.message)}</p>`; }
        box.scrollIntoView({ block: 'nearest' });
      };
      c.ondblclick = usar;
      c.onkeydown = (ev) => { if (ev.key === 'Enter') usar(); };
    });
  }
  $('#eh-prev-x', m.root).onclick = () => { if (window.__ehPrev) { window.__ehPrev.liberar(); window.__ehPrev = null; } $('#eh-prev', m.root).hidden = true; };
  const q = $('#eh-q', m.root);
  q.oninput = () => { st.q = q.value; pintar(); };
  q.onkeydown = (ev) => { if (ev.key === 'Enter') { const c = $('.eh-card [data-usar]', m.root); if (c) c.click(); } };
  $('#eh-todas', m.root).onchange = (ev) => { st.todas = ev.target.checked; };
  pintar(); setTimeout(() => q.focus(), 30);
}
