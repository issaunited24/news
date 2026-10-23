// Offline support: the app and its latest news are saved on the phone.
// Always tries the network first (so news and updates stay fresh) and falls back to the saved copy with no signal.
const CACHE = 'briefly-v1';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'favicon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const saveable = url => url.origin === location.origin || (url.hostname === 'raw.githubusercontent.com' && url.pathname.includes('/news/live/'));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!saveable(url)) return; // photos, prices and everything else go straight to the network
  const key = url.origin + url.pathname; // ignore the ?t= cache-busting so there's one saved copy per file
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key).then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error()))));
});
