const CACHE_NAME = 'stock-portfolio-v3.7.4';
const STATIC_ASSETS = ['./','./index.html','./manifest.json','./icon-512.png','./icon.svg'];
const API_CACHE_NAME = 'stock-api-cache-v3.7.4';
const API_MAX_AGE = 5 * 60 * 1000;

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(cacheNames => Promise.all(cacheNames.map(c => c !== CACHE_NAME && c !== API_CACHE_NAME ? caches.delete(c) : null))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  const isApi = ['api.fugle.tw','finance.yahoo.com','allorigins.win','corsproxy.io','api.codetabs.com','docs.google.com'].some(h => requestUrl.hostname.includes(h));
  if (isApi) {
    event.respondWith(networkFirstWithCache(event.request));
    return;
  }
  event.respondWith(caches.match(event.request).then(r => r || fetch(event.request).then(resp => {
    if (!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
    const clone = resp.clone();
    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
    return resp;
  })));
});

async function networkFirstWithCache(request) {
  const cache = await caches.open(API_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    const dateHeader = cached.headers.get('sw-cached-date');
    if (dateHeader && (Date.now() - parseInt(dateHeader)) < API_MAX_AGE) return cached;
  }
  try {
    const networkResp = await fetch(request);
    const clone = networkResp.clone();
    const headers = new Headers(clone.headers);
    headers.set('sw-cached-date', Date.now().toString());
    cache.put(request, new Response(clone.body, {status: clone.status, statusText: clone.statusText, headers}));
    return networkResp;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

