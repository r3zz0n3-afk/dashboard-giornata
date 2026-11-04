// Service worker: un piccolo script che il browser tiene attivo anche a pagina chiusa.
// Fa due lavori: mostra le notifiche, e tiene una copia della dashboard per aprirla subito anche senza rete.
// Deve stare nella cartella principale del sito (/sw.js), così vale per tutte le pagine.

// ---------------------------------------------------------------- copia per l'apertura immediata
// La copia dei file si aggiorna da sola a ogni apertura (vedi "stale-while-revalidate" qui sotto).
// Il nome si cambia solo se cambi l'elenco SHELL o questo file in modo importante: il browser vede che sw.js
// è diverso, installa la versione nuova e cancella la copia vecchia.
const CACHE = "giornata-v1";
const SHELL = ["./", "css/style.css", "js/script.js", "manifest.json", "img/icon.png", "img/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));  // skipWaiting: subito attivo
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));  // prende in carico anche le pagine già aperte
});

// Ogni richiesta della pagina passa di qui.
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;  // spunte, aggiunte, comandi: vanno sempre al server

  // I dati della dashboard: sempre dal server, ma ogni risposta buona viene salvata.
  // È la pagina (script.js) a mostrare per prima la copia salvata, poi quella nuova quando arriva.
  if (url.origin === location.origin && url.pathname === "/api/dashboard") {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put("api/dashboard", copy)));
      }
      return res;
    }));
    return;
  }
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) return;  // Spotify, notifiche...: niente copia

  // La pagina, lo stile, lo script, le icone e i font di Google: "stale-while-revalidate".
  // Risponde subito con la copia salvata e intanto chiede al server quella nuova, per la prossima apertura.
  const key = req.mode === "navigate" ? "./" : req;  // ogni indirizzo della dashboard (#/calendario...) è la stessa pagina
  e.respondWith(caches.open(CACHE).then(async c => {
    const saved = await c.match(key);
    const fresh = fetch(req).then(res => {
      if (res.ok || res.type === "opaque") c.put(key, res.clone());  // "opaque": file di un altro sito (i font)
      return res;
    });
    if (saved) {
      e.waitUntil(fresh.catch(() => {}));  // senza rete la copia nuova non arriva: va bene così
      return saved;
    }
    return fresh;
  }));
});

// ---------------------------------------------------------------- notifiche
// Il server manda {title, body, data}; per i promemoria data.rid è l'id, che serve a "Fatto" e "Tra 10 minuti".
self.addEventListener("push", e => {
  const m = e.data ? e.data.json() : {};
  const rid = m.data?.rid;
  // waitUntil: dice al browser di non spegnere il service worker finché la notifica non è mostrata
  e.waitUntil(self.registration.showNotification(m.title || "La mia giornata", {
    body: m.body || "",
    icon: "img/icon-192.png",
    data: m.data || {},
    // i pulsanti: Chrome, Edge e Firefox sul computer li mostrano; iPhone e iPad li ignorano (lì si tocca la notifica)
    actions: rid ? [{ action: "done", title: "Fatto" }, { action: "snooze", title: "Tra 10 minuti" }] : [],
  }));
});

// Tocco sulla notifica o su un suo pulsante.
self.addEventListener("notificationclick", e => {
  const rid = e.notification.data?.rid;
  e.notification.close();
  if (rid && (e.action === "done" || e.action === "snooze")) {  // un pulsante: fa tutto qui, senza aprire la pagina
    e.waitUntil(fetch(`api/todos/${encodeURIComponent(rid)}/${e.action}`, { method: "POST" }));
    return;
  }
  // Tocco sulla notifica: apre la dashboard. Se è un promemoria, la pagina mostra il foglio con "Fatto" e "Tra 10 minuti".
  const hash = rid ? `#/promemoria/${encodeURIComponent(rid)}` : "";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    if (!list.length) return clients.openWindow("./" + hash);
    if (rid) list[0].postMessage({ reminder: rid });  // pagina già aperta: le dice quale promemoria mostrare
    return list[0].focus();
  }));
});
