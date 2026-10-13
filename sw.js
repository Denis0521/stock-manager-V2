/* Service Worker：網路優先（一般 3 秒、頁面導覽 1.2 秒逾時退回快取）+ 離線退回 App Shell
   只攔截同來源 GET 請求：API 屬跨網域且為即時資料，直接放行可少一層開銷並避免污染快取
   版本號由 index.html 以 sw.js?v=版本 傳入，不需再手動同步兩處 */
const VER = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_NAME = 'stock-app-' + VER;
const APP_SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];
const SAME_ORIGIN_PREFIX = self.location.origin + '/';
const NETWORK_TIMEOUT = 3000;
const NAV_TIMEOUT = 1200; // 開啟 App（頁面導覽）時縮短等待，網路慢就先用快取秒開，背景仍會更新快取

let cachePromise = null;
const getCache = () => cachePromise || (cachePromise = caches.open(CACHE_NAME)); // 同一個 DB 只開一次

self.addEventListener('install', event => {
  self.skipWaiting();
  // 逐一快取：單一檔案（例如缺少圖示）失敗，不會讓整批快取一起失敗
  event.waitUntil(
    getCache().then(cache =>
      Promise.allSettled(APP_SHELL.map(url => cache.add(new Request(url, { cache: 'reload' }))))
    ).catch(() => {})
  );
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
  event.respondWith(networkFirst(req, event));
});

async function networkFirst(req, event) {
  const cache = await getCache();
  const network = fetch(req).then(res => {
    // 帶時間戳（_=）的即時請求不寫入快取，避免快取無限增長
    if (res && res.ok && res.type === 'basic' && !new URL(req.url).searchParams.has('_')) cache.put(req, res.clone());
    return res;
  });
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(reject, req.mode === 'navigate' ? NAV_TIMEOUT : NETWORK_TIMEOUT, new Error('timeout')); });
  try {
    return await Promise.race([network, timeout]);
  } catch (err) {
    // 逾時或離線：有快取就先回快取（網路請求在背景繼續，成功後會更新快取）
    const cached = (await cache.match(req)) || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
    return network; // 沒有快取就繼續等網路（失敗則照常報錯）
  } finally {
    clearTimeout(timer);
  }
}
