const runBtn = document.getElementById('run-btn');
const speedText = document.getElementById('display-speed');
const pingText = document.getElementById('ping-val');
const jitterText = document.getElementById('jitter-val');

let chart;
function initChart() {
    const ctx = document.getElementById('miniChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(15).fill(''),
            datasets: [{ data: [], borderColor: '#00d2ff', borderWidth: 2, tension: 0.4, pointRadius: 0 }]
        },
        options: { plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } }, responsive: true, maintainAspectRatio: false }
    });
}

async function runTest() {
    runBtn.disabled = true;
    runBtn.innerText = "...";
    
    // 1. قياس الـ Ping و Jitter
    let pings = [];
    for(let i=0; i<5; i++) {
        const start = performance.now();
        await fetch('https://1.1.1.1/cdn-cgi/trace', { mode: 'no-cors' });
        pings.push(performance.now() - start);
    }
    const avgPing = Math.min(...pings);
    const jitter = Math.max(...pings) - Math.min(...pings);
    pingText.innerText = avgPing.toFixed(0);
    jitterText.innerText = jitter.toFixed(0);

    // 2. قياس التحميل (استخدام ملف 50MB من Cloudflare)
    const testUrl = "https://speed.cloudflare.com/__down?bytes=50000000";
    const startTime = performance.now();
    const response = await fetch(testUrl);
    const reader = response.body.getReader();
    let receivedBytes = 0;

    while(true) {
        const {done, value} = await reader.read();
        if (done) break;
        receivedBytes += value.length;
        
        const duration = (performance.now() - startTime) / 1000;
        const mbps = ((receivedBytes * 8) / (1024 * 1024) / duration).toFixed(1);
        
        speedText.innerText = mbps;
        
        if (chart.data.datasets[0].data.length > 15) chart.data.datasets[0].data.shift();
        chart.data.datasets[0].data.push(mbps);
        chart.update('none');
    }

    runBtn.disabled = false;
    runBtn.innerText = "GO";
}

runBtn.addEventListener('click', runTest);
initChart();
