// Работа без сети. Страница — сначала из сети (всегда свежая), без сети — из кэша; шрифты — из
// своего кэша, в фоне обновляются. Версия — отпечаток страницы и файлов рядом: новая выкладка
// ставит новый кэш, старый удаляется. Сборка кладёт этот файл рядом со страницей и подставляет
// версию. Путь sw.js не переименовывать: аварийное выключение (sw-off.js) выходит под ним же.
const VERSION = '/*VERSION*/';
const CACHE = `ege-lg-trainer-${VERSION}`;
// Шрифты не зависят от выкладки: кэш не сбрасывается на каждое изменение данных.
const FONTS = 'ege-lg-trainer-fonts-v1';
const FONTS_MAX = 200;
const PAGE = 'index.html';
const CORE = [PAGE, 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'icon-maskable-512.png', 'apple-touch-icon.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  // cache: 'reload' — мимо HTTP-кэша браузера: иначе новая версия сложила бы старую страницу.
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(CORE.map((url) => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys
      .filter((k) => k.startsWith('ege-lg-trainer-') && k !== CACHE && k !== FONTS)
      .map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimFonts(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - FONTS_MAX)).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request)
      .then((response) => {
        // Только сама страница: открытый как страница манифест не должен её подменить.
        const type = response.headers.get('content-type') || '';
        if (response.ok && type.startsWith('text/html')) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(PAGE, copy)));
        }
        return response;
      })
      .catch(() => caches.open(CACHE).then((cache) => cache.match(PAGE))));
    return;
  }
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(caches.open(FONTS).then(async (cache) => {
      const cached = await cache.match(request);
      const fresh = fetch(request).then((response) => {
        if (response.ok) {
          cache.put(request, response.clone()).then(() => trimFonts(cache));
        }
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
