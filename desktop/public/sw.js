// Minimal service worker — its only job is to make the Dilarion web app
// installable (Add to Home Screen). It takes over immediately and passes every
// request through to the network, so there is never a stale cached app build.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  // Navigations fall back to the app shell when offline so the PWA still opens.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
  }
});
