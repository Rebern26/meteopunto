/**
 * ═══════════════════════════════════════════════════════════
 * METEOPUNTO.COM – app.js  |  Redesign Timeline
 * Scheda Live + Timeline 24h ora per ora + 16 giorni
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
};

/* ═══════════════════════════════════════
   STATO GLOBALE
═══════════════════════════════════════ */
const state = {
  selectedLocation: null,
  weatherData: null,
  marineData: null,
  selectedDayIdx: 0,
  activeService: "forecast",
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
  forecastSection: document.getElementById("forecast-section"),
  liveWeatherCard: document.getElementById("live-weather-card"),
  hourlyContainer: document.getElementById("hourly-container"),
  dayTabs: document.getElementById("day-tabs"),
  servicePanel: document.getElementById("service-panel"),
  serviceTabs: document.querySelectorAll(".service-tab"),
  hamburger: document.querySelector(".hamburger"),
  mobileMenu: document.getElementById("mobile-menu"),
  tagButtons: document.querySelectorAll(".tag-btn"),
};

/* ═══════════════════════════════════════
   UTILITY
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

function degToDir(deg) {
  const d = [
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
  return d[Math.round(deg / 22.5) % 16];
}

function uvMeta(idx) {
  if (idx <= 2) return { label: "Basso", color: "#2ECC71" };
  if (idx <= 5) return { label: "Moderato", color: "#F1C40F" };
  if (idx <= 7) return { label: "Alto", color: "#FF8C00" };
  if (idx <= 10) return { label: "Molto alto", color: "#E74C3C" };
  return { label: "Estremo", color: "#9B59B6" };
}

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

/**
 * Converte il WMO weather code in {label, icon}
 * Mappatura severa e completa.
 */
function wmoToCondition(code) {
  const map = {
    0: { label: "Cielo sereno", icon: "☀️" },
    1: { label: "Poco nuvoloso", icon: "🌤️" },
    2: { label: "Parzialmente nuvoloso", icon: "⛅" },
    3: { label: "Coperto", icon: "☁️" },
    45: { label: "Nebbia", icon: "🌫️" },
    48: { label: "Nebbia gelata", icon: "🌫️" },
    51: { label: "Pioggerella leggera", icon: "🌦️" },
    53: { label: "Pioggerella moderata", icon: "🌦️" },
    55: { label: "Pioggerella intensa", icon: "🌧️" },
    56: { label: "Pioggerella gelata", icon: "🌧️" },
    57: { label: "Pioggerella gelata forte", icon: "🌧️" },
    61: { label: "Pioggia leggera", icon: "🌧️" },
    63: { label: "Pioggia moderata", icon: "🌧️" },
    65: { label: "Pioggia intensa", icon: "🌧️" },
    66: { label: "Pioggia gelata lieve", icon: "🌧️" },
    67: { label: "Pioggia gelata", icon: "🌧️" },
    71: { label: "Neve leggera", icon: "🌨️" },
    73: { label: "Neve moderata", icon: "❄️" },
    75: { label: "Neve intensa", icon: "❄️" },
    77: { label: "Granelli di neve", icon: "🌨️" },
    80: { label: "Rovesci leggeri", icon: "🌦️" },
    81: { label: "Rovesci moderati", icon: "🌧️" },
    82: { label: "Rovesci violenti", icon: "⛈️" },
    85: { label: "Rovesci di neve", icon: "🌨️" },
    86: { label: "Forti rovesci di neve", icon: "❄️" },
    95: { label: "Temporale", icon: "⛈️" },
    96: { label: "Temporale con grandine", icon: "⛈️" },
    99: { label: "Temporale violento", icon: "🌩️" },
  };
  return map[code] ?? { label: "N/D", icon: "❓" };
}

/**
 * Nowcasting: sovrascrive la condizione con dati live
 * se la copertura nuvolosa o la precipitazione lo richiedono.
 */
function applyNowcasting(currentData, hourlyCondit) {
  if (!currentData) return hourlyCondit;
  const precip = currentData.precipitation ?? 0;
  const cloudCover = currentData.cloud_cover ?? 0;
  const wmoCode = currentData.weather_code ?? null;
  if (precip > 0 && wmoCode !== null) return wmoToCondition(wmoCode);
  if (cloudCover > 70) return { label: "Coperto", icon: "☁️" };
  if (cloudCover > 30) return { label: "Parzialmente nuvoloso", icon: "⛅" };
  return hourlyCondit;
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
   API – METEO 16 GIORNI
═══════════════════════════════════════ */
async function fetchWeather(loc) {
  const params = new URLSearchParams({
    latitude: loc.latitude,
    longitude: loc.longitude,
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
      "cloud_cover",
      "precipitation_probability",
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
   API – MARINE
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
    const hasData = data.hourly?.wave_height?.some((v) => v !== null);
    return hasData ? data : null;
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════
   CARICAMENTO PRINCIPALE
═══════════════════════════════════════ */
async function loadWeatherData(loc) {
  showLoadingState();
  try {
    const [weather, marine] = await Promise.all([
      fetchWeather(loc),
      fetchMarine(loc),
    ]);
    state.weatherData = weather;
    state.marineData = marine;
    state.selectedDayIdx = 0;
    state.activeService = "forecast";

    renderAll(weather, marine, loc, 0);
  } catch (err) {
    console.error("MeteoPunto – Errore:", err);
    dom.liveWeatherCard.innerHTML = `
      <div class="card-empty-state" style="color:rgba(255,255,255,0.7)">
        <span class="empty-icon">⚠️</span>
        <p>Errore nel caricamento. Riprova tra poco.</p>
      </div>`;
  }
}

/* ═══════════════════════════════════════
   RENDER PRINCIPALE
═══════════════════════════════════════ */
function renderAll(weather, marine, loc, dayIdx) {
  dom.forecastSection.hidden = false;

  renderDayTabs(weather, dayIdx);
  renderLiveWeather(weather, loc, dayIdx);
  renderHourlyTimeline(weather, dayIdx);
  renderServicePanel(weather, marine, dayIdx, state.activeService);

  // Riattiva sub-tab
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
function renderDayTabs(weather, selectedIdx) {
  dom.dayTabs.innerHTML = "";
  weather.daily.time.forEach((dateStr, idx) => {
    const { name, date } = formatDayLabel(dateStr, idx);
    const cond = wmoToCondition(weather.daily.weathercode[idx]);
    const tMax = Math.round(weather.daily.temperature_2m_max[idx]);
    const tMin = Math.round(weather.daily.temperature_2m_min[idx]);

    const btn = document.createElement("button");
    btn.className = "day-tab" + (idx === selectedIdx ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", idx === selectedIdx);
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

      // Aggiorna testo dinamico sotto "Previsioni Ora per Ora"
      const giornoEl = document.getElementById("giorno-selezionato-testo");
      if (giornoEl) {
        if (idx === 0) {
          giornoEl.textContent = "📅 Oggi";
        } else if (idx === 1) {
          giornoEl.textContent = "📅 Domani";
        } else {
          // Costruisce "Venerdì 26 Giugno" dalla data del giorno
          const dateStr = weather.daily.time[idx];
          const d = new Date(dateStr);
          const giorniEstesi = [
            "Domenica",
            "Lunedì",
            "Martedì",
            "Mercoledì",
            "Giovedì",
            "Venerdì",
            "Sabato",
          ];
          const mesiEstesi = [
            "Gennaio",
            "Febbraio",
            "Marzo",
            "Aprile",
            "Maggio",
            "Giugno",
            "Luglio",
            "Agosto",
            "Settembre",
            "Ottobre",
            "Novembre",
            "Dicembre",
          ];
          giornoEl.textContent = `📅 ${giorniEstesi[d.getDay()]} ${d.getDate()} ${mesiEstesi[d.getMonth()]}`;
        }
      }

      renderLiveWeather(state.weatherData, state.selectedLocation, idx);
      renderHourlyTimeline(state.weatherData, idx);
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
   RENDER – SCHEDA LIVE
   Per "Oggi" usa i dati current live di Open-Meteo.
   Per i giorni futuri usa l'orario di mezzogiorno.
═══════════════════════════════════════ */
function renderLiveWeather(weather, loc, dayIdx) {
  const isToday = dayIdx === 0;
  const cur = weather.current;
  const cw = weather.current_weather;
  const sublabel = loc.region ? `${loc.region}, ${loc.country}` : loc.country;

  let temp,
    feelsLike,
    humidity,
    windSpeed,
    windDir,
    precip,
    cloudCov,
    condLabel,
    condIcon;

  if (isToday && cur) {
    // Dati in tempo reale
    temp = Math.round(cur.temperature_2m);
    feelsLike = Math.round(cur.apparent_temperature);
    humidity = Math.round(cur.relative_humidity_2m);
    windSpeed = Math.round(cur.wind_speed_10m);
    windDir = degToDir(cur.wind_direction_10m);
    precip = cur.precipitation ?? 0;
    cloudCov = cur.cloud_cover ?? 0;
    let baseCond = wmoToCondition(cur.weather_code ?? cw.weathercode);
    const nowcasted = applyNowcasting(cur, baseCond);
    condIcon = nowcasted.icon;
    condLabel = nowcasted.label;
  } else {
    // Giorno futuro: usa le 12:00 del giorno selezionato
    const hIdx = dayIdx * 24 + 12;
    temp = Math.round(weather.hourly.temperature_2m[hIdx]);
    feelsLike = Math.round(weather.hourly.apparent_temperature[hIdx]);
    humidity = Math.round(weather.hourly.relativehumidity_2m[hIdx]);
    windSpeed = Math.round(weather.hourly.windspeed_10m[hIdx]);
    windDir = degToDir(weather.hourly.winddirection_10m[hIdx]);
    precip = 0;
    cloudCov = weather.hourly.cloud_cover?.[hIdx] ?? 0;
    const c = wmoToCondition(weather.hourly.weathercode[hIdx]);
    condIcon = c.icon;
    condLabel = c.label;
  }

  // Badge LIVE solo per oggi
  const liveBadgeHTML = isToday
    ? `<div class="lw-badge"><span class="lw-badge-dot"></span>LIVE – Ora</div>`
    : `<div class="lw-badge" style="background:rgba(255,255,255,0.1)">📅 Previsione</div>`;

  // Precipitazione
  const precipHTML =
    isToday && precip > 0
      ? `<p class="lw-precip">🌧️ Precipitazione: ${precip.toFixed(1)} mm</p>`
      : "";

  // Nuvolosità
  const cloudHTML =
    cloudCov > 0 ? `<p class="lw-cloud">☁️ Nuvolosità: ${cloudCov}%</p>` : "";

  // Tmax / Tmin del giorno
  const tMax = Math.round(weather.daily.temperature_2m_max[dayIdx]);
  const tMin = Math.round(weather.daily.temperature_2m_min[dayIdx]);

  dom.liveWeatherCard.innerHTML = `
    <div class="lw-layout">
      <div class="lw-main">
        ${liveBadgeHTML}
        <p class="lw-location-name">${escapeHtml(loc.name)}</p>
        <p class="lw-location-sub">${escapeHtml(sublabel)}${loc.elevation ? ` · ${loc.elevation}m s.l.m.` : ""}</p>
        <div class="lw-temp-row">
          <span class="lw-icon" aria-hidden="true">${condIcon}</span>
          <span class="lw-temp">${temp}°</span>
        </div>
        <p class="lw-cond">${condLabel}</p>
        <p class="lw-feels">Percepita: ${feelsLike}°C</p>
        ${precipHTML}
        ${cloudHTML}
      </div>
      <div class="lw-stats">
        <div class="lw-stat">
          <span class="lw-stat-icon">💧</span>
          <span class="lw-stat-label">Umidità</span>
          <span class="lw-stat-value">${humidity}%</span>
        </div>
        <div class="lw-stat">
          <span class="lw-stat-icon">💨</span>
          <span class="lw-stat-label">Vento</span>
          <span class="lw-stat-value">${windSpeed} km/h ${windDir}</span>
        </div>
        <div class="lw-stat">
          <span class="lw-stat-icon">🌡️</span>
          <span class="lw-stat-label">Max / Min</span>
          <span class="lw-stat-value">${tMax}° / ${tMin}°</span>
        </div>
        <div class="lw-stat">
          <span class="lw-stat-icon">☀️</span>
          <span class="lw-stat-label">UV Max</span>
          <span class="lw-stat-value">${weather.daily.uv_index_max[dayIdx]}</span>
        </div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════
   RENDER – TIMELINE ORA PER ORA
   24 card consecutive per il giorno selezionato.
   Scroll automatico all'ora corrente per "Oggi".
═══════════════════════════════════════ */
function renderHourlyTimeline(weather, dayIdx) {
  const container = dom.hourlyContainer;
  if (!container) return;
  container.innerHTML = "";

  const isToday = dayIdx === 0;
  const nowHour = new Date().getHours();
  const baseIdx = dayIdx * 24;
  const precipProb = weather.hourly.precipitation_probability || [];

  for (let h = 0; h < 24; h++) {
    const idx = baseIdx + h;
    const cond = wmoToCondition(weather.hourly.weathercode[idx]);
    const temp = Math.round(weather.hourly.temperature_2m[idx]);
    const prob = precipProb[idx] ?? 0;
    const isNow = isToday && h === nowHour;

    const card = document.createElement("div");
    card.className = "hc-card" + (isNow ? " hc-now" : "");

    card.innerHTML = `
      ${isNow ? '<span class="hc-now-badge">ORA</span>' : ""}
      <span class="hc-hour">${String(h).padStart(2, "0")}:00</span>
      <span class="hc-icon" aria-hidden="true">${cond.icon}</span>
      <span class="hc-temp">${temp}°</span>
      ${prob > 0 ? `<span class="hc-precip">💧 ${prob}%</span>` : ""}`;

    container.appendChild(card);
  }

  // Scrolla all'ora corrente
  if (isToday) {
    setTimeout(() => {
      const nowCard = container.querySelector(".hc-now");
      if (nowCard)
        nowCard.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
    }, 150);
  }
}

/* ═══════════════════════════════════════
   RENDER – SERVICE PANEL
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

// Etichette fascia per i sub-tab (solo descrittive, non guidano la logica)
const FASCE_LABEL = [
  { label: "NOTTE", icon: "🌙", midHour: 3 },
  { label: "MATTINA", icon: "🌅", midHour: 9 },
  { label: "POMERIGGIO", icon: "☀️", midHour: 15 },
  { label: "SERA", icon: "🌆", midHour: 21 },
];

/* ── TAB 1: PREVISIONI ── */
function renderServiceForecast(weather, dayIdx) {
  const cols = FASCE_LABEL.map((f) => {
    const hIdx = dayIdx * 24 + f.midHour;
    const cond = wmoToCondition(weather.hourly.weathercode[hIdx]);
    const humidity = weather.hourly.relativehumidity_2m[hIdx];
    return `
      <div class="sp-col">
        <div class="sp-col-header">${f.icon} ${f.label} <span style="font-weight:400;margin-left:auto">${String(f.midHour).padStart(2, "0")}:00</span></div>
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

/* ── TAB 2: TEMPERATURE ── */
function renderServiceTemperature(weather, dayIdx) {
  const cols = FASCE_LABEL.map((f) => {
    const hIdx = dayIdx * 24 + f.midHour;
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
        <div class="sp-col-header">${f.icon} ${f.label}</div>
        <div class="sp-row">
          <span class="sp-label">Temperatura reale</span>
          <span class="sp-value" style="font-size:1.8rem">${temp}°C</span>
        </div>
        <div class="sp-row">
          <span class="sp-label">Percepita</span>
          <span class="sp-value">${feels}°C</span>
          <span class="sp-sub">${diffStr}</span>
        </div>
      </div>`;
  }).join("");
  dom.servicePanel.innerHTML = `<div class="sp-grid">${cols}</div>`;
}

/* ── TAB 3: MARI E VENTO ── */
function renderServiceWindSea(weather, marine, dayIdx) {
  const windCols = FASCE_LABEL.map((f) => {
    const hIdx = dayIdx * 24 + f.midHour;
    const speed = Math.round(weather.hourly.windspeed_10m[hIdx]);
    const deg = weather.hourly.winddirection_10m[hIdx];
    const dir = degToDir(deg);
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
        <div class="sp-col-header">${f.icon} ${f.label}</div>
        <div class="sp-row">
          <span class="sp-label">Velocità</span>
          <span class="sp-value" style="font-size:1.4rem">${speed} km/h</span>
        </div>
        <div class="sp-row">
          <span class="sp-label">Direzione</span>
          <span class="sp-value"><span class="wind-arrow" style="transform:rotate(${deg}deg)">↑</span> ${dir}</span>
        </div>
        <div class="sp-row">
          <span class="sp-label">Forza Beaufort</span>
          <span class="sp-value">BF ${bf}</span>
        </div>
      </div>`;
  }).join("");

  let marineHTML = !marine
    ? `<div class="sea-unavailable">🏔️ <span>Dati marittimi non disponibili per questa località.</span></div>`
    : (() => {
        const seaCols = FASCE_LABEL.map((f) => {
          const hIdx = dayIdx * 24 + f.midHour;
          const waveH = marine.hourly.wave_height[hIdx];
          const waveP = marine.hourly.wave_period[hIdx];
          const waveD = marine.hourly.wave_direction
            ? degToDir(marine.hourly.wave_direction[hIdx])
            : "–";
          return `
            <div class="sp-col">
              <div class="sp-col-header">🌊 ${f.label}</div>
              <div class="sp-row"><span class="sp-label">Altezza onde</span><span class="sp-value" style="font-size:1.4rem">${waveH != null ? waveH.toFixed(1) + " m" : "–"}</span></div>
              <div class="sp-row"><span class="sp-label">Periodo</span><span class="sp-value">${waveP != null ? waveP.toFixed(0) + " s" : "–"}</span></div>
              <div class="sp-row"><span class="sp-label">Direzione</span><span class="sp-value">${waveD}</span></div>
            </div>`;
        }).join("");
        return `<h3 style="font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-sky);margin:var(--space-lg) 0 var(--space-md)">🌊 Condizioni del mare</h3><div class="sp-grid">${seaCols}</div>`;
      })();

  dom.servicePanel.innerHTML = `
    <h3 style="font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-sky);margin-bottom:var(--space-md)">💨 Vento</h3>
    <div class="sp-grid">${windCols}</div>
    ${marineHTML}`;
}

/* ── TAB 4: UV ── */
function renderServiceUV(weather, dayIdx) {
  const cols = FASCE_LABEL.map((f) => {
    const hIdx = dayIdx * 24 + f.midHour;
    const uv = weather.hourly.uv_index[hIdx];
    const uvR = uv != null ? Math.round(uv) : 0;
    const meta = uvMeta(uvR);
    const pct = Math.min(100, (uvR / 11) * 100);
    const isNight = f.midHour < 6;
    return `
      <div class="sp-col">
        <div class="sp-col-header">${f.icon} ${f.label}</div>
        <div class="sp-row">
          <span class="sp-label">Indice UV</span>
          <span class="sp-value" style="font-size:2rem;color:${meta.color}">${isNight ? "–" : uvR}</span>
          ${!isNight ? `<span class="uv-badge" style="background:${meta.color}">${meta.label}</span>` : '<span class="sp-sub">Nessuna radiazione</span>'}
        </div>
        ${
          !isNight
            ? `
        <div class="sp-row">
          <span class="sp-label">Intensità</span>
          <div class="uv-bar-wrap"><div class="uv-bar" style="width:${pct}%;background:${meta.color}"></div></div>
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
   UI – STATI
═══════════════════════════════════════ */
function showLoadingState() {
  dom.forecastSection.hidden = false;
  dom.liveWeatherCard.innerHTML = `
    <div class="card-empty-state" style="color:rgba(255,255,255,0.7)">
      <span class="empty-icon">⏳</span><p>Caricamento dati meteo…</p>
    </div>`;
  dom.hourlyContainer.innerHTML = "";
  dom.dayTabs.innerHTML = "";
  dom.servicePanel.innerHTML = "";
}

/* ═══════════════════════════════════════
   UI – AUTOCOMPLETE
═══════════════════════════════════════ */
function showAutocompleteLoading() {
  dom.autocompleteList.innerHTML = `<li class="autocomplete-loading"><span class="ac-spinner"></span>Ricerca in corso…</li>`;
  dom.autocompleteList.hidden = false;
  dom.searchInput.setAttribute("aria-expanded", "true");
  injectAutocompleteCSS();
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
  results.forEach((r) => {
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
   CSS DINAMICI AUTOCOMPLETE
═══════════════════════════════════════ */
function injectAutocompleteCSS() {
  if (document.getElementById("ac-css")) return;
  const s = document.createElement("style");
  s.id = "ac-css";
  s.textContent = `
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

dom.tagButtons.forEach((btn) => {
  btn.addEventListener("click", async function () {
    dom.searchInput.value = this.dataset.city;
    const results = await fetchLocations(this.dataset.city);
    if (results && results.length > 0) selectLocation(results[0]);
  });
});

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
   INIT – Geolocalizzazione automatica via Cloudflare
   1. Chiama /api/geolocate (nessun permesso browser)
   2. Cloudflare legge l'IP e restituisce lat/lon/città
   3. Se fallisce → fallback Roma
═══════════════════════════════════════ */
(async function init() {
  injectAutocompleteCSS();

  console.log(
    "%c🌤️ MeteoPunto.com – Geolocalizzazione IP attiva\n" +
      "%c📡 Scheda Live + Timeline 24h + 16 giorni\n" +
      "%c⚡ Nowcasting: cloud_cover + precipitation live",
    "color:#FFD700;font-weight:700;font-size:14px;",
    "color:#00A8E8;font-weight:500;",
    "color:#2ECC71;font-weight:500;",
  );

  // Fallback Roma se tutto fallisce
  const romaDefault = {
    name: "Roma",
    region: "Lazio",
    country: "Italia",
    latitude: 41.8919,
    longitude: 12.5113,
    elevation: null,
    timezone: "Europe/Rome",
  };

  // Determina se siamo in sviluppo locale o produzione
  const isLocal =
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost";

  if (isLocal) {
    // In sviluppo locale Cloudflare non è disponibile → usa Roma
    console.log(
      "%c🏠 Sviluppo locale → uso Roma come default",
      "color:#FF8C00;font-weight:500;",
    );
    dom.searchInput.value = "Roma, Lazio";
    state.selectedLocation = romaDefault;
    loadWeatherData(romaDefault);
    return;
  }

  // In produzione: chiama il Worker per rilevare la posizione dall'IP
  try {
    dom.searchInput.value = "📍 Rilevamento posizione…";
    dom.searchInput.disabled = true;

    const res = await fetch(
      "https://meteopunto-worker.hentzeldieter.workers.dev/api/geolocate",
    );
    const data = await res.json();

    dom.searchInput.disabled = false;

    if (data.success && data.latitude && data.longitude) {
      // Ottieni nome città in italiano via Nominatim
      let cityName = "La tua posizione";
      let region = "";
      let country = "";

      try {
        const nomRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${data.latitude}&lon=${data.longitude}&format=json&accept-language=it`,
        );
        const nomData = await nomRes.json();
        cityName =
          nomData.address?.city ||
          nomData.address?.town ||
          nomData.address?.village ||
          nomData.address?.municipality ||
          "La tua posizione";
        region = nomData.address?.state || "";
        country = nomData.address?.country || "";
      } catch {
        cityName = data.city || "La tua posizione";
        country = data.country || "";
      }

      const location = {
        name: cityName,
        region,
        country,
        latitude: data.latitude,
        longitude: data.longitude,
        elevation: null,
        timezone: data.timezone || "Europe/Rome",
      };

      dom.searchInput.value = cityName;
      state.selectedLocation = location;
      loadWeatherData(location);
    } else {
      dom.searchInput.value = "Roma, Lazio";
      state.selectedLocation = romaDefault;
      loadWeatherData(romaDefault);
    }
  } catch (err) {
    console.error("MeteoPunto – Errore geolocate:", err);
    dom.searchInput.disabled = false;
    dom.searchInput.value = "Roma, Lazio";
    state.selectedLocation = romaDefault;
    loadWeatherData(romaDefault);
  }
})();
