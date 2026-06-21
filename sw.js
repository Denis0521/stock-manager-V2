/* ========================================================= 🛡️ Service Worker V4.3.4 ========================================================= */

const CACHE_NAME = 'stock-portfolio-v4';
const STATIC_CACHE = 'stock-static-v4';
const DYNAMIC_CACHE = 'stock-dynamic-v4';
const IMAGE_CACHE = 'stock-images-v4';

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-512.png',
  '/icon-192.png'
];

self.addEventListener('install', (event) => {
  console.log('[SW] Installing V4.3.4...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        return cache.addAll(CORE_ASSETS.map(url => new Request(url, { cache: 'reload' })))
          .catch(err => {
            console.warn('[SW] Pre-cache partial failure:', err);
            return Promise.resolve();
          });
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating V4.3.4...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name.startsWith('stock-') && !name.includes('-v4'))
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;

  if (isStaticAsset(url)) {
    event.respondWith(staticAssetStrategy(request));
  } else if (isAPIRequest(url)) {
    event.respondWith(apiStrategy(request));
  } else if (isImageRequest(url)) {
    event.respondWith(imageStrategy(request));
  } else {
    event.respondWith(networkFirstStrategy(request));
  }
});

function isStaticAsset(url) {
  const exts = ['.html', '.css', '.js', '.json', '.woff2', '.woff'];
  return exts.some(ext => url.pathname.endsWith(ext)) || url.pathname === '/' || url.pathname === '/index.html';
}

function isAPIRequest(url) {
  return url.hostname.includes('api.fugle.tw') ||
         url.hostname.includes('yahoo') ||
         url.hostname.includes('workers.dev') ||
         url.hostname.includes('allorigins') ||
         url.hostname.includes('corsproxy');
}

function isImageRequest(url) {
  return url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i);
}

async function staticAssetStrategy(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request).then(r => { if (r.ok) cache.put(request, r.clone()); }).catch(() => {});
    return cached;
  }
  try {
    const r = await fetch(request);
    if (r.ok) cache.put(request, r.clone());
    return r;
  } catch (e) { return offlineResponse(); }
}

async function apiStrategy(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  try {
    const nr = await fetch(request);
    if (nr.ok) {
      const h = new Headers(nr.headers);
      h.set('x-sw-cached-at', Date.now().toString());
      cache.put(request, new Response(await nr.clone().blob(), { status: nr.status, statusText: nr.statusText, headers: h }));
      return nr;
    }
  } catch (e) { console.log('[SW] API fail, fallback to cache'); }
  const c = await cache.match(request);
  if (c) {
    const t = c.headers.get('x-sw-cached-at');
    if (t && (Date.now() - parseInt(t)) < 300000) return c;
  }
  return new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
}

async function imageStrategy(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const c = await cache.match(request);
  if (c) return c;
  try {
    const r = await fetch(request);
    if (r.ok) cache.put(request, r.clone());
    return r;
  } catch (e) { return transparentPixelResponse(); }
}

async function networkFirstStrategy(request) {
  try {
    const r = await fetch(request);
    if (r.ok) { const c = await caches.open(DYNAMIC_CACHE); c.put(request, r.clone()); }
    return r;
  } catch (e) {
    const c = await caches.open(DYNAMIC_CACHE);
    const m = await c.match(request);
    return m || offlineResponse();
  }
}

function offlineResponse() {
  return new Response(`<!DOCTYPE html>
<html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>離線模式</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#e0e5ec;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#e0e5ec;padding:40px;border-radius:20px;box-shadow:8px 8px 16px #a3b1c6,-8px -8px 16px #fff;text-align:center;max-width:400px}
.icon{font-size:64px;margin-bottom:20px}h1{color:#2d3436;font-size:24px}p{color:#6b7280;font-size:16px}
.btn{margin-top:24px;padding:12px 24px;border:none;border-radius:12px;background:#e0e5ec;box-shadow:4px 4px 8px #a3b1c6,-4px -4px 8px #fff;color:#1a73e8;font-size:16px;font-weight:600;cursor:pointer}
.btn:active{box-shadow:inset 4px 4px 8px #a3b1c6,inset -4px -4px 8px #fff}
</style></head><body>
<div class="card"><div class="icon">📡</div><h1>目前處於離線狀態</h1>
<p>已快取的資料仍可正常瀏覽。<br>請檢查網路後重新整理。</p>
<button class="btn" onclick="location.reload()">重新連線</button></div>
</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function transparentPixelResponse() {
  return new Response(new Uint8Array([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x06,0x00,0x00,0x00,0x1F,0x15,0xC4,0x89,0x00,0x00,0x00,0x0A,0x49,0x44,0x41,0x54,0x78,0x9C,0x63,0x00,0x01,0x00,0x00,0x05,0x00,0x01,0x0D,0x0A,0x2D,0xB4,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82]), { headers: { 'Content-Type': 'image/png' } });
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-stock-prices') {
    event.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => clients.forEach(c => c.postMessage({ type: 'SYNC_PRICES' }))));
  }
});

self.addEventListener('push', (event) => {
  const d = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(d.title || '股票庫存管理', {
    body: d.body || '持股有更新', icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag || 'stock-update', requireInteraction: false
  }));
});

self.addEventListener('notificationclick', (event) => { event.notification.close(); event.waitUntil(self.clients.openWindow('/')); });

self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  else if (event.data.type === 'CLEAR_CACHE') event.waitUntil(caches.keys().then(names => Promise.all(names.map(n => caches.delete(n)))));
});

console.log('[SW] Service Worker V4.3.4 loaded');
