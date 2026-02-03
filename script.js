const API_NODES = {
    ping: "https://1.1.1.1/cdn-cgi/trace",
    download: "https://speed.cloudflare.com/__down?bytes=8000000", // حزم 8MB مثالية
    upload: "https://speed.cloudflare.com/__up",
    dl_threads: 32, 
    ul_threads: 10
};

async function runEngine() {
    const btn = document.querySelector('.btn-launch');
    const log = document.getElementById('log-status');
    btn.disabled = true;

    // 1. مرحلة البينق (تصحيح الأرقام العالية)
    log.innerText = "جاري معايرة زمن الاستجابة الصافي...";
    document.getElementById('card-ping').classList.add('active');
    const idlePing = await measurePrecisionLatency();
    document.getElementById('v-ping').innerText = idlePing.toFixed(1);
    document.getElementById('card-ping').classList.remove('active');

    // 2. مرحلة التحميل + البينق المثقل
    log.innerText = "جاري تحليل التحميل بـ 32 مسار متوازٍ...";
    document.getElementById('card-loaded').classList.add('active');
    const dlMetrics = await runHyperDownload(12000);
    document.getElementById('dl-val').innerText = Math.round(dlMetrics.speed);
    document.getElementById('v-loaded').innerText = dlMetrics.loadedPing.toFixed(1);
    document.getElementById('card-loaded').classList.remove('active');

    // 3. مرحلة الرفع (حل مشكلة التوقف نهائياً)
    log.innerText = "جاري معايرة سرعة الرفع (حزم 4MB)...";
    document.getElementById('card-ul').classList.add('active');
    const ulSpeed = await runHyperUpload(10000);
    document.getElementById('v-ul').innerText = ulSpeed.toFixed(1);
    document.getElementById('card-ul').classList.remove('active');

    log.innerText = "اكتملت المعايرة بنجاح.";
    btn.disabled = false;
}

// دالة البينق (إهمال أول 3 قراءات DNS/Handshake)
async function measurePrecisionLatency() {
    let results = [];
    for (let i = 0; i < 12; i++) {
        const t0 = performance.now();
        try {
            await fetch(API_NODES.ping, { mode: 'no-cors', cache: 'no-cache' });
            results.push(performance.now() - t0);
        } catch (e) {}
    }
    // تصفية: حذف أول 3 قراءات (Warm-up) ثم أخذ أقل قيمة حقيقية
    const clean = results.slice(3).sort((a, b) => a - b);
    return clean[0] || 0; 
}

// محرك التحميل عالي الكثافة
async function runHyperDownload(duration) {
    let totalBytes = 0;
    let loadedPings = [];
    const startTime = performance.now();
    const abort = new AbortController();

    const pinger = setInterval(async () => {
        const p = await measurePrecisionLatency();
        if (p > 0) loadedPings.push(p);
    }, 400);

    const streams = Array(API_NODES.dl_threads).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                const res = await fetch(API_NODES.download + "&nocache=" + Math.random(), { signal: abort.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    totalBytes += value.length;
                    const elapsed = (performance.now() - startTime) / 1000;
                    const mbps = (totalBytes * 8) / (1024 * 1024) / elapsed;
                    if (elapsed > 1) document.getElementById('dl-val').innerText = Math.round(mbps);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    abort.abort();
    clearInterval(pinger);
    return {
        speed: (totalBytes * 8) / (1024 * 1024) / (duration / 1000),
        loadedPing: loadedPings.reduce((a, b) => a + b, 0) / loadedPings.length
    };
}

// محرك الرفع المستقر (حزم 4MB متتالية)
async function runHyperUpload(duration) {
    let uploadedBytes = 0;
    const startTime = performance.now();
    const chunk = new Uint8Array(4 * 1024 * 1024); // 4MB

    const uploaders = Array(API_NODES.ul_threads).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                await fetch(API_NODES.upload, {
                    method: 'POST',
                    body: chunk,
                    mode: 'no-cors'
                });
                uploadedBytes += chunk.length;
                const elapsed = (performance.now() - startTime) / 1000;
                document.getElementById('v-ul').innerText = ((uploadedBytes * 8) / (1024 * 1024) / elapsed).toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    return (uploadedBytes * 8) / (1024 * 1024) / (duration / 1000);
}
