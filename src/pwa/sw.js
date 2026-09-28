// Работа без сети. Страница — сначала из сети (всегда свежая), без сети — из кэша; шрифты — из
// кэша, в фоне обновляются. Версия — отпечаток страницы: новая выкладка ставит новый кэш, а
// старый удаляется. Сборка кладёт этот файл рядом со страницей и подставляет версию.
const VERSION = '/*VERSION*/';
const CACHE = `ege-lg-trainer-${VERSION}`;
const PAGE = 'index.html';
const CORE = ['./', PAGE, 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'icon-maskable-512.png', 'apple-touch-icon.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ege-lg-trainer-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(PAGE, copy)));
        }
        return response;
      })
      .catch(() => caches.open(CACHE).then((cache) => cache.match(PAGE))));
    return;
  }
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const fresh = fetch(request).then((response) => {
        if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
        return response;
      });
      if (cached) {
        event.waitUntil(fresh.catch(() => undefined));
        return cached;
      }
      return fresh;
    }));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(request)).then((cached) => cached || fetch(request)));
  }
});
