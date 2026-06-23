const CACHE_NAME='stock-portfolio-v5.0.0';
const urlsToCache=['./','./index.html','./manifest.json','./icon-512.png'];

self.addEventListener('install',e=>{
 self.skipWaiting();
 e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(urlsToCache)));
});

self.addEventListener('fetch',e=>{
 e.respondWith(fetch(e.request).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
