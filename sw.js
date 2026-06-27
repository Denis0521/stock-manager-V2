const CACHE_NAME = 'stock-portfolio-v4.14.1';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png', // 已補上 192x192 圖示，確保符合 Chrome 的安裝標準
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
  
  // 這些 API 請求不進快取，直接抓取最新資料
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

  // 網頁靜態資源優先透過網路抓取，抓不到才退回使用快取
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
