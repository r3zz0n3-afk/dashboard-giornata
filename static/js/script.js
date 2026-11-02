const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hm = d => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const dayStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const color = c => /^[a-z]+$/.test(c || "") ? `c-${c}` : "c-gray";
let data = null;

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

const tag = ev => `<span class="tag ${color(ev.color)}">${esc(ev.calendar)}</span>`;

function eventRow(ev, now, compact) {
  let cls = "row", live = "";
  if (now) {
    if (ev.e <= now) cls += " past";
    else if (ev.s <= now) { cls += " now"; live = `<span class="live">In corso, fino alle ${hm(ev.e)}</span>`; }
  }
  const time = compact ? `<div class="t num">${hm(ev.s)}</div>`
    : `<div class="t num">${hm(ev.s)}<small>${hm(ev.e)}</small></div>`;
  const meta = [live, ev.calendar ? tag(ev) : "", ev.location ? `<span>${esc(ev.location)}</span>` : ""].filter(Boolean).join("");
  return `<div class="${cls}">${time}<div><div class="title">${esc(ev.title)}</div>${meta ? `<div class="meta">${meta}</div>` : ""}</div></div>`;
}

// La barra della giornata: ogni impegno sulla sua fascia oraria, su più corsie se si sovrappongono.
function renderStrip(timed, now) {
  if (!timed.length) { $("strip").innerHTML = ""; return; }
  const day = dayStart(now);
  const hourOf = d => (d - day) / 3600000;
  const from = Math.max(0, Math.min(8, Math.floor(Math.min(...timed.map(e => hourOf(e.s))))));
  const to = Math.min(24, Math.max(20, Math.ceil(Math.max(...timed.map(e => hourOf(e.e))))));
  const pct = h => (Math.min(Math.max(h, from), to) - from) / (to - from) * 100;

  const lanes = [];
  const blocks = [...timed].sort((a, b) => a.s - b.s).map(ev => {
    let lane = lanes.findIndex(end => end <= ev.s);
    if (lane < 0) { lane = lanes.length; lanes.push(ev.e); } else lanes[lane] = ev.e;
    const left = pct(hourOf(ev.s)), width = Math.max(pct(hourOf(ev.e)) - left, .8);
    return `<div class="ev ${color(ev.color)}${ev.e <= now ? " done" : ""}" title="${esc(ev.title)} · ${hm(ev.s)}–${hm(ev.e)}"
      style="left:${left}%;width:calc(${width}% - 2px);top:${lane * 32}px">${esc(ev.title)}</div>`;
  }).join("");

  const nowH = hourOf(now);
  const inRange = nowH >= from && nowH <= to;
  const perHour = ($("strip").clientWidth || 800) / (to - from);  // px per ora: dirada le etichette su schermi stretti
  const step = perHour >= 48 ? 1 : perHour >= 24 ? 2 : 3;
  let ticks = "";
  for (let h = from; h <= to; h += step) ticks +=`<span class="num" style="left:${pct(h)}%">${String(h % 24).padStart(2, "0")}</span>`;

  $("strip").innerHTML = `<div class="lanes" style="height:${lanes.length * 32 - 4}px">
      ${inRange ? `<div class="past-area" style="width:${pct(nowH)}%"></div>` : ""}${blocks}
      ${inRange ? `<div class="nowline" style="left:${pct(nowH)}%"></div>` : ""}
    </div><div class="hours">${ticks}</div>`;
}

function renderNow(timed, now) {
  const currents = timed.filter(e => e.s <= now && e.e > now);
  const next = timed.find(e => e.s > now);
  const then = next
    ? `<div class="then">Dopo: <b>${esc(next.title)}</b> alle ${hm(next.s)}, tra ${dur(Math.round((next.s - now) / 60000))}${next.location ? " · " + esc(next.location) : ""}</div>`
    : `<div class="then">Dopo: niente altro in calendario oggi.</div>`;
  if (currents.length) {
    const maxEnd = new Date(Math.max(...currents.map(e => e.e)));
    const minStart = new Date(Math.min(...currents.map(e => e.s)));
    const pct = Math.min(100, (now - minStart) / (maxEnd - minStart) * 100);
    const titles = currents.map(e => esc(e.title)).join(" e ");
    $("nowCard").innerHTML = `<div class="lead">${titles} <span>· mancano ${dur(Math.round((maxEnd - now) / 60000))}, fino alle ${hm(maxEnd)}</span></div>
      <div class="progress"><span style="width:${pct}%"></span></div>${then}`;
  } else {
    const lead = next ? `Libero fino alle ${hm(next.s)}` : "Libero per il resto della giornata";
    $("nowCard").innerHTML = `<div class="lead">${lead}</div>${next ? then : ""}`;
  }
}

// Meteo: adesso sotto l'orologio, domani accanto al titolo "Domani". Se non è configurato non compare.
function renderWeather() {
  const w = data.weather;
  if (!w || !w.now) {
    $("weather").innerHTML = w?.error ? `<span class="err">${esc(w.error)}</span>` : "";
    $("tomWeather").textContent = "";
    return;
  }
  const t = w.today;
  $("weather").innerHTML = `<span class="temp num">${w.now.temp}°</span> ${esc(w.now.text)}
    <span class="range num">${t.min}°–${t.max}°<span class="place"> · ${esc(w.place)}</span></span>`;
  if (w.error) $("weather").title = w.error;  // dato vecchio: l'errore resta visibile al passaggio del mouse
  const d = w.tomorrow;
  $("tomWeather").textContent = d ? `${d.text}, ${d.min}°–${d.max}°` : "";
}

function render() {
  const now = new Date();
  $("date").textContent = cap(now.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }));
  $("clock").textContent = hm(now);
  if (!data) return;

  $("alerts").innerHTML = (data.errors || []).map(e => `<div class="notice">${esc(e)}</div>`).join("");
  if (data.demo) $("date").innerHTML += '<span class="tag c-gray demo">Demo</span>';

  // Oggi
  const today = eventsOn(now);
  const allDay = today.filter(e => e.all_day), timed = today.filter(e => !e.all_day);
  $("allDay").innerHTML = allDay.map(e => `<span class="tag ${color(e.color)}">${esc(e.title)}</span>`).join("");
  $("today").innerHTML = timed.length ? timed.map(e => eventRow(e, now)).join("")
    : `<div class="empty">${allDay.length ? "Nessun impegno con orario." : "Niente in calendario oggi."}</div>`;
  $("countToday").textContent = today.length || "";

  renderNow(timed, now);
  renderStrip(timed, now);
  renderWeather();

  // Promemoria
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
  const remRow = (r, kind) => {
    let when = "";
    if (r.d) {
      const sameDay = dayStart(r.d).getTime() === tStart.getTime();
      const dayTxt = sameDay ? "oggi" : r.d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
      when = esc(r.date_only ? dayTxt : `${dayTxt} alle ${hm(r.d)}`);
      if (kind === "overdue") when = `<b>${when}</b>`;
    }
    const meta = [when, esc(r.list)].filter(Boolean).join(" · ");
    return `<div class="todo ${kind}"><div class="box"></div><div><div>${esc(r.title)}</div>${meta ? `<div class="when">${meta}</div>` : ""}</div></div>`;
  };
  const sections = [["Scaduti", "overdue"], ["Oggi", "today"], ["Prossimi", "later"], ["Senza data", "nodate"]];
  let html = "";
  for (const [label, key] of sections) {
    const list = groups[key];
    if (!list.length) continue;
    if (key !== "nodate") list.sort(byDate);
    const max = key === "later" ? 5 : 20;
    html += `<div class="group">${label}</div>` + list.slice(0, max).map(r => remRow(r, key)).join("")
      + (list.length > max ? `<div class="more">e altri ${list.length - max}</div>` : "");
  }
  $("reminders").innerHTML = html || `<div class="empty">${data.reminders_updated_at ? "Nessun promemoria da fare." : "Nessun promemoria ricevuto dall'iPhone finora."}</div>`;
  const pending = groups.overdue.length + groups.today.length;
  $("countRem").textContent = pending ? `${pending} da fare oggi` : "";

  // Domani
  const tom = eventsOn(addDays(now, 1));
  const tomAllDay = tom.filter(e => e.all_day), tomTimed = tom.filter(e => !e.all_day);
  $("tomorrow").innerHTML = tom.length
    ? (tomAllDay.length ? `<div class="tags">${tomAllDay.map(e => `<span class="tag ${color(e.color)}">${esc(e.title)}</span>`).join("")}</div>` : "")
      + `<div class="compact">${tomTimed.map(e => eventRow(e, null, true)).join("")}</div>`
    : `<div class="empty">Niente in programma.</div>`;
  $("countTom").textContent = tom.length || "";

  // Riepilogo sotto il titolo
  const left = timed.filter(e => e.e > now).length;
  const bits = [left ? `${left} ${left === 1 ? "impegno" : "impegni"} ancora da fare` : "Nessun altro impegno oggi"];
  if (groups.overdue.length) bits.push(`${groups.overdue.length} promemoria scadut${groups.overdue.length === 1 ? "o" : "i"}`);
  if (groups.today.length) bits.push(`${groups.today.length} promemoria per oggi`);
  const rain = data.weather?.rain;
  if (rain) bits.push(`pioggia probabile dalle ${rain.from} (${rain.prob}%)`);
  $("summary").textContent = bits.join(" · ");

  const ru = data.reminders_updated_at ? new Date(data.reminders_updated_at) : null;
  $("updated").textContent = `Calendario aggiornato alle ${hm(new Date(data.now))}` +
    (ru ? ` · promemoria ricevuti ${dayStart(ru).getTime() === tStart.getTime() ? "alle " + hm(ru) : ru.toLocaleDateString("it-IT") + " " + hm(ru)}` : "");
}

async function load(force) {
  const btn = $("refresh");
  if (force) { btn.classList.add("busy"); btn.disabled = true; btn.textContent = "Aggiorno"; }
  try {
    if (force) await fetch("api/refresh", { method: "POST" });
    const r = await fetch("api/dashboard", { cache: "no-store" });
    data = await r.json();
  } catch (e) {
    $("alerts").innerHTML = `<div class="notice">Server non raggiungibile: ${esc(e.message)}</div>`;
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

$("refresh").onclick = () => load(true);
render();                            // data e orologio subito, senza aspettare il server
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
