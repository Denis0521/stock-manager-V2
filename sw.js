// 版本號與 index.html 必須同步，以觸發快取更新
const CACHE_NAME = 'stock-portfolio-v4.20.3'; 
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png', 
  './icon-512.png'
];

// 安裝事件：建立新的快取並刪除舊版本
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// 啟動事件：清除過期的快取，確保介面樣式同步更新
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

// 抓取策略：API 使用 Network-First 以確保即時，靜態資源使用 Cache-First
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  
  // 指定 API 域名，不經過快取
  const apiHosts = [
    'api.fugle.tw', 'finance.yahoo.com', 'allorigins.win', 
    'denis0521.workers.dev', 'corsproxy.io', 'codetabs.com', 'thingproxy.freeboard.io'
  ];
  
  const isApiRequest = apiHosts.some(host => requestUrl.hostname.includes(host));

  if (isApiRequest) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 靜態資源採取快取優先策略
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
