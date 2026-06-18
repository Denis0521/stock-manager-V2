const CACHE_NAME = 'stock-portfolio-v3.8.0'; // 🚀 版本號已升至 3.8.0
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // 強制立即啟用新版的 Service Worker
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache v3.8.0');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName); // 清除舊版快取
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  
  // 絕對不快取 API 動態請求與智慧搜尋請求
  const isApiRequest = 
    requestUrl.hostname.includes('api.fugle.tw') || 
    requestUrl.hostname.includes('finance.yahoo.com') || 
    requestUrl.hostname.includes('allorigins.win') ||
    requestUrl.hostname.includes('docs.google.com');
  
  if (isApiRequest) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // 靜態檔案使用快取優先
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) return response;
        return fetch(event.request);
      })
  );
});
