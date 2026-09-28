// Аварийное выключение работы без сети. Выходит под именем sw.js (build_site.py --no-offline):
// браузер, проверяя обновление, ставит этот файл вместо старого — тот удаляет кэши, снимает
// регистрацию и перезагружает открытые страницы уже из сети.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ege-lg-trainer-')).map((k) => caches.delete(k))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.matchAll({ type: 'window' }))
    .then((clients) => clients.forEach((client) => client.navigate(client.url))));
});
