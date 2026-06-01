function searchCity() {
    const cityName = document.getElementById('city-input').value.trim();
    if (!cityName) return alert("Inserisci il nome di una città o comune!");

    const geocodingUrl = `https://open-meteo.com{encodeURIComponent(cityName)}&count=1&language=it`;

    fetch(geocodingUrl)
        .then(response => response.json())
        .then(data => {
            if (!data.results || data.results.length === 0) {
                throw new Error("Località non trovata. Riprova controllando il nome.");
            }

            const city = data.results[0];
            const lat = city.latitude;
            const lon = city.longitude;
            const country = city.country || "";
            const admin1 = city.admin1 ? `, ${city.admin1}` : "";

            document.getElementById('city-name').innerText = `${city.name}${admin1}, ${country}`;

            getWeather(lat, lon);
        })
        .catch(error => {
            alert(error.message);
        });
}

function getWeather(lat, lon) {
    const weatherUrl = `https://open-meteo.com{lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`;

    fetch(weatherUrl)
        .then(response => response.json())
        .then(data => {
            const current = data.current;
            document.getElementById('temperature').innerText = `${Math.round(current.temperature_2m)}°C`;
            document.getElementById('humidity').innerText = `Umidità: ${current.relative_humidity_2m}%`;
            document.getElementById('wind').innerText = `Vento: ${current.wind_speed_10m} km/h`;
        })
        .catch(error => {
            alert("Errore nel recupero dei dati meteo.");
        });
}
