/* PepsGoal : service worker de la version web (https://app.pepsgoal.fr).
 * Rôle unique : afficher les notifications push envoyées par le serveur, même quand l'application est fermée,
 * et ouvrir le bon écran au toucher. Aucune mise en cache : l'application se charge toujours depuis le réseau.
 * Copié tel quel dans apps/web/dist par apps/web/build.mjs. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Les pages ouvertes rafraîchissent leurs données sociales
    wins.forEach(w => w.postMessage({ type: 'push', tag: d.tag || 'pepsgoal', title: d.title || '', body: d.body || '', view: d.view || '' }));
    // PepsGoal est déjà au premier plan : l'application affiche elle-même l'information
    if (wins.some(w => w.visibilityState === 'visible' && w.focused)) return;
    await self.registration.showNotification(d.title || 'PepsGoal', {
      body: d.body || '', icon: '/icon-512.png', badge: '/favicon.png', lang: 'fr',
      tag: d.tag || 'pepsgoal', renotify: true, data: { view: d.view || 'today' }
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const view = (e.notification.data && e.notification.data.view) || 'today';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(c => new URL(c.url).origin === self.location.origin);
    if (w) { w.postMessage({ type: 'open', view }); return w.focus(); }
    return self.clients.openWindow('/?view=' + encodeURIComponent(view));
  })());
});
