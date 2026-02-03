const CONFIG = {
    dl_file: "https://speed.cloudflare.com/__down?bytes=500000000", // ملف 500 ميجا
    ul_endpoint: "https://httpbin.org/post",
    ping_target: "https://1.1.1.1/cdn-cgi/trace", // سيرفر كلاود فلير (الأسرع عالمياً)
    threads: 20, // 20 مسار تحميل متوازي لإحداث "إجهاد" كامل للشبكة
    ping_samples: 50 // عدد العينات لضمان الدقة
};

async function startEngine() {
    const btn = document.getElementById('run-btn');
    const log = document.getElementById('log');
    btn.disabled = true;

    // المرحلة 1: البينق غير المثقل (بدقة 50 عينة)
    log.innerText = "جاري قياس البينق غير المثقل بدقة ميكرو-ثانية...";
    document.getElementById('b-ping').classList.add('active');
    const idlePing = await measurePrecisionPing(CONFIG.ping_samples);
    document.getElementById('v-ping').innerText = idlePing.toFixed(2);
    document.getElementById('b-ping').classList.remove('active');

    // المرحلة 2: التحميل + البينق المثقل (أهم جزء في مشروعك)
    log.innerText = "جاري إشباع الشبكة بـ 20 مسار وقياس البينق تحت الضغط...";
    document.getElementById('b-loaded').classList.add('active');
    const dlData = await runUltraDownload(15000);
    document.getElementById('dl-val').innerText = Math.round(dlData.speed);
    document.getElementById('v-loaded').innerText = dlData.loadedPing.toFixed(2);
    document.getElementById('b-loaded').classList.remove('active');

    // المرحلة 3: الرفع
    log.innerText = "جاري تحليل سرعة الرفع...";
    document.getElementById('b-upload').classList.add('active');
    const ulSpeed = await runUltraUpload(15000);
    document.getElementById('v-upload').innerText = ulSpeed;
    document.getElementById('b-upload').classList.remove('active');

    log.innerText = "تمت المعايرة. النتائج جاهزة للمناقشة.";
    btn.disabled = false;
}

// دالة البينق فائقة الدقة
async function measurePrecisionPing(count) {
    let pings = [];
    for (let i = 0; i < count; i++) {
        const t0 = performance.now();
        try {
            await fetch(CONFIG.ping_target, { mode: 'no-cors', cache: 'no-cache' });
            pings.push(performance.now() - t0);
        } catch(e) {}
        await new Promise(r => setTimeout(r, 50)); // فاصل زمني صغير جداً بين العينات
    }
    // تصفية إحصائية: حذف القيم الشاذة القصوى
    pings.sort((a, b) => a - b);
    const trimmed = pings.slice(Math.floor(pings.length * 0.1), -Math.floor(pings.length * 0.1));
    return trimmed.reduce((a, b) => a + b) / trimmed.length;
}

// محرك التحميل المتوازي (20 مسار) مع مراقبة البينق
async function runUltraDownload(duration) {
    let bytes = 0;
    let loadedPings = [];
    const startTime = performance.now();
    const abort = new AbortController();

    // فحص البينق أثناء التحميل النشط (Loaded Ping) كل 200 ملي ثانية
    const pinger = setInterval(async () => {
        const t0 = performance.now();
        try {
            await fetch(CONFIG.ping_target, { mode: 'no-cors' });
            loadedPings.push(performance.now() - t0);
        } catch(e) {}
    }, 200);

    const streams = Array(CONFIG.threads).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                const res = await fetch(CONFIG.dl_file + "&r=" + Math.random(), { signal: abort.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - startTime >= duration)) break;
                    bytes += value.length;
                    const elapsed = (performance.now() - startTime) / 1000;
                    if (elapsed > 1) {
                        const mbps = ((bytes * 8) / (1024 * 1024) / elapsed);
                        document.getElementById('dl-val').innerText = Math.round(mbps);
                    }
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    abort.abort();
    clearInterval(pinger);

    return {
        speed: ((bytes * 8) / (1024 * 1024) / (duration / 1000)).toFixed(1),
        loadedPing: loadedPings.reduce((a,b)=>a+b, 0) / loadedPings.length
    };
}

// محرك الرفع بملف ضخم
async function runUltraUpload(duration) {
    let upBytes = 0;
    const startTime = performance.now();
    const blob = new Blob([new Uint8Array(10 * 1024 * 1024)]); // قطعة 10 ميجا

    while (performance.now() - startTime < duration) {
        try {
            await fetch(CONFIG.ul_endpoint, { method: 'POST', body: blob, mode: 'no-cors' });
            upBytes += blob.size;
            const elapsed = (performance.now() - startTime) / 1000;
            const mbps = ((upBytes * 8) / (1024 * 1024) / elapsed).toFixed(1);
            document.getElementById('v-upload').innerText = mbps;
        } catch (e) { break; }
    }
    return ((upBytes * 8) / (1024 * 1024) / (duration / 1000)).toFixed(1);
}
