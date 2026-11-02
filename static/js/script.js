const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hm = d => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const dayStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
// Colori delle etichette (Notion). Tailwind trova le classi leggendo questo file come testo, quindi:
// - le classi vanno scritte per intero: un nome costruito a pezzi, come "bg-t-" + colore, non lo vedrebbe;
// - prima di ${...} serve uno spazio: in "bg-control${x}" vedrebbe la parola "bg-control${x}", non "bg-control".
const TAG = {
  gray: "bg-t-gray text-t-gray-ink", brown: "bg-t-brown text-t-brown-ink", orange: "bg-t-orange text-t-orange-ink",
  yellow: "bg-t-yellow text-t-yellow-ink", green: "bg-t-green text-t-green-ink", blue: "bg-t-blue text-t-blue-ink",
  pink: "bg-t-pink text-t-pink-ink", red: "bg-t-red text-t-red-ink",
};
const color = c => TAG[c] || TAG.gray;
const PILL = "inline-block max-w-full truncate rounded-full px-[9px] text-xs/[22px] font-semibold tracking-normal";
const DAYS = 7;  // oggi e i 6 giorni successivi, come nel server
let data = null;
let sel = 0;     // giorno mostrato nel Calendario: 0 = oggi, 1 = domani, ...
let view = "home";  // schermata: "home" (#/) o "cal" (#/calendario)

function dur(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function eventsOn(day) {
  const s = dayStart(day), e = addDays(s, 1);
  return (data?.events || []).map(ev => ({ ...ev, s: new Date(ev.start), e: new Date(ev.end) }))
    .filter(ev => ev.s < e && ev.e > s);
}

function split(day) {
  const events = eventsOn(day);
  return { events, allDay: events.filter(e => e.all_day), timed: events.filter(e => !e.all_day) };
}

const dayName = (n, d) => n === 0 ? "Oggi" : n === 1 ? "Domani" : cap(d.toLocaleDateString("it-IT", { weekday: "long" }));
const forecast = d => data?.weather?.days?.find(x => x.date === isoDay(d));
const tag = (ev, past) => `<span class="${PILL} ${color(ev.color)} ${past ? "opacity-60" : ""}">${esc(ev.calendar)}</span>`;
const notice = text => `<div class="mt-5 rounded-[14px] bg-danger-bg px-4 py-3.5 text-sm text-danger md:px-5">${esc(text)}</div>`;

function eventRow(ev, now) {
  const past = now && ev.e <= now;
  const live = now && !past && ev.s <= now ? `<span class="font-semibold text-accent">In corso, fino alle ${hm(ev.e)}</span>` : "";
  const meta = [live, ev.calendar ? tag(ev, past) : "", ev.location ? `<span>${esc(ev.location)}</span>` : ""].filter(Boolean).join("");
  const ink = past ? "text-muted" : "";
  return `<div class="grid grid-cols-[52px_minmax(0,1fr)] gap-3.5 border-b border-rule py-3.5 last:border-0">
    <div class="font-semibold tabular-nums ${ink}">${hm(ev.s)}<small class="block text-[13px] font-normal text-muted">${hm(ev.e)}</small></div>
    <div><div class="text-base font-semibold tracking-[-.015em] ${ink}">${esc(ev.title)}</div>
    ${meta ? `<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">${meta}</div>` : ""}</div></div>`;
}

// Le linguette dei giorni, come nell'app Calendario: oggi in rosso, il giorno scelto nel cerchio pieno,
// il puntino dice che ci sono impegni.
function renderWeek(now) {
  const today = dayStart(now);
  let html = "";
  for (let i = 0; i < DAYS; i++) {
    const d = addDays(today, i);
    const busy = data && eventsOn(d).length;
    const num = i === sel && i === 0 ? "bg-today font-semibold text-white"
      : i === sel ? "bg-ink font-semibold text-surface"
      : i === 0 ? "font-semibold text-today group-hover:bg-active"
      : "group-hover:bg-active";
    html += `<button type="button" data-i="${i}" aria-pressed="${i === sel}" aria-label="${dayName(i, d)}, ${d.getDate()}"
      class="group flex cursor-pointer flex-col items-center gap-1 py-1 text-muted">
      <span class="text-xs">${cap(d.toLocaleDateString("it-IT", { weekday: "short" }).replace(".", ""))}</span>
      <span class="size-[34px] rounded-full text-center text-[17px]/[34px] tabular-nums transition-colors md:size-9 md:leading-9 ${num}">${d.getDate()}</span>
      <span class="size-1 rounded-full bg-control ${busy ? "" : "invisible"}"></span></button>`;
  }
  $("week").innerHTML = html;
}

// La barra della giornata, dalle 00 alle 24: ogni impegno sulla sua fascia oraria, su più corsie se si sovrappongono.
function renderStrip(el, timed, now, day, isToday) {
  if (!timed.length) { el.innerHTML = ""; return; }
  const hourOf = d => (d - day) / 3600000;
  const pct = h => Math.min(Math.max(h, 0), 24) / 24 * 100;

  const lanes = [];
  const blocks = [...timed].sort((a, b) => a.s - b.s).map(ev => {
    let lane = lanes.findIndex(end => end <= ev.s);
    if (lane < 0) { lane = lanes.length; lanes.push(ev.e); } else lanes[lane] = ev.e;
    const left = pct(hourOf(ev.s)), width = Math.max(pct(hourOf(ev.e)) - left, .8);
    return `<div class="absolute h-7 truncate rounded-md px-2 text-xs/7 font-semibold ${color(ev.color)} ${isToday && ev.e <= now ? "opacity-45" : ""}"
      title="${esc(ev.title)} · ${hm(ev.s)}–${hm(ev.e)}" style="left:${left}%;width:calc(${width}% - 2px);top:${lane * 32}px">${esc(ev.title)}</div>`;
  }).join("");

  const nowP = pct(hourOf(now));
  const perHour = (el.clientWidth || 800) / 24;  // px per ora: dirada le etichette su schermi stretti
  const step = perHour >= 48 ? 1 : perHour >= 24 ? 2 : perHour >= 12 ? 3 : 6;
  let ticks = "";
  for (let h = 0; h <= 24; h += step) ticks += `<span class="absolute top-0 -translate-x-1/2 text-xs text-muted tabular-nums first:translate-x-0 last:-translate-x-full" style="left:${pct(h)}%">${String(h).padStart(2, "0")}</span>`;

  // la linea di adesso è blu con un pallino in cima (before:), la zona già passata è velata di grigio
  el.innerHTML = `<div class="relative" style="height:${lanes.length * 32 - 4}px">
      ${isToday ? `<div class="absolute inset-y-0 left-0 rounded-l-lg bg-past" style="width:${nowP}%"></div>` : ""}${blocks}
      ${isToday ? `<div class="absolute -inset-y-1 -ml-px w-0.5 rounded-full bg-accent before:absolute before:-top-1 before:-left-1 before:size-2.5 before:rounded-full before:bg-accent" style="left:${nowP}%"></div>` : ""}
    </div><div class="relative mt-2.5 h-[18px]">${ticks}</div>`;
}

function renderNow(el, timed, now) {
  const currents = timed.filter(e => e.s <= now && e.e > now);
  const next = timed.find(e => e.s > now);
  const then = next
    ? `<div class="text-muted">Dopo: <b class="font-semibold text-ink">${esc(next.title)}</b> alle ${hm(next.s)}, tra ${dur(Math.round((next.s - now) / 60000))}${next.location ? " · " + esc(next.location) : ""}</div>`
    : `<div class="text-muted">Dopo: niente altro in calendario oggi.</div>`;
  const lead = "text-lg/tight font-semibold tracking-[-.02em] md:text-xl/tight";
  if (currents.length) {
    const maxEnd = new Date(Math.max(...currents.map(e => e.e)));
    const minStart = new Date(Math.min(...currents.map(e => e.s)));
    const pct = Math.min(100, (now - minStart) / (maxEnd - minStart) * 100);
    const titles = currents.map(e => esc(e.title)).join(" e ");
    el.innerHTML = `<div class="${lead}">${titles} <span class="font-normal text-muted">· mancano ${dur(Math.round((maxEnd - now) / 60000))}, fino alle ${hm(maxEnd)}</span></div>
      <div class="mt-2.5 mb-1.5 h-1.5 max-w-[420px] overflow-hidden rounded-full bg-track"><span class="block h-full rounded-full bg-accent" style="width:${pct}%"></span></div>${then}`;
  } else {
    const free = next ? `Libero fino alle ${hm(next.s)}` : "Libero per il resto della giornata";
    el.innerHTML = `<div class="${lead}">${free}</div>${next ? then : ""}`;
  }
}

// La lista degli impegni di un giorno: prima quelli di giornata intera come etichette, poi quelli con orario.
function renderList(ids, { events, allDay, timed }, now) {
  $(ids.allDay).innerHTML = allDay.map(e => `<span class="${PILL} ${color(e.color)}">${esc(e.title)}</span>`).join("");
  $(ids.list).innerHTML = timed.length ? timed.map(e => eventRow(e, now)).join("")
    : `<div class="py-4 text-muted">${allDay.length ? "Nessun impegno con orario." : "Niente in calendario."}</div>`;
  $(ids.count).textContent = events.length || "";
}

const forecastText = d => { const f = forecast(d); return f ? `${f.text}, ${f.min}°–${f.max}°` : ""; };

// Meteo adesso, sotto l'orologio. Se non è configurato non compare.
function renderWeather() {
  const w = data.weather;
  if (!w || !w.now) {
    $("weather").innerHTML = w?.error ? `<span class="text-[13px] text-muted">${esc(w.error)}</span>` : "";
    return;
  }
  const t = w.days?.[0];
  // il nome della città si vede solo da computer: sul telefono lascia spazio alla data
  $("weather").innerHTML = `<span class="font-semibold tabular-nums">${w.now.temp}°</span> ${esc(w.now.text)}
    ${t ? `<span class="block text-[13px] text-muted tabular-nums">${t.min}°–${t.max}°<span class="hidden md:inline"> · ${esc(w.place)}</span></span>` : ""}`;
  if (w.error) $("weather").title = w.error;  // dato vecchio: l'errore resta visibile al passaggio del mouse
}

// Il riepilogo della settimana nel Calendario: una riga per giorno, toccala per aprirlo.
function renderWeekList(now) {
  const today = dayStart(now);
  let html = "";
  for (let i = 0; i < DAYS; i++) {
    const d = addDays(today, i), { events, timed } = split(d);
    const what = events.length ? `${events.length} ${events.length === 1 ? "impegno" : "impegni"}`
      + (timed.length ? `, il primo alle ${hm(timed[0].s)}` : "") : "Libero";
    const name = `${dayName(i, d)} ${i > 1 ? d.getDate() : ""}`;
    html += `<button type="button" data-i="${i}" aria-pressed="${i === sel}"
      class="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 py-3 text-left ${i < DAYS - 1 ? "border-b border-rule" : ""}">
      <span><span class="font-semibold ${i === 0 ? "text-today" : ""}">${name}</span>
        <span class="block text-[13px] text-muted">${what}</span></span>
      <span class="text-[13px] text-muted tabular-nums">${esc(forecastText(d))}</span></button>`;
  }
  $("weekList").innerHTML = html;
}

function renderReminders(now) {
  const tStart = dayStart(now), tEnd = addDays(tStart, 1);
  const groups = { overdue: [], today: [], later: [], nodate: [] };
  for (const r of data.reminders || []) {
    if (!r.due) { groups.nodate.push(r); continue; }
    const d = new Date(r.due);
    r.d = d;
    if (r.date_only ? d < tStart : d < now) groups.overdue.push(r);
    else if (d < tEnd) groups.today.push(r);
    else groups.later.push(r);
  }
  const byDate = (a, b) => a.d - b.d;
  // il cerchietto dell'app Promemoria; la riga di separazione manca sull'ultima di ogni gruppo
  const remRow = (r, kind, last) => {
    let when = "";
    if (r.d) {
      const sameDay = dayStart(r.d).getTime() === tStart.getTime();
      const dayTxt = sameDay ? "oggi" : r.d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
      when = esc(r.date_only ? dayTxt : `${dayTxt} alle ${hm(r.d)}`);
      if (kind === "overdue") when = `<b class="font-semibold text-danger">${when}</b>`;
    }
    const meta = [when, esc(r.list)].filter(Boolean).join(" · ");
    return `<div class="grid grid-cols-[20px_minmax(0,1fr)] gap-3 py-2.5 ${last ? "" : "border-b border-rule"}">
      <div class="mt-px size-5 rounded-full border-[1.5px] border-control"></div>
      <div><div>${esc(r.title)}</div>${meta ? `<div class="text-[13px] text-muted">${meta}</div>` : ""}</div></div>`;
  };
  const sections = [["Scaduti", "overdue"], ["Oggi", "today"], ["Prossimi", "later"], ["Senza data", "nodate"]];
  let html = "";
  for (const [label, key] of sections) {
    const list = groups[key];
    if (!list.length) continue;
    if (key !== "nodate") list.sort(byDate);
    const max = key === "later" ? 5 : 20;
    const shown = list.slice(0, max);
    html += `<div class="${html ? "mt-4" : "mt-3.5"} mb-0.5 text-[13px] font-semibold text-muted">${label}</div>`
      + shown.map((r, i) => remRow(r, key, i === shown.length - 1)).join("")
      + (list.length > max ? `<div class="pt-1 pb-3 pl-8 text-[13px] text-muted">e altri ${list.length - max}</div>` : "");
  }
  $("reminders").innerHTML = html || `<div class="py-4 text-muted">${data.reminders_updated_at ? "Nessun promemoria da fare." : "Nessun promemoria ricevuto dall'iPhone finora."}</div>`;
  const pending = groups.overdue.length + groups.today.length;
  $("countRem").textContent = pending ? `${pending} da fare oggi` : "";
  return groups;
}

function summary(day, isToday, timed, groups, now) {
  const bits = [];
  if (isToday) {
    const left = timed.filter(e => e.e > now).length;
    bits.push(left ? `${left} ${left === 1 ? "impegno" : "impegni"} ancora da fare` : "Nessun altro impegno oggi");
    if (groups.overdue.length) bits.push(`${groups.overdue.length} promemoria scadut${groups.overdue.length === 1 ? "o" : "i"}`);
    if (groups.today.length) bits.push(`${groups.today.length} promemoria per oggi`);
    const rain = data.weather?.rain;
    if (rain) bits.push(`pioggia probabile dalle ${rain.from} (${rain.prob}%)`);
  } else {
    bits.push(timed.length ? `${timed.length} ${timed.length === 1 ? "impegno" : "impegni"}, il primo alle ${hm(timed[0].s)}`
      : "Nessun impegno con orario");
    const f = forecast(day);
    if (f && f.rain >= 50) bits.push(`pioggia probabile (${f.rain}%)`);
  }
  return bits.join(" · ");
}

function render() {
  const now = new Date(), today = dayStart(now);
  // la Home guarda sempre oggi, il Calendario il giorno scelto
  const day = view === "home" ? today : addDays(today, sel), isToday = day.getTime() === today.getTime();
  $("date").textContent = cap(day.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }));
  $("clock").textContent = hm(now);
  if (view === "cal") renderWeek(now);
  if (!data) return;

  $("alerts").innerHTML = (data.errors || []).map(notice).join("");
  if (data.demo) $("date").innerHTML += `<span class="${PILL} ${TAG.gray} ml-2.5 align-[6px]">Demo</span>`;
  renderWeather();
  const groups = renderReminders(now);
  const d = split(day);

  if (view === "home") {
    renderNow($("hNow"), d.timed, now);
    renderStrip($("hStrip"), d.timed, now, day, true);
    renderList({ allDay: "hAllDay", list: "hList", count: "hCount" }, d, now);
    $("hWeather").textContent = forecastText(day);
  } else {
    renderStrip($("cStrip"), d.timed, now, day, isToday);
    $("cDay").hidden = !d.timed.length;  // un giorno senza orari: niente scheda vuota
    renderList({ allDay: "cAllDay", list: "cList", count: "cCount" }, d, isToday ? now : null);
    $("cLabel").textContent = dayName(sel, day);
    $("cWeather").textContent = forecastText(day);
    renderWeekList(now);
  }
  $("summary").textContent = summary(day, isToday, d.timed, groups, now);

  const ru = data.reminders_updated_at ? new Date(data.reminders_updated_at) : null;
  $("updated").textContent = `Calendario aggiornato alle ${hm(new Date(data.now))}` +
    (ru ? ` · promemoria ricevuti ${dayStart(ru).getTime() === today.getTime() ? "alle " + hm(ru) : ru.toLocaleDateString("it-IT") + " " + hm(ru)}` : "");
}

// Le due schermate stanno nella stessa pagina: l'indirizzo dopo # dice quale mostrare.
// Così funzionano il tasto indietro e i preferiti, senza bisogno di un framework.
function route() {
  view = location.hash === "#/calendario" ? "cal" : "home";
  $("viewHome").hidden = view !== "home";
  $("viewCal").hidden = view !== "cal";
  for (const a of document.querySelectorAll("[data-view]")) {  // il link della schermata aperta è evidenziato
    if (a.dataset.view === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  scrollTo(0, 0);
  render();
}

// Cambia giorno, con un piccolo scorrimento nella direzione giusta.
function select(i) {
  i = Math.max(0, Math.min(DAYS - 1, i));
  if (i === sel) return;
  const dir = i > sel ? 1 : -1;
  sel = i;
  render();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
    $("calBody").animate([{ opacity: 0, transform: `translateX(${dir * 16}px)` }, { opacity: 1, transform: "none" }],
      { duration: 220, easing: "ease-out" });
}

async function load(force) {
  const btn = $("refresh");
  if (force) { btn.classList.add("busy"); btn.disabled = true; btn.textContent = "Aggiorno"; }
  try {
    if (force) await fetch("api/refresh", { method: "POST" });
    const r = await fetch("api/dashboard", { cache: "no-store" });
    data = await r.json();
  } catch (e) {
    $("alerts").innerHTML = notice(`Server non raggiungibile: ${e.message}`);
  }
  render();
  // Primo caricamento finito: la schermata d'apertura svanisce e il contenuto compare con una dissolvenza.
  // Resta almeno SPLASH_MIN ms, così non fa solo un lampo quando i dati arrivano subito.
  if (document.body.classList.contains("loading")) {
    await new Promise(r => setTimeout(r, Math.max(0, SPLASH_MIN - (Date.now() - started))));
    document.body.classList.remove("loading");
    document.querySelector("main").removeAttribute("aria-busy");
  }
  if (force) { btn.classList.remove("busy"); btn.disabled = false; btn.textContent = "Aggiorna"; }
}

const started = Date.now(), SPLASH_MIN = 600;
const today0 = new Date();
$("splashMonth").textContent = today0.toLocaleDateString("it-IT", { month: "short" }).replace(".", "");
$("splashDay").textContent = today0.getDate();

// Nel Calendario, tre modi per cambiare giorno: tocco sulla linguetta (o sulla riga della settimana),
// frecce della tastiera, scorrimento col dito.
$("week").onclick = $("weekList").onclick = e => { const b = e.target.closest("button"); if (b) select(+b.dataset.i); };
addEventListener("keydown", e => {
  if (view !== "cal" || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === "ArrowRight") select(sel + 1);
  if (e.key === "ArrowLeft") select(sel - 1);
});
let touch = null;
addEventListener("touchstart", e => { const t = e.touches[0]; touch = { x: t.clientX, y: t.clientY }; }, { passive: true });
addEventListener("touchend", e => {
  if (!touch || view !== "cal") return;
  const t = e.changedTouches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) select(sel + (dx < 0 ? 1 : -1));  // orizzontale, non scroll
}, { passive: true });

$("refresh").onclick = () => load(true);
addEventListener("hashchange", route);
route();                             // sceglie la schermata e disegna subito data e orologio, senza aspettare il server
load();
setInterval(render, 15000);          // aggiorna orologio e "adesso"
addEventListener("resize", render);   // la barra della giornata ricalcola le etichette delle ore
setInterval(() => load(), 5 * 60000); // ricarica i dati ogni 5 minuti
document.addEventListener(
  "visibilitychange",
  () => {
    if (!document.hidden) load();
  }
);
