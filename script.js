const CORE_CONFIG = {
    dl: "https://speed.cloudflare.com/__down?bytes=400000000", // 400MB
    ping: "https://1.1.1.1/cdn-cgi/trace",
    ul: "https://httpbin.org/post",
    p_duration: 5000, 
    t_duration: 15000,
    parallel_streams: 14 // رفع المسارات لضمان التشبع التام
};

async function initiateHighPrecisionTest() {
    const btn = document.getElementById('run-btn');
    const status = document.getElementById('engine-status');
    btn.disabled = true;

    // 1. معايرة البينق الخامل (5ث)
    status.innerText = "جاري قياس استجابة البروتوكول (Latency)...";
    document.getElementById('b-ping').classList.add('active');
    const idlePing = await runEnginePing(CORE_CONFIG.p_duration);
    document.getElementById('v-ping').innerText = idlePing.toFixed(0);
    document.getElementById('b-ping').classList.remove('active');

    // 2. معايرة التحميل + البينق المثقل (15ث)
    status.innerText = "جاري تحليل التدفق المستمر والضغط الرقمي...";
    document.getElementById('b-loaded').classList.add('active');
    const dlMetrics = await runEngineDownload(CORE_CONFIG.t_duration);
    document.getElementById('hero-speed').innerText = dlMetrics.speed;
    document.getElementById('v-loaded').innerText = dlMetrics.loadedPing.toFixed(0);
    document.getElementById('b-loaded').classList.remove('active');

    // 3. معايرة الرفع (15ث)
    status.innerText = "جاري تحليل كفاءة الإرسال (Upload Performance)...";
    document.getElementById('b-upload').classList.add('active');
    const ulSpeed = await runEngineUpload(CORE_CONFIG.t_duration);
    document.getElementById('v-upload').innerText = ulSpeed.toFixed(1);
    document.getElementById('b-upload').classList.remove('active');

    status.innerText = "تمت المعايرة بنجاح - النتائج نهائية";
    btn.disabled = false;
}

// دالة البينق الذكي مع الفلترة
async function runEnginePing(ms) {
    let rawPings = [];
    const start = Date.now();
    while (Date.now() - start < ms) {
        const t0 = performance.now();
        await fetch(CORE_CONFIG.ping, { mode: 'no-cors', cache: 'no-cache' });
        rawPings.push(performance.now() - t0);
        await new Promise(r => setTimeout(r, 120));
    }
    // خوارزمية Trimmed Mean لضمان الدقة
    rawPings.sort((a, b) => a - b);
    const filtered = rawPings.slice(Math.floor(rawPings.length * 0.1), -Math.floor(rawPings.length * 0.1));
    return filtered.reduce((a, b) => a + b) / filtered.length;
}

// محرك التحميل المتوازي الفائق
async function runEngineDownload(duration) {
    let bytesSum = 0;
    let lPings = [];
    const startT = performance.now();
    const abortSignal = new AbortController();

    // فحص البينق المثقل كل 250ms
    const pingInterval = setInterval(async () => {
        const t0 = performance.now();
        await fetch(CORE_CONFIG.ping, { mode: 'no-cors' });
        lPings.push(performance.now() - t0);
    }, 250);

    // إنشاء 14 مسار تدفق متزامن
    const streams = Array(CORE_CONFIG.parallel_streams).fill(0).map(async () => {
        while (performance.now() - startT < duration) {
            try {
                const res = await fetch(CORE_CONFIG.dl + "&nc=" + Math.random(), { signal: abortSignal.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - startT >= duration)) break;
                    bytesSum += value.length;
                    
                    const timeElapsed = (performance.now() - startT) / 1000;
                    if (timeElapsed > 1) { // تجاهل أول ثانية للحساب
                        const mbps = ((bytesSum * 8) / (1024 * 1024) / timeElapsed);
                        document.getElementById('hero-speed').innerText = Math.round(mbps);
                    }
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    abortSignal.abort();
    clearInterval(pingInterval);

    const finalMbps = ((bytesSum * 8) / (1024 * 1024) / (duration / 1000)).toFixed(1);
    return {
        speed: finalMbps,
        loadedPing: (lPings.reduce((a,b)=>a+b, 0) / lPings.length)
    };
}

async function runEngineUpload(duration) {
    let upBytes = 0;
    const startT = performance.now();
    const payload = new Uint8Array(4 * 1024 * 1024); // رفع كتل 4MB للدقة العظمى

    while (performance.now() - startT < duration) {
        try {
            await fetch(CORE_CONFIG.ul, { method: 'POST', body: payload, mode: 'no-cors' });
            upBytes += payload.length;
            const timeElapsed = (performance.now() - startT) / 1000;
            const mbps = ((upBytes * 8) / (1024 * 1024) / timeElapsed).toFixed(1);
            document.getElementById('v-upload').innerText = mbps;
        } catch (e) { break; }
    }
    return ((upBytes * 8) / (1024 * 1024) / (duration / 1000));
}
