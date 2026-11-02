# Dashboard giornata

Una pagina web con due schermate, che si scelgono dalla barra in basso sul telefono o in alto sul computer.

**Home**, la dashboard della giornata:
- **Adesso / Prossimo**: cosa stai facendo e cosa viene dopo, con il tempo che manca, sulla barra delle ore di oggi.
- **Esami**: il conto alla rovescia ai prossimi esami, presi da un calendario apposta.
- **Oggi**: gli eventi del calendario Apple (iCloud), con quelli passati sbiaditi.
- **Promemoria**: quelli scaduti, quelli di oggi, i prossimi e quelli senza data.

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
| `install.sh` | Installazione e servizio sempre attivo |
| `deploy.sh` | Aggiorna il server da GitHub con un comando |
