const CACHE_NAME = 'stock-portfolio-v4.14.9';
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(['./', './index.html'])));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // 新聞代理與 API 直接連線，不使用快取
  if (url.hostname.includes('api.fugle.tw') || url.hostname.includes('allorigins.win') || url.hostname.includes('api.rss2json.com')) {
    event.respondWith(fetch(event.request));
  } else {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});
