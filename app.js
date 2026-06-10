// ======================
// Base configuration
// ======================
// ======================
// Base configuration
// ======================

const BASE_URL = "https://api.openweathermap.org/data/2.5";

const API_KEY = "0fbd71c43b9d1fa47d6c950126f17e15";


const searchForm = document.getElementById("search-form");
const cityInput = document.getElementById("city-input");

// Current weather elements
const cityNameEl = document.getElementById("city-name");
const currentDateEl = document.getElementById("current-date");
const tempNowEl = document.getElementById("temp-now");
const descriptionEl = document.getElementById("description");
const tempMinEl = document.getElementById("temp-min");
const tempMaxEl = document.getElementById("temp-max");
const iconEl = document.getElementById("icon");
const feelsLikeEl = document.getElementById("feels-like");
const windEl = document.getElementById("wind");
const humidityEl = document.getElementById("humidity");
const pressureEl = document.getElementById("pressure");

// Extra details
const sunriseEl = document.getElementById("sunrise");
const sunsetEl = document.getElementById("sunset");
const cloudsEl = document.getElementById("clouds");
const visibilityEl = document.getElementById("visibility");
const yearEl = document.getElementById("year");yearEl.textContent = new Date().getFullYear();

// Forecast
const hoursGrid = document.getElementById("hours-grid");
const daysGrid = document.getElementById("days-grid");

// Map cities (SVG groups)
const mapCities = document.querySelectorAll(".map-city");

// ======================
// Utils
// ======================

function formatDateTime(ts, options) {
  return new Date(ts * 1000).toLocaleString("it-IT", options);
}

function formatTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

// ======================
// API calls
// ======================

async function getCoords(city) {
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=5&appid=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.length) throw new Error("Città non trovata");
  
  // Preferisce Italia se disponibile
  const italy = data.find(c => c.country === "IT");
  return italy || data[0];
}

async function fetchCurrent(city) {
  const { lat, lon } = await getCoords(city);
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=it`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Città non trovata");
  return res.json();
}

async function fetchForecast(city) {
  const { lat, lon } = await getCoords(city);
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=it`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Forecast error");
  return res.json();
}
 

// ======================
// Render current weather
// ======================

function renderCurrent(data) {
  cityNameEl.textContent = `${data.name}, ${data.sys.country}`;

  let dateStr = formatDateTime(data.dt, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  });
  dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  currentDateEl.textContent = dateStr;

  const temp = Math.round(data.main.temp);
  const tMin = Math.round(data.main.temp_min);
  const tMax = Math.round(data.main.temp_max);

  tempNowEl.textContent = `${temp}°`;
  tempMinEl.textContent = `Min: ${tMin}°`;
  tempMaxEl.textContent = `Max: ${tMax}°`;

  const desc = data.weather[0].description || "";
  const descCap = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : "";
  descriptionEl.textContent = descCap;

  const iconCode = data.weather[0].icon;
  iconEl.src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
  iconEl.alt = data.weather[0].description || "Weather icon";

  feelsLikeEl.textContent = `${Math.round(data.main.feels_like)}°`;
  windEl.textContent = `${Math.round(data.wind.speed * 3.6)} km/h`;
  humidityEl.textContent = `${data.main.humidity}%`;
  pressureEl.textContent = `${data.main.pressure} hPa`;

  sunriseEl.textContent = formatTime(data.sys.sunrise);
  sunsetEl.textContent = formatTime(data.sys.sunset);
  cloudsEl.textContent = `${data.clouds.all}%`;
  visibilityEl.textContent = `${(data.visibility / 1000).toFixed(1)} km`;
}

// ======================
// Render today hours
// ======================

function renderTodayHours(forecast) {
  hoursGrid.innerHTML = "";

  const now = new Date();
const todayItems = forecast.list.filter(item => {
  const d = new Date(item.dt * 1000);
  return d.getDate() === now.getDate() && 
         d.getMonth() === now.getMonth();
});

  todayItems.forEach(item => {
    const date = new Date(item.dt * 1000);
    const hourLabel = date.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit"
    });

    const card = document.createElement("div");
    card.className = "hour-card";

    const iconCode = item.weather[0].icon;
    const desc = item.weather[0].description || "";

    card.innerHTML = `
      <strong>${hourLabel}</strong>
      <img src="https://openweathermap.org/img/wn/${iconCode}@2x.png" alt="${desc}">
      <div>${Math.round(item.main.temp)}°C</div>
      <div style="font-size:0.75rem;color:#6b7280">${desc}</div>
    `;

    hoursGrid.appendChild(card);
  });

  if (!todayItems.length) {
    hoursGrid.innerHTML = "<p>No hourly data available.</p>";
  }
}

// ======================
// Render next days
// ======================

function renderDays(forecast) {
  daysGrid.innerHTML = "";

  const byDay = {};

  forecast.list.forEach(item => {
    const date = new Date(item.dt * 1000);
    const dayKey = date.toISOString().slice(0, 10);

    if (!byDay[dayKey]) {
      byDay[dayKey] = [];
    }
    byDay[dayKey].push(item);
  });

  const days = Object.keys(byDay).sort().slice(0, 5);

  days.forEach((dayKey, index) => {
    const items = byDay[dayKey];

    let min = Infinity;
    let max = -Infinity;
    let chosen = items[0];

    items.forEach(item => {
      const t = item.main.temp;
      if (t < min) min = t;
      if (t > max) max = t;
      if (
        Math.abs(new Date(item.dt * 1000).getHours() - 12) <
        Math.abs(new Date(chosen.dt * 1000).getHours() - 12)
      ) {
        chosen = item;
      }
    });

    const date = new Date(chosen.dt * 1000);
    const label = date.toLocaleDateString("it-IT", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit"
    });

    const iconCode = chosen.weather[0].icon;
    const desc = chosen.weather[0].description || "";

    const card = document.createElement("div");
    card.className = "day-card";

    card.innerHTML = `
      <div class="day-label">${index === 0 ? "Today" : label}</div>
      <img src="https://openweathermap.org/img/wn/${iconCode}@2x.png" alt="${desc}">
      <div class="temps">
        <span><strong>${Math.round(max)}°</strong> / ${Math.round(min)}°</span>
      </div>
      <div style="font-size:0.75rem;color:#6b7280;margin-top:2px">
        ${desc}
      </div>
    `;

    daysGrid.appendChild(card);
  });
}

// ======================
// Map: city temperatures
// ======================

async function loadMapCityWeather() {
  if (!mapCities.length) return;

  mapCities.forEach(cityGroup => {
    const tempSpan = cityGroup.querySelector("tspan.temp");
    if (tempSpan) tempSpan.textContent = "";
  });

  mapCities.forEach(async cityGroup => {
    const cityName = cityGroup.getAttribute("data-city");
    const tempSpan = cityGroup.querySelector("tspan.temp");
    if (!tempSpan) return;

    try {
      const data = await fetchCurrent(cityName);
      const t = Math.round(data.main.temp);
      tempSpan.textContent = ` ${t}°`;
    } catch (e) {
      tempSpan.textContent = "";
    }
  });
}

// ======================
// Load a city
// ======================

async function loadCity(city) {
  try {
    cityNameEl.textContent = "Loading...";
    const [current, forecast] = await Promise.all([
      fetchCurrent(city),
      fetchForecast(city)
    ]);
    renderCurrent(current);
    renderTodayHours(forecast);
    renderDays(forecast);
  } catch (err) {
    alert(err.message || "Error loading weather data");
  }
}

// ======================
// Events
// ======================

searchForm.addEventListener("submit", e => {
  e.preventDefault();
  const city = cityInput.value.trim();
  if (!city) return;
  loadCity(city);
});

document.querySelectorAll(".quick-cities button").forEach(btn => {
  btn.addEventListener("click", () => {
    const city = btn.getAttribute("data-city");
    if (!city) return;
    loadCity(city);
  });
});

mapCities.forEach(cityGroup => {
  cityGroup.addEventListener("click", () => {
    const city = cityGroup.getAttribute("data-city");
    if (!city) return;
    loadCity(city);
  });
});

// ======================
// Initial load
// ======================

yearEl.textContent = new Date().getFullYear();

loadCity("Rome");
loadMapCityWeather();

