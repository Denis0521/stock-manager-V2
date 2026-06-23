// =========================================================
//  Service Worker - 股票庫存管理 V4.14.0
//  策略：Cache First (快取優先) + Network Fallback (網路備援)
// =========================================================
const CACHE_NAME = 'stock-portfolio-v4.14.0';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-512.png'
];

// 安裝 Service Worker 時，預先快取必要資源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] 預先快取資源中...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('[SW] 快取完成！');
        return self.skipWaiting(); // 強制啟動新的 SW
      })
  );
});

// 啟動時接管所有客戶端
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // 刪除舊版本快取
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] 刪除舊快取：', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] 已啟動並接管頁面');
      return self.clients.claim();
    })
  );
});

// 攔截請求，實施「快取優先，網路備援」策略
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // 如果是 API 請求（Fugle, Yahoo, Worker），直接採用 Network First 策略，不存入快取
  if (requestUrl.hostname.includes('fugle.tw') || 
      requestUrl.hostname.includes('yahoo.com') || 
      requestUrl.hostname.includes('workers.dev')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // 若 API 完全失敗，回傳一個空回應 (或可自訂錯誤訊息)
        return new Response('{"error":"Offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  // 對於其他資源 (HTML, CSS, JS, 圖片)，使用 Cache First
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // 命中快取：直接回傳
          return cachedResponse;
        }
        // 未命中快取：發起網路請求，並將結果存入快取 (動態快取)
        return fetch(event.request)
          .then((networkResponse) => {
            // 檢查是否為有效的回應
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            // 複製回應，存入快取
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });
            return networkResponse;
          })
          .catch(() => {
            // 若網路完全離線且無快取，回傳簡易離線頁面 (或空回應)
            return new Response('離線模式 - 請檢查網路連線', { status: 503 });
          });
      })
  );
});
