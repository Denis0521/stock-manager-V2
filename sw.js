// 請將版本號更新為與 index.html 一致的 4.20.1
const CACHE_NAME = 'stock-portfolio-v4.20.1'; 
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
        cacheNames
          .filter(cacheName => cacheName !== CACHE_NAME)
          .map(cacheName => caches.delete(cacheName))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  
  // API 請求不進快取，保持資料即時性
  const apiHosts = [
    'api.fugle.tw', 'finance.yahoo.com', 'allorigins.win', 
    'denis0521.workers.dev', 'corsproxy.io', 'codetabs.com', 'thingproxy.freeboard.io'
  ];
  
  const isApiRequest = apiHosts.some(host => requestUrl.hostname.includes(host));

  if (isApiRequest) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 靜態資源使用 Cache First, Network Fallback 策略
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then(response => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, response.clone());
          return response;
        });
      });
    }).catch(() => caches.match(event.request))
  );
});
