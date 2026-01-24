async function getWeather() {
    const city = document.getElementById("cityInput").value;
    const apiKey = "2d82dbdecba67d3e9742ec667dcfb3dd";
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=ar`;

    const resultDiv = document.getElementById("weatherResult");

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.cod === "404") {
            resultDiv.innerHTML = "❌ المدينة غير موجودة";
            return;
        }

        resultDiv.innerHTML = `
            <h3>${data.name}</h3>
            <p>درجة الحرارة: ${data.main.temp}°C</p>
            <p>الحالة: ${data.weather[0].description}</p>
            <p>الرطوبة: ${data.main.humidity}%</p>
            <p>الرياح: ${data.wind.speed} m/s</p>
            <img src="https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png">
        `;
    } catch (error) {
        resultDiv.innerHTML = "⚠️ حدث خطأ أثناء جلب البيانات";
    }
}
