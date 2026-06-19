const CACHE_NAME = 'stock-portfolio-v3.9.1'; // ⚠️ 版本號升級至 3.9.1
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache v3.9.1');
        return cache.addAll(urlsToCache);
      })
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
  
  const isApiRequest = 
    requestUrl.hostname.includes('api.fugle.tw') || 
    requestUrl.hostname.includes('finance.yahoo.com') || 
    requestUrl.hostname.includes('allorigins.win') ||
    requestUrl.hostname.includes('docs.google.com');
  
  if (isApiRequest) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) return response;
        return fetch(event.request);
      })
  );
});
