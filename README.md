# Dashboard giornata

Una pagina web con due schermate, che si scelgono dalla barra in basso sul telefono o in alto sul computer.

**Home**, la dashboard della giornata:
- **Adesso / Prossimo**: cosa stai facendo e cosa viene dopo, con il tempo che manca, sulla barra delle ore di oggi.
- **Esami**: il conto alla rovescia ai prossimi esami, presi da un calendario apposta.
- **Oggi**: gli eventi del calendario Apple (iCloud), con quelli passati sbiaditi.
- **Promemoria**: quelli scaduti, quelli di oggi, i prossimi e quelli senza data. Si spuntano toccando il cerchietto e se ne aggiungono di nuovi con "+ Nuovo promemoria".

**Calendario**, la settimana un giorno alla volta:
- Ogni giorno ha la barra dalle 00 alle 24 e la lista degli impegni.
- **La settimana** riassume tutti i giorni, con il numero di impegni e il meteo.
- Per cambiare giorno tocca le linguette o le righe della settimana, scorri col dito o usa le frecce ← → della tastiera.

Si aggiorna da sola ogni 5 minuti e ha il tema chiaro o scuro automatico.

```
iPhone (Promemoria) ──Comando Rapido──▶  server sul PC  ◀──CalDAV── iCloud (Calendario)
                                              │
                                    http://IP-DEL-PC:8080  (browser, telefono, tablet)
```

---

## 1. Installazione sul PC (CachyOS / qualsiasi Linux)

```bash
cd ~/dashboard-giornata
chmod +x install.sh
./install.sh
```

Lo script fa quattro cose:
- crea l'ambiente Python;
- crea il file `.env`, con un token segreto già generato;
- installa il servizio `dashboard-giornata`, che **parte da solo all'accensione** e si riavvia se si blocca;
- alla fine ti stampa l'indirizzo da aprire.

**Vuoi vederla subito con dati finti?** Metti `DEMO=1` nel file `.env`, poi esegui `systemctl --user restart dashboard-giornata`.

### Comandi utili
```bash
systemctl --user status dashboard-giornata     # è attivo?
systemctl --user restart dashboard-giornata    # dopo aver cambiato .env
journalctl --user -u dashboard-giornata -f     # log in tempo reale
```

> **Portatile come server:** perché resti raggiungibile non deve andare in sospensione. In KDE vai su
> *Impostazioni di sistema → Gestione energetica* e imposta "Sospendi sessione: Mai" quando è collegato alla corrente.
> Se lo usi a coperchio chiuso, imposta anche "Quando il coperchio viene chiuso: Non fare nulla".

---

## 2. Collegare il Calendario Apple

1. Vai su **appleid.apple.com**, poi in **Accesso e sicurezza**, poi in **Password specifiche per le app**. Creane una, chiamandola ad esempio "Dashboard".
2. Apri il file `.env` e inserisci:
   ```
   APPLE_ID=la-tua-email@icloud.com
   APPLE_APP_PASSWORD=abcd-efgh-ijkl-mnop
   ```
3. Facoltativo: per vedere solo alcuni calendari, elencali così: `CALENDARS=Università,Personale`.
4. Esegui `systemctl --user restart dashboard-giornata`.

Se qualcosa non va, l'errore compare in rosso in cima alla dashboard.

---

## Meteo

Il meteo arriva da [Open-Meteo](https://open-meteo.com), che è gratuito e non richiede registrazione.
Nel file `.env` scrivi la tua città:
```
WEATHER_CITY=Bologna
```
poi esegui `systemctl --user restart dashboard-giornata`. Se lasci il campo vuoto, il meteo non viene mostrato.

La dashboard mostra la temperatura e il cielo sotto l'orologio e avvisa nel riepilogo se è probabile che piova.
Per ogni giorno della settimana mostra le previsioni accanto al titolo del giorno.

---

## Esami

Crea su iCloud un calendario solo per gli esami (ad esempio "Esami uni") e aggiungi lì ogni esame, come un evento normale.
Nel file `.env` scrivi il nome del calendario:
```
EXAMS=Esami uni
```
poi esegui `systemctl --user restart dashboard-giornata`. Se hai più calendari di esami, separali con la virgola.

La Home mostra una scheda per esame, con i giorni che mancano: in rosso quando manca meno di una settimana.
Se il titolo inizia con "Esame" o "Esame di", la scheda lo toglie (nella scheda Esami sarebbe ripetuto).
Gli esami vengono cercati nei prossimi 180 giorni e richiesti a iCloud ogni mezz'ora; il pulsante Aggiorna li richiede subito.
Per guardare più avanti: `EXAM_DAYS=365`.

---

## 3. Collegare i Promemoria (Comando Rapido su iPhone)

Apple non permette di leggere i Promemoria da fuori. Per questo è l'iPhone a **inviarli** al PC.
Ti serve il token che trovi nel file `.env` alla riga `REMINDERS_TOKEN=`.

### Crea il comando
Apri l'app **Comandi Rapidi**, tocca **+** e chiamalo "Invia promemoria". Poi aggiungi in ordine queste azioni:

1. **Trova promemoria**
   - Tocca *Aggiungi filtro* e scegli **Completato** → **è disattivato**.
   - *Ordina per*: Data di scadenza. Togli il limite.
2. **Ripeti con ogni elemento** (prendilo da *Scripting*). Dentro il ciclo metti:
   1. **Formatta data**
      - Data: tocca e scegli *Elemento ripetuto* → **Data di scadenza**.
      - Formato data: **ISO 8601**, con "Includi ora" attivo.
   2. **Testo**. Scrivi queste tre variabili separate dalla barra verticale `|`:
      `[Elemento ripetuto → Titolo]|[Data formattata]|[Elemento ripetuto → Elenco]`
3. Dopo *Fine ripetizione*, aggiungi **Combina testo**: Risultati ripetizione, separatore **Nuova riga**.
4. **Ottieni contenuto dell'URL**
   - URL: `http://IP-DEL-PC:8080/api/reminders`
   - Tocca *Mostra di più* e imposta:
     - Metodo **POST**.
     - *Intestazioni*: chiave `Authorization`, valore `Bearer IL-TUO-TOKEN`.
     - *Corpo della richiesta*: **JSON**, con un campo di testo chiamato `text` e valore **Testo combinato**.

Premi ▶︎ per provarlo. Se funziona vedi una risposta tipo `{"ok": true, "ricevuti": 7}` e i promemoria compaiono nella dashboard.

### Spuntare e aggiungere dalla dashboard (e portarli sull'iPhone)
Nella dashboard puoi spuntare i promemoria e aggiungerne di nuovi. Apple però non permette di scrivere nei Promemoria
da fuori: è lo stesso Comando Rapido a portare le modifiche sull'iPhone, **la prossima volta che parte**.
Il server gli prepara la lista di cosa fare all'indirizzo `/api/reminders/sync`:
```json
{"done": [{"title": "Studiare reti", "list": "Università"}],
 "new":  [{"title": "Comprare il pane", "due": "2026-11-04 17:30"}]}
```
- `done`: promemoria spuntati nella dashboard, da segnare come **completati** (restano nella sezione Completati, si possono recuperare);
- `new`: promemoria aggiunti nella dashboard, da **creare** in Apple. Al successivo invio dell'iPhone la dashboard toglie la sua copia:
  da lì in poi vale la lista di Apple, quindi se lo cancelli o lo completi sull'iPhone sparisce anche dalla dashboard.

Crea un secondo comando, ad esempio **"Ricevo promemoria aggiornati"**, con queste azioni.
(Puoi anche metterle all'inizio di "Invia promemoria", prima di *Trova promemoria*: fanno la stessa cosa.)

1. **Ottieni contenuto dell'URL**
   - URL: `http://IP-DEL-PC:8080/api/reminders/sync`
   - *Mostra di più*: metodo **GET**, intestazione `Authorization` con valore `Bearer IL-TUO-TOKEN` (come per l'invio).
2. **Ottieni valore del dizionario**: chiave `done`, dal *Contenuto dell'URL*.
3. **Ripeti con ogni elemento** (sul valore appena ottenuto). Dentro il ciclo:
   1. **Ottieni valore del dizionario**: chiave `title`, da *Elemento ripetuto*.
   2. **Trova promemoria**, con due filtri: *Titolo* **è** il valore appena ottenuto, e *Completato* **è disattivato**.
   3. L'azione che modifica un promemoria (cerca "Completato" tra le azioni dei Promemoria):
      imposta **Completato** su attivo per i *Promemoria* trovati.
4. Dopo *Fine ripetizione*: **Ottieni valore del dizionario**, chiave `new`, sempre dal *Contenuto dell'URL*
   (tocca il campo e scegli la variabile *Contenuto dell'URL*, non il risultato precedente).
5. **Ripeti con ogni elemento**. Dentro il ciclo:
   1. **Ottieni valore del dizionario**: chiave `title`, da *Elemento ripetuto*.
   2. **Ottieni valore del dizionario**: chiave `due`, da *Elemento ripetuto*.
   3. **Ottieni date dall'input**, con il valore `due`. Se il promemoria non ha data, resta vuoto.
   4. **Aggiungi nuovo promemoria**: titolo il valore `title`; in *Mostra di più* attiva l'avviso **In una data** e scegli le *Date*.

Per farlo partire da solo: **Automazione → + → App → Promemoria → "Viene aperta"**, *Esegui immediatamente*,
azione "Esegui comando → Ricevo promemoria aggiornati". Insieme all'automazione "Viene chiusa" di "Invia promemoria"
il giro si chiude: aprendo Promemoria arrivano le modifiche della dashboard, chiudendolo la dashboard riceve la lista aggiornata.

Un promemoria nuovo, una volta consegnato, non viene rimandato per 10 minuti, anche se il comando parte più volte: niente doppioni.
Se dopo 10 minuti l'iPhone non ha ancora mandato la lista (ad esempio perché il comando si è fermato a metà), viene consegnato di nuovo.
Le spunte invece vengono rimandate finché l'iPhone non manda la lista aggiornata, ma non fa danni:
il filtro *Completato è disattivato* trova solo quelli ancora aperti.

> Se due promemoria aperti hanno lo **stesso titolo**, spuntarne uno nella dashboard li chiude **tutti e due** su Apple:
> il Comando Rapido li cerca per nome.

### Rendilo automatico
Nell'app Comandi Rapidi vai su **Automazione**, poi tocca **+**. Due idee, anche insieme:
- **App → Promemoria → "Viene chiusa"**: ogni volta che esci da Promemoria, la dashboard si aggiorna.
- **Ora del giorno**: ad esempio alle 7:30, alle 13:00 e alle 19:00 (crea un'automazione per ogni orario).

Per ognuna scegli **Esegui immediatamente** e l'azione "Esegui comando → Invia promemoria".

---

## 4. Vederla anche fuori casa

Così com'è, la dashboard funziona solo quando telefono e PC sono sulla **stessa rete Wi-Fi**.
Per raggiungerla ovunque, e far arrivare i promemoria anche fuori casa, la via più semplice e sicura è **Tailscale** (gratuito):

```bash
sudo pacman -S tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up
```

Poi installa l'app Tailscale sull'iPhone con lo stesso account. Il PC riceve un indirizzo `100.x.y.z` che funziona ovunque:
usalo sia nel browser sia nell'URL del Comando Rapido.
Non serve aprire porte sul router e la dashboard **resta privata**: la vedi solo dai tuoi dispositivi.

### Notifiche sull'iPhone
La dashboard può mandarti notifiche anche a pagina chiusa:
- **evento tra poco**: 15 minuti prima di ogni evento (cambia con `NOTIFY_BEFORE=10` nel `.env`);
- **promemoria**: all'ora del promemoria, se ha un orario;
- **esame vicino**: alle 8, quando mancano 7, 3 o 1 giorno;
- **riepilogo del mattino**: alle 7:30, con eventi, meteo e cose da fare.

Su iPhone le notifiche web funzionano solo se la pagina è in **https** e la dashboard è **aggiunta alla schermata Home**.
Tailscale dà un certificato https vero al server; sul server, una volta sola:

```bash
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8080
```

La dashboard risponde allora anche su `https://NOME.TAILNET.ts.net:8443` (il nome completo lo dà `tailscale status --self`),
sempre e solo per i tuoi dispositivi: `serve` non la pubblica su internet (quello sarebbe `funnel`).
Sull'iPhone apri quell'indirizzo in Safari, **Condividi → Aggiungi alla schermata Home**, apri la dashboard dall'icona
e tocca **Attiva notifiche** in fondo alla pagina. Arriva subito una notifica di prova.

Il server firma le notifiche con una chiave che crea da solo in `data/vapid.pem`: se la cancelli, i telefoni vanno iscritti di nuovo.

### Spotify
Un mini player nella Home, sopra i Promemoria, in stile Spotify: cosa stai ascoltando e su quale dispositivo,
con play/pausa/avanti/indietro. Quando non suona niente mostra l'ultimo brano ascoltato.
Funziona anche con VoiceOver e con la tastiera. I comandi funzionano solo con **Spotify Premium**,
e Spotify chiede Premium anche al proprietario dell'app sviluppatore.

1. Vai su [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), accedi e **Create app**.
2. Nome e descrizione a piacere. In **Redirect URIs** scrivi l'indirizzo https della dashboard seguito da
   `/api/spotify/callback`, ad esempio `https://NOME.TAILNET.ts.net:8443/api/spotify/callback`. In **APIs used** spunta **Web API**.
3. Nelle impostazioni dell'app copia **Client ID** e **Client secret** nel file `.env`:

   ```
   SPOTIFY_CLIENT_ID=...
   SPOTIFY_CLIENT_SECRET=...
   SPOTIFY_REDIRECT=https://NOME.TAILNET.ts.net:8443/api/spotify/callback
   ```
4. Riavvia il servizio, apri la dashboard e tocca **Collega Spotify**: Spotify chiede il permesso e ti riporta alla dashboard.

L'accesso all'account resta in `data/spotify.json`. Per scollegare Spotify cancella quel file
(o togli l'accesso da spotify.com → Account → App).

---

## 5. Aggiornare il server con un comando

Se la dashboard gira su un altro computer (un server raggiungibile via `ssh`), puoi aggiornarlo con:

```bash
./deploy.sh
```

Lo script invia a GitHub i commit mancanti. Poi, sul server, scarica l'ultima versione con `git pull`,
aggiorna le librerie se servono, riavvia il servizio e controlla che la pagina risponda.
Il server di default si chiama `homelab`; per usarne un altro: `DEPLOY_HOST=mioserver ./deploy.sh`.

**Preparazione, da fare una volta sola sul server:**
1. Installa git: `sudo apt install git`.
2. Se il repository è privato, crea una chiave con `ssh-keygen -t ed25519 -f ~/.ssh/github_dashboard`.
   Aggiungila al repository su GitHub, in *Settings → Deploy keys*, lasciando la **sola lettura**.
   Poi, in `~/.ssh/config`, scrivi:
   ```
   Host github.com
     IdentityFile ~/.ssh/github_dashboard
   ```
3. Clona il repository: `git clone git@github.com:TUO-UTENTE/dashboard-giornata.git`.

---

## 6. Modificare lo stile (Tailwind)

Lo stile usa [Tailwind CSS](https://tailwindcss.com): le classi sono scritte direttamente in `static/index.html`
e in `static/js/script.js`, mentre colori, font e animazioni stanno in `src/style.css` (il blocco `@theme`).
Tailwind legge questi file e genera `static/css/style.css`, che è il file usato davvero dalla pagina.

Serve [Node.js](https://nodejs.org) solo sul computer dove modifichi lo stile, non sul server:

```bash
npm install        # una volta sola: scarica Tailwind in node_modules/
npm run dev        # mentre lavori: rigenera lo stile a ogni salvataggio
npm run build      # prima del commit: genera la versione finale, compressa
```

`./deploy.sh` esegue `npm run build` da solo. Se lo stile è cambiato, si ferma e ti chiede di fare il commit.

---

## File

| File | Cosa fa |
|---|---|
| `server.py` | Server: legge iCloud, riceve i promemoria, serve la pagina |
| `static/index.html` | La dashboard |
| `src/style.css` | Lo stile: tema e colori per Tailwind |
| `static/css/style.css` | Lo stile generato da Tailwind (non modificarlo a mano) |
| `.env` | Le tue impostazioni (privato, non condividerlo) |
| `data/reminders.json` | Ultimi promemoria ricevuti dall'iPhone |
| `data/todos.json` | Promemoria aggiunti dalla dashboard e spunte |
| `data/push.json` | Dispositivi iscritti alle notifiche e notifiche già mandate |
| `data/spotify.json` | Accesso al tuo account Spotify (si crea quando lo colleghi) |
| `data/vapid.pem` | Chiave privata per firmare le notifiche (si crea da sola) |
| `static/sw.js` | Service worker: mostra le notifiche anche a pagina chiusa |
| `install.sh` | Installazione e servizio sempre attivo |
| `deploy.sh` | Aggiorna il server da GitHub con un comando |
