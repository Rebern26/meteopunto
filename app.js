/**
 * ═══════════════════════════════════════════════════════════
 * METEOPUNTO.COM – app.js  |  FASE 3
 * Previsioni reali fino a 16 giorni · 4 fasce orarie · 4 servizi
 * ═══════════════════════════════════════════════════════════
 */

"use strict";

/* ═══════════════════════════════════════
   CONFIGURAZIONE
═══════════════════════════════════════ */
const CONFIG = {
  GEO_URL: "https://geocoding-api.open-meteo.com/v1/search",
  METEO_URL: "https://api.open-meteo.com/v1/forecast",
  MARINE_URL: "https://marine-api.open-meteo.com/v1/marine",
  FORECAST_DAYS: 16,
  DEBOUNCE_MS: 350,
  MIN_CHARS: 3,
  MAX_RESULTS: 8,
  LANGUAGE: "it",
  // Ore delle 4 fasce orarie (indice nell'array hourly)
  FASCE: [
    { key: "notte", label: "NOTTE", hour: 3, icon: "🌙", cssClass: "notte" },
    {
      key: "mattina",
      label: "MATTINA",
      hour: 9,
      icon: "🌅",
      cssClass: "mattina",
    },
    {
      key: "pomeriggio",
      label: "POMERIGGIO",
      hour: 15,
      icon: "☀️",
      cssClass: "pomeriggio",
    },
    { key: "sera", label: "SERA", hour: 21, icon: "🌆", cssClass: "sera" },
  ],
};

/* ═══════════════════════════════════════
   STATO GLOBALE
═══════════════════════════════════════ */
const state = {
  selectedLocation: null, // {name, region, country, latitude, longitude, elevation, timezone}
  weatherData: null, // risposta grezza API Open-Meteo
  marineData: null, // risposta grezza API Marine (null se entroterra)
  selectedDayIdx: 0, // indice del giorno selezionato (0=Oggi … 15)
  activeService: "forecast", // tab servizio attivo
  menuOpen: false,
  abortController: null,
};

/* ═══════════════════════════════════════
   DOM REFS
═══════════════════════════════════════ */
const dom = {
  searchInput: document.getElementById("city-search"),
  autocompleteList: document.getElementById("autocomplete-list"),
  searchBtn: document.querySelector(".search-btn"),
  currentWeatherPanel: document.getElementById("current-weather-panel"),
  forecastSection: document.getElementById("forecast-section"),
  dayTabs: document.getElementById("day-tabs"),
  timeslotGrid: document.getElementById("timeslot-grid"),
  servicePanel: document.getElementById("service-panel"),
  serviceTabs: document.querySelectorAll(".service-tab"),
  hamburger: document.querySelector(".hamburger"),
  mobileMenu: document.getElementById("mobile-menu"),
  tagButtons: document.querySelectorAll(".tag-btn"),
};

/* ═══════════════════════════════════════
   UTILITÀ
═══════════════════════════════════════ */
function debounce(fn, wait) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Converte il WMO weather code in {label, icon}
 * Mappatura SEVERA: progressione corretta 0→1→2→3
 * e tutti i codici di precipitazione/neve/temporale distinti.
 */
function wmoToCondition(code) {
  const map = {
    // ── Sereno / Nuvolosità progressiva ──────────────────
    0: { label: "Cielo sereno", icon: "☀️" }, // 0–10% nuv.
    1: { label: "Poco nuvoloso", icon: "🌤️" }, // 10–30% nuv.
    2: { label: "Parzialmente nuvoloso", icon: "⛅" }, // 30–70% nuv.
    3: { label: "Coperto", icon: "☁️" }, // 70–100% nuv.
    // ── Nebbia ───────────────────────────────────────────
    45: { label: "Nebbia", icon: "🌫️" },
    48: { label: "Nebbia gelata", icon: "🌫️" },
    // ── Pioggerella (drizzle) ─────────────────────────────
    51: { label: "Pioggerella leggera", icon: "🌦️" },
    53: { label: "Pioggerella moderata", icon: "🌦️" },
    55: { label: "Pioggerella intensa", icon: "🌧️" },
    56: { label: "Pioggerella gelata lieve", icon: "🌧️" },
    57: { label: "Pioggerella gelata", icon: "🌧️" },
    // ── Pioggia ──────────────────────────────────────────
    61: { label: "Pioggia leggera", icon: "🌧️" },
    63: { label: "Pioggia moderata", icon: "🌧️" },
    65: { label: "Pioggia intensa", icon: "🌧️" },
    66: { label: "Pioggia gelata lieve", icon: "🌧️" },
    67: { label: "Pioggia gelata", icon: "🌧️" },
    // ── Neve ─────────────────────────────────────────────
    71: { label: "Neve leggera", icon: "🌨️" },
    73: { label: "Neve moderata", icon: "❄️" },
    75: { label: "Neve intensa", icon: "❄️" },
    77: { label: "Granelli di neve", icon: "🌨️" },
    // ── Rovesci ──────────────────────────────────────────
    80: { label: "Rovesci leggeri", icon: "🌦️" },
    81: { label: "Rovesci moderati", icon: "🌧️" },
    82: { label: "Rovesci violenti", icon: "⛈️" },
    85: { label: "Rovesci di neve", icon: "🌨️" },
    86: { label: "Forti rovesci di neve", icon: "❄️" },
    // ── Temporali ────────────────────────────────────────
    95: { label: "Temporale", icon: "⛈️" },
    96: { label: "Temporale con grandine", icon: "⛈️" },
    99: { label: "Temporale violento", icon: "🌩️" },
  };
  return map[code] ?? { label: "N/D", icon: "❓" };
}

/**
 * NOWCASTING – sovrascrittura condizione con dati reali
 * Usato per la fascia oraria corrente nel giorno "Oggi".
 *
 * Regole (in ordine di priorità):
 * 1. Se c'è precipitazione reale > 0 → usa WMO code corrente
 * 2. Se cloud_cover reale > 70%      → forza "Coperto" (code 3)
 * 3. Se cloud_cover reale > 30%      → forza "Parzialmente nuvoloso" (code 2)
 * 4. Altrimenti → lascia la previsione oraria invariata
 *
 * @param {object} currentData  - data.current dell'API
 * @param {object} hourlyCondit - condizione oraria già calcolata
 * @returns {object} condizione corretta {label, icon}
 */
function applyNowcasting(currentData, hourlyCondit) {
  if (!currentData) return hourlyCondit;

  const precip = currentData.precipitation ?? 0;
  const cloudCover = currentData.cloud_cover ?? 0;
  const wmoCode = currentData.weather_code ?? null;

  // Priorità 1: pioggia/neve in atto → usa il WMO attuale
  if (precip > 0 && wmoCode !== null) {
    const realCond = wmoToCondition(wmoCode);
    console.log(`[Nowcasting] Precipitazione ${precip}mm → ${realCond.label}`);
    return realCond;
  }

  // Priorità 2: copertura nuvolosa > 70% → Coperto
  if (cloudCover > 70) {
    console.log(`[Nowcasting] Cloud cover ${cloudCover}% > 70% → Coperto`);
    return { label: "Coperto", icon: "☁️" };
  }

  // Priorità 3: copertura nuvolosa > 30% → Parzialmente nuvoloso
  if (cloudCover > 30) {
    console.log(
      `[Nowcasting] Cloud cover ${cloudCover}% > 30% → Parzialmente nuvoloso`,
    );
    return { label: "Parzialmente nuvoloso", icon: "⛅" };
  }

  // Nessuna sovrascrittura necessaria
  return hourlyCondit;
}

/** Converte gradi meteorologici in sigla direzione vento */
function degToDir(deg) {
  const dirs = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSO",
    "SO",
    "OSO",
    "O",
    "ONO",
    "NO",
    "NNO",
  ];
  return dirs[Math.round(deg / 22.5) % 16];
}

/** Colore e label per indice UV */
function uvMeta(idx) {
  if (idx <= 2) return { label: "Basso", color: "#2ECC71" };
  if (idx <= 5) return { label: "Moderato", color: "#F1C40F" };
  if (idx <= 7) return { label: "Alto", color: "#FF8C00" };
  if (idx <= 10) return { label: "Molto alto", color: "#E74C3C" };
  return { label: "Estremo", color: "#9B59B6" };
}

/** Formatta data nel formato "Lun 23" */
function formatDayLabel(dateStr, idx) {
  if (idx === 0) return { name: "Oggi", date: "" };
  if (idx === 1) return { name: "Domani", date: "" };
  const d = new Date(dateStr);
  const days = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
  return { name: days[d.getDay()], date: d.getDate().toString() };
}

function formatLocationLabel(r) {
  const parts = [];
  if (r.admin1) parts.push(r.admin1);
  if (r.admin2 && r.admin2 !== r.admin1) parts.push(r.admin2);
  if (r.country && r.country !== "Italia" && r.country !== "Italy")
    parts.push(r.country);
  return parts.join(", ") || r.country || "";
}

function highlightMatch(text, query) {
  const escaped = escapeHtml(text);
  const re = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );
  return escaped.replace(re, "<mark>$1</mark>");
}

/* ═══════════════════════════════════════
   API – GEOCODING
═══════════════════════════════════════ */
async function fetchLocations(query) {
  if (state.abortController) state.abortController.abort();
  state.abortController = new AbortController();
  const params = new URLSearchParams({
    name: query.trim(),
    count: CONFIG.MAX_RESULTS,
    language: CONFIG.LANGUAGE,
    format: "json",
  });
  try {
    showAutocompleteLoading();
    const res = await fetch(`${CONFIG.GEO_URL}?${params}`, {
      signal: state.abortController.signal,
    });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    return data.results || [];
  } catch (e) {
    if (e.name === "AbortError") return null;
    showAutocompleteError();
    return [];
  }
}

/* ═══════════════════════════════════════
   API – METEO 16 GIORNI (Open-Meteo)
═══════════════════════════════════════ */
async function fetchWeather(loc) {
  const params = new URLSearchParams({
    latitude: loc.latitude,
    longitude: loc.longitude,
    // ── Dati correnti in tempo reale (Nowcasting) ──────────
    current: [
      "temperature_2m",
      "weather_code",
      "cloud_cover",
      "precipitation",
      "wind_speed_10m",
      "wind_direction_10m",
      "apparent_temperature",
      "relative_humidity_2m",
    ].join(","),
    hourly: [
      "temperature_2m",
      "apparent_temperature",
      "weathercode",
      "windspeed_10m",
      "winddirection_10m",
      "uv_index",
      "relativehumidity_2m",
      "cloud_cover", // aggiunto per nowcasting fasce orarie
    ].join(","),
    daily: [
      "weathercode",
      "temperature_2m_max",
      "temperature_2m_min",
      "sunrise",
      "sunset",
      "uv_index_max",
      "windspeed_10m_max",
    ].join(","),
    current_weather: "true",
    timezone: loc.timezone || "Europe/Rome",
    wind_speed_unit: "kmh",
    forecast_days: CONFIG.FORECAST_DAYS,
  });
  const res = await fetch(`${CONFIG.METEO_URL}?${params}`);
  if (!res.ok) throw new Error("Errore API meteo: " + res.status);
  return res.json();
}

/* ═══════════════════════════════════════
   API – MARINE (Open-Meteo Marine)
   Se la località è nell'entroterra l'API
   restituirà dati nulli o errore → lo gestiamo.
═══════════════════════════════════════ */
async function fetchMarine(loc) {
  const params = new URLSearchParams({
    latitude: loc.latitude,
    longitude: loc.longitude,
    hourly: "wave_height,wave_direction,wave_period,wind_wave_height",
    timezone: loc.timezone || "Europe/Rome",
    forecast_days: CONFIG.FORECAST_DAYS,
  });
  try {
    const res = await fetch(`${CONFIG.MARINE_URL}?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    // Se tutti i valori sono null = entroterra
    const hasData = data.hourly?.wave_height?.some((v) => v !== null);
    return hasData ? data : null;
  } catch {
    return null; // silenziosamente: entroterra o errore rete
  }
}

/* ═══════════════════════════════════════
   CARICAMENTO PRINCIPALE
═══════════════════════════════════════ */
async function loadWeatherData(loc) {
  showDashboardLoading();
  try {
    // Le due chiamate partono in parallelo
    const [weather, marine] = await Promise.all([
      fetchWeather(loc),
      fetchMarine(loc),
    ]);
    state.weatherData = weather;
    state.marineData = marine;
    state.selectedDayIdx = 0;
    state.activeService = "forecast";

    renderCurrentWeather(weather, loc);
    renderForecastSection(weather, marine, loc);
  } catch (err) {
    console.error("MeteoPunto – Errore caricamento:", err);
    dom.currentWeatherPanel.innerHTML = `
      <div class="card-empty-state">
        <span class="empty-icon">⚠️</span>
        <p>Errore nel caricamento dei dati. Riprova tra poco.</p>
      </div>`;
  }
}

/* ═══════════════════════════════════════
   RENDER – METEO ATTUALE
═══════════════════════════════════════ */
function renderCurrentWeather(data, loc) {
  const cw = data.current_weather;
  const cur = data.current; // dati nowcasting in tempo reale
  const sublabel = loc.region ? `${loc.region}, ${loc.country}` : loc.country;

  // ── Usa i dati "current" se disponibili, altrimenti fallback a current_weather ──
  const temp = cur
    ? Math.round(cur.temperature_2m)
    : Math.round(cw.temperature);
  const feelsLike = cur ? Math.round(cur.apparent_temperature) : temp;
  const humidity = cur ? Math.round(cur.relative_humidity_2m) : "–";
  const windSpeed = cur
    ? Math.round(cur.wind_speed_10m)
    : Math.round(cw.windspeed);
  const windDir = cur
    ? degToDir(cur.wind_direction_10m)
    : degToDir(cw.winddirection);
  const precip = cur ? (cur.precipitation ?? 0) : 0;
  const cloudCov = cur ? (cur.cloud_cover ?? 0) : 0;

  // Condizione: usa WMO nowcasting se disponibile
  const wmoCode = cur?.weather_code ?? cw.weathercode;
  let cond = wmoToCondition(wmoCode);

  // Ulteriore verifica cloud_cover per massima precisione
  if (precip === 0 && cloudCov > 70 && [0, 1, 2].includes(wmoCode)) {
    cond = { label: "Coperto", icon: "☁️" };
  }

  // Indicatore precipitazione in corso
  const precipBadge =
    precip > 0
      ? `<span style="font-size:0.78rem;color:#00A8E8;font-weight:600">🌧️ Precipitazione: ${precip.toFixed(1)} mm</span>`
      : "";

  // Indicatore copertura nuvolosa
  const cloudBadge =
    cloudCov > 0
      ? `<span style="font-size:0.75rem;color:var(--color-text-muted)">☁️ Nuvolosità: ${cloudCov}%</span>`
      : "";

  dom.currentWeatherPanel.innerHTML = `
    <div class="current-weather-layout">
      <div class="cw-main">
        <div class="cw-location">
          <span class="cw-city-name">${escapeHtml(loc.name)}</span>
          <span class="cw-region">${escapeHtml(sublabel)}</span>
          ${loc.elevation ? `<span class="cw-elevation">📍 ${loc.elevation}m s.l.m.</span>` : ""}
        </div>
        <div class="cw-temp-block">
          <span class="cw-icon" aria-hidden="true">${cond.icon}</span>
          <span class="cw-temp">${temp}°</span>
        </div>
        <p class="cw-condition">${cond.label}</p>
        <p class="cw-feels">Percepita: ${feelsLike}°C</p>
        ${precipBadge}
        ${cloudBadge}
      </div>
      <div class="cw-stats">
        <div class="cw-stat"><span class="cw-stat-icon">💧</span><span class="cw-stat-label">Umidità</span><strong>${humidity}%</strong></div>
        <div class="cw-stat"><span class="cw-stat-icon">💨</span><span class="cw-stat-label">Vento</span><strong>${windSpeed} km/h ${windDir}</strong></div>
        <div class="cw-stat"><span class="cw-stat-icon">🌡️</span><span class="cw-stat-label">Max/Min</span><strong>${Math.round(data.daily.temperature_2m_max[0])}° / ${Math.round(data.daily.temperature_2m_min[0])}°</strong></div>
        <div class="cw-stat"><span class="cw-stat-icon">☀️</span><span class="cw-stat-label">UV Max</span><strong>${data.daily.uv_index_max[0]}</strong></div>
      </div>
    </div>`;
  injectCurrentWeatherCSS();
}

/* ═══════════════════════════════════════
   RENDER – SEZIONE PREVISIONI 16 GIORNI
═══════════════════════════════════════ */
function renderForecastSection(weather, marine, loc) {
  dom.forecastSection.hidden = false;
  renderDayTabs(weather);
  renderTimeslots(weather, marine, state.selectedDayIdx);
  renderServicePanel(
    weather,
    marine,
    state.selectedDayIdx,
    state.activeService,
  );
  // Riattiva i sub-tab servizi
  dom.serviceTabs.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.service === state.activeService);
    btn.setAttribute(
      "aria-selected",
      btn.dataset.service === state.activeService,
    );
  });
}

/* ═══════════════════════════════════════
   RENDER – TAB 16 GIORNI
═══════════════════════════════════════ */
function renderDayTabs(weather) {
  dom.dayTabs.innerHTML = "";
  weather.daily.time.forEach((dateStr, idx) => {
    const { name, date } = formatDayLabel(dateStr, idx);
    const cond = wmoToCondition(weather.daily.weathercode[idx]);
    const tMax = Math.round(weather.daily.temperature_2m_max[idx]);
    const tMin = Math.round(weather.daily.temperature_2m_min[idx]);

    const btn = document.createElement("button");
    btn.className = "day-tab" + (idx === state.selectedDayIdx ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", idx === state.selectedDayIdx);
    btn.setAttribute(
      "aria-label",
      `${name}${date ? " " + date : ""}: ${cond.label}, ${tMax}°/${tMin}°`,
    );
    btn.dataset.dayIdx = idx;
    btn.innerHTML = `
      <span class="day-tab-name">${name}</span>
      ${date ? `<span class="day-tab-date">${date}</span>` : ""}
      <span class="day-tab-icon">${cond.icon}</span>
      <span class="day-tab-temp">${tMax}° / ${tMin}°</span>`;

    btn.addEventListener("click", () => {
      state.selectedDayIdx = idx;
      dom.dayTabs.querySelectorAll(".day-tab").forEach((b, i) => {
        b.classList.toggle("active", i === idx);
        b.setAttribute("aria-selected", i === idx);
      });
      renderTimeslots(state.weatherData, state.marineData, idx);
      renderServicePanel(
        state.weatherData,
        state.marineData,
        idx,
        state.activeService,
      );
    });

    dom.dayTabs.appendChild(btn);
  });
}

/* ═══════════════════════════════════════
   RENDER – GRIGLIA 4 FASCE ORARIE
   Mostra un riepilogo visivo per ogni fascia
   (usato come intestazione, sempre visibile)
═══════════════════════════════════════ */
function renderTimeslots(weather, marine, dayIdx) {
  dom.timeslotGrid.innerHTML = "";

  const nowHour = new Date().getHours();
  const isToday = dayIdx === 0;
  const currentData = weather.current || null; // dati nowcasting

  CONFIG.FASCE.forEach((fascia) => {
    const hIdx = dayIdx * 24 + fascia.hour;

    // Condizione dalla previsione oraria
    let cond = wmoToCondition(weather.hourly.weathercode[hIdx]);

    // ── NOWCASTING: sovrascrittura solo per la fascia corrente di "Oggi" ──
    // La fascia è "corrente" se l'ora attuale rientra nel suo blocco:
    // NOTTE   03:00 → blocco 00–05
    // MATTINA 09:00 → blocco 06–11
    // POMERIGGIO 15:00 → blocco 12–17
    // SERA    21:00 → blocco 18–23
    const fasciaRanges = {
      notte: [0, 5],
      mattina: [6, 11],
      pomeriggio: [12, 17],
      sera: [18, 23],
    };
    const [start, end] = fasciaRanges[fascia.key];
    const isFasciaCorrente = isToday && nowHour >= start && nowHour <= end;

    if (isFasciaCorrente && currentData) {
      cond = applyNowcasting(currentData, cond);
    }

    const temp = Math.round(weather.hourly.temperature_2m[hIdx]);
    const wind = Math.round(weather.hourly.windspeed_10m[hIdx]);

    // Badge "LIVE" visibile solo sulla fascia corrente di oggi
    const liveBadge = isFasciaCorrente
      ? `<span style="display:inline-block;background:#E74C3C;color:#fff;font-size:0.6rem;font-weight:700;padding:1px 6px;border-radius:99px;letter-spacing:0.05em;margin-left:auto">LIVE</span>`
      : "";

    const card = document.createElement("div");
    card.className =
      "timeslot-card" + (isFasciaCorrente ? " timeslot-current" : "");
    card.innerHTML = `
      <div class="timeslot-header ${fascia.cssClass}">
        <span>${fascia.icon}</span>
        <span>${fascia.label}</span>
        ${liveBadge}
        <span style="margin-left:${isFasciaCorrente ? "4px" : "auto"};font-size:0.68rem;opacity:0.85">ore ${fascia.hour}:00</span>
      </div>
      <div class="timeslot-body">
        <span class="timeslot-icon">${cond.icon}</span>
        <span class="timeslot-main-value">${temp}°C</span>
        <span class="timeslot-sub-value">💨 ${wind} km/h</span>
        <span class="timeslot-label">${cond.label}</span>
      </div>`;
    dom.timeslotGrid.appendChild(card);
  });
}

/* ═══════════════════════════════════════
   RENDER – SERVICE PANEL (4 sub-tab)
═══════════════════════════════════════ */
function renderServicePanel(weather, marine, dayIdx, service) {
  switch (service) {
    case "forecast":
      renderServiceForecast(weather, dayIdx);
      break;
    case "temperature":
      renderServiceTemperature(weather, dayIdx);
      break;
    case "wind-sea":
      renderServiceWindSea(weather, marine, dayIdx);
      break;
    case "uv":
      renderServiceUV(weather, dayIdx);
      break;
  }
}

/* ── TAB 1: PREVISIONI (icona + descrizione cielo) ── */
function renderServiceForecast(weather, dayIdx) {
  const cols = CONFIG.FASCE.map((fascia) => {
    const hIdx = dayIdx * 24 + fascia.hour;
    const cond = wmoToCondition(weather.hourly.weathercode[hIdx]);
    const humidity = weather.hourly.relativehumidity_2m[hIdx];
    return `
      <div class="sp-col">
        <div class="sp-col-header">${fascia.icon} ${fascia.label} <span style="font-weight:400;margin-left:auto">${fascia.hour}:00</span></div>
        <div class="sp-row">
          <span class="sp-label">Condizioni</span>
          <span style="font-size:2rem;line-height:1.2">${cond.icon}</span>
          <span class="sp-value" style="font-size:0.9rem">${cond.label}</span>
        </div>
        <div class="sp-row">
          <span class="sp-label">Umidità</span>
          <span class="sp-value">${humidity}%</span>
        </div>
      </div>`;
  }).join("");
  dom.servicePanel.innerHTML = `<div class="sp-grid">${cols}</div>`;
}

/* ── TAB 2: TEMPERATURE (reale + percepita) ── */
function renderServiceTemperature(weather, dayIdx) {
  const cols = CONFIG.FASCE.map((fascia) => {
    const hIdx = dayIdx * 24 + fascia.hour;
    const temp = Math.round(weather.hourly.temperature_2m[hIdx]);
    const feels = Math.round(weather.hourly.apparent_temperature[hIdx]);
    const diff = temp - feels;
    const diffStr =
      diff > 0
        ? `−${diff}° percepita`
        : diff < 0
          ? `+${Math.abs(diff)}° percepita`
          : "come reale";
    return `
      <div class="sp-col">
        <div class="sp-col-header">${fascia.icon} ${fascia.label}</div>
        <div class="sp-row">
          <span class="sp-label">Temperatura reale</span>
          <span class="sp-value" style="font-size:1.8rem">${temp}°C</span>
        </div>
        <div class="sp-row">
          <span class="sp-label">Temperatura percepita</span>
          <span class="sp-value">${feels}°C</span>
          <span class="sp-sub">${diffStr}</span>
        </div>
      </div>`;
  }).join("");
  dom.servicePanel.innerHTML = `<div class="sp-grid">${cols}</div>`;
}

/* ── TAB 3: MARI E VENTO ── */
function renderServiceWindSea(weather, marine, dayIdx) {
  // Colonne vento (sempre disponibile)
  const windCols = CONFIG.FASCE.map((fascia) => {
    const hIdx = dayIdx * 24 + fascia.hour;
    const speed = Math.round(weather.hourly.windspeed_10m[hIdx]);
    const deg = weather.hourly.winddirection_10m[hIdx];
    const dir = degToDir(deg);
    // Forza Beaufort approssimata
    const bf =
      speed < 1
        ? 0
        : speed < 6
          ? 1
          : speed < 12
            ? 2
            : speed < 20
              ? 3
              : speed < 29
                ? 4
                : speed < 39
                  ? 5
                  : speed < 50
                    ? 6
                    : speed < 62
                      ? 7
                      : speed < 75
                        ? 8
                        : speed < 89
                          ? 9
                          : speed < 103
                            ? 10
                            : speed < 118
                              ? 11
                              : 12;
    return `
      <div class="sp-col">
        <div class="sp-col-header">${fascia.icon} ${fascia.label}</div>
        <div class="sp-row">
          <span class="sp-label">Velocità</span>
          <span class="sp-value" style="font-size:1.4rem">${speed} km/h</span>
        </div>
        <div class="sp-row">
          <span class="sp-label">Direzione</span>
          <span class="sp-value">
            <span class="wind-arrow" style="transform:rotate(${deg}deg)">↑</span> ${dir}
          </span>
        </div>
        <div class="sp-row">
          <span class="sp-label">Forza Beaufort</span>
          <span class="sp-value">BF ${bf}</span>
        </div>
      </div>`;
  }).join("");

  // Sezione mare
  let marineHTML = "";
  if (!marine) {
    marineHTML = `
      <div class="sea-unavailable">
        🏔️ <span>Dati marittimi non disponibili per questa località.<br>
        La stazione si trova nell'entroterra o in zona montuosa.</span>
      </div>`;
  } else {
    const seaCols = CONFIG.FASCE.map((fascia) => {
      const hIdx = dayIdx * 24 + fascia.hour;
      const waveH = marine.hourly.wave_height[hIdx];
      const waveP = marine.hourly.wave_period[hIdx];
      const waveD = marine.hourly.wave_direction
        ? degToDir(marine.hourly.wave_direction[hIdx])
        : "–";
      return `
        <div class="sp-col">
          <div class="sp-col-header">🌊 ${fascia.label}</div>
          <div class="sp-row">
            <span class="sp-label">Altezza onde</span>
            <span class="sp-value" style="font-size:1.4rem">${waveH != null ? waveH.toFixed(1) + " m" : "–"}</span>
          </div>
          <div class="sp-row">
            <span class="sp-label">Periodo</span>
            <span class="sp-value">${waveP != null ? waveP.toFixed(0) + " s" : "–"}</span>
          </div>
          <div class="sp-row">
            <span class="sp-label">Direzione</span>
            <span class="sp-value">${waveD}</span>
          </div>
        </div>`;
    }).join("");
    marineHTML = `
      <h3 style="font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-sky);margin:var(--space-lg) 0 var(--space-md)">🌊 Condizioni del mare</h3>
      <div class="sp-grid">${seaCols}</div>`;
  }

  dom.servicePanel.innerHTML = `
    <h3 style="font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-sky);margin-bottom:var(--space-md)">💨 Vento</h3>
    <div class="sp-grid">${windCols}</div>
    ${marineHTML}`;
}

/* ── TAB 4: INDICE UV ── */
function renderServiceUV(weather, dayIdx) {
  const cols = CONFIG.FASCE.map((fascia) => {
    const hIdx = dayIdx * 24 + fascia.hour;
    const uv = weather.hourly.uv_index[hIdx];
    const uvR = uv != null ? Math.round(uv) : 0;
    const meta = uvMeta(uvR);
    const pct = Math.min(100, (uvR / 11) * 100);
    // Di notte l'UV è sempre 0
    const isNight = fascia.hour === 3;
    return `
      <div class="sp-col">
        <div class="sp-col-header">${fascia.icon} ${fascia.label}</div>
        <div class="sp-row">
          <span class="sp-label">Indice UV</span>
          <span class="sp-value" style="font-size:2rem;color:${meta.color}">${isNight ? "–" : uvR}</span>
          ${!isNight ? `<span class="uv-badge" style="background:${meta.color}">${meta.label}</span>` : '<span class="sp-sub">Nessuna radiazione</span>'}
        </div>
        ${
          !isNight
            ? `
        <div class="sp-row" style="margin-top:4px">
          <span class="sp-label">Intensità</span>
          <div class="uv-bar-wrap">
            <div class="uv-bar" style="width:${pct}%;background:${meta.color}"></div>
          </div>
        </div>`
            : ""
        }
        <div class="sp-row">
          <span class="sp-label">Consiglio</span>
          <span class="sp-sub">${uvAdvice(uvR, isNight)}</span>
        </div>
      </div>`;
  }).join("");
  dom.servicePanel.innerHTML = `<div class="sp-grid">${cols}</div>`;
}

function uvAdvice(idx, isNight) {
  if (isNight) return "Nessuna protezione necessaria";
  if (idx <= 2) return "Protezione minima";
  if (idx <= 5) return "Usa crema SPF 30+";
  if (idx <= 7) return "Cerca ombra nelle ore centrali";
  if (idx <= 10) return "SPF 50+, cappello, occhiali";
  return "Evita esposizione diretta";
}

/* ═══════════════════════════════════════
   UI – AUTOCOMPLETE
═══════════════════════════════════════ */
function showAutocompleteLoading() {
  dom.autocompleteList.innerHTML = `<li class="autocomplete-loading"><span class="ac-spinner"></span>Ricerca in corso…</li>`;
  dom.autocompleteList.hidden = false;
  dom.searchInput.setAttribute("aria-expanded", "true");
}
function showAutocompleteError() {
  dom.autocompleteList.innerHTML = `<li class="autocomplete-empty">⚠️ Connessione non disponibile.</li>`;
  dom.autocompleteList.hidden = false;
}
function closeAutocomplete() {
  dom.autocompleteList.hidden = true;
  dom.autocompleteList.innerHTML = "";
  dom.searchInput.setAttribute("aria-expanded", "false");
}
function renderAutocomplete(results, query) {
  dom.autocompleteList.innerHTML = "";
  if (!results || !results.length) {
    dom.autocompleteList.innerHTML = `<li class="autocomplete-empty">Nessuna località per "<strong>${escapeHtml(query)}</strong>"</li>`;
    dom.autocompleteList.hidden = false;
    return;
  }
  results.forEach((r, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("tabindex", "-1");
    li.className = "autocomplete-item";
    li.innerHTML = `<span class="autocomplete-city">${highlightMatch(r.name, query)}</span><span class="autocomplete-region">${escapeHtml(formatLocationLabel(r))}</span>`;
    li.addEventListener("click", () => selectLocation(r));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectLocation(r);
      }
      handleDropdownKeyboard(e);
    });
    dom.autocompleteList.appendChild(li);
  });
  dom.autocompleteList.hidden = false;
  dom.searchInput.setAttribute("aria-expanded", "true");
}
function handleDropdownKeyboard(e) {
  const items = [
    ...dom.autocompleteList.querySelectorAll(".autocomplete-item"),
  ];
  if (!items.length) return;
  const idx = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") {
    e.preventDefault();
    (items[idx + 1] || items[0]).focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    idx <= 0 ? dom.searchInput.focus() : items[idx - 1].focus();
  } else if (e.key === "Escape") {
    closeAutocomplete();
    dom.searchInput.focus();
  }
}

/* ═══════════════════════════════════════
   SELEZIONE CITTÀ
═══════════════════════════════════════ */
function selectLocation(result) {
  state.selectedLocation = {
    name: result.name,
    region: result.admin1 || "",
    country: result.country || "",
    latitude: result.latitude,
    longitude: result.longitude,
    elevation: result.elevation || null,
    timezone: result.timezone || "Europe/Rome",
  };
  const sub = formatLocationLabel(result);
  dom.searchInput.value = sub ? `${result.name}, ${sub}` : result.name;
  closeAutocomplete();
  loadWeatherData(state.selectedLocation);
}

/* ═══════════════════════════════════════
   UI – LOADING DASHBOARD
═══════════════════════════════════════ */
function showDashboardLoading() {
  dom.currentWeatherPanel.innerHTML = `<div class="card-empty-state"><span class="empty-icon">⏳</span><p>Caricamento dati meteo…</p></div>`;
  dom.forecastSection.hidden = true;
}

/* ═══════════════════════════════════════
   CSS DINAMICI
═══════════════════════════════════════ */
function injectCurrentWeatherCSS() {
  if (document.getElementById("cw-dynamic-css")) return;
  const s = document.createElement("style");
  s.id = "cw-dynamic-css";
  s.textContent = `
    .current-weather-layout{width:100%;display:flex;flex-wrap:wrap;gap:24px;align-items:center}
    .cw-main{flex:1;min-width:200px}
    .cw-location{display:flex;flex-direction:column;margin-bottom:8px}
    .cw-city-name{font-family:var(--font-display);font-size:1.5rem;font-weight:700}
    .cw-region{font-size:0.85rem;color:var(--color-text-muted)}
    .cw-elevation{font-size:0.75rem;color:var(--color-text-muted)}
    .cw-temp-block{display:flex;align-items:center;gap:8px;margin:8px 0 4px}
    .cw-icon{font-size:3rem;line-height:1}
    .cw-temp{font-family:var(--font-display);font-size:4rem;font-weight:700;line-height:1;color:var(--color-text-primary)}
    .cw-condition{font-size:1.1rem;font-weight:500;color:var(--color-sky)}
    .cw-feels{font-size:0.85rem;color:var(--color-text-muted);margin-top:4px}
    .cw-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;flex:1;min-width:200px}
    .cw-stat{background:var(--color-bg);border-radius:var(--radius-sm);padding:12px;display:flex;flex-direction:column;gap:2px}
    .cw-stat-icon{font-size:1.1rem}
    .cw-stat-label{font-size:0.75rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em}
    .cw-stat strong{font-size:0.95rem;font-weight:600}
    .autocomplete-loading{display:flex;align-items:center;gap:10px;padding:14px 20px;font-size:0.9rem;color:var(--color-text-muted)}
    .ac-spinner{width:16px;height:16px;border:2px solid var(--color-sky-light);border-top-color:var(--color-sky);border-radius:50%;animation:spin 0.7s linear infinite;flex-shrink:0}
    @keyframes spin{to{transform:rotate(360deg)}}
    .autocomplete-empty{padding:14px 20px;font-size:0.875rem;color:var(--color-text-muted)}
    .autocomplete-empty strong{color:var(--color-text-primary)}
    .autocomplete-item mark{background:transparent;color:var(--color-sky);font-weight:700}
  `;
  document.head.appendChild(s);
}

/* ═══════════════════════════════════════
   EVENT LISTENERS
═══════════════════════════════════════ */

// Ricerca con debounce
const handleSearchInput = debounce(async function () {
  const q = dom.searchInput.value.trim();
  if (q.length < CONFIG.MIN_CHARS) {
    closeAutocomplete();
    return;
  }
  const results = await fetchLocations(q);
  if (results === null) return;
  renderAutocomplete(results, q);
}, CONFIG.DEBOUNCE_MS);

dom.searchInput.addEventListener("input", handleSearchInput);

dom.searchInput.addEventListener("keydown", function (e) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    dom.autocompleteList.querySelector(".autocomplete-item")?.focus();
  } else if (e.key === "Escape") closeAutocomplete();
  else if (e.key === "Enter")
    dom.autocompleteList.querySelector(".autocomplete-item")?.click();
});

dom.searchBtn.addEventListener("click", () => {
  const first = dom.autocompleteList.querySelector(".autocomplete-item");
  if (first) first.click();
  else if (dom.searchInput.value.trim().length >= CONFIG.MIN_CHARS)
    handleSearchInput();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrapper")) closeAutocomplete();
});

// Sub-tab servizi
dom.serviceTabs.forEach((btn) => {
  btn.addEventListener("click", function () {
    state.activeService = this.dataset.service;
    dom.serviceTabs.forEach((b) => {
      b.classList.toggle("active", b === this);
      b.setAttribute("aria-selected", b === this);
    });
    renderServicePanel(
      state.weatherData,
      state.marineData,
      state.selectedDayIdx,
      state.activeService,
    );
  });
});

// Tag rapidi
dom.tagButtons.forEach((btn) => {
  btn.addEventListener("click", async function () {
    const name = this.dataset.city;
    dom.searchInput.value = name;
    const results = await fetchLocations(name);
    if (results && results.length > 0) selectLocation(results[0]);
  });
});

// Hamburger
dom.hamburger.addEventListener("click", function () {
  state.menuOpen = !state.menuOpen;
  this.classList.toggle("open", state.menuOpen);
  this.setAttribute("aria-expanded", state.menuOpen);
  dom.mobileMenu.classList.toggle("open", state.menuOpen);
  dom.mobileMenu.setAttribute("aria-hidden", !state.menuOpen);
});
dom.mobileMenu.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    state.menuOpen = false;
    dom.hamburger.classList.remove("open");
    dom.hamburger.setAttribute("aria-expanded", false);
    dom.mobileMenu.classList.remove("open");
    dom.mobileMenu.setAttribute("aria-hidden", true);
  });
});

/* ═══════════════════════════════════════
   INIT
═══════════════════════════════════════ */
(function init() {
  injectCurrentWeatherCSS();
  console.log(
    "%c🌤️ MeteoPunto.com – FASE 3 + Nowcasting caricata\n" +
      "%c📅 Previsioni: 16 giorni · 4 fasce · 4 servizi\n" +
      "%c🌊 Marine API: rilevamento automatico entroterra\n" +
      "%c⚡ Nowcasting: cloud_cover + precipitation in tempo reale",
    "color:#FFD700;font-weight:700;font-size:14px;",
    "color:#00A8E8;font-weight:500;",
    "color:#2ECC71;font-weight:500;",
    "color:#E74C3C;font-weight:500;",
  );
})();
