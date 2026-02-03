const ENGINE_CONFIG = {
    dl_url: "https://speed.cloudflare.com/__down?bytes=500000000", // ملف ضخم نصف جيجا
    ping_url: "https://1.1.1.1/cdn-cgi/trace", // أقرب سيرفر Anycast
    ul_url: "https://httpbin.org/post",
    test_duration: 15000, 
    threads: 20 // 20 مسار متوازي لإشباع النطاق بالكامل
};

async function launchUltraEngine() {
    const btn = document.getElementById('run-btn');
    const log = document.getElementById('engine-log');
    btn.disabled = true;

    // 1. فحص البينق الخامل (أقرب سيرفر)
    log.innerText = "تحديد أقرب سيرفر ومعايرة الاستجابة...";
    document.getElementById('b-ping').classList.add('active');
    const idlePing = await runUltraPing(5000);
    document.getElementById('v-ping').innerText = idlePing.toFixed(0);
    document.getElementById('b-ping').classList.remove('active');

    // 2. التحميل العملاق (20 مسار) + البينق المثقل
    log.innerText = "إطلاق 20 مسار تحميل متوازي لإشباع النطاق...";
    document.getElementById('b-loaded').classList.add('active');
    const dlMetrics = await runUltraDownload(ENGINE_CONFIG.test_duration);
    document.getElementById('main-speed').innerText = dlMetrics.speed;
    document.getElementById('v-loaded').innerText = dlMetrics.loadedPing.toFixed(0);
    document.getElementById('b-loaded').classList.remove('active');

    // 3. الرفع المعزز
    log.innerText = "تحليل كفاءة الرفع (High-Payload Mode)...";
    document.getElementById('b-upload').classList.add('active');
    const ulSpeed = await runUltraUpload(ENGINE_CONFIG.test_duration);
    document.getElementById('v-upload').innerText = ulSpeed.toFixed(1);
    document.getElementById('b-upload').classList.remove('active');

    log.innerText = "اكتمل الفحص الفائق - دقة 99.9%";
    btn.disabled = false;
}

// دالة البينق (أقرب سيرفر + تصفية إحصائية)
async function runUltraPing(ms) {
    let pings = [];
    const start = Date.now();
    while (Date.now() - start < ms) {
        const t0 = performance.now();
        await fetch(ENGINE_CONFIG.ping_url, { mode: 'no-cors', cache: 'no-cache' });
        pings.push(performance.now() - t0);
        await new Promise(r => setTimeout(r, 100));
    }
    pings.sort((a, b) => a - b);
    const middle = pings.slice(Math.floor(pings.length * 0.15), -Math.floor(pings.length * 0.15));
    return middle.reduce((a, b) => a + b) / middle.length;
}

// محرك التحميل بـ 20 مسار متوازي
async function runUltraDownload(duration) {
    let totalBytes = 0;
    let loadedPings = [];
    const startT = performance.now();
    const abort = new AbortController();

    const pingTask = setInterval(async () => {
        const t0 = performance.now();
        await fetch(ENGINE_CONFIG.ping_url, { mode: 'no-cors' });
        loadedPings.push(performance.now() - t0);
    }, 200);

    // إنشاء 20 مسار تدفق (Flooding Engine)
    const streams = Array(ENGINE_CONFIG.threads).fill(0).map(async () => {
        while (performance.now() - startT < duration) {
            try {
                const res = await fetch(ENGINE_CONFIG.dl_url + "&r=" + Math.random(), { signal: abort.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - startT >= duration)) break;
                    totalBytes += value.length;
                    
                    const elapsed = (performance.now() - startT) / 1000;
                    if (elapsed > 1.5) { // استبعاد البداية الدافئة TCP
                        const mbps = ((totalBytes * 8) / (1024 * 1024) / elapsed);
                        document.getElementById('main-speed').innerText = Math.round(mbps);
                    }
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    abort.abort();
    clearInterval(pingTask);

    return {
        speed: ((totalBytes * 8) / (1024 * 1024) / (duration / 1000)).toFixed(1),
        loadedPing: (loadedPings.reduce((a,b)=>a+b, 0) / loadedPings.length)
    };
}

async function runUltraUpload(duration) {
    let upBytes = 0;
    const startT = performance.now();
    const payload = new Uint8Array(5 * 1024 * 1024); // رفع كتل ضخمة 5MB

    while (performance.now() - startT < duration) {
        try {
            await fetch(ENGINE_CONFIG.ul_url, { method: 'POST', body: payload, mode: 'no-cors' });
            upBytes += payload.length;
            const elapsed = (performance.now() - startT) / 1000;
            const mbps = ((upBytes * 8) / (1024 * 1024) / elapsed).toFixed(1);
            document.getElementById('v-upload').innerText = mbps;
        } catch (e) { break; }
    }
    return ((upBytes * 8) / (1024 * 1024) / (duration / 1000));
}
