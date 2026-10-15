// Motor de cálculo: el MISMO código Python se ejecuta de dos formas.
//  1) Servidor Python (server.py)  -> PC o celular en la misma red. Rápido.
//  2) Pyodide (Python en el navegador) -> web estática / celular sin servidor.
//     La primera carga descarga ~40 MB (numpy, scipy, pandas, matplotlib); luego
//     queda en caché del navegador y funciona sin internet.

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/';
const PAQUETES = ['numpy', 'scipy', 'pandas', 'matplotlib', 'openpyxl'];

async function leerError(r) {
  try { const j = await r.json(); return (j.errores || []).join('\n') || r.statusText; }
  catch { return `${r.status} ${r.statusText}`; }
}

function nombreDeCabecera(r, defecto) {
  const cd = r.headers.get('Content-Disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  return m ? decodeURIComponent(m[1]) : defecto;
}

export class MotorServidor {
  constructor(info) { this.tipo = 'servidor'; this.etiqueta = 'Servidor Python'; this.version = info.version; }
  async listo() { return true; }
  async info() { const r = await fetch('api/info'); return r.json(); }
  async calcular(payload) {
    const r = await fetch('api/calcular', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) return { ok: false, errores: [await leerError(r)] };
    return r.json();
  }
  async importar(archivo) {
    const r = await fetch('api/importar', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await archivo.arrayBuffer() });
    if (!r.ok) return { ok: false, errores: [await leerError(r)] };
    return r.json();
  }
  async exportar(payload, formato) {
    const r = await fetch(`api/exportar/${formato}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(await leerError(r));
    return { blob: await r.blob(), nombre: nombreDeCabecera(r, `resultado.${formato}`) };
  }
  async plantilla() {
    const r = await fetch('api/plantilla');
    return { blob: await r.blob(), nombre: 'PLANTILLA_DATOS.xlsx' };
  }
  async rpc(nombre, datos) {
    const r = await fetch(`api/rpc/${nombre}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos || {}) });
    if (!r.ok) return { ok: false, errores: [await leerError(r)] };
    return r.json();
  }
  async config() { try { const r = await fetch('api/config', { cache: 'no-store' }); return (await r.json()); } catch { return {}; } }
  async guardarConfig(c) { const r = await fetch('api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) }); return r.json(); }
  get proyectos() {
    const j = async (url, op) => { const r = await fetch(url, op); const d = await r.json(); if (!r.ok || d.ok === false) throw new Error((d.errores || [r.statusText]).join(' ')); return d; };
    const post = (url, cuerpo) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {}) });
    return {
      listar: async () => (await j('api/proyectos')).proyectos,
      obtener: async (id) => (await j(`api/proyectos/${id}`)).proyecto,
      guardar: (datos, id) => post('api/proyectos', { datos, id }),
      version: (id, comentario) => post(`api/proyectos/${id}/versiones`, { comentario }),
      versiones: async (id) => (await j(`api/proyectos/${id}/versiones`)).versiones,
      version_obtener: async (id, v) => (await j(`api/proyectos/${id}/versiones/${v}`)).version,
      archivar: (id) => post(`api/proyectos/${id}/archivar`),
    };
  }
}

function cargarScript(src) {
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => mal(new Error('No se pudo descargar ' + src));
    document.head.appendChild(s);
  });
}

// Proyectos en este dispositivo (modo navegador, sin servidor): misma interfaz que el servidor.
const CLAVE_PROY = 'cm-proyectos-v1';
const ahora = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19); // hora local
function leerLocal() { try { return JSON.parse(localStorage.getItem(CLAVE_PROY) || '{}'); } catch { return {}; } }
function escribirLocal(d) {
  try { localStorage.setItem(CLAVE_PROY, JSON.stringify(d)); }
  catch { throw new Error('El almacenamiento del navegador está lleno: guarde el proyecto como archivo o use el servidor.'); }
}
export const proyectosLocales = {
  async listar() {
    return Object.values(leerLocal()).filter((p) => !p.archivado).map((p) => {
      const c = p.datos.calculo || {};
      return { id: p.id, nombre: p.nombre, departamento: p.datos.meta?.departamento, municipio: p.datos.meta?.municipio, creado: p.creado, actualizado: p.actualizado,
        n_postes: (p.datos.apoyos || []).length, n_versiones: (p.versiones || []).length, calc_fecha: c.fecha, calc_desactualizado: c.desactualizado,
        calc_longitud_m: c.longitud_m, calc_vanos: c.vanos, calc_no_cumplen: c.no_cumplen, calc_arrancamiento: c.arrancamiento, calc_advertencias: c.advertencias };
    }).sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''));
  },
  async obtener(id) { const p = leerLocal()[id]; if (!p) throw new Error('Proyecto no encontrado.'); return { id: p.id, nombre: p.nombre, actualizado: p.actualizado, datos: p.datos }; },
  async guardar(datos, id) {
    const todo = leerLocal(); const t = ahora();
    id = id && todo[id] ? id : (id || Math.random().toString(16).slice(2, 14));
    const p = todo[id] || { id, creado: t, versiones: [] };
    Object.assign(p, { nombre: datos.proyecto?.nombre || 'Proyecto sin nombre', actualizado: t, datos });
    todo[id] = p; escribirLocal(todo); return { id, actualizado: t };
  },
  async version(id, comentario) {
    const todo = leerLocal(); const p = todo[id]; if (!p) throw new Error('Proyecto no encontrado.');
    const v = { id: (p.versiones.at(-1)?.id || 0) + 1, fecha: ahora(), comentario, datos: p.datos };
    p.versiones.push(v); escribirLocal(todo); return { version: v.id };
  },
  async versiones(id) { return (leerLocal()[id]?.versiones || []).map(({ id: i, fecha, comentario }) => ({ id: i, fecha, comentario })).reverse(); },
  async version_obtener(id, v) { return (leerLocal()[id]?.versiones || []).find((x) => String(x.id) === String(v)); },
  async archivar(id) { const todo = leerLocal(); if (todo[id]) { todo[id].archivado = true; escribirLocal(todo); } return { ok: true }; },
};

export class MotorPyodide {
  get proyectos() { return proyectosLocales; }
  constructor(onProgreso) {
    this.tipo = 'navegador'; this.etiqueta = 'Python en el navegador';
    this.onProgreso = onProgreso || (() => {});
    this._promesa = null;
  }
  listo() { return (this._promesa ||= this._iniciar()); }
  async _iniciar() {
    this.onProgreso('Descargando Python (Pyodide)…');
    if (!window.loadPyodide) await cargarScript(PYODIDE_URL + 'pyodide.js');
    const py = await window.loadPyodide({ indexURL: PYODIDE_URL });
    this.onProgreso('Cargando numpy, scipy, pandas y matplotlib…');
    await py.loadPackage(PAQUETES);
    this.onProgreso('Cargando el motor de cálculo…');
    const lista = await (await fetch('py/manifest.json', { cache: 'no-cache' })).json();
    py.FS.mkdirTree('/app/calculos_mecanicos');
    for (const nombre of lista) {
      const txt = await (await fetch(`py/calculos_mecanicos/${nombre}`, { cache: 'no-cache' })).text();
      py.FS.writeFile(`/app/calculos_mecanicos/${nombre}`, txt);
    }
    py.runPython(`
import sys, json
sys.path.insert(0, '/app')
import matplotlib
matplotlib.use('Agg')
from calculos_mecanicos import motor
`);
    this.py = py;
    this.version = py.runPython('motor.info()["version"]');
    this.onProgreso('');
    return true;
  }
  async info() {
    await this.listo();
    return JSON.parse(this.py.runPython('motor.js_info()'));
  }
  async calcular(payload) {
    await this.listo();
    this.py.globals.set('PAYLOAD', JSON.stringify(payload));
    return JSON.parse(this.py.runPython('motor.js_calcular(PAYLOAD)'));
  }
  async importar(archivo) {
    await this.listo();
    this.py.FS.writeFile('/tmp/entrada.xlsx', new Uint8Array(await archivo.arrayBuffer()));
    return JSON.parse(this.py.runPython(`json.dumps(motor.importar_excel(open('/tmp/entrada.xlsx','rb').read()), ensure_ascii=False)`));
  }
  async exportar(payload, formato) {
    await this.listo();
    this.py.globals.set('PAYLOAD', JSON.stringify(payload));
    this.py.globals.set('FMT', formato);
    const meta = JSON.parse(this.py.runPython(`
_b, _n, _m = motor.exportar(json.loads(PAYLOAD), FMT)
open('/tmp/salida.bin', 'wb').write(_b)
json.dumps([_n, _m])`));
    const datos = this.py.FS.readFile('/tmp/salida.bin');
    return { blob: new Blob([datos], { type: meta[1] }), nombre: meta[0] };
  }
  async rpc(nombre, datos) {
    await this.listo();
    this.py.globals.set('RPC_N', nombre);
    this.py.globals.set('RPC_D', JSON.stringify(datos || {}));
    return JSON.parse(this.py.runPython('motor.js_rpc(RPC_N, RPC_D)'));
  }
  async config() { try { return JSON.parse(localStorage.getItem('cm-config') || '{}'); } catch { return {}; } }
  async guardarConfig(c) { try { localStorage.setItem('cm-config', JSON.stringify(c)); } catch { /* */ } return { ok: true }; }
  async plantilla() {
    await this.listo();
    this.py.runPython(`open('/tmp/plantilla.xlsx','wb').write(motor.plantilla_excel())`);
    return { blob: new Blob([this.py.FS.readFile('/tmp/plantilla.xlsx')]), nombre: 'PLANTILLA_DATOS.xlsx' };
  }
}

export async function detectarMotor(onProgreso) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch('api/salud', { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) {
      const j = await r.json();
      if (j && j.ok) return new MotorServidor(j);
    }
  } catch { /* sin servidor: modo navegador */ }
  return new MotorPyodide(onProgreso);
}
