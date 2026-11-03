// Service worker: un piccolo script che il browser tiene attivo anche a pagina chiusa.
// Qui serve solo per le notifiche: riceve il messaggio dal server (via Apple/Google) e lo mostra.
// Deve stare nella cartella principale del sito (/sw.js), così vale per tutte le pagine.

self.addEventListener("push", e => {
  const m = e.data ? e.data.json() : {};
  // waitUntil: dice al browser di non spegnere il service worker finché la notifica non è mostrata
  e.waitUntil(self.registration.showNotification(m.title || "La mia giornata", {
    body: m.body || "",
    icon: "img/icon-192.png",
  }));
});

// Tocco sulla notifica: porta in primo piano la dashboard se è già aperta, altrimenti la apre.
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list =>
    list.length ? list[0].focus() : clients.openWindow("./")));
});
