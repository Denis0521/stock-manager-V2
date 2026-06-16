const CACHE_NAME = 'stock-portfolio-v3.6.1'; // ⚠️ 修改這裡的版本號是強制更新的關鍵
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting(); // 強制立即啟用新版的 Service Worker
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName); // 刪除舊版快取
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  
  // 🚀 重要優化：絕對不快取 API 動態請求，確保股價即時更新！
  const isApiRequest = 
    requestUrl.hostname.includes('api.fugle.tw') || 
    requestUrl.hostname.includes('finance.yahoo.com') || 
    requestUrl.hostname.includes('allorigins.win') ||
    requestUrl.hostname.includes('docs.google.com');

  if (isApiRequest) {
    // 如果是 API 請求，永遠直接向伺服器要資料，不讀快取
    event.respondWith(fetch(event.request));
    return;
  }

  // 對於靜態檔案 (HTML, CSS, JS)，使用 Cache First 策略增加離線可用性
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

