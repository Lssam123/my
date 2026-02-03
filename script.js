const SERVERS = {
    // سيرفرات البينق المحلي السعودي
    local: {
        stc: "https://www.stc.com.sa/favicon.ico",
        mobily: "https://www.mobily.com.sa/favicon.ico",
        zain: "https://www.sa.zain.com/favicon.ico"
    },
    // السيرفرات العالمية للسرعة العالية
    global_dl: "https://speed.cloudflare.com/__down?bytes=500000000",
    global_ping: "https://1.1.1.1/cdn-cgi/trace",
    global_ul: "https://httpbin.org/post"
};

async function startHybridEngine() {
    const btn = document.querySelector('.start-btn');
    btn.disabled = true;

    // 1. فحص البينق المحلي فقط (أقرب السيرفرات)
    await measureLocalPings();

    // 2. فحص التحميل + البينق المثقل (باستخدام السيرفر العالمي)
    document.getElementById('c-loaded').classList.add('active');
    const dlMetrics = await runGlobalDownload(12000);
    document.getElementById('v-dl').innerText = Math.round(dlMetrics.speed);
    document.getElementById('v-loaded').innerText = dlMetrics.loadedPing.toFixed(1);
    document.getElementById('c-loaded').classList.remove('active');

    // 3. فحص الرفع (حل مشكلة التوقف عبر كتل متوازية)
    document.getElementById('c-ul').classList.add('active');
    const ulSpeed = await runGlobalUpload(10000);
    document.getElementById('v-ul').innerText = ulSpeed.toFixed(1);
    document.getElementById('c-ul').classList.remove('active');

    btn.disabled = false;
}

// فحص البينق المحلي (STC, Mobily, Zain)
async function measureLocalPings() {
    const targets = Object.keys(SERVERS.local);
    let best = 999;

    for (let isp of targets) {
        let pings = [];
        for (let i = 0; i < 8; i++) {
            const t0 = performance.now();
            try {
                await fetch(SERVERS.local[isp] + "?n=" + Math.random(), { mode: 'no-cors' });
                pings.push(performance.now() - t0);
            } catch (e) {}
        }
        const avg = pings.length ? (pings.reduce((a, b) => a + b) / pings.length) : 0;
        document.getElementById(`p-${isp}`).innerText = avg.toFixed(1);
        if (avg > 0 && avg < best) best = avg;
    }
    document.getElementById('v-idle').innerText = best.toFixed(1);
}

// فحص التحميل العالمي + البينق تحت الضغط
async function runGlobalDownload(duration) {
    let bytes = 0;
    let loadedPings = [];
    const startTime = performance.now();
    const abort = new AbortController();

    // قياس البينق العالمي أثناء التحميل
    const pingInterval = setInterval(async () => {
        const t0 = performance.now();
        await fetch(SERVERS.global_ping, { mode: 'no-cors' });
        loadedPings.push(performance.now() - t0);
    }, 200);

    const streams = Array(20).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                const res = await fetch(SERVERS.global_dl + "&nocache=" + Math.random(), { signal: abort.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - startTime >= duration)) break;
                    bytes += value.length;
                    const elapsed = (performance.now() - startTime) / 1000;
                    if (elapsed > 2) {
                        const mbps = (bytes * 8) / (1024 * 1024) / elapsed;
                        document.getElementById('v-dl').innerText = Math.round(mbps);
                    }
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    abort.abort();
    clearInterval(pingInterval);

    return {
        speed: (bytes * 8) / (1024 * 1024) / (duration / 1000),
        loadedPing: (loadedPings.reduce((a, b) => a + b, 0) / loadedPings.length)
    };
}

// حل مشكلة الرفع: استخدام كتل بيانات 2MB عبر 8 مسارات متزامنة
async function runGlobalUpload(duration) {
    let upBytes = 0;
    const start = performance.now();
    const chunk = new Uint8Array(2 * 1024 * 1024); // 2MB

    const uploaders = Array(8).fill(0).map(async () => {
        while (performance.now() - start < duration) {
            try {
                await fetch(SERVERS.global_ul, {
                    method: 'POST',
                    body: chunk,
                    mode: 'no-cors',
                    keepalive: true
                });
                upBytes += chunk.length;
                const elapsed = (performance.now() - start) / 1000;
                const mbps = (upBytes * 8) / (1024 * 1024) / elapsed;
                document.getElementById('v-ul').innerText = mbps.toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    return (upBytes * 8) / (1024 * 1024) / (duration / 1000);
}
