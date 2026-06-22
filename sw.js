const CACHE_NAME = 'stock-portfolio-v4.6.0'; 
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
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
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  const isApiRequest = requestUrl.hostname.includes('api.fugle.tw') || 
                       requestUrl.hostname.includes('finance.yahoo.com') || 
                       requestUrl.hostname.includes('allorigins.win') || 
                       requestUrl.hostname.includes('docs.google.com');

  if (isApiRequest) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 💡 底層修正：改用「網路優先 (Network-First)」策略。
  // 有網路時絕對抓取最新版檔案，沒網路時才使用舊快取，避免永遠卡在舊版本。
  event.respondWith(
    fetch(event.request).then(response => {
      return caches.open(CACHE_NAME).then(cache => {
        cache.put(event.request, response.clone());
        return response;
      });
    }).catch(() => {
      return caches.match(event.request);
    })
  );
});
