const apiKey = "2d82dbdecba67d3e9742ec667dcfb3dd";

document.getElementById("themeToggle").onclick = () => {
    document.body.classList.toggle("dark");
};

async function getWeather() {
    const city = document.getElementById("cityInput").value;
    fetchWeather(city);
}

async function getLocationWeather() {
    navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        fetchWeather(null, lat, lon);
    });
}

async function fetchWeather(city, lat = null, lon = null) {
    let url = city
        ? `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=ar`
        : `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=ar`;

    const res = await fetch(url);
    const data = await res.json();

    displayCurrentWeather(data);

    // توقعات 5 أيام
    const forecastUrl = city
        ? `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${apiKey}&units=metric&lang=ar`
        : `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=ar`;

    const forecastRes = await fetch(forecastUrl);
    const forecastData = await forecastRes.json();

    displayForecast(forecastData);
}

function displayCurrentWeather(data) {
    document.getElementById("currentWeather").innerHTML = `
        <h2>${data.name}</h2>
        <img src="https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png">
        <p>درجة الحرارة: ${data.main.temp}°C</p>
        <p>الحالة: ${data.weather[0].description}</p>
        <p>الرطوبة: ${data.main.humidity}%</p>
        <p>الرياح: ${data.wind.speed} m/s</p>
    `;
}

function displayForecast(data) {
    const container = document.getElementById("forecast");
    container.innerHTML = "";

    const daily = data.list.filter(item => item.dt_txt.includes("12:00:00"));

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
