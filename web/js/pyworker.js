// Python en el navegador (Pyodide) dentro de un Web Worker: el cálculo no congela la pantalla y en
// celulares y tabletas la carga corre en segundo plano mientras el usuario trabaja.
// Mensajes: {id, op, ...}  ->  {id, ok, r} | {id, ok:false, error} ;  {tipo:'progreso', msg, pct}
/* global importScripts, loadPyodide */
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/';
const BASE = self.location.href.replace(/js\/pyworker\.js.*$/, '');
let py = null, listo = null;
const extra = {};
const progreso = (msg, pct) => self.postMessage({ tipo: 'progreso', msg, pct });

async function iniciar() {
  progreso('Descargando Python (Pyodide)…', 5);
  importScripts(PYODIDE_URL + 'pyodide.js');
  py = await loadPyodide({ indexURL: PYODIDE_URL });
  progreso('Descargando numpy y pandas…', 35);
  await py.loadPackage(['numpy', 'pandas']);
  progreso('Cargando el motor de cálculo…', 80);
  // todo el motor en un solo archivo (una sola descarga)
  const fuentes = await (await fetch(BASE + 'py/motor.json')).json();
  py.FS.mkdirTree('/app/calculos_mecanicos');
  for (const [nombre, txt] of Object.entries(fuentes)) py.FS.writeFile(`/app/calculos_mecanicos/${nombre}`, txt);
  py.runPython("import sys, json\nsys.path.insert(0, '/app')\nfrom calculos_mecanicos import motor");
  const version = py.runPython('motor.info()["version"]');
  progreso('', 100);
  return version;
}

async function asegurar(nombre) {
  return (extra[nombre] ||= (async () => {
    if (nombre === 'openpyxl') {
      progreso('Descargando el lector de Excel (openpyxl)…');
      await py.loadPackage('micropip');
      await py.runPythonAsync("import micropip\nawait micropip.install('openpyxl')");
    } else {
      progreso(`Cargando ${nombre}…`);
      await py.loadPackage(nombre);
      if (nombre === 'matplotlib') py.runPython("import matplotlib\nmatplotlib.use('Agg')");
    }
    progreso('');
  })().catch((e) => { delete extra[nombre]; progreso(''); throw e; }));
}

// ejecuta y, si falta openpyxl o matplotlib, los carga y repite una vez
async function conPaquetes(fn) {
  try { return fn(); } catch (e) {
    const m = String(e?.message || e);
    const falta = /openpyxl/.test(m) ? 'openpyxl' : /matplotlib/.test(m) ? 'matplotlib' : null;
    if (!falta || extra[falta]) throw e;
    await asegurar(falta);
    return fn();
  }
}

const OPS = {
  async iniciar() { return (listo ||= iniciar().catch((e) => { listo = null; throw e; })); },
  async info() { return py.runPython('motor.js_info()'); },
  async calcular({ datos }) { py.globals.set('PAYLOAD', datos); return py.runPython('motor.js_calcular(PAYLOAD)'); },
  async importar({ bytes }) {
    await asegurar('openpyxl');
    py.FS.writeFile('/tmp/entrada.xlsx', bytes);
    return py.runPython("json.dumps(motor.importar_excel(open('/tmp/entrada.xlsx','rb').read()), ensure_ascii=False)");
  },
  async exportar({ datos, formato }) {
    if (formato === 'xlsx') await asegurar('openpyxl');
    if (formato === 'pdf') await asegurar('matplotlib');
    py.globals.set('PAYLOAD', datos); py.globals.set('FMT', formato);
    const meta = await conPaquetes(() => py.runPython("_b, _n, _m = motor.exportar(json.loads(PAYLOAD), FMT)\nopen('/tmp/salida.bin', 'wb').write(_b)\njson.dumps([_n, _m])"));
    return { meta, bytes: py.FS.readFile('/tmp/salida.bin') };
  },
  async rpc({ nombre, datos }) {
    if (/importar|plantilla|excel/i.test(nombre)) await asegurar('openpyxl');
    return conPaquetes(() => { py.globals.set('RPC_N', nombre); py.globals.set('RPC_D', datos); return py.runPython('motor.js_rpc(RPC_N, RPC_D)'); });
  },
  async plantilla() {
    await asegurar('openpyxl');
    py.runPython("open('/tmp/plantilla.xlsx','wb').write(motor.plantilla_excel())");
    return { bytes: py.FS.readFile('/tmp/plantilla.xlsx') };
  },
};

self.onmessage = async (ev) => {
  const { id, op, ...args } = ev.data || {};
  try {
    if (op !== 'iniciar') await OPS.iniciar();
    const r = await OPS[op](args);
    const tr = r && r.bytes ? [r.bytes.buffer] : [];
    self.postMessage({ id, ok: true, r }, tr);
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message || e).split('\n').filter(Boolean).slice(-3).join(' ') });
  }
};
