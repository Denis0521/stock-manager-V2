const CACHE_NAME = 'stock-portfolio-v4.1.0';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json'
];

// 安裝服務器：載入靜態基礎核心
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened dynamic service cache store');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// 激活服務器：清除其餘過時的舊版 Cache 碎片
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting expired old version cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 💡 關鍵代碼優化：對本地 html、json 資源全面改為 "Network First"
// 這樣能保證開發者未來一更新代碼，使用者重開 App 就一定看得到最新功能
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  if (url.origin === self.location.origin) {
    // 本地靜態頁面：網絡優先，網絡斷線時才降級用快取
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // 外部第三方 API（Fugle / Yahoo / Google）：直接走網絡，不要緩存股價
    event.respondWith(fetch(event.request));
  }
});
