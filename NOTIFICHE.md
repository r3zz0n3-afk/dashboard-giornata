# Come funzionano le notifiche della dashboard

Report dalla teoria al codice. Tutto è nel commit `df098a7`.

## 1. L'idea di base: chi parla con chi

Ci sono quattro protagonisti:

```
 ┌───────────┐  1. iscrizione  ┌──────────────┐
 │  iPhone   │ ──────────────► │ server.py    │
 │ (pagina + │                 │ (homelab)    │
 │  sw.js)   │                 └──────┬───────┘
 └─────▲─────┘                        │ 2. messaggio cifrato e firmato
       │ 3. consegna                  ▼
       │                       ┌──────────────┐
       └────────────────────── │ Apple Push   │
                               │ (web.push.   │
                               │  apple.com)  │
                               └──────────────┘
```

Il server **non può scrivere direttamente all'iPhone**: il telefono non ha un indirizzo raggiungibile e spesso è in standby. Scrive invece al **servizio push di Apple**, che resta sempre collegato al telefono e gli consegna il messaggio.

Si chiama **Web Push** ed è uno standard: la stessa cosa funziona con Chrome su Android (passa da Google) o con Firefox (passa da Mozilla).

## 2. Le condizioni di iOS

Apple permette le notifiche web solo se:
1. la pagina è in **HTTPS**, cioè con il lucchetto;
2. la pagina è **aggiunta alla schermata Home** e aperta da lì: in Safari "normale" non funzionano;
3. l'iPhone ha iOS 16.4 o successivo.

Per questo serve `tailscale serve` sulla porta 8443. Tailscale ottiene un certificato vero per `homelab.tail1e15f8.ts.net`, e iOS lo considera sicuro.

- **Cosa ho evitato:** su homelab c'era già un **Funnel** sulla porta 443, che è pubblico su internet. Ho scelto `serve` su una porta diversa, così la dashboard resta visibile solo ai tuoi dispositivi.

## 3. Le chiavi VAPID: la "firma" del server

**Problema:** se qualcuno scoprisse l'indirizzo del tuo iPhone presso Apple, potrebbe mandarti notifiche finte?
**Soluzione:** le chiavi **VAPID**, una coppia di chiavi crittografiche.

- **Chiave privata**: la conosce solo il server, che la usa per **firmare** ogni notifica. Sta in `data/vapid.pem`, con permessi `600` (solo il tuo utente può leggerla). La cartella `data/` è nel `.gitignore`, quindi non finisce mai su GitHub.
- **Chiave pubblica**: la riceve l'iPhone al momento dell'iscrizione. Da lì Apple accetta notifiche per quell'iscrizione **solo se firmate** con la privata corrispondente.

Il server la crea da solo al primo avvio:

```python
def vapid_public_key():
    with _plock:
        if not VAPID_FILE.exists():
            v = Vapid01()
            v.generate_keys()                # crea la coppia di chiavi
            v.save_key(str(VAPID_FILE))
            VAPID_FILE.chmod(0o600)          # segreto: solo il tuo utente
        v = Vapid01.from_file(str(VAPID_FILE))
    raw = v.public_key.public_bytes(...)     # la pubblica, nel formato che vuole il browser
    return b64urlencode(raw)
```

`_plock` è un **lucchetto** (lock). Se due richieste arrivassero insieme, senza lucchetto potrebbero creare due chiavi diverse. Con il lucchetto una aspetta l'altra.

## 4. L'iscrizione: cosa succede quando tocchi "Attiva notifiche"

In [script.js](static/js/script.js), passo per passo:

```js
// a) registra il service worker (vedi punto 6)
navigator.serviceWorker.register("sw.js")

// b) chiede il permesso: compare il popup di iOS "Consenti notifiche?"
await Notification.requestPermission()

// c) prende dal server la chiave pubblica
const { key } = await (await fetch("api/push/key")).json();

// d) si iscrive al servizio push di Apple
const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });

// e) manda l'iscrizione al server e chiede una notifica di prova
await postJSON("api/push/subscribe", sub.toJSON());
await postJSON("api/push/test", { endpoint: sub.endpoint });
```

**Cosa contiene l'iscrizione (`sub`):**

```json
{ "endpoint": "https://web.push.apple.com/QF3k...lungo...",
  "keys": { "p256dh": "BNc...", "auth": "tBH..." } }
```

- `endpoint` è l'indirizzo della "cassetta postale" del tuo iPhone presso Apple.
- `p256dh` e `auth` servono a **cifrare** il messaggio. Apple lo trasporta ma **non può leggerlo**: solo il tuo iPhone può decifrarlo.

**Dettagli:**
- `userVisibleOnly: true`: prometti che ogni messaggio mostrerà una notifica visibile. Niente messaggi "silenziosi" per spiare; iOS lo esige.
- `keyBytes()`: la chiave arriva come testo (base64), mentre il browser la vuole come sequenza di byte. È solo una conversione.
- Il permesso viene chiesto **per primo**, subito dopo il tocco. iOS mostra il popup solo se è una conseguenza diretta di un tuo gesto: se prima la pagina aspettasse il server, iOS potrebbe rifiutare.

**Il pulsante ha quattro stati**, decisi da `renderPush()`:

| Situazione | Cosa vedi |
|---|---|
| Niente https o non aggiunta alla Home | Un testo che spiega cosa fare |
| Permesso negato in passato | "Notifiche bloccate: riattivale nelle Impostazioni" |
| Non iscritto | **Attiva notifiche** |
| Iscritto | **Prova notifica** e **Disattiva notifiche** |

Ogni volta che apri la pagina da iscritto, questa rimanda l'iscrizione al server. Così, se il server la perdesse, si sistema da sola.

## 5. Il server: le nuove rotte

In [server.py](server.py):

| Rotta | Cosa fa |
|---|---|
| `GET /api/push/key` | Dà la chiave pubblica VAPID |
| `POST /api/push/subscribe` | Salva l'iscrizione in `data/push.json` |
| `POST /api/push/unsubscribe` | La toglie |
| `POST /api/push/test` | Manda la notifica di prova **solo** a chi la chiede |

**Un controllo di sicurezza importante: l'SSRF.** Il server farà richieste HTTP all'`endpoint` che gli manda la pagina. Se accettasse qualsiasi indirizzo, chiunque potrebbe dirgli "manda una richiesta a `http://192.168.1.1/...`" e usarlo per colpire la tua rete di casa. Questo attacco si chiama **SSRF** (Server-Side Request Forgery). Per questo il server accetta solo i veri servizi push:

```python
PUSH_HOSTS = ("push.apple.com", "fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com")

def _push_host_ok(endpoint):
    m = re.match(r"https://([^/:]+)/", endpoint)     # estrae il nome del server dall'indirizzo
    return bool(m) and any(m[1] == h or m[1].endswith("." + h) for h in PUSH_HOSTS)
```

Provato con tre indirizzi:
- `https://web.push.apple.com/...`: accettato;
- `https://evil.com/push.apple.com/`: rifiutato, perché il server vero è evil.com;
- `https://push.apple.com.evil.com/`: rifiutato, è un trucco classico.

Accetta al massimo **20 dispositivi**, così nessuno può riempire il file all'infinito.

## 6. Il service worker: `static/sw.js`

Un **service worker** è uno script che il browser tiene "in panchina" anche a pagina chiusa e che sveglia quando succede qualcosa. Il nostro ascolta due eventi:

```js
// arriva un messaggio dal servizio push → mostra la notifica
self.addEventListener("push", e => {
  const m = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(m.title, { body: m.body, icon: "img/icon-192.png" }));
});

// tocchi la notifica → apre la dashboard (o la porta in primo piano)
self.addEventListener("notificationclick", e => { ... });
```

- `waitUntil`: dice al browser di non rimettere il service worker in panchina finché la notifica non è mostrata.
- Il file sta in `/sw.js`, alla radice del sito, perché un service worker controlla solo la sua cartella e quelle sotto.

## 7. Mandare una notifica: `push_send()`

```python
webpush(s, msg, vapid_private_key=str(VAPID_FILE), vapid_claims={"sub": PUSH_CONTACT}, ttl=3600, timeout=10)
```

La libreria **pywebpush**, nuova in [requirements.txt](requirements.txt), fa tre cose:
1. **cifra** il messaggio con le chiavi `p256dh` e `auth` di quel telefono;
2. lo **firma** con la chiave privata VAPID;
3. lo manda all'`endpoint` di Apple.

**Parametri:**
- `ttl=3600`: se il telefono è spento o senza rete, Apple tiene la notifica per un'ora, poi la butta. Non ha senso ricevere alle 15 "Lezione tra 10 minuti" delle 9.
- `sub`: un contatto per Apple, in caso di problemi. È un indirizzo GitHub "noreply", non la tua email; si cambia con `PUSH_CONTACT` nel `.env`.
- `timeout=10`: se Apple non risponde entro 10 secondi, lascia perdere invece di bloccarsi.

**Pulizia automatica:** se Apple risponde **404 o 410**, quell'iscrizione non esiste più (hai disattivato le notifiche o cancellato l'icona) e il server la toglie da `push.json`.

## 8. Il controllo continuo: il thread `notifier()`

```python
threading.Thread(target=notifier, daemon=True).start()
```

Un **thread** è un lavoro che gira **in parallelo** al server web: il sito continua a rispondere mentre il thread fa il suo giro. `daemon=True` vuol dire che si ferma insieme al server.

Ogni **30 secondi** il thread fa questo:
1. Se nessun dispositivo è iscritto, non fa nulla (non disturba nemmeno iCloud).
2. Chiama `due_notifications(adesso)`, che restituisce le notifiche da mandare in questo momento.
3. Per ognuna controlla se la sua **chiave** è già in `sent`. Se c'è, la salta; altrimenti la segna e la manda.

**Perché le chiavi.** Il thread controlla ogni 30 secondi, ma "Lezione tra 15 minuti" deve arrivare **una volta sola**. Ogni notifica ha quindi una chiave unica:

| Notifica | Chiave |
|---|---|
| Evento | `ev\|2026-11-03T09:00+01:00\|Lezione di Analisi` |
| Promemoria | `rem\|a1b2c3...\|2026-11-03T17:30+01:00` |
| Esame | `exam\|2026-11-03\|inizio esame\|titolo` (il giorno di oggi: domani è una notifica diversa) |
| Riepilogo | `morning\|2026-11-03` |

Le chiavi sono salvate su file (`data/push.json` → `sent`), quindi **sopravvivono a un riavvio**: un deploy alle 8:50 non ti rimanda il riepilogo. Le chiavi più vecchie di 2 giorni vengono cancellate, così il file non cresce all'infinito.

**Una scelta da sapere:** la notifica viene segnata **prima** di mandarla. Se Apple è giù in quel momento, quella notifica si perde. L'alternativa sarebbe riprovare ogni 30 secondi, rischiando raffiche di doppioni: meglio perderne una.

Tutto il giro è dentro un `try/except`. Se iCloud non risponde, l'errore finisce nei log (`journalctl --user -u dashboard-giornata`) e il thread riprova al giro dopo, invece di morire per sempre.

## 9. Le quattro regole, in `due_notifications()`

| Notifica | Regola | Esempio |
|---|---|---|
| **Evento tra poco** | Eventi di oggi con orario (non quelli di tutto il giorno) che iniziano tra 0 e 15 minuti | **Lezione di Analisi**: Tra 10 minuti · 09:00–11:00 · Aula 3 |
| **Promemoria** | Promemoria con **orario**, scaduti da 0 a 10 minuti (il margine copre un riavvio del server) | **Promemoria**: Chiamare il dentista |
| **Esame vicino** | Dalle 8 alle 12, esami a 7, 3 o 1 giorno | **Esame tra 3 giorni**: Analisi 1 · venerdì 6 alle 09:00 |
| **Riepilogo** | Dalle 7:30 alle 11 | **Buongiorno, martedì 3**: 4 eventi, il primo alle 09:00: Lezione di Analisi · Rovesci, 8°–17° · 1 cosa da fare |

Le **finestre**, come "dalle 7:30 alle 11", servono se il server era spento alle 7:30: ripartendo alle 9, il riepilogo arriva lo stesso. Dopo le 11 non avrebbe più senso.

I dati vengono dalle funzioni che esistevano già: `get_events`, `get_exams`, `get_weather`, `all_reminders`. Usano la stessa **cache** della pagina, quindi controllare ogni 30 secondi non significa chiedere a iCloud ogni 30 secondi.

## 10. Come è stato provato

1. **Chiavi**: generate in locale; controllato il formato (87 caratteri) e i permessi `-rw-------`.
2. **Filtro SSRF**: i tre indirizzi del punto 5.
3. **Regole**:
   - con i dati demo alle 8:50 sono partiti l'evento delle 9:00 e il riepilogo;
   - con dati inventati alle 8:05 sono partiti il promemoria delle 8:03, un esame a 3 giorni e uno domani.
4. **Pagina**: server di prova in locale; il pulsante compare in fondo e mostra lo stato giusto.
5. **Homelab**: deploy fatto; la libreria si è installata da sola perché `requirements.txt` era cambiato, e la chiave è stata creata.

**Ancora da provare:** la consegna vera di una notifica all'iPhone. Serve l'HTTPS, cioè il comando `tailscale serve` da Termius.

## 11. File toccati

| File | Cosa è cambiato |
|---|---|
| `server.py` | Sezione "notifiche", 4 rotte, il thread all'avvio |
| `static/sw.js` | **Nuovo**: il service worker |
| `static/js/script.js` | Il pulsante e l'iscrizione |
| `static/index.html` | Il posto per il pulsante, in fondo alla pagina |
| `requirements.txt` | + `pywebpush` |
| `README.md` | Sezione "Notifiche sull'iPhone" e tabella dei file |
| `data/vapid.pem`, `data/push.json` | Creati sul server, mai su GitHub |

## 12. Limiti

- **Promemoria senza orario** (solo la data) non mandano una notifica dedicata: li conta il riepilogo del mattino.
- Gli **eventi di tutto il giorno** non hanno l'avviso "tra 15 minuti", perché non hanno un orario.
- Se ti iscrivi tra le 7:30 e le 11, il riepilogo di oggi arriva subito dopo la prova. Dal giorno dopo è normale.
- Chiunque sia nella tua rete Tailscale può iscriversi: oggi ci sei solo tu.
- Se cancelli `data/vapid.pem`, il server crea chiavi nuove e i telefoni vanno iscritti di nuovo.
- `http://homelab:8080` continua a funzionare per guardare la dashboard, ma le notifiche funzionano solo dall'indirizzo https.
