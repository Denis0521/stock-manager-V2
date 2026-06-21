/* ========================================================= 🛡️ Service Worker V5.0.0 ========================================================= */

const CACHE_NAME = 'stock-portfolio-v5';
const STATIC_CACHE = 'stock-static-v5';
const DYNAMIC_CACHE = 'stock-dynamic-v5';
const IMAGE_CACHE = 'stock-images-v5';

// 核心靜態資源（安裝時預快取）
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-512.png',
  '/icon-192.png'
];

// 外部資源（可選快取）
const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;600;700;800&display=swap'
];

/* ========================================================= 📦 安裝階段 ========================================================= */

self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        // 預快取核心資源
        return cache.addAll(CORE_ASSETS.map(url => new Request(url, { cache: 'reload' })))
          .catch(err => {
            console.warn('[SW] Failed to pre-cache some assets:', err);
            // 即使部分失敗也繼續安裝
            return Promise.resolve();
          });
      })
      .then(() => {
        console.log('[SW] Core assets cached');
        return self.skipWaiting(); // 立即激活
      })
  );
});

/* ========================================================= 🔄 激活階段 ========================================================= */

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');

  event.waitUntil(
    caches.keys().then(cacheNames => {
      // 清理舊版本快取
      return Promise.all(
        cacheNames
          .filter(name => {
            return name.startsWith('stock-') && 
                   !name.includes('v5');
          })
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Activated and controlling');
      return self.clients.claim(); // 立即控制所有頁面
    })
  );
});

/* ========================================================= 🌐 攔截請求 ========================================================= */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 忽略非 GET 請求
  if (request.method !== 'GET') return;

  // 策略路由
  if (isStaticAsset(url)) {
    event.respondWith(staticAssetStrategy(request));
  } else if (isAPIRequest(url)) {
    event.respondWith(apiStrategy(request));
  } else if (isImageRequest(url)) {
    event.respondWith(imageStrategy(request));
  } else {
    event.respondWith(networkFirstStrategy(request));
  }
});

/* ========================================================= 📋 策略函數 ========================================================= */

/** 判斷是否為靜態資源 */
function isStaticAsset(url) {
  const staticExts = ['.html', '.css', '.js', '.json', '.woff2', '.woff'];
  return staticExts.some(ext => url.pathname.endsWith(ext)) || 
         url.pathname === '/' ||
         url.pathname === '/index.html';
}

/** 判斷是否為 API 請求 */
function isAPIRequest(url) {
  return url.hostname.includes('api.fugle.tw') ||
         url.hostname.includes('yahoo') ||
         url.hostname.includes('workers.dev') ||
         url.hostname.includes('allorigins') ||
         url.hostname.includes('corsproxy');
}

/** 判斷是否為圖片 */
function isImageRequest(url) {
  return url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i);
}

/** 🏠 靜態資源策略：Cache First + 背景更新 */
async function staticAssetStrategy(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    // 背景更新：返回快取的同時去網路取最新版本
    fetch(request).then(response => {
      if (response.ok) cache.put(request, response.clone());
    }).catch(() => {});
    return cached;
  }

  // 沒有快取，從網路取
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    // 完全離線且沒快取，返回離線頁面
    return offlineResponse();
  }
}

/** ⚡ API 策略：Network First + 快取降級 */
async function apiStrategy(request) {
  const cache = await caches.open(DYNAMIC_CACHE);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // 成功響應存入快取（帶時間戳）
      const responseToCache = networkResponse.clone();
      const headers = new Headers(responseToCache.headers);
      headers.set('x-sw-cached-at', Date.now().toString());

      const cachedResponse = new Response(await responseToCache.blob(), {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers
      });

      cache.put(request, cachedResponse);
      return networkResponse;
    }
  } catch (err) {
    console.log('[SW] API network failed, trying cache:', request.url);
  }

  // 網路失敗，嘗試快取
  const cached = await cache.match(request);
  if (cached) {
    // 檢查快取是否過期（5 分鐘）
    const cachedAt = cached.headers.get('x-sw-cached-at');
    if (cachedAt && (Date.now() - parseInt(cachedAt)) < 300000) {
      return cached;
    }
  }

  // 完全無法取得，返回錯誤響應
  return new Response(JSON.stringify({ error: 'offline', message: '無網路連線且無可用快取' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

/** 🖼️ 圖片策略：Cache First + 過期檢查 */
async function imageStrategy(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);

  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    // 圖片離線時返回透明 1x1 pixel
    return transparentPixelResponse();
  }
}

/** 🌐 通用策略：Network First */
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cache = await caches.open(DYNAMIC_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    return offlineResponse();
  }
}

/* ========================================================= 📄 備用響應 ========================================================= */

/** 離線頁面 */
function offlineResponse() {
  const offlineHTML = `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>離線模式 - 股票庫存管理</title>
<style>
  body { 
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
    background: #e0e5ec; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    min-height: 100vh; 
    margin: 0; 
  }
  .offline-card { 
    background: #e0e5ec; 
    padding: 40px; 
    border-radius: 20px; 
    box-shadow: 8px 8px 16px #a3b1c6, -8px -8px 16px #ffffff; 
    text-align: center; 
    max-width: 400px; 
  }
  .offline-icon { font-size: 64px; margin-bottom: 20px; }
  h1 { color: #2d3436; font-size: 24px; margin-bottom: 12px; }
  p { color: #6b7280; font-size: 16px; line-height: 1.6; }
  .retry-btn { 
    margin-top: 24px; 
    padding: 12px 24px; 
    border: none; 
    border-radius: 12px; 
    background: #e0e5ec; 
    box-shadow: 4px 4px 8px #a3b1c6, -4px -4px 8px #ffffff; 
    color: #1a73e8; 
    font-size: 16px; 
    font-weight: 600; 
    cursor: pointer; 
  }
  .retry-btn:active { box-shadow: inset 4px 4px 8px #a3b1c6, inset -4px -4px 8px #ffffff; }
</style>
</head>
<body>
  <div class="offline-card">
    <div class="offline-icon">📡</div>
    <h1>目前處於離線狀態</h1>
    <p>您的網路連線已中斷，但已快取的資料仍可正常瀏覽。<br>請檢查網路設定後重新整理。</p>
    <button class="retry-btn" onclick="location.reload()">重新連線</button>
  </div>
</body>
</html>`;

  return new Response(offlineHTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/** 透明像素 */
function transparentPixelResponse() {
  const pixel = new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
    0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
  ]);

  return new Response(pixel, {
    headers: { 'Content-Type': 'image/png' }
  });
}

/* ========================================================= 🔄 背景同步 ========================================================= */

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-stock-prices') {
    console.log('[SW] Background sync triggered');
    event.waitUntil(syncPrices());
  }
});

async function syncPrices() {
  // 嘗試在背景刷新價格
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_PRICES' });
  });
}

/* ========================================================= 💬 推送通知 ========================================================= */

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '股票庫存管理';
  const options = {
    body: data.body || '您的持股有更新',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'stock-update',
    requireInteraction: false,
    data: data.payload || {}
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow('/')
  );
});

/* ========================================================= 🧹 定期清理 ========================================================= */

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'cleanup-cache') {
    event.waitUntil(cleanupOldCache());
  }
});

async function cleanupOldCache() {
  const dynamicCache = await caches.open(DYNAMIC_CACHE);
  const requests = await dynamicCache.keys();
  const now = Date.now();
  const ONE_DAY = 86400000;

  for (const request of requests) {
    const response = await dynamicCache.match(request);
    if (response) {
      const cachedAt = response.headers.get('x-sw-cached-at');
      if (cachedAt && (now - parseInt(cachedAt)) > ONE_DAY * 7) {
        await dynamicCache.delete(request);
      }
    }
  }

  console.log('[SW] Cache cleanup completed');
}

/* ========================================================= 📡 消息處理 ========================================================= */

self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))))
    );
  } else if (event.data.type === 'GET_CACHE_SIZE') {
    event.waitUntil(
      caches.keys().then(async names => {
        let total = 0;
        for (const name of names) {
          const cache = await caches.open(name);
          const requests = await cache.keys();
          total += requests.length;
        }
        event.source.postMessage({ type: 'CACHE_SIZE', size: total });
      })
    );
  }
});

console.log('[SW] Service Worker V5.0.0 loaded');
