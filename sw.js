const CACHE_NAME = 'stock-portfolio-v4.11.0'; 
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
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
  // 核心網路請求判斷：以下所有金融報價端點或 CORS 公開代理服務一律跳過靜態快取，確保報價不卡死
  const isApiRequest = requestUrl.hostname.includes('api.fugle.tw') || 
                       requestUrl.hostname.includes('finance.yahoo.com') || 
                       requestUrl.hostname.includes('allorigins.win') || 
                       requestUrl.hostname.includes('denis0521.workers.dev') || 
                       requestUrl.hostname.includes('corsproxy.io') ||
                       requestUrl.hostname.includes('codetabs.com') ||
                       requestUrl.hostname.includes('thingproxy.freeboard.io') ||
                       requestUrl.hostname.includes('docs.google.com');

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
