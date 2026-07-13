/**
 * ═══════════════════════════════════════════════════════════
 * METEOPUNTO.COM – app.js  |  Redesign Timeline
 * Scheda Live + Timeline 24h ora per ora + 16 giorni
 * ═══════════════════════════════════════════════════════════
 */

"use strict";

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

const state = {
  selectedLocation: null,
  weatherData: null,
  marineData: null,
  selectedDayIdx: 0,
  activeService: "forecast",
  menuOpen: false,
  abortController: null,
};

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

// Restituisce true se l'ora è notturna basandosi su sunrise/sunset reali
function isNightTime(hour, sunriseStr, sunsetStr) {
  const h = hour !== undefined ? hour : new Date().getHours();
  if (!sunriseStr || !sunsetStr) return h >= 21 || h < 6;
  const riseHour = new Date(sunriseStr).getHours();
  const riseMin = new Date(sunriseStr).getMinutes();
  const setHour = new Date(sunsetStr).getHours();
  const setMin = new Date(sunsetStr).getMinutes();
  const nowMins = h * 60 + new Date().getMinutes();
  const riseMins = riseHour * 60 + riseMin;
  const setMins = setHour * 60 + setMin;
  return nowMins < riseMins || nowMins >= setMins;
}

function wmoToCondition(code, hour, sunriseStr, sunsetStr) {
  const h = hour !== undefined ? hour : new Date().getHours();
  const isNight = isNightTime(h, sunriseStr, sunsetStr);

  const map = {
    0: { label: "Cielo sereno", icon: isNight ? "🌙" : "☀️" },
    1: { label: "Poco nuvoloso", icon: isNight ? "🌙" : "🌤️" },
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
      "relative_humidity_2m",
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
  const data = await res.json();
  if (!data.current && data.current_weather) {
    data.current = {
      temperature_2m: data.current_weather.temperature,
      weather_code: data.current_weather.weathercode,
      wind_speed_10m: data.current_weather.windspeed,
      wind_direction_10m: data.current_weather.winddirection,
      apparent_temperature: data.current_weather.temperature,
      relative_humidity_2m: null,
      cloud_cover: null,
      precipitation: 0,
    };
  }
  return data;
}

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

function renderAll(weather, marine, loc, dayIdx) {
  dom.forecastSection.hidden = false;
  renderDayTabs(weather, dayIdx);
  renderLiveWeather(weather, loc, dayIdx);
  renderHourlyTimeline(weather, dayIdx);
  renderServicePanel(weather, marine, dayIdx, state.activeService);
  updateCornerDate(dayIdx, weather);
  dom.serviceTabs.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.service === state.activeService);
    btn.setAttribute(
      "aria-selected",
      btn.dataset.service === state.activeService,
    );
  });
}

function renderDayTabs(weather, selectedIdx) {
  dom.dayTabs.innerHTML = "";
  weather.daily.time.forEach((dateStr, idx) => {
    const { name, date } = formatDayLabel(dateStr, idx);
    const srDT = weather.daily.sunrise?.[idx] ?? null;
    const ssDT = weather.daily.sunset?.[idx] ?? null;
    const cond = wmoToCondition(weather.daily.weathercode[idx], 12, srDT, ssDT);
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
      const giornoEl = document.getElementById("giorno-selezionato-testo");
      if (giornoEl) {
        if (idx === 0) {
          giornoEl.textContent = "📅 Oggi";
        } else if (idx === 1) {
          giornoEl.textContent = "📅 Domani";
        } else {
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
      updateCornerDate(idx, state.weatherData);
    });
    dom.dayTabs.appendChild(btn);
  });
}

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
    temp = Math.round(cur.temperature_2m);
    feelsLike = Math.round(cur.apparent_temperature);
    // FIX: se current.relative_humidity_2m è null, leggi dall'array orario
    humidity =
      cur.relative_humidity_2m != null
        ? Math.round(cur.relative_humidity_2m)
        : Math.round(
            weather.hourly.relative_humidity_2m[new Date().getHours()] ?? 0,
          );
    windSpeed = Math.round(cur.wind_speed_10m);
    windDir = degToDir(cur.wind_direction_10m);
    precip = cur.precipitation ?? 0;
    cloudCov = cur.cloud_cover ?? 0;
    const sr = weather.daily.sunrise?.[0] ?? null;
    const ss = weather.daily.sunset?.[0] ?? null;
    let baseCond = wmoToCondition(
      cur.weather_code ?? cw.weathercode,
      new Date().getHours(),
      sr,
      ss,
    );
    const nowcasted = applyNowcasting(cur, baseCond);
    condIcon = nowcasted.icon;
    condLabel = nowcasted.label;
  } else {
    const hIdx = dayIdx * 24 + 12;
    temp = Math.round(weather.hourly.temperature_2m[hIdx]);
    feelsLike = Math.round(weather.hourly.apparent_temperature[hIdx]);
    humidity = Math.round(weather.hourly.relative_humidity_2m[hIdx]);
    windSpeed = Math.round(weather.hourly.windspeed_10m[hIdx]);
    windDir = degToDir(weather.hourly.winddirection_10m[hIdx]);
    precip = 0;
    cloudCov = weather.hourly.cloud_cover?.[hIdx] ?? 0;
    const srF = weather.daily.sunrise?.[dayIdx] ?? null;
    const ssF = weather.daily.sunset?.[dayIdx] ?? null;
    const c = wmoToCondition(weather.hourly.weathercode[hIdx], 12, srF, ssF);
    condIcon = c.icon;
    condLabel = c.label;
  }
  let liveBadgeLabel = "📅 Previsione";
  if (dayIdx === 1) {
    liveBadgeLabel = "📅 Domani";
  } else if (dayIdx > 1) {
    const d = new Date(weather.daily.time[dayIdx]);
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
    liveBadgeLabel = `📅 ${giorniEstesi[d.getDay()]} ${d.getDate()} ${mesiEstesi[d.getMonth()]}`;
  }
  const liveBadgeHTML = isToday
    ? `<div class="lw-badge"><span class="lw-badge-dot"></span>LIVE – Ora</div>`
    : `<div class="lw-badge" style="background:rgba(255,255,255,0.1)">${liveBadgeLabel}</div>`;
  const precipHTML =
    isToday && precip > 0
      ? `<p class="lw-precip">🌧️ Precipitazione: ${precip.toFixed(1)} mm</p>`
      : "";
  const cloudHTML =
    cloudCov > 0 ? `<p class="lw-cloud">☁️ Nuvolosità: ${cloudCov}%</p>` : "";
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
        ${precipHTML}${cloudHTML}
      </div>
      <div class="lw-stats">
        <div class="lw-stat"><span class="lw-stat-icon">💧</span><span class="lw-stat-label">Umidità</span><span class="lw-stat-value">${humidity}%</span></div>
        <div class="lw-stat"><span class="lw-stat-icon">💨</span><span class="lw-stat-label">Vento</span><span class="lw-stat-value">${windSpeed} km/h ${windDir}</span></div>
        <div class="lw-stat"><span class="lw-stat-icon">🌡️</span><span class="lw-stat-label">Max / Min</span><span class="lw-stat-value">${tMax}° / ${tMin}°</span></div>
        <div class="lw-stat"><span class="lw-stat-icon">☀️</span><span class="lw-stat-label">UV Max</span><span class="lw-stat-value">${weather.daily.uv_index_max[dayIdx]}</span></div>
      </div>
    </div>`;
}

function renderHourlyTimeline(weather, dayIdx) {
  const container = dom.hourlyContainer;
  if (!container) return;
  container.innerHTML = "";
  const isToday = dayIdx === 0;
  const nowHour = new Date().getHours();
  const baseIdx = dayIdx * 24;
  const precipProb = weather.hourly.precipitation_probability || [];
  const sunriseStr = weather.daily.sunrise?.[dayIdx] ?? null;
  const sunsetStr = weather.daily.sunset?.[dayIdx] ?? null;
  for (let h = 0; h < 24; h++) {
    const idx = baseIdx + h;
    const cond = wmoToCondition(
      weather.hourly.weathercode[idx],
      h,
      sunriseStr,
      sunsetStr,
    );
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

function updateCornerDate(idx, weather) {
  const el = document.getElementById("data-angolo-dettaglio");
  if (!el) return;
  if (idx === 0) {
    el.textContent = "Oggi";
    return;
  }
  if (idx === 1) {
    el.textContent = "Domani";
    return;
  }
  const d = new Date(weather.daily.time[idx]);
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
  el.textContent = `${giorniEstesi[d.getDay()]} ${d.getDate()} ${mesiEstesi[d.getMonth()]}`;
}

const FASCE_LABEL = [
  { label: "NOTTE", icon: "🌙", midHour: 3 },
  { label: "MATTINA", icon: "🌅", midHour: 9 },
  { label: "POMERIGGIO", icon: "☀️", midHour: 15 },
  { label: "SERA", icon: "🌆", midHour: 21 },
];

function renderServiceForecast(weather, dayIdx) {
  const cols = FASCE_LABEL.map((f) => {
    const hIdx = dayIdx * 24 + f.midHour;
    const srFC = weather.daily.sunrise?.[dayIdx] ?? null;
    const ssFC = weather.daily.sunset?.[dayIdx] ?? null;
    const cond = wmoToCondition(
      weather.hourly.weathercode[hIdx],
      f.midHour,
      srFC,
      ssFC,
    );
    const humidity = weather.hourly.relative_humidity_2m[hIdx];
    return `
      <div class="sp-col">
        <div class="sp-col-header">${f.icon} ${f.label} <span style="font-weight:400;margin-left:auto">${String(f.midHour).padStart(2, "0")}:00</span></div>
        <div class="sp-row"><span class="sp-label">Condizioni</span><span style="font-size:2rem;line-height:1.2">${cond.icon}</span><span class="sp-value" style="font-size:0.9rem">${cond.label}</span></div>
        <div class="sp-row"><span class="sp-label">Umidità</span><span class="sp-value">${humidity}%</span></div>
      </div>`;
  }).join("");
  dom.servicePanel.innerHTML = `<div class="sp-grid">${cols}</div>`;
}

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
        <div class="sp-row"><span class="sp-label">Temperatura reale</span><span class="sp-value" style="font-size:1.8rem">${temp}°C</span></div>
        <div class="sp-row"><span class="sp-label">Percepita</span><span class="sp-value">${feels}°C</span><span class="sp-sub">${diffStr}</span></div>
      </div>`;
  }).join("");
  dom.servicePanel.innerHTML = `<div class="sp-grid">${cols}</div>`;
}

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
        <div class="sp-row"><span class="sp-label">Velocità</span><span class="sp-value" style="font-size:1.4rem">${speed} km/h</span></div>
        <div class="sp-row"><span class="sp-label">Direzione</span><span class="sp-value"><span class="wind-arrow" style="transform:rotate(${deg}deg)">↑</span> ${dir}</span></div>
        <div class="sp-row"><span class="sp-label">Forza Beaufort</span><span class="sp-value">BF ${bf}</span></div>
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
    <div class="sp-grid">${windCols}</div>${marineHTML}`;
}

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
        ${!isNight ? `<div class="sp-row"><span class="sp-label">Intensità</span><div class="uv-bar-wrap"><div class="uv-bar" style="width:${pct}%;background:${meta.color}"></div></div></div>` : ""}
        <div class="sp-row"><span class="sp-label">Consiglio</span><span class="sp-sub">${uvAdvice(uvR, isNight)}</span></div>
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
    country_code: result.country_code || "",
    latitude: result.latitude,
    longitude: result.longitude,
    elevation: result.elevation || null,
    timezone: result.timezone || "Europe/Rome",
  };
  const sub = formatLocationLabel(result);
  dom.searchInput.value = sub ? `${result.name}, ${sub}` : result.name;
  closeAutocomplete();
  updateAllerteVisibility(result.country_code);
  loadWeatherData(state.selectedLocation);
}

function updateAllerteVisibility(countryCode) {
  const allerteSection = document.getElementById("allerte");
  if (!allerteSection) return;
  const isItaly = countryCode === "IT";
  allerteSection.hidden = !isItaly;
}

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
   INIT
═══════════════════════════════════════ */
(async function init() {
  injectAutocompleteCSS();

  const romaDefault = {
    name: "Roma",
    region: "Lazio",
    country: "Italia",
    latitude: 41.8919,
    longitude: 12.5113,
    elevation: null,
    timezone: "Europe/Rome",
  };

  const isLocal =
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost";

  if (isLocal) {
    dom.searchInput.value = "Roma, Lazio";
    state.selectedLocation = romaDefault;
    loadWeatherData(romaDefault);
    return;
  }

  try {
    dom.searchInput.value = "📍 Rilevamento posizione…";
    dom.searchInput.disabled = true;
    const res = await fetch(
      "https://meteopunto-worker.hentzeldieter.workers.dev/api/geolocate",
    );
    const data = await res.json();
    dom.searchInput.disabled = false;

    if (data.success && data.latitude && data.longitude) {
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
        country_code: "IT",
        latitude: data.latitude,
        longitude: data.longitude,
        elevation: null,
        timezone: data.timezone || "Europe/Rome",
      };
      dom.searchInput.value = cityName;
      state.selectedLocation = location;
      updateAllerteVisibility("IT");
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

/* ═══════════════════════════════════════
   MAPPA INTERATTIVA – GLOBALE
   20 capoluoghi IT + capitali EU + metropoli mondo
   + RainViewer layer live + zoom anti-caos
═══════════════════════════════════════ */
const CAPOLUOGHI = [
  { name: "Roma", lat: 41.8919, lon: 12.5113 },
  { name: "Milano", lat: 45.4654, lon: 9.1859 },
  { name: "Napoli", lat: 40.8518, lon: 14.2681 },
  { name: "Torino", lat: 45.0703, lon: 7.6869 },
  { name: "Palermo", lat: 38.1157, lon: 13.3615 },
  { name: "Genova", lat: 44.4056, lon: 8.9463 },
  { name: "Bologna", lat: 44.4949, lon: 11.3426 },
  { name: "Firenze", lat: 43.7696, lon: 11.2558 },
  { name: "Bari", lat: 41.1171, lon: 16.8719 },
  { name: "Catania", lat: 37.5079, lon: 15.083 },
  { name: "Venezia", lat: 45.4408, lon: 12.3155 },
  { name: "Verona", lat: 45.4384, lon: 10.9916 },
  { name: "Trieste", lat: 45.6495, lon: 13.7768 },
  { name: "Trento", lat: 46.0748, lon: 11.1217 },
  { name: "Ancona", lat: 43.6158, lon: 13.5189 },
  { name: "Perugia", lat: 43.1107, lon: 12.3908 },
  { name: "L'Aquila", lat: 42.3498, lon: 13.3995 },
  { name: "Potenza", lat: 40.6402, lon: 15.8057 },
  { name: "Catanzaro", lat: 38.9098, lon: 16.5872 },
  { name: "Cagliari", lat: 39.2238, lon: 9.1217 },
];

const CAPITALI_EU = [
  { name: "Londra", lat: 51.5074, lon: -0.1278 },
  { name: "Parigi", lat: 48.8566, lon: 2.3522 },
  { name: "Berlino", lat: 52.52, lon: 13.405 },
  { name: "Madrid", lat: 40.4168, lon: -3.7038 },
  { name: "Vienna", lat: 48.2082, lon: 16.3738 },
  { name: "Atene", lat: 37.9838, lon: 23.7275 },
  { name: "Varsavia", lat: 52.2297, lon: 21.0122 },
  { name: "Amsterdam", lat: 52.3676, lon: 4.9041 },
  { name: "Bruxelles", lat: 50.8503, lon: 4.3517 },
  { name: "Lisbona", lat: 38.7169, lon: -9.1399 },
  { name: "Stoccolma", lat: 59.3293, lon: 18.0686 },
  { name: "Oslo", lat: 59.9139, lon: 10.7522 },
  { name: "Copenaghen", lat: 55.6761, lon: 12.5683 },
  { name: "Helsinki", lat: 60.1699, lon: 24.9384 },
  { name: "Zurigo", lat: 47.3769, lon: 8.5417 },
  { name: "Praga", lat: 50.0755, lon: 14.4378 },
  { name: "Budapest", lat: 47.4979, lon: 19.0402 },
  { name: "Bucarest", lat: 44.4268, lon: 26.1025 },
  { name: "Mosca", lat: 55.7558, lon: 37.6173 },
  { name: "Istanbul", lat: 41.0082, lon: 28.9784 },
];

const METROPOLI_MONDO = [
  { name: "New York", lat: 40.7128, lon: -74.006 },
  { name: "Los Angeles", lat: 34.0522, lon: -118.2437 },
  { name: "Chicago", lat: 41.8781, lon: -87.6298 },
  { name: "Toronto", lat: 43.6532, lon: -79.3832 },
  { name: "Città del Messico", lat: 19.4326, lon: -99.1332 },
  { name: "Tokyo", lat: 35.6762, lon: 139.6503 },
  { name: "Pechino", lat: 39.9042, lon: 116.4074 },
  { name: "Shanghai", lat: 31.2304, lon: 121.4737 },
  { name: "Seoul", lat: 37.5665, lon: 126.978 },
  { name: "Mumbai", lat: 19.076, lon: 72.8777 },
  { name: "Delhi", lat: 28.6139, lon: 77.209 },
  { name: "Dubai", lat: 25.2048, lon: 55.2708 },
  { name: "Singapore", lat: 1.3521, lon: 103.8198 },
  { name: "Sydney", lat: -33.8688, lon: 151.2093 },
  { name: "Melbourne", lat: -37.8136, lon: 144.9631 },
  { name: "Cairo", lat: 30.0444, lon: 31.2357 },
  { name: "Lagos", lat: 6.5244, lon: 3.3792 },
  { name: "Johannesburg", lat: -26.2041, lon: 28.0473 },
  { name: "Buenos Aires", lat: -34.6037, lon: -58.3816 },
  { name: "Rio de Janeiro", lat: -22.9068, lon: -43.1729 },
  { name: "São Paulo", lat: -23.5505, lon: -46.6333 },
  { name: "Bogotà", lat: 4.711, lon: -74.0721 },
  { name: "Lima", lat: -12.0464, lon: -77.0428 },
];

function wmoToMapClass(code) {
  if ([0, 1].includes(code)) return "cond-clear";
  if ([2, 3, 45, 48].includes(code)) return "cond-cloud";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return "cond-rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "cond-snow";
  if ([95, 96, 99].includes(code)) return "cond-storm";
  return "cond-cloud";
}

const COND_COLORS = {
  clear: { bg: "#FFF3CD", border: "#F57C00", dot: "#F57C00" },
  cloud: { bg: "#ECEFF1", border: "#78909C", dot: "#78909C" },
  rain: { bg: "#E3F2FD", border: "#1565C0", dot: "#1565C0" },
  storm: { bg: "#F3E5F5", border: "#6A1B9A", dot: "#6A1B9A" },
  snow: { bg: "#E8F4FD", border: "#5DADE2", dot: "#5DADE2" },
};

let italiaMap = null;
let mapMarkers = [];
let mapMarkersEU = [];
let mapMarkersMondo = [];
let rainviewerLayer = null;

async function fetchCapoluogoDay(cap, dayIdx) {
  const params = new URLSearchParams({
    latitude: cap.lat,
    longitude: cap.lon,
    daily: "weathercode,temperature_2m_max",
    timezone: "Europe/Rome",
    forecast_days: 16,
  });
  try {
    const res = await fetch(`${CONFIG.METEO_URL}?${params}`);
    const data = await res.json();
    return {
      temp: Math.round(data.daily.temperature_2m_max[dayIdx]),
      code: data.daily.weathercode[dayIdx],
    };
  } catch {
    return { temp: "--", code: 0 };
  }
}

function createMarker(cap, temp, code) {
  const markerCond = wmoToCondition(code);
  const isMobile = window.innerWidth < 768;
  const iconSize = isMobile ? "1.4rem" : "1.8rem";
  const tempSize = isMobile ? "10px" : "12px";

  const icon = L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;cursor:pointer;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.25));">
      <span style="font-size:${iconSize};line-height:1">${markerCond.icon}</span>
      <span style="font-size:${tempSize};font-weight:700;color:#1a1a2e;background:rgba(255,255,255,0.85);border-radius:6px;padding:1px 4px;line-height:1.3;">${temp}°</span>
    </div>`,
    iconAnchor: [12, 12],
  });

  const marker = L.marker([cap.lat, cap.lon], { icon });

  const popupCond = wmoToCondition(code);
  marker.bindPopup(
    `
    <div style="text-align:center;padding:4px 8px;min-width:120px">
      <div style="font-size:1.4rem">${popupCond.icon}</div>
      <div style="font-weight:700;font-size:1rem">${cap.name}</div>
      <div style="font-size:1.2rem;font-weight:700;color:#00a8e8">${temp}°C</div>
      <div style="font-size:0.75rem;color:#666;margin-top:4px">${popupCond.label}</div>
      <button onclick="window._mapSelectCity(this.dataset.city)" data-city="${cap.name}" style="
        margin-top:8px;background:#00a8e8;color:#fff;border:none;
        border-radius:12px;padding:5px 14px;font-size:0.78rem;
        font-weight:600;cursor:pointer;width:100%;
      ">Vedi previsioni</button>
    </div>
  `,
    { maxWidth: 160 },
  );

  marker.bindTooltip(
    `<div style="text-align:center;padding:2px 6px;font-size:0.78rem;font-weight:600;">${cap.name}<br><span style="color:#00a8e8;font-size:0.72rem;">Clicca per le previsioni</span></div>`,
    {
      direction: "top",
      offset: [0, -10],
      permanent: false,
    },
  );

  return marker;
}

function createStaticMarker(city) {
  const isMobile = window.innerWidth < 768;
  const iconSize = isMobile ? "1.2rem" : "1.5rem";
  const nameSize = isMobile ? "9px" : "11px";

  const icon = L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;cursor:pointer;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.25));">
      <span style="font-size:${iconSize};line-height:1">🌍</span>
      <span style="font-size:${nameSize};font-weight:700;color:#1a1a2e;background:rgba(255,255,255,0.85);border-radius:6px;padding:1px 5px;line-height:1.3;white-space:nowrap;">${city.name}</span>
    </div>`,
    iconAnchor: [12, 12],
  });

  const marker = L.marker([city.lat, city.lon], { icon });

  marker.bindTooltip(
    `<div style="text-align:center;padding:2px 6px;font-size:0.78rem;font-weight:600;">
    ${city.name}<br>
    <span style="color:#00a8e8;font-size:0.72rem;">Clicca per le previsioni</span>
  </div>`,
    { direction: "top", offset: [0, -10], permanent: false },
  );

  marker.on("click", () => window._mapSelectCity(city.name));

  return marker;
}

window._mapSelectCity = function (cityName) {
  dom.searchInput.value = cityName;
  fetchLocations(cityName).then((results) => {
    if (results && results.length > 0) {
      selectLocation(results[0]);
      setTimeout(() => {
        dom.forecastSection.scrollIntoView({ behavior: "smooth" });
      }, 300);
    }
  });
  if (italiaMap) italiaMap.closePopup();
};

async function updateMapMarkers(dayIdx) {
  mapMarkers.forEach((m) => italiaMap.removeLayer(m));
  mapMarkers = [];
  const results = await Promise.all(
    CAPOLUOGHI.map((cap) => fetchCapoluogoDay(cap, dayIdx)),
  );
  CAPOLUOGHI.forEach((cap, i) => {
    const { temp, code } = results[i];
    const marker = createMarker(cap, temp, code);
    mapMarkers.push(marker);
  });
  applyZoomVisibility(italiaMap.getZoom());
}

function buildStaticMarkers() {
  mapMarkersEU = CAPITALI_EU.map((city) => createStaticMarker(city));
  mapMarkersMondo = METROPOLI_MONDO.map((city) => createStaticMarker(city));
}

function applyZoomVisibility(zoom) {
  [...mapMarkers, ...mapMarkersEU, ...mapMarkersMondo].forEach((m) => {
    if (italiaMap.hasLayer(m)) italiaMap.removeLayer(m);
  });
  if (zoom >= 5) {
    mapMarkers.forEach((m) => m.addTo(italiaMap));
  } else if (zoom === 4) {
    mapMarkersEU.forEach((m) => m.addTo(italiaMap));
  } else {
    mapMarkersMondo.forEach((m) => m.addTo(italiaMap));
  }
}

async function addRainViewerLayer() {
  try {
    const res = await fetch(
      "https://api.rainviewer.com/public/weather-maps.json",
    );
    const data = await res.json();
    const frames = data.radar?.past;
    if (!frames || !frames.length) return;
    const latest = frames[frames.length - 1];
    const tileUrl = `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
    rainviewerLayer = L.tileLayer(tileUrl, {
      opacity: 0.5,
      attribution: '&copy; <a href="https://rainviewer.com">RainViewer</a>',
    });
    rainviewerLayer.addTo(italiaMap);
  } catch (e) {
    console.warn("RainViewer non disponibile:", e);
  }
}

function initMap() {
  if (italiaMap) return;
  if (typeof L === "undefined") return;

  italiaMap = L.map("italia-map", {
    center: [42.5, 12.5],
    zoom: 5,
    scrollWheelZoom: false,
    zoomControl: true,
    minZoom: 2,
  });

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org">OSM</a>',
      subdomains: "abcd",
      maxZoom: 18,
    },
  ).addTo(italiaMap);

  addRainViewerLayer();
  buildStaticMarkers();
  updateMapMarkers(0);

  italiaMap.on("zoomend", () => {
    applyZoomVisibility(italiaMap.getZoom());
  });

  document.querySelectorAll(".map-day-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      document
        .querySelectorAll(".map-day-btn")
        .forEach((b) => b.classList.remove("active"));
      this.classList.add("active");
      updateMapMarkers(parseInt(this.dataset.day));
    });
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", function (e) {
      const txt = this.textContent.trim();
      const navHeight =
        document.querySelector(".site-header")?.offsetHeight || 64;

      function scrollToEl(el) {
        if (!el) return;
        const top =
          el.getBoundingClientRect().top + window.scrollY - navHeight - 16;
        window.scrollTo({ top, behavior: "smooth" });
      }

      if (txt === "Italia" || txt === "Mappe") {
        e.preventDefault();
        scrollToEl(document.getElementById("map-heading").closest("section"));
        setTimeout(() => italiaMap && italiaMap.flyTo([42.5, 12.5], 5), 400);
      } else if (txt === "Europa") {
        e.preventDefault();
        scrollToEl(document.getElementById("map-heading").closest("section"));
        setTimeout(() => italiaMap && italiaMap.flyTo([54.0, 15.0], 4), 400);
      } else if (txt === "Mondo") {
        e.preventDefault();
        scrollToEl(document.getElementById("map-heading").closest("section"));
        setTimeout(() => italiaMap && italiaMap.flyTo([20.0, 0.0], 2), 400);
      } else if (txt === "Radar") {
        e.preventDefault();
        scrollToEl(document.getElementById("map-heading").closest("section"));
      } else if (txt === "Allerte") {
        e.preventDefault();
        const allerteSection = document.getElementById("allerte");
        if (allerteSection && !allerteSection.hidden) {
          scrollToEl(allerteSection);
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
          setTimeout(
            () =>
              alert(
                "Il servizio di monitoraggio allerte è attivo sul territorio italiano.",
              ),
            600,
          );
        }
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(initMap, 800);
});

/* ═══════════════════════════════════════
   COOKIE BANNER
═══════════════════════════════════════ */
(function initCookieBanner() {
  const banner = document.getElementById("cookie-banner");
  if (!banner) return;

  const consent = localStorage.getItem("mp_cookie_consent");
  if (!consent) {
    banner.hidden = false;
  }

  document.getElementById("cookie-accept").addEventListener("click", () => {
    localStorage.setItem("mp_cookie_consent", "accepted");
    banner.hidden = true;
  });

  document.getElementById("cookie-reject").addEventListener("click", () => {
    localStorage.setItem("mp_cookie_consent", "rejected");
    banner.hidden = true;
  });
})();
