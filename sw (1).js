// =========================================================
//  SERVICE WORKER — Flora Agronegócio · Almoxarifado
// =========================================================

const SW_VERSION = 'v1.2.0';
const CACHE_STATIC = `flora-static-${SW_VERSION}`;
const CACHE_FONTS  = `flora-fonts-${SW_VERSION}`;

const STATIC_ASSETS = [
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const FONT_ORIGINS = ['https://fonts.googleapis.com','https://fonts.gstatic.com'];
const CDN_ORIGINS  = ['https://www.gstatic.com','https://cdnjs.cloudflare.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_STATIC && k !== CACHE_FONTS).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebase.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com')) return;
  if (FONT_ORIGINS.some(o => request.url.startsWith(o))) {
    event.respondWith(cacheFirst(request, CACHE_FONTS)); return;
  }
  if (CDN_ORIGINS.some(o => request.url.startsWith(o))) {
    event.respondWith(cacheFirst(request, CACHE_STATIC)); return;
  }
  if (url.origin === self.location.origin &&
     (url.pathname.endsWith('/') || url.pathname.endsWith('index.html'))) {
    event.respondWith(networkFirst(request)); return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_STATIC)); return;
  }
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request) || await caches.match('./index.html');
    if (cached) return cached;
    return new Response(offlinePage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) { const cache = await caches.open(cacheName); cache.put(request, response.clone()); }
    return response;
  } catch (e) {
    return new Response('Offline', { status: 503 });
  }
}

function offlinePage() {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flora · Offline</title><style>body{margin:0;background:#1a4a20;color:#fff;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}.icon{font-size:64px;margin-bottom:24px}h1{font-size:22px;color:#4caf50}p{font-size:14px;color:rgba(255,255,255,.7);max-width:280px;line-height:1.6}button{margin-top:24px;background:#1a7a2e;color:#fff;border:none;border-radius:12px;padding:14px 28px;font-size:15px;font-weight:600;cursor:pointer}</style></head><body><div class="icon">🌿</div><h1>Sem conexão</h1><p>Verifique sua internet e tente novamente.</p><button onclick="location.reload()">↺ Tentar novamente</button></body></html>`;
}

self.addEventListener('sync', event => {
  if (event.tag === 'sync-contagens')
    event.waitUntil(self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage({ type: 'SYNC_PENDING' }))));
});

self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(self.registration.showNotification(data.title || 'Flora Almoxarifado', {
    body: data.body || '', icon: './icons/icon-192.png', badge: './icons/icon-96.png',
    tag: data.tag || 'flora', data: data.url || './', vibrate: [200, 100, 200],
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data || './'));
});
