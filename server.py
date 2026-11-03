#!/usr/bin/env python3
"""Dashboard giornata: calendario iCloud (CalDAV) + Promemoria (via Comando Rapido iPhone)."""
import hashlib
import json
import os
import secrets
import threading
import time
from datetime import date, datetime, timedelta, time as dtime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from flask import Flask, abort, jsonify, request, send_from_directory

BASE = Path(__file__).resolve().parent
load_dotenv(BASE / ".env")

TZ = ZoneInfo(os.getenv("TIMEZONE", "Europe/Rome"))
APPLE_ID = os.getenv("APPLE_ID", "").strip()
APP_PASSWORD = os.getenv("APPLE_APP_PASSWORD", "").strip()
CALDAV_URL = os.getenv("CALDAV_URL", "https://caldav.icloud.com").strip()
CALENDARS = [c.strip().lower() for c in os.getenv("CALENDARS", "").split(",") if c.strip()]
TOKEN = os.getenv("REMINDERS_TOKEN", "").strip()
DEMO = os.getenv("DEMO", "0").strip() == "1"
CACHE_SECONDS = int(os.getenv("CACHE_SECONDS", "300"))
WEATHER_CITY = os.getenv("WEATHER_CITY", "").strip()
WEATHER_SECONDS = int(os.getenv("WEATHER_SECONDS", "900"))
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8080"))
DAYS = 7  # giorni mostrati nella pagina: oggi e i 6 successivi
EXAMS = [c.strip().lower() for c in os.getenv("EXAMS", "").split(",") if c.strip()]  # calendari degli esami
EXAM_DAYS = int(os.getenv("EXAM_DAYS", "180"))  # quanto avanti cercare gli esami
EXAM_SECONDS = int(os.getenv("EXAM_SECONDS", "1800"))  # gli esami cambiano di rado: li richiede ogni mezz'ora

DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
REM_FILE = DATA / "reminders.json"
TODO_FILE = DATA / "todos.json"  # promemoria aggiunti dalla dashboard e spunte
RESEND_SECONDS = 600  # dopo quanto rimandare all'iPhone un promemoria nuovo che non è ancora arrivato in Apple

# colori dei tag di Notion: la pagina li traduce in classi CSS (c-blue, c-orange, ...)
PALETTE = ["blue", "orange", "green", "pink", "yellow", "brown", "red", "gray"]

app = Flask(__name__, static_folder=None)
_cache = {"key": None, "at": 0.0, "events": [], "error": None}
_lock = threading.Lock()


# ---------------------------------------------------------------- calendario
def _local(v):
    """Ritorna (datetime locale, è_giornata_intera)."""
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=TZ)
        return v.astimezone(TZ), False
    return datetime.combine(v, dtime.min, TZ), True


def fetch_caldav(day: date, days: int = DAYS, only=None):
    """Eventi da `day` per `days` giorni. `only`: nomi dei calendari da leggere (di default CALENDARS)."""
    import caldav  # import qui così la modalità demo non lo richiede

    start = datetime.combine(day, dtime.min, TZ)
    end = start + timedelta(days=days)
    client = caldav.DAVClient(url=CALDAV_URL, username=APPLE_ID, password=APP_PASSWORD)
    principal = client.principal()
    events = []
    for i, cal in enumerate(principal.calendars()):
        try:
            name = cal.get_display_name() or "Calendario"
        except Exception:
            name = getattr(cal, "name", None) or "Calendario"
        only = CALENDARS if only is None else only
        if only and name.lower() not in only:
            continue
        try:
            results = cal.search(start=start, end=end, event=True, expand=True)
        except Exception:
            continue  # calendari che non supportano eventi (es. vecchi promemoria)
        for r in results:
            for comp in r.icalendar_instance.walk("VEVENT"):
                ds = comp.get("DTSTART")
                if ds is None:
                    continue
                s, all_day = _local(ds.dt)
                de = comp.get("DTEND")
                if de is not None:
                    e, _ = _local(de.dt)
                elif comp.get("DURATION") is not None:
                    e = s + comp.get("DURATION").dt
                else:
                    e = s + (timedelta(days=1) if all_day else timedelta(hours=1))
                if e <= start or s >= end:
                    continue
                events.append({
                    "title": str(comp.get("SUMMARY", "(senza titolo)")),
                    "start": s.isoformat(),
                    "end": e.isoformat(),
                    "all_day": all_day,
                    "location": str(comp.get("LOCATION", "") or ""),
                    "calendar": name,
                    "color": PALETTE[i % len(PALETTE)],
                })
    events.sort(key=lambda ev: (not ev["all_day"], ev["start"]))
    return events


def demo_events(day: date):
    def at(d, h, m=0):
        return datetime.combine(d, dtime(h, m), TZ).isoformat()

    tom = day + timedelta(days=1)
    return [
        {"title": "Consegna progetto", "start": at(day, 0), "end": at(tom, 0), "all_day": True,
         "location": "", "calendar": "Università", "color": PALETTE[0]},
        {"title": "Lezione di Analisi", "start": at(day, 9), "end": at(day, 11), "all_day": False,
         "location": "Aula 3", "calendar": "Università", "color": PALETTE[0]},
        {"title": "Pranzo con Marco", "start": at(day, 13), "end": at(day, 14), "all_day": False,
         "location": "Centro", "calendar": "Personale", "color": PALETTE[2]},
        {"title": "Studio di gruppo", "start": at(day, 15, 30), "end": at(day, 17, 30), "all_day": False,
         "location": "Biblioteca", "calendar": "Università", "color": PALETTE[0]},
        {"title": "Palestra", "start": at(day, 19), "end": at(day, 20), "all_day": False,
         "location": "", "calendar": "Personale", "color": PALETTE[2]},
        {"title": "Ricevimento professore", "start": at(tom, 10), "end": at(tom, 10, 30), "all_day": False,
         "location": "Studio 12", "calendar": "Università", "color": PALETTE[0]},
        {"title": "Cena di compleanno", "start": at(tom, 20, 30), "end": at(tom, 23), "all_day": False,
         "location": "", "calendar": "Personale", "color": PALETTE[2]},
    ] + [  # qualche impegno anche nel resto della settimana
        {"title": t, "start": at(day + timedelta(days=n), h), "end": at(day + timedelta(days=n), h + 2), "all_day": False,
         "location": "", "calendar": "Università", "color": PALETTE[0]}
        for n, t, h in [(2, "Laboratorio", 9), (3, "Lezione di Fisica", 11), (4, "Esercitazione", 14), (5, "Ripasso", 10)]
    ]


def get_events(day: date):
    if DEMO:
        return demo_events(day), None
    if not APPLE_ID or not APP_PASSWORD:
        return [], "Calendario non configurato: imposta APPLE_ID e APPLE_APP_PASSWORD nel file .env"
    with _lock:
        if _cache["key"] == day.isoformat() and time.time() - _cache["at"] < CACHE_SECONDS:
            return _cache["events"], _cache["error"]
        try:
            events, err = fetch_caldav(day), None
        except Exception as exc:  # mostra l'errore nella pagina, tiene gli ultimi dati validi
            events, err = _cache["events"], f"Errore calendario iCloud: {exc}"
        _cache.update(key=day.isoformat(), at=time.time(), events=events, error=err)
        return events, err


# ---------------------------------------------------------------- esami
# Gli esami sono gli eventi dei calendari scritti in EXAMS (es. EXAMS=Esami uni), cercati nei prossimi EXAM_DAYS giorni.
_exams = {"at": 0.0, "items": [], "error": None}
_elock = threading.Lock()


def demo_exams(day: date):
    def at(n, h):
        return datetime.combine(day + timedelta(days=n), dtime(h), TZ).isoformat()
    return [{"title": t, "start": at(n, h), "end": at(n, h + 2), "all_day": False, "location": l,
             "calendar": "Esami uni", "color": "red"}
            for n, t, h, l in [(4, "Analisi 1", 9, "Aula 2"), (18, "Programmazione", 14, "Lab 3"), (41, "Fisica", 10, "")]]


def get_exams(day: date):
    if DEMO:
        return demo_exams(day), None
    if not EXAMS or not APPLE_ID or not APP_PASSWORD:
        return None, None  # esami non configurati: la pagina non mostra la scheda
    with _elock:
        if time.time() - _exams["at"] < EXAM_SECONDS:
            return _exams["items"], _exams["error"]
        try:
            items, err = fetch_caldav(day, EXAM_DAYS, only=EXAMS), None
        except Exception as exc:
            items, err = _exams["items"], f"Errore esami iCloud: {exc}"
        _exams.update(at=time.time(), items=items, error=err)
        return items, err


# ---------------------------------------------------------------- meteo
# Open-Meteo: gratuito, senza chiave. Prima trova le coordinate della città, poi chiede le previsioni.
WMO = {  # codici meteo WMO -> descrizione
    0: "Sereno", 1: "Quasi sereno", 2: "Poco nuvoloso", 3: "Nuvoloso", 45: "Nebbia", 48: "Nebbia gelata",
    51: "Pioviggine leggera", 53: "Pioviggine", 55: "Pioviggine intensa", 56: "Pioviggine gelata", 57: "Pioviggine gelata",
    61: "Pioggia leggera", 63: "Pioggia", 65: "Pioggia forte", 66: "Pioggia gelata", 67: "Pioggia gelata",
    71: "Neve leggera", 73: "Neve", 75: "Neve forte", 77: "Nevischio",
    80: "Rovesci leggeri", 81: "Rovesci", 82: "Rovesci violenti", 85: "Rovesci di neve", 86: "Rovesci di neve",
    95: "Temporale", 96: "Temporale con grandine", 99: "Temporale con grandine",
}
_weather = {"at": 0.0, "data": None, "place": None}
_wlock = threading.Lock()  # lucchetto separato: il meteo non blocca il calendario


def _get_json(url, params):
    with urlopen(f"{url}?{urlencode(params)}", timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_weather():
    if _weather["place"] is None:
        res = _get_json("https://geocoding-api.open-meteo.com/v1/search",
                        {"name": WEATHER_CITY, "count": 1, "language": "it"}).get("results")
        if not res:
            raise ValueError(f"città «{WEATHER_CITY}» non trovata")
        _weather["place"] = res[0]
    place = _weather["place"]
    f = _get_json("https://api.open-meteo.com/v1/forecast", {
        "latitude": place["latitude"], "longitude": place["longitude"], "timezone": str(TZ), "forecast_days": DAYS,
        "current": "temperature_2m,weather_code",
        "hourly": "precipitation_probability",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    })
    d = f["daily"]
    days = [{"date": d["time"][i], "text": WMO.get(d["weather_code"][i], "—"),
             "max": round(d["temperature_2m_max"][i]), "min": round(d["temperature_2m_min"][i]),
             "rain": d["precipitation_probability_max"][i]} for i in range(len(d["time"]))]
    # prima ora da adesso a fine giornata con pioggia probabile (>= 50%)
    now_h, today = datetime.now(TZ).strftime("%Y-%m-%dT%H:00"), datetime.now(TZ).date().isoformat()
    rain = next(({"from": t[11:16], "prob": p}
                 for t, p in zip(f["hourly"]["time"], f["hourly"]["precipitation_probability"])
                 if t.startswith(today) and t >= now_h and (p or 0) >= 50), None)
    return {"place": place["name"],
            "now": {"temp": round(f["current"]["temperature_2m"]), "text": WMO.get(f["current"]["weather_code"], "—")},
            "days": days, "rain": rain}


def get_weather():
    if not WEATHER_CITY:
        return None  # meteo non configurato: la pagina non lo mostra
    if DEMO:
        today = datetime.now(TZ).date()
        sky = [("Rovesci", 70), ("Sereno", 0), ("Poco nuvoloso", 10), ("Pioggia", 80), ("Nuvoloso", 30), ("Sereno", 0), ("Sereno", 5)]
        return {"place": WEATHER_CITY, "now": {"temp": 14, "text": "Poco nuvoloso"}, "rain": {"from": "16:00", "prob": 70},
                "days": [{"date": (today + timedelta(days=i)).isoformat(), "text": t, "max": 17 - i % 3, "min": 8 + i % 2, "rain": r}
                         for i, (t, r) in enumerate(sky[:DAYS])]}
    with _wlock:
        if time.time() - _weather["at"] < WEATHER_SECONDS and _weather["data"]:
            return _weather["data"]
        try:
            data = fetch_weather()
        except Exception as exc:  # tiene l'ultimo dato valido e segnala l'errore solo nel riquadro meteo
            data = dict(_weather["data"] or {}, error=f"Meteo non disponibile: {exc}")
        _weather.update(at=time.time(), data=data)
        return data


# ---------------------------------------------------------------- promemoria
def _parse_due(s: str):
    s = (s or "").strip()
    if not s:
        return None, False
    try:
        if len(s) == 10:  # solo data
            return datetime.combine(date.fromisoformat(s), dtime.min, TZ), True
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=TZ)
        return d.astimezone(TZ), False
    except ValueError:
        return None, False


def parse_reminders(payload):
    """Accetta {"text": "titolo|scadenza|lista\\n..."}, {"reminders": [...]} oppure testo semplice."""
    items = []
    if isinstance(payload, dict) and isinstance(payload.get("reminders"), list):
        raw = payload["reminders"]
        for r in raw:
            if isinstance(r, str):
                r = {"title": r}
            items.append((str(r.get("title", "")), str(r.get("due", "") or ""), str(r.get("list", "") or "")))
    else:
        text = payload.get("text", "") if isinstance(payload, dict) else str(payload or "")
        for line in str(text).splitlines():
            parts = [p.strip() for p in line.split("|")]
            items.append((parts[0], parts[1] if len(parts) > 1 else "", parts[2] if len(parts) > 2 else ""))
    out = []
    for title, due, lst in items:
        title = title.strip()
        if not title:
            continue
        d, date_only = _parse_due(due)
        out.append({"title": title, "due": d.isoformat() if d else None,
                    "date_only": date_only, "list": lst})
    return out


def load_reminders():
    if DEMO and not REM_FILE.exists():
        today = datetime.now(TZ).date()
        mk = lambda d, h=None: (datetime.combine(d, dtime(h or 0), TZ).isoformat(), h is None)
        demo = [("Pagare la bolletta", today - timedelta(days=1), 18, "Casa"),
                ("Ripassare capitolo 4", today, None, "Università"),
                ("Chiamare il dentista", today, 17, "Personale"),
                ("Comprare il latte", None, None, "Spesa")]
        items = []
        for t, d, h, l in demo:
            due, only = mk(d, h) if d else (None, False)
            items.append({"title": t, "due": due, "date_only": only, "list": l})
        return {"updated_at": datetime.now(TZ).isoformat(), "items": items}
    if not REM_FILE.exists():
        return {"updated_at": None, "items": []}
    try:
        return json.loads(REM_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"updated_at": None, "items": []}


# ---------------------------------------------------------------- promemoria della dashboard
# Apple non permette di scrivere nei Promemoria da fuori, quindi spunte e promemoria nuovi restano qui,
# in data/todos.json: {"items": [promemoria aggiunti], "done": [{id, title, list} dei promemoria Apple spuntati]}.
# È il Comando Rapido dell'iPhone a portarli in Apple: chiede /api/reminders/sync, chiude e crea i promemoria,
# poi manda la lista aggiornata a /api/reminders, che fa pulizia (vedi sync_cleanup).
_tlock = threading.Lock()


def _apple_id(r):
    """Un id stabile per un promemoria arrivato dall'iPhone: lo stesso titolo, scadenza ed elenco danno lo stesso id."""
    raw = f"{r.get('title')}|{r.get('due')}|{r.get('list')}"
    return "a" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def load_todos():
    try:
        t = json.loads(TODO_FILE.read_text(encoding="utf-8"))
        # le prime versioni salvavano solo l'id delle spunte: le trasforma nel formato nuovo
        done = [d if isinstance(d, dict) else {"id": d, "title": "", "list": ""} for d in t.get("done", [])]
        return {"items": list(t.get("items", [])), "done": done}
    except (OSError, json.JSONDecodeError):
        return {"items": [], "done": []}


def save_todos(t):
    tmp = TODO_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(t, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(TODO_FILE)  # scrive su un file temporaneo e poi lo sostituisce: mai un file a metà


def all_reminders(apple):
    """I promemoria da mostrare: quelli dell'iPhone non ancora spuntati qui, più quelli aggiunti dalla dashboard."""
    t = load_todos()
    done = {d["id"] for d in t["done"]}
    out = [dict(r, id=_apple_id(r), source="apple") for r in apple]
    out = [r for r in out if r["id"] not in done]
    return out + [dict(r, source="dash") for r in t["items"]]


def sync_cleanup(apple):
    """Dopo che l'iPhone ha mandato la lista aggiornata:
    - le spunte di promemoria che l'iPhone non manda più sono state chiuse in Apple: non servono più;
    - i promemoria della dashboard già consegnati all'iPhone si tolgono da qui: da ora vale la lista di Apple.
      Se ci sono, arrivano da Apple (e non li vedi doppi); se non ci sono, li hai cancellati o completati sull'iPhone."""
    alive = {_apple_id(r) for r in apple}
    titles = {r["title"].strip().lower() for r in apple}
    with _tlock:
        t = load_todos()
        # le spunte dei promemoria nati nella dashboard (id "d...") restano finché l'iPhone ne manda uno con quel titolo
        t["done"] = [d for d in t["done"] if d["id"] in alive or (d["id"].startswith("d") and d["title"].strip().lower() in titles)]
        t["items"] = [i for i in t["items"] if not i.get("exported")]
        save_todos(t)


def _check_token():
    """Gli indirizzi usati dal Comando Rapido vogliono il token del file .env (intestazione Authorization o ?token=)."""
    if not TOKEN:
        abort(503, "REMINDERS_TOKEN non impostato nel file .env")
    sent = request.headers.get("Authorization", "").removeprefix("Bearer ").strip() \
        or request.args.get("token", "")
    if not secrets.compare_digest(sent, TOKEN):  # confronto a tempo costante: non rivela quanti caratteri sono giusti
        abort(401)


# ---------------------------------------------------------------- rotte
@app.get("/")
def index():
    return send_from_directory(BASE / "static", "index.html")


@app.get("/<path:filename>")
def static_files(filename):
    # consegna qualsiasi file dentro static/ (icone, manifest, immagini...)
    # send_from_directory blocca i tentativi di uscire dalla cartella (es. /../.env)
    return send_from_directory(BASE / "static", filename)


@app.get("/api/dashboard")
def api_dashboard():
    today = datetime.now(TZ).date()
    events, err = get_events(today)
    exams, exam_err = get_exams(today)
    rem = load_reminders()
    return jsonify({
        "now": datetime.now(TZ).isoformat(),
        "today": today.isoformat(),
        "events": events,
        "reminders": all_reminders(rem.get("items", [])),
        "reminders_updated_at": rem.get("updated_at"),
        "weather": get_weather(),
        "exams": exams,
        "errors": [e for e in [err, exam_err] if e],
        "demo": DEMO,
    })


@app.post("/api/reminders")
def api_reminders():
    _check_token()
    payload = request.get_json(silent=True)
    if payload is None:
        payload = request.get_data(as_text=True)
    items = parse_reminders(payload)
    data = {"updated_at": datetime.now(TZ).isoformat(), "items": items}
    tmp = REM_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(REM_FILE)
    sync_cleanup(items)
    return jsonify({"ok": True, "ricevuti": len(items)})


@app.get("/api/reminders/sync")
def api_reminders_sync():
    """Per il Comando Rapido: cosa fare in Apple. "done" = da segnare completati, "new" = da creare.
    "due" è nel formato "2026-11-04 17:30" (o solo la data), che Comandi Rapidi sa leggere come data."""
    _check_token()
    with _tlock:
        t = load_todos()
        new = []
        now = time.time()
        for i in t["items"]:
            # Un promemoria consegnato non si rimanda subito: se il comando partisse due volte prima che l'iPhone
            # rimandi la lista, verrebbe creato doppio. Se però sono passati RESEND_SECONDS
            # e l'iPhone non ha ancora rimandato la lista, si rimanda. Al prossimo invio dell'iPhone si toglie da qui.
            sent = i.get("exported")
            if sent and (sent is True or now - sent < RESEND_SECONDS):
                continue
            i["exported"] = now
            due = ""
            if i.get("due"):
                d = datetime.fromisoformat(i["due"])
                due = d.strftime("%Y-%m-%d") if i.get("date_only") else d.strftime("%Y-%m-%d %H:%M")
            new.append({"title": i["title"], "due": due})
        save_todos(t)
    return jsonify({"done": [{"title": d["title"], "list": d["list"]} for d in t["done"] if d["title"]], "new": new})


@app.post("/api/todos")
def api_todo_add():
    """Aggiunge un promemoria dalla dashboard: {"title": "...", "date": "2026-11-05", "time": "17:30"} (data e ora facoltative)."""
    body = request.get_json(silent=True) or {}
    title = str(body.get("title", "")).strip()[:200]
    if not title:
        abort(400, "manca il titolo")
    due, date_only = None, False
    if body.get("date"):
        try:
            d = date.fromisoformat(str(body["date"]))
            t = dtime.fromisoformat(str(body["time"])) if body.get("time") else dtime.min
        except ValueError:
            abort(400, "data o ora non valida")
        due, date_only = datetime.combine(d, t, TZ).isoformat(), not body.get("time")
    item = {"id": "d" + secrets.token_hex(6), "title": title, "due": due, "date_only": date_only, "list": ""}
    with _tlock:
        t = load_todos()
        t["items"].append(item)
        save_todos(t)
    return jsonify({"ok": True, "item": item})


@app.post("/api/todos/<rid>/done")
def api_todo_done(rid):
    """Spunta un promemoria: quelli della dashboard si cancellano, quelli dell'iPhone si nascondono."""
    with _tlock:
        t = load_todos()
        if rid.startswith("d"):
            item = next((i for i in t["items"] if i["id"] == rid), None)
            t["items"] = [i for i in t["items"] if i["id"] != rid]
            # se era già stato consegnato all'iPhone, in Apple esiste: va chiuso anche lì
            if item and item.get("exported"):
                t["done"].append({"id": rid, "title": item["title"], "list": ""})
        else:
            # tiene solo le spunte di promemoria che l'iPhone manda ancora: la lista non cresce all'infinito
            # salva anche titolo ed elenco: l'iPhone li cerca per nome, l'id non sa calcolarlo
            r = next((r for r in load_reminders().get("items", []) if _apple_id(r) == rid), None)
            if r is None:
                abort(404)
            t["done"] = [d for d in t["done"] if d["id"] != rid] + [{"id": rid, "title": r["title"], "list": r.get("list", "")}]
        save_todos(t)
    return jsonify({"ok": True})


@app.post("/api/refresh")
def api_refresh():
    with _lock:
        _cache["at"] = 0.0
    with _elock:
        _exams["at"] = 0.0
    return jsonify({"ok": True})


if __name__ == "__main__":
    from waitress import serve

    print(f"Dashboard su http://{HOST}:{PORT}  (demo={'sì' if DEMO else 'no'})")
    serve(app, host=HOST, port=PORT)