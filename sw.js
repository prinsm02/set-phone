// Offline cache: the app works in airplane mode once opened online one time.
// Bump VERSION after every change so phones pick up the new files.
const VERSION = 'setphone-v4';
const FILES = ['./', './index.html', './styles.css', './app.js', './presets.js', './manifest.json',
  './icon-180.png', './icon-192.png', './icon-512.png',
  './ring.wav', './alarm.wav', './ringback.wav', './in.wav', './notif.wav', './sent.wav', './end.wav', './buzz.wav', './lib/library.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    await c.addAll(FILES);
    try { // built-in image library + UI icons listed in lib/library.json
      const j = await (await fetch('./lib/library.json')).json();
      await c.addAll([...(j.items || []).map(x => './lib/' + x.file), ...(j.ui || []).map(f => './lib/' + f)]);
    } catch (err) {}
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res;
  }).catch(() => caches.match('./index.html'))));
});
