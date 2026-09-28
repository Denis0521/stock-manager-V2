/* Service Worker：網路優先 + 離線退回 App Shell
   只攔截同來源 GET 請求：API 屬跨網域且為即時資料，直接放行可少一层開銷並避免污染快取 */
const CACHE_NAME = 'stock-app-V7.41'; // 需與 index.html 的 APP_VER 同步更新
const APP_SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const SAME_ORIGIN_PREFIX = self.location.origin + '/';

let cachePromise = null;
const getCache = () => cachePromise || (cachePromise = caches.open(CACHE_NAME)); // 同一個 DB 只開一次

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(getCache().then(cache => cache.addAll(APP_SHELL)).catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      // allSettled：單一舊快取刪除失敗也不會卡住整個啟動流程
      .then(names => Promise.allSettled(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(SAME_ORIGIN_PREFIX)) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await getCache();
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()); // 不 await，不拖慢回應
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {           // 離線開站：退回已快取的頁面骨架
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}
