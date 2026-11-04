# Spotify, accessibilità, "Fatto / Tra 10 minuti" e apertura senza rete

Report dalla teoria al codice, dopo [NOTIFICHE.md](NOTIFICHE.md). Commit principali:
`29c5336` e `94c7e29` (Spotify), `bfc4916` (pulsanti delle notifiche e apertura senza rete).

---

## 1. Spotify: come fa la dashboard a "parlare" con il tuo account

### Il problema
Spotify non dà i tuoi dati a chiunque li chieda. Serve un modo per dire "io permetto a questa dashboard di vedere
cosa ascolto e di comandare la riproduzione". Questo modo si chiama **OAuth**.

### Gli attori
- **L'app Spotify** creata su developer.spotify.com. Ha un **Client ID** (il suo nome pubblico) e un
  **Client secret** (la sua password), tutti e due nel `.env`.
- **Tu**, che dai il permesso.
- **Il server** della dashboard, che riceve le chiavi d'accesso.

### Il login, passo per passo
```
1. Tocchi "Collega Spotify"  →  /api/spotify/login
2. Il server ti rimanda a accounts.spotify.com con:
     client_id, redirect_uri, scope (cosa chiede), state (numero a caso)
3. Spotify ti chiede: "Permetti a Dashboard giornata di…?"  →  Sì
4. Spotify ti rimanda a /api/spotify/callback?code=XYZ&state=...
5. Il server dà a Spotify: code + client_id + client_secret
6. Spotify risponde: access_token (dura 1 ora) + refresh_token
7. Il server salva tutto in data/spotify.json
```

### Le tre parole chiave
- **scope**, cioè i permessi chiesti. Ne chiediamo solo tre: vedere cosa suona, comandarlo, vedere gli ultimi
  ascolti. Niente playlist né dati personali: chiedere il minimo indispensabile è una regola di sicurezza.
- **state**, la protezione contro la **CSRF**. Il server inventa un numero a caso, lo mette nel link e controlla
  che torni identico. Senza questo controllo, qualcuno potrebbe mandarti un link "di ritorno" preparato da lui e
  collegare alla tua dashboard **il suo** account Spotify. Il numero vale una volta sola.
- **access_token e refresh_token.**
  - L'**access token** è il "biglietto" per chiamare l'API, e scade dopo un'ora.
  - Il **refresh token** serve a chiedere biglietti nuovi senza rifare il login. Per questo è un segreto:
    `spotify.json` ha i permessi `600` (solo il tuo utente lo legge).

```python
if force or time.time() > t["expires_at"] - 60:   # scade tra meno di un minuto?
    new = _spotify_auth({"grant_type": "refresh_token", ...})   # ne chiede uno nuovo
```
Se Spotify rifiuta il refresh token (ad esempio perché hai tolto l'accesso dal sito di Spotify), il server
cancella il file e la scheda torna a "Collega Spotify".

### Le chiamate all'API
| Chiamata | A cosa serve |
|---|---|
| `GET /me/player` | Cosa suona, su che dispositivo, a che punto |
| `GET /me/player/recently-played?limit=1` | L'ultimo brano, quando non suona niente |
| `PUT /me/player/play` / `pause` | Play e pausa |
| `POST /me/player/next` / `previous` | Avanti e indietro |

I codici di risposta da conoscere:
- **204** vuol dire "niente in riproduzione": la risposta è vuota.
- **401** vuol dire "token scaduto": il server lo rinnova e riprova una volta.
- **404** sui comandi vuol dire "nessun dispositivo attivo": la pagina ti dice di aprire Spotify.

### La cache di 4 secondi
iPhone e iPad chiedono ogni 10 secondi, quindi senza cache Spotify riceverebbe una richiesta ogni 5 secondi.
Il server ricorda l'ultima risposta per 4 secondi e la riusa. L'ultimo ascolto lo chiede al massimo una volta
al minuto. Così stiamo lontani dai **limiti di frequenza** di Spotify, che altrimenti risponderebbe 429,
"troppe richieste".

### La barra che avanza da sola
La pagina non chiede la posizione del brano ogni secondo. Prende l'ultima risposta ("sei a 1:23") e l'ora in
cui è arrivata, poi calcola:
```js
posizione = progress + (adesso − momento della risposta)     // solo se sta suonando
```
Ogni secondo aggiorna solo il tempo e la barra, senza ridisegnare il resto. Ogni 10 secondi riceve il dato vero
e si riallinea.

### Aggiornamento "ottimista"
Quando tocchi pausa, l'icona cambia **subito**, prima che Spotify risponda. Dopo 0,7 secondi la pagina chiede lo
stato vero. Così l'interfaccia sembra istantanea anche se la rete è lenta.

---

## 2. Accessibilità: cosa vuol dire in pratica

Accessibile significa che la dashboard funziona anche per chi usa **VoiceOver** (lo screen reader dell'iPhone),
la **tastiera** o "Riduci movimento", o per chi vede poco.

| Problema | Soluzione | Come si scrive |
|---|---|---|
| VoiceOver non sa leggere un'icona ▶ | Un nome nascosto | `aria-label="Riproduci"` |
| Pulsanti troppo piccoli per il dito | Almeno 44×44 px (consiglio Apple) | `size-11`, play `size-14` |
| Non vedi dove sei con la tastiera | Contorno verde solo con la tastiera | `focus-visible:outline-2` |
| Dopo "pausa" il pulsante viene ridisegnato e il focus salta in cima alla pagina | Il codice ricorda quale pulsante aveva il focus e glielo ridà | `card.querySelector(...).focus()` |
| Chi non vede non sa che il brano è cambiato | Un testo invisibile che VoiceOver legge quando cambia | `aria-live="polite"` + `sr-only` |
| La barra di avanzamento è solo un disegno | Dire che è una barra e a che punto è | `role="progressbar"` + `aria-valuetext="1:23 di 3:34"` |
| Le animazioni danno fastidio ad alcuni | Si fermano se è attivo "Riduci movimento" | `motion-reduce:*:animate-none` |
| Testo poco leggibile | Contrasto almeno 4,5:1 (WCAG AA) | Bianco e `#b3b3b3` su `#121212` |

Due dettagli:
- **`polite`** vuol dire che VoiceOver aspetta di finire la frase che sta leggendo prima di annunciare. Il testo
  cambia solo quando cambia brano o stato, non ogni 10 secondi, altrimenti VoiceOver parlerebbe in continuazione.
- **`sr-only`** nasconde un elemento alla vista ma lo lascia agli screen reader ("sr" = screen reader).

---

## 3. "Fatto" e "Tra 10 minuti"

### Il limite di iOS
Le notifiche web su iPhone **non mostrano pulsanti**: solo titolo, testo e icona. Per questo ci sono due strade,
scelte dal service worker:

```
Notifica di un promemoria
├── Computer (Chrome, Edge, Firefox): pulsanti nella notifica
│     └── sw.js chiama direttamente /done o /snooze, senza aprire nulla
└── iPhone / iPad: tocchi la notifica
      └── si apre la dashboard su #/promemoria/<id>  →  foglio con i due pulsanti
```

### Il percorso dell'id
Per spuntare un promemoria serve sapere **quale**. Quindi l'id viaggia con la notifica:
```
server.py:  push_send(..., data={"rid": "a1b2c3..."})
   ↓ (cifrato, attraverso Apple)
sw.js:      showNotification(..., { data: { rid } })
   ↓ (tocchi)
sw.js:      notificationclick → e.notification.data.rid
```

### Due casi quando tocchi la notifica
- **La dashboard è chiusa**: `clients.openWindow("./#/promemoria/<id>")` la apre a quell'indirizzo, e `route()`
  legge l'id dalla parte dopo `#`.
- **La dashboard è già aperta**: aprirne un'altra sarebbe brutto. Il service worker le manda un messaggio con
  `postMessage({ reminder: id })`, e la pagina, che lo sta ascoltando, apre il foglio.

### Il foglio è un `<dialog>`
`<dialog>` è un elemento HTML nato per le finestre in primo piano. Con `showModal()` il browser fa gratis tre
cose che a mano sarebbero difficili:
- **intrappola il focus**: con Tab non finisci nella pagina sotto;
- chiude con **Esc**;
- dice a VoiceOver che è una finestra.

Altri dettagli:
- lo sfondo scuro si colora con `backdrop:bg-black/45`;
- sul telefono sale dal basso (`mt-auto`), sul computer sta al centro (`md:my-auto`);
- `history.replaceState(null, "", "#/")` toglie l'id dall'indirizzo, così ricaricando la pagina il foglio non
  si riapre;
- il foglio aspetta i **dati veri** prima di aprirsi: nella copia salvata quel promemoria potrebbe essere già
  stato fatto.

### "Tra 10 minuti"
Il promemoria in Apple **non si può spostare** da fuori. Quindi si sposta solo **l'avviso**:
```json
// data/push.json
"snooze": { "a1b2c3...": { "at": "2026-11-04T15:42:00+01:00", "title": "Chiamare" } }
```
Il thread delle notifiche, che già gira ogni 30 secondi, ora controlla anche questa lista. Quando arriva l'ora,
se il promemoria non è stato spuntato, rimanda la notifica. La sua chiave nuova `snz|id|ora` è diversa da quella
originale, quindi non viene scambiata per un doppione.

---

## 4. Apertura immediata, anche senza rete

### Il service worker come "intermediario"
Prima `sw.js` serviva solo alle notifiche. Ora ascolta anche l'evento **`fetch`**: **ogni richiesta della
pagina passa da lui**, e lui decide se rispondere con la copia salvata, con la rete o con tutte e due.

```
Pagina ──richiesta──► sw.js ──► Cache (copia sul telefono)
                         └────► Rete (homelab)
```

### Il ciclo di vita
| Evento | Cosa fa |
|---|---|
| `install` | Scarica e salva i file base (pagina, CSS, JS, icone) |
| `activate` | Cancella le copie vecchie e prende il controllo delle pagine aperte |
| `fetch` | Decide da dove rispondere a ogni richiesta |

- `skipWaiting()` e `clients.claim()` servono a far partire subito la versione nuova, invece di aspettare che
  chiudi tutte le schede.
- `CACHE = "giornata-v1"` è il nome della copia. Si cambia (v2, v3…) solo se cambi il funzionamento del service
  worker: così la copia vecchia viene buttata.

### Tre strategie diverse
1. **Pagina, stile, script, font: stale-while-revalidate** ("vecchio ma intanto aggiorna").
   - Risponde **subito** con la copia salvata e intanto scarica la versione nuova e la salva.
   - Pro: apertura istantanea.
   - Contro: dopo un deploy, la novità la vedi dalla **seconda** apertura.
2. **Dati (`/api/dashboard`): sempre dalla rete, salvando ogni risposta buona.** Il service worker non risponde
   mai con la copia. Così la pagina sa sempre se i dati sono freschi o vecchi, ed è lei a decidere.
3. **Spotify, notifiche, spunte: nessuna copia.** Una spunta "finta" o un brano vecchio sarebbero sbagliati.

### La pagina in due tempi
```js
// 1. subito: l'ultima copia dei dati, se c'è
const saved = await caches.match("api/dashboard");
if (saved) { data = await saved.json(); stale = true; render(); hideSplash(0); }

// 2. poi: i dati veri, con un limite di 8 secondi
const r = await fetch("api/dashboard", { signal: AbortSignal.timeout(8000) });
data = await r.json(); stale = false; render();
```
- `stale` ("stantio") vale `true` finché i dati sono la copia. Se resta così, compare la scritta grigia
  "Homelab non risponde: dati aggiornati alle…", calcolata da `data.now`, l'ora in cui il server aveva prodotto
  quei dati.
- **`AbortSignal.timeout(8000)`** serve perché, se homelab è spento ma Tailscale è acceso, la richiesta può
  restare appesa per decine di secondi: dopo 8 si lascia perdere.
- **`hideSplash(0)`**: se c'è una copia, la schermata di caricamento sparisce subito invece di aspettare i 600 ms.

### Il test
Il browser dentro l'app di Claude non permette i service worker. Ho quindi avviato Google Chrome in modalità
**headless** (senza finestra) e l'ho comandato con un piccolo script Node attraverso il **Chrome DevTools
Protocol**, lo stesso canale che usano gli strumenti per sviluppatori:
1. pagina aperta online: copia salvata (10 file);
2. **server spento**: pagina pronta in **161 ms**, con i dati e la scritta grigia;
3. `#/promemoria/<id>`: il foglio si apre con il promemoria giusto e "Tra 10 minuti" risponde.

---

## I file toccati, in breve
| File | Cosa c'è di nuovo |
|---|---|
| `server.py` | Sezione Spotify (OAuth, token, API, cache), rotta `/snooze`, `data.rid` nelle notifiche, lista `snooze` |
| `static/sw.js` | Copia offline (install, activate, fetch) e pulsanti/tocco delle notifiche |
| `static/js/script.js` | Scheda Spotify accessibile, apertura in due tempi, scritta offline, foglio del promemoria |
| `static/index.html` | Scheda Spotify sopra i Promemoria, `<dialog id="sheet">` |
| `src/style.css` | Colori Spotify, animazione dell'equalizzatore |
| `data/spotify.json` | Accesso al tuo Spotify (solo su homelab, mai su GitHub) |
