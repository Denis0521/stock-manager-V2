const CACHE_NAME = 'stock-portfolio-v3.5.4';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

// Install: 使用 allSettled 避免單一資源失敗導致安裝中斷
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching static assets');
      return Promise.allSettled(
        STATIC_ASSETS.map(url => 
          cache.add(url).catch(err => console.warn(`[SW] Skip caching ${url}:`, err))
        )
      );
    })
  );
  self.skipWaiting();
});

// Activate: 清理舊版快取並立即接管
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

// Fetch: API 請求強制走網路，靜態資源走 Cache-First
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 🔑 關鍵優化：Fugle API 永不快取，確保股價即時性
  if (url.hostname.includes('fugle') || url.pathname.includes('/api/')) {
    return; // 交由瀏覽器預設 Network-Only 處理
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // 僅快取成功且為 GET 的靜態資源
        if (response && response.status === 200 && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // 離線 fallback：僅對 HTML 請求返回快取頁面
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
