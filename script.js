const apiKey = "2d82dbdecba67d3e9742ec667dcfb3dd"; // ضع مفتاحك هنا

// =========================
// 1) تبديل الوضع الليلي
// =========================
document.getElementById("themeToggle").addEventListener("click", () => {
    document.body.classList.toggle("dark");
});

// =========================
// 2) عند اختيار مدينة
// =========================
document.getElementById("citySelect").addEventListener("change", function () {
    const city = this.value;
    if (city) {
        fetchWeather(city);
    }
});

// =========================
// 3) جلب الطقس الحالي
// =========================
async function fetchWeather(city) {
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=ar`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.cod !== 200) {
            document.getElementById("currentWeather").innerHTML = "<p>تعذر جلب البيانات</p>";
            return;
        }

        displayCurrentWeather(data);
        drawWindGauge(data.wind.speed);

        fetchForecast(city);
        fetchAQI(data.coord.lat, data.coord.lon);

    } catch (error) {
        document.getElementById("currentWeather").innerHTML = "<p>خطأ في الاتصال</p>";
    }
}

// =========================
// 4) عرض الطقس الحالي
// =========================
function displayCurrentWeather(data) {
    document.getElementById("currentWeather").innerHTML = `
        <h2>${data.name}</h2>
        <img src="https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png">
        <p>درجة الحرارة: ${data.main.temp}°C</p>
        <p>${data.weather[0].description}</p>
        <p>الرطوبة: ${data.main.humidity}%</p>
        <p>الرياح: ${data.wind.speed} m/s</p>
    `;
}

// =========================
// 5) توقعات 5 أيام
// =========================
async function fetchForecast(city) {
    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${apiKey}&units=metric&lang=ar`;
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

// =========================
// 6) جودة الهواء AQI
// =========================
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

// =========================
// 7) عداد سرعة الرياح
// =========================
function drawWindGauge(speed) {
    const canvas = document.getElementById("windGauge");
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, 200, 200);

    // الخلفية
    ctx.beginPath();
    ctx.arc(100, 100, 80, Math.PI, 2 * Math.PI);
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 15;
    ctx.stroke();

    // المؤشر
    ctx.beginPath();
    const angle = Math.PI + (speed / 20) * Math.PI;
    ctx.arc(100, 100, 80, Math.PI, angle);
    ctx.strokeStyle = "#0078ff";
    ctx.lineWidth = 15;
    ctx.stroke();

    // النص
    ctx.font = "20px Cairo";
    ctx.fillStyle = "var(--text)";
    ctx.fillText(speed + " m/s", 70, 110);
}
