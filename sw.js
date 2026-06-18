const CACHE_NAME = 'stock-portfolio-v3.7.4';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-512.png',
  './icon.svg'
];
const API_CACHE_NAME = 'stock-api-cache-v3.7.4';
const API_MAX_AGE = 5 * 60 * 1000;

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Cache opened:', CACHE_NAME);
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  
  const isApiRequest = [
    'api.fugle.tw',
    'finance.yahoo.com',
    'allorigins.win',
    'corsproxy.io',
    'api.codetabs.com',
    'docs.google.com'
  ].some(host => requestUrl.hostname.includes(host));

  if (isApiRequest) {
    event.respondWith(networkFirstWithCache(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(response => {
      if (response) return response;
      return fetch(event.request).then(resp => {
        if (!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return resp;
      });
    })
  );
});

async function networkFirstWithCache(request) {
  const cache = await caches.open(API_CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    const dateHeader = cached.headers.get('sw-cached-date');
    if (dateHeader && (Date.now() - parseInt(dateHeader)) < API_MAX_AGE) {
      return cached;
    }
  }

  try {
    const networkResp = await fetch(request);
    const clone = networkResp.clone();
    const headers = new Headers(clone.headers);
    headers.set('sw-cached-date', Date.now().toString());
    
    const modifiedResp = new Response(clone.body, {
      status: clone.status,
      statusText: clone.statusText,
      headers
    });
    
    cache.put(request, modifiedResp);
    return networkResp;
  } catch (err) {
    if (cached) {
      console.log('[SW] Network failed, serving stale cache');
      return cached;
    }
    throw err;
  }
}

