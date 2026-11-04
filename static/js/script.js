const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hm = d => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const dayStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
// Colori delle etichette (i tag di Notion). Tailwind trova le classi leggendo questo file come testo, quindi:
// - le classi vanno scritte per intero: un nome costruito a pezzi, come "bg-t-" + colore, non lo vedrebbe;
// - prima di ${...} serve uno spazio: in "bg-control${x}" vedrebbe la parola "bg-control${x}", non "bg-control".
const TAG = {
  gray: "bg-t-gray text-t-gray-ink", brown: "bg-t-brown text-t-brown-ink", orange: "bg-t-orange text-t-orange-ink",
  yellow: "bg-t-yellow text-t-yellow-ink", green: "bg-t-green text-t-green-ink", blue: "bg-t-blue text-t-blue-ink",
  pink: "bg-t-pink text-t-pink-ink", red: "bg-t-red text-t-red-ink",
};
const color = c => TAG[c] || TAG.gray;
const PILL = "inline-block max-w-full truncate rounded-[5px] px-1.5 text-xs/[22px] font-medium tracking-normal";
const DAYS = 7;  // oggi e i 6 giorni successivi, come nel server
let data = null;
let stale = false;   // true = i dati sono la copia salvata, perché homelab non risponde
let sheetFor = null; // il promemoria da mostrare nel foglio aperto da una notifica (#/promemoria/<id>)
let sel = 0;     // giorno mostrato nel Calendario: 0 = oggi, 1 = domani, ...
let view = "home";  // schermata: "home" (#/) o "cal" (#/calendario)
let open = null;    // l'evento o l'esame toccato, per mostrarne i dettagli: la sua chiave (inizio + titolo)
const keyOf = ev => ev.start + ev.title;
const ticking = new Map();  // promemoria appena spuntati: id -> timer che li toglie dopo un attimo

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
    // ogni blocco è un pulsante: toccalo per leggere il nome intero e i dettagli sotto la barra
    const on = keyOf(ev) === open;
    return `<button type="button" data-open="${esc(keyOf(ev))}" aria-expanded="${on}" aria-label="${esc(ev.title)}, ${hm(ev.s)}–${hm(ev.e)}"
      class="absolute h-7 cursor-pointer truncate rounded-md px-2 text-left text-xs/7 font-semibold transition-shadow hover:ring-2 hover:ring-black/25 ${color(ev.color)} ${on ? "z-[1] ring-2 ring-black" : isToday && ev.e <= now ? "opacity-45" : ""}"
      style="left:${left}%;width:calc(${width}% - 2px);top:${lane * 32}px">${esc(ev.title)}</button>`;
  }).join("");

  // la scheda dei dettagli dell'evento toccato: nome intero, orario, durata, luogo e calendario
  const ev = timed.find(e => keyOf(e) === open);
  const detail = ev ? `<div class="mt-4 flex items-start gap-3 rounded-xl bg-white/70 p-3.5 animate-appear">
      <div class="min-w-0 flex-1">
        <div class="font-semibold break-words">${esc(ev.title)}</div>
        <div class="mt-0.5 text-[13px] text-muted tabular-nums">${hm(ev.s)}–${hm(ev.e)} · ${dur(Math.round((ev.e - ev.s) / 60000))}${ev.location ? " · " + esc(ev.location) : ""}</div>
        ${ev.calendar ? `<div class="mt-2">${tag(ev)}</div>` : ""}
      </div>
      <button type="button" data-open="" aria-label="Chiudi" class="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-lg/none text-muted hover:bg-black/10">×</button>
    </div>` : "";

  const nowP = pct(hourOf(now));
  const perHour = (el.clientWidth || 800) / 24;  // px per ora: dirada le etichette su schermi stretti
  const step = perHour >= 48 ? 1 : perHour >= 24 ? 2 : perHour >= 12 ? 3 : 6;
  let ticks = "";
  for (let h = 0; h <= 24; h += step) ticks += `<span class="absolute top-0 -translate-x-1/2 text-xs text-muted tabular-nums first:translate-x-0 last:-translate-x-full" style="left:${pct(h)}%">${String(h).padStart(2, "0")}</span>`;

  // la linea di adesso è blu con un pallino in cima (before:), la zona già passata è velata di grigio
  el.innerHTML = `<div class="relative" style="height:${lanes.length * 32 - 4}px">
      ${isToday ? `<div class="absolute inset-y-0 left-0 rounded-l-lg bg-past" style="width:${nowP}%"></div>` : ""}${blocks}
      ${isToday ? `<div class="absolute -inset-y-1 -ml-px w-0.5 rounded-full bg-accent before:absolute before:-top-1 before:-left-1 before:size-2.5 before:rounded-full before:bg-accent" style="left:${nowP}%"></div>` : ""}
    </div><div aria-hidden="true" class="relative mt-2.5 h-[18px]">${ticks}</div>${detail}`;
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
    r.d = null;
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
    // il cerchietto è un pulsante: spuntato si riempie di nero con la ✓, e il testo si barra
    const on = ticking.has(r.id);
    return `<div class="grid grid-cols-[20px_minmax(0,1fr)] gap-3 py-2.5 ${last ? "" : "border-b border-rule"}">
      <button type="button" data-done="${esc(r.id)}" aria-pressed="${on}" aria-label="Fatto: ${esc(r.title)}"
        class="relative mt-px grid size-5 cursor-pointer place-items-center rounded-full border-[1.5px] transition-colors before:absolute before:-inset-2.5 ${on ? "border-ink bg-ink text-surface" : "border-control text-transparent hover:border-ink"}">
        <svg viewBox="0 0 12 12" aria-hidden="true" class="size-3 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"><path d="m2.5 6.2 2.3 2.3 4.7-5"/></svg></button>
      <div class="${on ? "text-muted line-through" : ""}"><div>${esc(r.title)}</div>${meta ? `<div class="text-[13px] text-muted">${meta}</div>` : ""}</div></div>`;
  };
  const sections = [["Scaduti", "overdue"], ["Oggi", "today"], ["Prossimi", "later"], ["Senza data", "nodate"]];
  let html = "";
  for (const [label, key] of sections) {
    const list = groups[key];
    if (!list.length) continue;
    if (key !== "nodate") list.sort(byDate);
    const max = key === "later" ? 5 : 20;
    const shown = list.slice(0, max);
    html += `<div class="${html ? "mt-4" : "mt-3.5"} mb-0.5 font-mono text-[11px] font-medium tracking-[.08em] text-muted uppercase">${label}</div>`
      + shown.map((r, i) => remRow(r, key, i === shown.length - 1)).join("")
      + (list.length > max ? `<div class="pt-1 pb-3 pl-8 text-[13px] text-muted">e altri ${list.length - max}</div>` : "");
  }
  $("reminders").innerHTML = html || `<div class="py-4 text-muted">Niente da fare.</div>`;
  const pending = groups.overdue.length + groups.today.length;
  $("countRem").textContent = pending ? `${pending} da fare oggi` : "";
  return groups;
}

// Gli esami futuri, dal più vicino. `days` conta i giorni di calendario: un esame domani mattina è "tra 1 giorno".
// `name` è il titolo senza "Esame" o "Esame di" davanti, che nella scheda Esami sarebbe ripetuto.
function upcomingExams(now) {
  return (data.exams || []).map(ev => ({ ...ev, s: new Date(ev.start), e: new Date(ev.end) }))
    .filter(ev => ev.e > now).sort((a, b) => a.s - b.s)
    .map(ev => ({ ...ev, days: Math.round((dayStart(ev.s) - dayStart(now)) / 86400000),
      name: cap(ev.title.replace(/^esame\s+(di\s+)?/i, "") || ev.title) }));
}

// Il conto alla rovescia: un blocco pastello per esame, come i foglietti di Figma, col numero grande dei giorni.
// Corallo quando manca meno di una settimana, gli altri si alternano fra lilla, menta e crema.
const EXAM_BG = ["bg-lilac", "bg-mint", "bg-cream"];
function renderExams(now) {
  const box = $("exams");
  box.hidden = !Array.isArray(data.exams);  // null = esami non configurati nel server
  if (box.hidden) return [];
  const exams = upcomingExams(now);
  $("examCount").textContent = exams.length || "";
  $("examList").innerHTML = exams.length ? exams.slice(0, 8).map((ev, i) => {
    const bg = ev.days < 7 ? "bg-coral" : EXAM_BG[i % EXAM_BG.length];
    const big = ev.days === 0 ? "Oggi" : ev.days === 1 ? "Domani" : ev.days;
    const unit = ev.days > 1 ? `<span class="ml-1 text-[15px] font-normal tracking-normal text-muted">giorni</span>` : "";
    const when = cap(ev.s.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" }).replaceAll(".", ""))
      + (ev.all_day ? "" : ` · ${hm(ev.s)}`);
    // toccando la scheda il nome e l'aula vanno a capo invece di essere tagliati con i puntini
    const on = keyOf(ev) === open, cut = on ? "break-words" : "truncate";
    return `<button type="button" data-open="${esc(keyOf(ev))}" aria-expanded="${on}"
      class="note w-[44%] min-w-[150px] shrink-0 cursor-pointer snap-start p-4 text-left md:w-auto md:min-w-0 md:p-5 ${bg}">
      <div class="font-mono text-[11px] tracking-[.06em] text-muted uppercase tabular-nums">${esc(when)}</div>
      <div class="mt-2 text-[40px]/none font-light tracking-[-.04em] tabular-nums">${big}${unit}</div>
      <div class="mt-4 font-semibold tracking-[-.015em] ${cut}" title="${esc(ev.title)}">${esc(on ? ev.title : ev.name)}</div>
      <div class="text-[13px] text-muted ${cut}">${esc(ev.location) || "&nbsp;"}</div></button>`;
  }).join("") : `<div class="card w-full px-4 py-4 text-muted md:col-span-4 md:px-5">Nessun esame in calendario nei prossimi mesi.</div>`;
  return exams;
}

function summary(day, isToday, timed, groups, now, exams = []) {
  const bits = [];
  if (isToday) {
    const ex = exams[0];  // il prossimo esame entra nel riepilogo solo quando è vicino
    if (ex && ex.days <= 3) bits.push(ex.days === 0 ? `Esame di ${ex.name} oggi` : ex.days === 1 ? `Esame di ${ex.name} domani` : `Esame di ${ex.name} tra ${ex.days} giorni`);
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

  $("alerts").innerHTML = (data.errors || []).map(notice).join("") + (stale ? offlineNote() : "");
  if (data.demo) $("date").innerHTML += `<span class="${PILL} ${TAG.gray} ml-2.5 align-[6px]">Demo</span>`;
  renderWeather();
  const groups = renderReminders(now);
  const d = split(day);
  let exams = [];

  if (view === "home") {
    renderNow($("hNow"), d.timed, now);
    exams = renderExams(now);
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
  $("summary").textContent = summary(day, isToday, d.timed, groups, now, exams);
  if (sheetFor && !stale) openSheet();  // aspetta i dati veri: nella copia salvata il promemoria potrebbe essere vecchio

  const ru = data.reminders_updated_at ? new Date(data.reminders_updated_at) : null;
  $("updated").textContent = `Calendario aggiornato alle ${hm(new Date(data.now))}` +
    (ru ? ` · promemoria ricevuti ${dayStart(ru).getTime() === today.getTime() ? "alle " + hm(ru) : ru.toLocaleDateString("it-IT") + " " + hm(ru)}` : "");
}

// Le due schermate stanno nella stessa pagina: l'indirizzo dopo # dice quale mostrare.
// Così funzionano il tasto indietro e i preferiti, senza bisogno di un framework.
function route() {
  const m = location.hash.match(/^#\/promemoria\/(.+)$/);  // aperto da una notifica: la Home con il foglio del promemoria
  if (m) sheetFor = decodeURIComponent(m[1]);
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

// Apertura immediata: al primo caricamento la pagina mostra subito l'ultima copia dei dati salvata dal service worker
// (sw.js), poi chiede quelli nuovi al server. Se il server non risponde, resta la copia con la scritta "offline".
async function load(force) {
  const btn = $("refresh");
  if (force) { btn.classList.add("busy"); btn.disabled = true; btn.textContent = "Aggiorno"; }
  if (!data && "caches" in window) {
    const saved = await caches.match("api/dashboard").catch(() => null);
    if (saved) {
      data = await saved.json();
      stale = true;  // finché non arriva la risposta del server
      render();
      hideSplash(0);  // c'è già qualcosa da mostrare: niente attesa
    }
  }
  try {
    if (force) await fetch("api/refresh", { method: "POST" });
    // dopo 8 secondi lascia perdere: se homelab è spento la richiesta potrebbe restare appesa a lungo
    const r = await fetch("api/dashboard", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(r.status);
    data = await r.json();
    stale = false;
  } catch (e) {
    if (data) stale = true;
    else $("alerts").innerHTML = notice(`Server non raggiungibile: ${e.message}`);
  }
  render();
  hideSplash(SPLASH_MIN);
  if (force) { btn.classList.remove("busy"); btn.disabled = false; btn.textContent = "Aggiorna"; }
}

// Primo caricamento finito: la schermata d'apertura svanisce e il contenuto compare con una dissolvenza.
// Resta almeno `min` ms, così non fa solo un lampo quando i dati arrivano subito.
async function hideSplash(min) {
  if (!document.body.classList.contains("loading")) return;
  await new Promise(r => setTimeout(r, Math.max(0, min - (Date.now() - started))));
  document.body.classList.remove("loading");
  document.querySelector("main").removeAttribute("aria-busy");
}

// La scritta quando i dati sono la copia salvata: grigia, non rossa, perché non è un errore ma un'informazione.
function offlineNote() {
  const at = new Date(data.now), today = dayStart(new Date()).getTime() === dayStart(at).getTime();
  const when = today ? `alle ${hm(at)}` : `il ${at.toLocaleDateString("it-IT", { day: "numeric", month: "long" })} alle ${hm(at)}`;
  return `<div role="status" class="mt-5 flex items-center gap-2.5 rounded-[14px] bg-active px-4 py-3.5 text-sm text-muted md:px-5">
    <span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-control"></span>
    Homelab non risponde: dati aggiornati ${when}.</div>`;
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

// Tocco su un evento della barra o su un esame: apre i dettagli; di nuovo, sulla × o altrove, li chiude.
document.addEventListener("click", e => {
  const b = e.target.closest("[data-open]");
  const next = b ? (b.dataset.open === open ? null : b.dataset.open || null) : null;
  if (next === open) return;
  open = next;
  render();
});
addEventListener("keydown", e => { if (e.key === "Escape" && open) { open = null; render(); } });

// Spuntare un promemoria: si riempie subito, e dopo 1,5 secondi sparisce e il server lo segna come fatto.
// Se lo tocchi di nuovo prima, ci ripensi e non succede niente.
$("reminders").onclick = e => {
  const b = e.target.closest("[data-done]");
  if (!b) return;
  const id = b.dataset.done;
  if (ticking.has(id)) { clearTimeout(ticking.get(id)); ticking.delete(id); render(); return; }
  ticking.set(id, setTimeout(async () => {
    try {
      const r = await fetch(`api/todos/${encodeURIComponent(id)}/done`, { method: "POST" });
      if (!r.ok) throw new Error(r.status);
      data.reminders = data.reminders.filter(x => x.id !== id);
    } catch (err) {
      $("alerts").innerHTML = notice(`Non sono riuscito a spuntare il promemoria: ${err.message}`);
    }
    ticking.delete(id);
    render();
  }, 1500));
  render();
};

// Il foglio di un promemoria, aperto toccando la sua notifica: su iPhone le notifiche web non hanno pulsanti,
// quindi "Fatto" e "Tra 10 minuti" stanno qui. È un <dialog>: il browser gestisce già il focus, Esc e VoiceOver.
let sheetRid = null;
function openSheet() {
  if (!sheetFor || !data) return;
  const r = data.reminders.find(x => x.id === sheetFor);
  sheetFor = null;
  history.replaceState(null, "", "#/");  // ricaricando la pagina il foglio non si riapre
  if (!r) {
    $("alerts").insertAdjacentHTML("beforeend", notice("Questo promemoria non c'è più: forse l'hai già fatto."));
    return;
  }
  sheetRid = r.id;
  $("sheetTitle").textContent = r.title;
  const due = r.due ? new Date(r.due) : null;
  $("sheetDue").textContent = due ? (r.date_only ? due.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })
    : `${dayStart(due).getTime() === dayStart(new Date()).getTime() ? "Oggi" : cap(due.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }))} alle ${hm(due)}`) : "Senza data";
  if (!$("sheet").open) $("sheet").showModal();
}
async function sheetAction(kind) {
  const btn = $(kind === "done" ? "sheetDone" : "sheetSnooze");
  btn.disabled = true;
  try {
    const r = await fetch(`api/todos/${encodeURIComponent(sheetRid)}/${kind}`, { method: "POST" });
    if (!r.ok) throw new Error(r.status);
    if (kind === "done") data.reminders = data.reminders.filter(x => x.id !== sheetRid);
    else $("alerts").insertAdjacentHTML("beforeend", `<div role="status" class="mt-5 rounded-[14px] bg-active px-4 py-3.5 text-sm text-muted md:px-5">Te lo ricordo alle ${hm(new Date((await r.json()).at))}.</div>`);
    $("sheet").close();
    if (kind === "done") render();
  } catch (err) {
    $("sheetError").textContent = `Non ci sono riuscito (${err.message}). Riprova.`;
  }
  btn.disabled = false;
}
$("sheetDone").onclick = () => sheetAction("done");
$("sheetSnooze").onclick = () => sheetAction("snooze");
$("sheetClose").onclick = () => $("sheet").close();
$("sheet").onclose = () => { $("sheetError").textContent = ""; };
$("sheet").onclick = e => { if (e.target === $("sheet")) $("sheet").close(); };  // tocco sullo sfondo scuro: chiude
// la pagina era già aperta: il service worker ci dice quale promemoria mostrare
navigator.serviceWorker?.addEventListener("message", e => {
  if (e.data?.reminder) { sheetFor = e.data.reminder; openSheet(); }
});

// Aggiungere un promemoria: "+ Nuovo promemoria" apre il modulo, Annulla (o Esc) lo chiude.
function addForm(show) {
  $("addForm").hidden = !show;
  $("addOpen").hidden = show;
  if (show) $("addTitle").focus(); else $("addForm").reset();
}
$("addOpen").onclick = () => addForm(true);
$("addCancel").onclick = () => addForm(false);
$("addForm").onkeydown = e => { if (e.key === "Escape") addForm(false); };
$("addForm").onsubmit = async e => {
  e.preventDefault();  // senza questo il browser ricaricherebbe la pagina
  const btn = e.target.querySelector("[type=submit]"), f = new FormData(e.target);
  btn.disabled = true;
  try {
    const r = await fetch("api/todos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: f.get("title"), date: f.get("date"), time: f.get("date") ? f.get("time") : "" }),
    });
    if (!r.ok) throw new Error(r.status);
    data.reminders.push((await r.json()).item);
    addForm(false);
    render();
  } catch (err) {
    $("alerts").innerHTML = notice(`Non sono riuscito ad aggiungere il promemoria: ${err.message}`);
  }
  btn.disabled = false;
};

// Notifiche. Tre passi: registrare il service worker (sw.js), chiedere il permesso, iscriversi al servizio push
// del telefono con la chiave pubblica del server; l'iscrizione (endpoint + chiavi) va poi al server, che la usa per scrivere.
// Su iPhone funziona solo in https e con la dashboard aggiunta alla schermata Home.
const PUSH_BTN = "h-11 cursor-pointer rounded-full border border-rule px-4 text-sm font-medium text-ink transition hover:bg-active active:scale-96 disabled:opacity-50 md:h-8";
// il service worker si registra sempre (serve anche per aprire la pagina senza rete); le notifiche solo dove esistono
const swReg = "serviceWorker" in navigator ? navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready) : null;
const swReady = "PushManager" in window ? swReg : null;
const postJSON = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then(r => { if (!r.ok) throw new Error(r.status); return r; });
// la chiave del server è in base64 "per URL": il browser la vuole come byte
const keyBytes = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

async function renderPush() {
  const el = $("push");
  if (!swReady) {
    el.innerHTML = `<span>${isSecureContext ? "Per le notifiche aggiungi la dashboard alla schermata Home" : "Per le notifiche apri la dashboard in https"}</span>`;
    return;
  }
  if (Notification.permission === "denied") {
    el.innerHTML = "<span>Notifiche bloccate: riattivale nelle Impostazioni</span>";
    return;
  }
  const sub = await (await swReady).pushManager.getSubscription();
  if (sub) postJSON("api/push/subscribe", sub.toJSON()).catch(() => {});  // ricorda al server l'iscrizione, se l'avesse persa
  el.innerHTML = sub
    ? `<button type="button" data-push="test" class="${PUSH_BTN}">Prova notifica</button>
       <button type="button" data-push="off" class="${PUSH_BTN}">Disattiva notifiche</button>`
    : `<button type="button" data-push="on" class="${PUSH_BTN}">Attiva notifiche</button>`;
}

$("push").onclick = async e => {
  const btn = e.target.closest("[data-push]");
  if (!btn) return;
  btn.disabled = true;
  try {
    if (btn.dataset.push === "on") {
      // il permesso va chiesto subito dopo il tocco: iOS non lo mostra se prima si aspetta altro
      if (await Notification.requestPermission() === "granted") {
        const { key } = await (await fetch("api/push/key")).json();
        const sub = await (await swReady).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
        await postJSON("api/push/subscribe", sub.toJSON());
        await postJSON("api/push/test", { endpoint: sub.endpoint });
      }
    } else {
      const sub = await (await swReady).pushManager.getSubscription();
      if (btn.dataset.push === "test") await postJSON("api/push/test", { endpoint: sub.endpoint });
      else if (sub) {
        await postJSON("api/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
    }
  } catch (err) {
    $("alerts").innerHTML = notice(`Notifiche: qualcosa non ha funzionato (${err.message})`);
  }
  renderPush();
};

// Spotify: una scheda scura in stile Spotify nella Home, sopra i Promemoria. La pagina chiede al server cosa suona
// ogni 10 secondi; nel frattempo la barra avanza da sola, calcolata dal momento dell'ultima risposta.
// La scheda si ridisegna solo se cambia qualcosa (brano, pausa, dispositivo).
// Accessibilità: pulsanti di almeno 44 px con un nome per VoiceOver, contorno verde quando ci arrivi con la tastiera,
// il focus resta sul pulsante dopo play/pausa, l'equalizzatore si ferma se in iOS è attivo "Riduci movimento".
let music = null, musicAt = 0, musicSig = "";
// dopo play/pausa Spotify ci mette un attimo ad aggiornarsi: per 4 secondi vale quello che hai toccato tu,
// così l'icona non torna indietro e poi avanti
let musicHold = null;  // {playing, until}
const mmss = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const SVG = (d, size = "size-5") => `<svg viewBox="0 0 24 24" aria-hidden="true" class="${size} fill-current"><path d="${d}"/></svg>`;
const ICON = {
  play: SVG("M8 5.5v13l11-6.5z", "size-6"), pause: SVG("M7 5h3.5v14H7zM13.5 5H17v14h-3.5z", "size-6"),
  next: SVG("M6 5.5v13l9-6.5zM16.5 5H19v14h-2.5z"), previous: SVG("M18 5.5v13L9 12zM5 5h2.5v14H5z"),
};
// il logo di Spotify: cerchio verde con tre onde
const LOGO = (size = "size-6") => `<svg viewBox="0 0 24 24" aria-hidden="true" class="${size} shrink-0"><circle cx="12" cy="12" r="12" class="fill-spotify"/>
  <path d="M6.3 9.2c3.9-1.1 8.2-.8 11.4 1.2M6.9 12.4c3.2-.9 6.8-.6 9.6 1.1M7.5 15.4c2.6-.7 5.3-.4 7.5.9" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round"/></svg>`;
// le barrette dell'equalizzatore accanto a "In ascolto"
const EQ = `<span aria-hidden="true" class="flex h-3 shrink-0 items-end gap-[2px] *:h-full *:w-[3px] *:origin-bottom *:animate-eq *:rounded-full *:bg-spotify motion-reduce:*:animate-none">
  <span></span><span class="[animation-delay:-.45s]"></span><span class="[animation-delay:-.2s]"></span></span>`;
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify";
const SKIP = `grid size-11 cursor-pointer place-items-center rounded-full text-spotify-muted transition hover:text-white active:scale-90 ${FOCUS}`;
const GREEN = `inline-flex h-11 items-center rounded-full bg-spotify px-6 text-sm font-bold text-black transition hover:scale-104 active:scale-96 ${FOCUS}`;
const musicPos = () => Math.min(music.track.duration, music.progress + (music.playing ? Date.now() - musicAt : 0));

async function loadMusic() {
  try {
    music = await (await fetch("api/spotify", { cache: "no-store" })).json();
    // il server può rispondere con una lettura di qualche secondo fa (age, in ms): la barra parte da lì, senza salti
    musicAt = Date.now() - (music?.age || 0);
    if (musicHold && music?.track) {
      if (Date.now() > musicHold.until || music.playing === musicHold.playing) musicHold = null;
      else music.playing = musicHold.playing;
    }
  } catch { return; }  // server irraggiungibile: lo segnala già il resto della pagina
  renderMusic();
}

function renderMusic() {
  const m = music, card = $("musicCard");
  $("music").hidden = !m;
  const sig = JSON.stringify(m && { ...m, progress: 0, age: 0 });
  if (!m || sig === musicSig) return tickMusic();
  musicSig = sig;
  if (!m.connected || m.error || !m.track) {
    card.innerHTML = `<div class="flex flex-wrap items-center gap-3">${LOGO()}
      <p class="min-w-0 flex-1 text-sm text-spotify-muted">${!m.connected ? "Collega il tuo account per vedere cosa ascolti." : esc(m.error ? "Spotify non raggiungibile." : "Niente in ascolto.")}</p>
      ${!m.connected ? `<a href="api/spotify/login" class="${GREEN}">Collega Spotify</a>` : ""}</div>`;
    return;
  }
  const t = m.track, when = m.played_at ? new Date(m.played_at) : null;
  const ago = when ? (dayStart(when).getTime() === dayStart(new Date()).getTime() ? "oggi alle " + hm(when) : when.toLocaleDateString("it-IT", { day: "numeric", month: "long" })) : "";
  const status = m.last ? `Ultimo ascolto${ago ? " · " + ago : ""}` : `${m.playing ? "In ascolto" : "In pausa"}${m.device ? " su " + m.device : ""}`;
  // il pulsante che aveva il focus (es. play) viene ricreato: dopo il ridisegno il focus torna sul nuovo
  const focused = document.activeElement?.dataset?.cmd;
  card.innerHTML = `
    <div class="flex items-start gap-4">
      ${t.image ? `<img src="${esc(t.image)}" alt="" class="size-20 shrink-0 rounded-[8px] object-cover shadow-[0_8px_24px_rgba(0,0,0,.5)]">`
        : `<span class="block size-20 shrink-0 rounded-[8px] bg-white/10"></span>`}
      <div class="min-w-0 flex-1">
        <p class="flex items-center gap-1.5 text-xs font-bold ${m.playing ? "text-spotify" : "text-spotify-muted"}">${m.playing ? EQ : ""}<span class="truncate">${esc(status)}</span></p>
        <p class="mt-1 line-clamp-2 text-base/snug font-bold">${esc(t.title)}</p>
        <p class="mt-0.5 line-clamp-1 text-sm text-spotify-muted">${esc(t.artist)}</p>
      </div>
      <a href="${esc(t.url)}" target="_blank" rel="noopener" aria-label="Apri ${esc(t.title)} in Spotify"
        class="-mt-2.5 -mr-2.5 grid size-11 shrink-0 place-items-center rounded-full transition hover:scale-108 ${FOCUS}">${LOGO()}</a>
    </div>
    ${m.last ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" class="mt-4 ${GREEN}">Apri in Spotify</a>` : `
    <div class="mt-4">
      <div id="mBar" role="progressbar" aria-label="Avanzamento del brano" aria-valuemin="0" aria-valuemax="${Math.round(t.duration / 1000)}"
        class="h-1 overflow-hidden rounded-full bg-white/25"><div id="mFill" class="h-full rounded-full bg-white transition-[width] duration-1000 ease-linear motion-reduce:transition-none"></div></div>
      <div aria-hidden="true" class="mt-1.5 flex justify-between text-[11px] text-spotify-muted tabular-nums"><span id="mPos"></span><span>${mmss(t.duration)}</span></div>
    </div>
    <div class="mt-1 flex items-center justify-center gap-4">
      <button type="button" data-cmd="previous" aria-label="Brano precedente" class="${SKIP}">${ICON.previous}</button>
      <button type="button" data-cmd="${m.playing ? "pause" : "play"}" aria-label="${m.playing ? "Metti in pausa" : "Riproduci"}"
        class="grid size-14 cursor-pointer place-items-center rounded-full bg-spotify text-black transition hover:scale-104 active:scale-92 ${FOCUS}">${m.playing ? ICON.pause : ICON.play}</button>
      <button type="button" data-cmd="next" aria-label="Brano successivo" class="${SKIP}">${ICON.next}</button>
    </div>`}`;
  if (focused) card.querySelector(focused === "play" || focused === "pause" ? "[data-cmd=play],[data-cmd=pause]" : `[data-cmd=${focused}]`)?.focus();
  // VoiceOver: annuncia il cambio di brano o di stato, non ogni aggiornamento
  const say = m.last ? "" : `${m.playing ? "In ascolto" : "In pausa"}: ${t.title}, ${t.artist}`;
  if ($("musicStatus").textContent !== say) $("musicStatus").textContent = say;
  tickMusic();
}

// ogni secondo: solo il tempo e la barra, senza ridisegnare il resto
function tickMusic() {
  if (!music?.track || music.last || !$("mPos")) return;
  const pos = musicPos();
  $("mPos").textContent = mmss(pos);
  $("mFill").style.width = `${music.track.duration ? pos / music.track.duration * 100 : 0}%`;
  $("mBar").setAttribute("aria-valuenow", Math.round(pos / 1000));
  $("mBar").setAttribute("aria-valuetext", `${mmss(pos)} di ${mmss(music.track.duration)}`);
}

$("musicCard").onclick = async e => {
  const btn = e.target.closest("[data-cmd]");
  if (!btn) return;
  const cmd = btn.dataset.cmd;
  if (cmd === "play" || cmd === "pause") {  // cambia subito l'icona, senza aspettare Spotify
    music = { ...music, progress: musicPos(), playing: cmd === "play" };
    musicAt = Date.now();
    musicHold = { playing: music.playing, until: Date.now() + 4000 };
    renderMusic();
  }
  try {
    const r = await fetch(`api/spotify/${cmd}`, { method: "POST" });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Spotify: errore ${r.status}`);
  } catch (err) {
    musicHold = null;  // il comando non è andato: torna a mostrare lo stato vero
    $("alerts").innerHTML = notice(err.message);
  }
  // Spotify ci mette un attimo ad aggiornare lo stato (soprattutto il brano dopo "avanti"): controlla due volte
  setTimeout(loadMusic, 600);
  setTimeout(loadMusic, 1800);
};

$("refresh").onclick = () => { load(true); loadMusic(); };
renderPush();
loadMusic();
setInterval(tickMusic, 1000);
setInterval(() => { if (!document.hidden && view === "home") loadMusic(); }, 10000);  // solo nella Home
addEventListener("hashchange", route);
route();                             // sceglie la schermata e disegna subito data e orologio, senza aspettare il server
load();
setInterval(render, 15000);          // aggiorna orologio e "adesso"
addEventListener("resize", render);   // la barra della giornata ricalcola le etichette delle ore
setInterval(() => load(), 5 * 60000); // ricarica i dati ogni 5 minuti
document.addEventListener(
  "visibilitychange",
  () => {
    if (!document.hidden) { load(); loadMusic(); }
  }
);
