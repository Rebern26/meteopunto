// Cloudflare Pages Function — proxy per OpenWeatherMap
// La chiave API vive SOLO qui, nelle variabili d'ambiente di Cloudflare.
// Il browser non la vede mai.
//
// Endpoint disponibili (parametro "type"):
//   /api/owm?type=geo&q=Roma
//   /api/owm?type=weather&lat=41.9&lon=12.5
//   /api/owm?type=forecast&lat=41.9&lon=12.5

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const params = url.searchParams;
  const type = params.get("type");

  const KEY = env.OWM_API_KEY; // variabile d'ambiente Cloudflare

  if (!KEY) {
    return json({ error: "API key non configurata sul server" }, 500);
  }

  let target;

  if (type === "geo") {
    const q = params.get("q");
    if (!q) return json({ error: "Parametro q mancante" }, 400);
    target = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=5&appid=${KEY}`;
  } else if (type === "weather") {
    const lat = params.get("lat");
    const lon = params.get("lon");
    if (!lat || !lon) return json({ error: "lat/lon mancanti" }, 400);
    target = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${KEY}&units=metric&lang=it`;
  } else if (type === "forecast") {
    const lat = params.get("lat");
    const lon = params.get("lon");
    if (!lat || !lon) return json({ error: "lat/lon mancanti" }, 400);
    target = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${KEY}&units=metric&lang=it`;
  } else {
    return json({ error: "type non valido" }, 400);
  }

  try {
    const res = await fetch(target);
    const data = await res.json();
    return json(data, res.status);
  } catch (e) {
    return json({ error: "Errore nella richiesta a OpenWeatherMap" }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300", // 5 min cache lato edge
    },
  });
}
