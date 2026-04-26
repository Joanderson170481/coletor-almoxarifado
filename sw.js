// =========================================================
//  SERVICE WORKER — Coletor Almoxarifado
//  Estratégia: Cache First para assets estáticos
//              Network First para dados Firebase
//              Fila offline para operações de escrita
// =========================================================

const SW_VERSION = 'v1.0.0';
const CACHE_STATIC  = `coletor-static-${SW_VERSION}`;
const CACHE_FONTS   = `coletor-fonts-${SW_VERSION}`;
const CACHE_PAGES   = `coletor-pages-${SW_VERSION}`;

// Assets que sempre queremos em cache
const STATIC_ASSETS = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

const CDN_ORIGINS = [
  'https://www.gstatic.com',
  'https://cdnjs.cloudflare.com',
];

// ─── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  const validCaches = [CACHE_STATIC, CACHE_FONTS, CACHE_PAGES];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => !validCaches.includes(k))
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora requests que não são GET
  if (request.method !== 'GET') return;

  // Ignora requests do Firebase (Firestore / Auth) — deixa passar direto
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebase.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com')) {
    return;
  }

  // Fontes Google — Cache First (mudam raramente)
  if (FONT_ORIGINS.some(o => request.url.startsWith(o))) {
    event.respondWith(cacheFirst(request, CACHE_FONTS));
    return;
  }

  // CDN scripts (Firebase SDK, XLSX) — Cache First
  if (CDN_ORIGINS.some(o => request.url.startsWith(o))) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // index.html e assets locais — Stale While Revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
});

// ─── Estratégias de cache ─────────────────────────────────────

// Cache First: serve do cache, vai à rede só se não tiver
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    return new Response('Offline — recurso não disponível', { status: 503 });
  }
}

// Stale While Revalidate: serve do cache imediatamente e atualiza em background
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_PAGES);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  // Se tem cache, serve imediatamente e atualiza em background
  if (cached) {
    fetchPromise; // dispara em background
    return cached;
  }

  // Se não tem cache, espera a rede
  const networkResponse = await fetchPromise;
  if (networkResponse) return networkResponse;

  // Fallback: retorna index.html para navegação offline (SPA)
  const fallback = await caches.match('./index.html');
  if (fallback) return fallback;

  return new Response(offlinePage(), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ─── Página offline de fallback ───────────────────────────────
function offlinePage() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coletor · Offline</title>
<style>
  body{margin:0;background:#0f2027;color:#e8f4f0;font-family:sans-serif;
       display:flex;flex-direction:column;align-items:center;justify-content:center;
       min-height:100vh;text-align:center;padding:24px}
  .icon{font-size:64px;margin-bottom:24px}
  h1{font-size:22px;margin-bottom:8px;color:#00d4aa}
  p{font-size:14px;color:#8ab8ae;max-width:280px;line-height:1.6}
  button{margin-top:24px;background:#00d4aa;color:#0f2027;border:none;
         border-radius:12px;padding:14px 28px;font-size:15px;font-weight:600;cursor:pointer}
</style>
</head>
<body>
  <div class="icon">📦</div>
  <h1>Sem conexão</h1>
  <p>Verifique sua internet e tente novamente. Os dados já salvos continuam disponíveis.</p>
  <button onclick="location.reload()">↺ Tentar novamente</button>
</body>
</html>`;
}

// ─── Background Sync (fila de operações offline) ───────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-contagens') {
    event.waitUntil(syncPendingContagens());
  }
});

async function syncPendingContagens() {
  // Notifica os clientes para sincronizar dados pendentes
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_PENDING' });
  });
}

// ─── Push Notifications ───────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Coletor Almoxarifado', {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-96.png',
      tag: data.tag || 'coletor',
      data: data.url || './',
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data || './')
  );
});
