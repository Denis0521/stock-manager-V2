// 請將版本號更新為與 index.html 一致的 4.14.5
const CACHE_NAME = 'stock-portfolio-v4.15.0'; 
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png', 
  './icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
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
  
  // API 請求不進快取
  const isApiRequest = requestUrl.hostname.includes('api.fugle.tw') || 
                       requestUrl.hostname.includes('finance.yahoo.com') || 
                       requestUrl.hostname.includes('allorigins.win') || 
                       requestUrl.hostname.includes('denis0521.workers.dev') || 
                       requestUrl.hostname.includes('corsproxy.io') ||
                       requestUrl.hostname.includes('codetabs.com') ||
                       requestUrl.hostname.includes('thingproxy.freeboard.io');

  if (isApiRequest) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request).then(response => {
      return caches.open(CACHE_NAME).then(cache => {
        cache.put(event.request, response.clone());
        return response;
      });
    }).catch(() => {
      return caches.match(event.request);
    })
  );
});
