const CACHE_NAME = 'stock-portfolio-v4.14.8';
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(['./', './index.html'])));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // 主要 API、備用代理與各家新聞媒體源直接連線，不使用快取
  if (url.hostname.includes('api.fugle.tw') || url.hostname.includes('allorigins.win') || url.hostname.includes('api.rss2json.com') || url.hostname.includes('wealth.com.tw') || url.hostname.includes('vocus.cc')) {
    event.respondWith(fetch(event.request));
  } else {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});
