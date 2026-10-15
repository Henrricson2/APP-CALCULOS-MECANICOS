// Igual que la app de APUs: network-first para el código propio, cache-first para
// recursos estáticos y para Python en el navegador (Pyodide, ~40 MB, se descarga una vez).
const CACHE = 'calculos-mt-v15';
const APP = ['./', './index.html', './styles.css?v=15', './js/app.js?v=15', './js/motor.js?v=15', './js/perfil.js?v=15', './js/geo-ui.js?v=15', './js/mapa.js?v=15', './js/elevacion.js',
  './manifest.webmanifest', './icon.svg', './icon-192.png', './defaults.json', './ejemplo.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && !k.startsWith('pyodide') && !k.startsWith('leaflet')).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === self.location.origin && url.pathname.includes('/api/')) return; // API: siempre red

  if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('gstatic.com')) return; // Google Maps: nunca en caché (condiciones de uso)
  // Teselas de mapas gratuitos (Esri, OpenStreetMap, OpenTopoMap): siempre red, sin guardar (condiciones de uso)
  if (/(arcgisonline\.com|openstreetmap\.org|opentopomap\.org)$/.test(url.hostname)) return;
  if (url.hostname === 'unpkg.com' && url.pathname.startsWith('/leaflet@')) { // Leaflet: cache-first (librería fija por versión)
    e.respondWith(caches.open('leaflet-1.9.4').then(async (c) => {
      const hit = await c.match(e.request); if (hit) return hit;
      const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r;
    }));
    return;
  }
  if (url.hostname === 'cdn.jsdelivr.net') { // Pyodide: cache-first permanente
    e.respondWith(caches.open('pyodide-v0.27.2').then(async (c) => {
      const hit = await c.match(e.request); if (hit) return hit;
      const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: false }).then((m) => m || caches.match('./index.html'))));
});
