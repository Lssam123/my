const apiKey = "2d82dbdecba67d3e9742ec667dcfb3dd";

document.getElementById("themeToggle").onclick = () => {
    document.body.classList.toggle("dark");
};

document.getElementById("searchBtn").addEventListener("click", () => {
    const city = document.getElementById("cityInput").value.trim();
    if (!city) return alert("اكتب اسم المدينة");
    fetchWeather(city);
});

document.getElementById("gpsBtn").addEventListener("click", () => {
    navigator.geolocation.getCurrentPosition(pos => {
        fetchWeather(null, pos.coords.latitude, pos.coords.longitude);
    });
});

async function fetchWeather(city, lat = null, lon = null) {
    let url = city
        ? `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=ar`
        : `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=ar`;

    const res = await fetch(url);
    const data = await res.json();

    displayCurrentWeather(data);
    drawWindGauge(data.wind.speed);

    fetchForecast(city, lat, lon);
    fetchAQI(data.coord.lat, data.coord.lon);
}

function displayCurrentWeather(data) {
    document.getElementById("currentWeather").innerHTML = `
        <h2>${data.name}</h2>
        <img src="https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png">
        <p>درجة الحرارة: ${data.main.temp}°C</p>
        <p>${data.weather[0].description}</p>
        <p>الرطوبة: ${data.main.humidity}%</p>
    `;
}

async function fetchForecast(city, lat, lon) {
    let url = city
        ? `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${apiKey}&units=metric&lang=ar`
        : `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=ar`;

    const res = await fetch(url);
    const data = await res.json();

    const container = document.getElementById("forecast");
    container.innerHTML = "";

    const daily = data.list.filter(i => i.dt_txt.includes("12:00:00"));

    daily.forEach(day => {
        container.innerHTML += `
            <div class="forecast-item">
                <h4>${new Date(day.dt_txt).toLocaleDateString("ar-SA")}</h4>
                <img src="https://openweathermap.org/img/wn/${day.weather[0].icon}.png">
                <p>${day.main.temp}°C</p>
                <p>${day.weather[0].description}</p>
            </div>
        `;
    });
}

async function fetchAQI(lat, lon) {
    const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();

    const aqi = data.list[0].main.aqi;
    const levels = ["ممتاز", "جيد", "متوسط", "سيء", "سيء جدًا"];

    document.getElementById("aqiCard").innerHTML = `
        <h3>جودة الهواء</h3>
        <p>${levels[aqi - 1]}</p>
    `;
}

function drawWindGauge(speed) {
    const canvas = document.getElementById("windGauge");
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, 200, 200);

    ctx.beginPath();
    ctx.arc(100, 100, 80, Math.PI, Math.PI + (speed / 20) * Math.PI);
    ctx.strokeStyle = "#0078ff";
    ctx.lineWidth = 15;
    ctx.stroke();

    ctx.font = "20px Cairo";
    ctx.fillText(speed + " m/s", 70, 110);
}
