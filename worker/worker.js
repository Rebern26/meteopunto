/**
 * ═══════════════════════════════════════════════════════════
 * METEOPUNTO.COM – worker.js
 * Cloudflare Worker · Backend Proxy Sicuro + Cache 30 min
 * ═══════════════════════════════════════════════════════════
 *
 * Endpoints esposti:
 *   GET /api/weather?lat=X&lon=Y&tz=Europe/Rome
 *   GET /api/marine?lat=X&lon=Y&tz=Europe/Rome
 *   GET /api/geo?q=Roma&lang=it
 *   GET /api/geolocate  ← NUOVO: rileva posizione dall'IP Cloudflare
 *   GET /api/health
 */

/* ═══════════════════════════════════════
   CONFIGURAZIONE
═══════════════════════════════════════ */
const CONFIG = {
  // TTL cache in secondi (30 minuti)
  CACHE_TTL: 60 * 30,

  // Domini autorizzati a chiamare il Worker (CORS whitelist)
  ALLOWED_ORIGINS: [
    "https://meteopunto.com",
    "https://www.meteopunto.com",
    "https://meteopunto.pages.dev", // dominio Cloudflare Pages automatico
    "http://127.0.0.1:5500", // Live Server VS Code (sviluppo)
    "http://localhost:5500",
    "http://localhost:3000",
  ],

  // Upstream APIs (Open-Meteo — nessuna API key richiesta)
  UPSTREAM: {
    GEO: "https://geocoding-api.open-meteo.com/v1/search",
    METEO: "https://api.open-meteo.com/v1/forecast",
    MARINE: "https://marine-api.open-meteo.com/v1/marine",
  },

  // Parametri obbligatori per ogni endpoint
  REQUIRED_PARAMS: {
    weather: ["lat", "lon"],
    marine: ["lat", "lon"],
    geo: ["q"],
  },

  // Limiti di validazione coordinate
  LAT_RANGE: [-90, 90],
  LON_RANGE: [-180, 180],
};

/* ═══════════════════════════════════════
   ENTRY POINT CLOUDFLARE WORKER
   Ogni richiesta HTTP passa da qui.
═══════════════════════════════════════ */
export default {
  async fetch(request, env, ctx) {
    // Gestione preflight CORS (richieste OPTIONS del browser)
    if (request.method === "OPTIONS") {
      return handleCORS(request);
    }

    // Solo GET è accettato
    if (request.method !== "GET") {
      return errorResponse(405, "Metodo non consentito. Usa GET.");
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get("Origin") || "";

    // Verifica origine autorizzata
    if (!isAllowedOrigin(origin)) {
      return errorResponse(403, "Origine non autorizzata.");
    }

    // Router
    try {
      if (path === "/api/weather")
        return await handleWeather(request, url, ctx);
      if (path === "/api/marine") return await handleMarine(request, url, ctx);
      if (path === "/api/geo") return await handleGeo(request, url, ctx);
      if (path === "/api/geolocate") return handleGeolocate(request);
      if (path === "/api/health") return handleHealth();
      return errorResponse(404, `Endpoint "${path}" non trovato.`);
    } catch (err) {
      console.error("[MeteoPunto Worker] Errore:", err.message);
      return errorResponse(500, "Errore interno del server. Riprova tra poco.");
    }
  },
};

/* ═══════════════════════════════════════
   HANDLER – /api/weather
   Previsioni meteo 16 giorni da Open-Meteo
═══════════════════════════════════════ */
async function handleWeather(request, url, ctx) {
  const params = url.searchParams;

  // Validazione parametri obbligatori
  const validationError = validateParams(
    params,
    CONFIG.REQUIRED_PARAMS.weather,
  );
  if (validationError) return errorResponse(400, validationError);

  const lat = parseFloat(params.get("lat"));
  const lon = parseFloat(params.get("lon"));
  const tz = params.get("tz") || "Europe/Rome";

  // Validazione range coordinate
  const coordError = validateCoords(lat, lon);
  if (coordError) return errorResponse(400, coordError);

  // Costruisce la URL upstream verso Open-Meteo
  const upstreamParams = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: [
      "temperature_2m",
      "apparent_temperature",
      "weathercode",
      "windspeed_10m",
      "winddirection_10m",
      "uv_index",
      "relativehumidity_2m",
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
    timezone: tz,
    wind_speed_unit: "kmh",
    forecast_days: 16,
  });

  const upstreamURL = `${CONFIG.UPSTREAM.METEO}?${upstreamParams}`;
  return await fetchWithCache(request, upstreamURL, ctx);
}

/* ═══════════════════════════════════════
   HANDLER – /api/marine
   Dati mare da Open-Meteo Marine API
═══════════════════════════════════════ */
async function handleMarine(request, url, ctx) {
  const params = url.searchParams;

  const validationError = validateParams(params, CONFIG.REQUIRED_PARAMS.marine);
  if (validationError) return errorResponse(400, validationError);

  const lat = parseFloat(params.get("lat"));
  const lon = parseFloat(params.get("lon"));
  const tz = params.get("tz") || "Europe/Rome";

  const coordError = validateCoords(lat, lon);
  if (coordError) return errorResponse(400, coordError);

  const upstreamParams = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: "wave_height,wave_direction,wave_period,wind_wave_height",
    timezone: tz,
    forecast_days: 16,
  });

  const upstreamURL = `${CONFIG.UPSTREAM.MARINE}?${upstreamParams}`;
  return await fetchWithCache(request, upstreamURL, ctx);
}

/* ═══════════════════════════════════════
   HANDLER – /api/geo
   Geocoding: cerca una città per nome
═══════════════════════════════════════ */
async function handleGeo(request, url, ctx) {
  const params = url.searchParams;

  const validationError = validateParams(params, CONFIG.REQUIRED_PARAMS.geo);
  if (validationError) return errorResponse(400, validationError);

  const q = params.get("q").trim();
  const lang = params.get("lang") || "it";
  const count = Math.min(parseInt(params.get("count") || "8"), 20); // max 20

  // Sanitizzazione query: solo lettere, spazi, apostrofi, trattini
  if (!/^[\p{L}\s'\-\.]+$/u.test(q)) {
    return errorResponse(400, "Query di ricerca non valida.");
  }
  if (q.length < 2 || q.length > 100) {
    return errorResponse(400, "La query deve essere tra 2 e 100 caratteri.");
  }

  const upstreamParams = new URLSearchParams({
    name: q,
    count: count,
    language: lang,
    format: "json",
  });

  const upstreamURL = `${CONFIG.UPSTREAM.GEO}?${upstreamParams}`;
  // Cache più breve per il geocoding (10 min) — i nomi delle città cambiano raramente
  return await fetchWithCache(request, upstreamURL, ctx, 600);
}

/* ═══════════════════════════════════════
   HANDLER – /api/geolocate
   Legge gli header nativi di Cloudflare per
   rilevare la posizione dell'utente dall'IP,
   senza richiedere permessi al browser.
   
   Cloudflare inietta automaticamente in request.cf:
   - latitude  → coordinata latitudine
   - longitude → coordinata longitudine
   - city      → nome città
   - country   → codice paese (es. "IT")
   - timezone  → fuso orario (es. "Europe/Rome")
═══════════════════════════════════════ */
function handleGeolocate(request) {
  const cf = request.cf || {};

  const lat = cf.latitude ? parseFloat(cf.latitude) : null;
  const lon = cf.longitude ? parseFloat(cf.longitude) : null;
  const city = cf.city || null;
  const country = cf.country || null;
  const timezone = cf.timezone || "Europe/Rome";

  // Se Cloudflare non ha fornito le coordinate → fallback Roma
  if (!lat || !lon) {
    return jsonResponse({
      success: false,
      fallback: true,
      message: "Geolocalizzazione IP non disponibile, uso Roma come default.",
      latitude: 41.8919,
      longitude: 12.5113,
      city: "Roma",
      country: "IT",
      timezone: "Europe/Rome",
    });
  }

  return jsonResponse({
    success: true,
    fallback: false,
    latitude: lat,
    longitude: lon,
    city: city,
    country: country,
    timezone: timezone,
  });
}

/* ═══════════════════════════════════════
   HANDLER – /api/health
   Endpoint di diagnostica
═══════════════════════════════════════ */
function handleHealth() {
  return jsonResponse({
    status: "ok",
    service: "MeteoPunto.com Worker",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    cache_ttl: `${CONFIG.CACHE_TTL}s`,
  });
}

/* ═══════════════════════════════════════
   CORE – FETCH CON CACHE CLOUDFLARE
   
   Strategia: Cache-First
   1. Calcola una cache key dalla URL upstream
   2. Cerca nella Cache API di Cloudflare
   3. Se HIT → restituisce dati cached istantaneamente
   4. Se MISS → chiama Open-Meteo, salva in cache, risponde
═══════════════════════════════════════ */
async function fetchWithCache(
  request,
  upstreamURL,
  ctx,
  ttl = CONFIG.CACHE_TTL,
) {
  // La Cache API di Cloudflare usa oggetti Request come chiave
  const cacheKey = new Request(upstreamURL, { method: "GET" });
  const cache = caches.default; // cache globale Cloudflare CDN

  // ── STEP 1: cerca in cache ──────────────────────────────
  let cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    // CACHE HIT: clona la risposta aggiungendo header diagnostico
    const body = await cachedResponse.json();
    const headers = buildCORSHeaders(request);
    headers.set("X-Cache", "HIT");
    headers.set("X-Cache-TTL", `${ttl}s`);
    headers.set("Content-Type", "application/json");
    headers.set("X-MeteoPunto", "v1");
    return new Response(JSON.stringify(body), { status: 200, headers });
  }

  // ── STEP 2: CACHE MISS → chiama upstream ───────────────
  const upstreamResponse = await fetch(upstreamURL, {
    headers: {
      "User-Agent": "MeteoPunto.com/1.0 Cloudflare-Worker",
      Accept: "application/json",
    },
    cf: {
      // Hint Cloudflare: non cachare a livello infrastrutturale
      // (lo gestiamo noi manualmente per avere controllo)
      cacheEverything: false,
    },
  });

  if (!upstreamResponse.ok) {
    // Propaga l'errore upstream al client
    const errText = await upstreamResponse.text();
    console.error(
      `[Worker] Upstream error ${upstreamResponse.status}:`,
      errText,
    );
    return errorResponse(
      502,
      `Servizio meteo temporaneamente non disponibile (${upstreamResponse.status}).`,
    );
  }

  const data = await upstreamResponse.json();

  // ── STEP 3: salva in cache con TTL ─────────────────────
  // La Cache API Cloudflare rispetta l'header Cache-Control
  const responseToCache = new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${ttl}, s-maxage=${ttl}`,
    },
  });
  // ctx.waitUntil: salva in cache in background senza bloccare la risposta
  ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));

  // ── STEP 4: risponde al client ──────────────────────────
  const headers = buildCORSHeaders(request);
  headers.set("X-Cache", "MISS");
  headers.set("X-Cache-TTL", `${ttl}s`);
  headers.set("Content-Type", "application/json");
  headers.set("X-MeteoPunto", "v1");

  return new Response(JSON.stringify(data), { status: 200, headers });
}

/* ═══════════════════════════════════════
   SICUREZZA – CORS
═══════════════════════════════════════ */

/** Verifica se l'origine è nella whitelist */
function isAllowedOrigin(origin) {
  if (!origin) return true; // richieste server-to-server senza Origin
  return CONFIG.ALLOWED_ORIGINS.includes(origin);
}

/** Costruisce gli header CORS da aggiungere a ogni risposta */
function buildCORSHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const headers = new Headers();
  headers.set(
    "Access-Control-Allow-Origin",
    isAllowedOrigin(origin) ? origin : "",
  );
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Accept");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return headers;
}

/** Risposta al preflight OPTIONS */
function handleCORS(request) {
  const headers = buildCORSHeaders(request);
  return new Response(null, { status: 204, headers });
}

/* ═══════════════════════════════════════
   VALIDAZIONE
═══════════════════════════════════════ */
function validateParams(params, required) {
  for (const p of required) {
    if (!params.has(p) || !params.get(p).trim()) {
      return `Parametro obbligatorio mancante: "${p}"`;
    }
  }
  return null;
}

function validateCoords(lat, lon) {
  if (isNaN(lat) || lat < CONFIG.LAT_RANGE[0] || lat > CONFIG.LAT_RANGE[1]) {
    return `Latitudine non valida: ${lat}. Range: ${CONFIG.LAT_RANGE[0]}–${CONFIG.LAT_RANGE[1]}`;
  }
  if (isNaN(lon) || lon < CONFIG.LON_RANGE[0] || lon > CONFIG.LON_RANGE[1]) {
    return `Longitudine non valida: ${lon}. Range: ${CONFIG.LON_RANGE[0]}–${CONFIG.LON_RANGE[1]}`;
  }
  return null;
}

/* ═══════════════════════════════════════
   HELPERS RISPOSTA
═══════════════════════════════════════ */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: true, status, message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
