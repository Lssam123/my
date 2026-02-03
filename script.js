const CONFIG = {
    dl: "https://speed.cloudflare.com/__down?bytes=300000000",
    ping: "https://1.1.1.1/cdn-cgi/trace",
    ul: "https://httpbin.org/post",
    pTime: 5000,
    tTime: 15000,
    maxThreads: 12 // تعدد مسارات فائق للوصول لأقصى سرعة
};

async function startEngine() {
    const btn = document.getElementById('go-btn');
    const status = document.getElementById('status-info');
    btn.disabled = true;

    // 1. فحص البينق (5ث)
    status.innerText = "قياس زمن الاستجابة الأساسي...";
    document.getElementById('c-ping').classList.add('active');
    const pIdle = await runAdvancedPing(CONFIG.pTime);
    document.getElementById('v-ping').innerText = pIdle.toFixed(0);
    document.getElementById('c-ping').classList.remove('active');

    // 2. فحص التحميل والبينق المثقل (15ث)
    status.innerText = "تحليل كفاءة التحميل تحت الضغط القصوى...";
    document.getElementById('c-loaded').classList.add('active');
    const dlResult = await runAdvancedDownload(CONFIG.tTime);
    document.getElementById('hero-num').innerText = dlResult.speed;
    document.getElementById('v-loaded').innerText = dlResult.loadedPing.toFixed(0);
    document.getElementById('c-loaded').classList.remove('active');

    // 3. فحص الرفع (15ث)
    status.innerText = "تحليل قدرة الإرسال والاستقرار...";
    document.getElementById('c-upload').classList.add('active');
    const ulSpeed = await runAdvancedUpload(CONFIG.tTime);
    document.getElementById('v-upload').innerText = ulSpeed.toFixed(1);
    document.getElementById('c-upload').classList.remove('active');

    status.innerText = "اكتمل الفحص: تمت المعايرة بنجاح";
    btn.disabled = false;
}

// دالة البينق مع الفلترة الإحصائية
async function runAdvancedPing(ms) {
    let results = [];
    const start = Date.now();
    while (Date.now() - start < ms) {
        const t0 = performance.now();
        await fetch(CONFIG.ping, { mode: 'no-cors', cache: 'no-cache' });
        results.push(performance.now() - t0);
        await new Promise(r => setTimeout(r, 100));
    }
    // استبعاد القيم الشاذة (Trimmed Mean)
    results.sort((a, b) => a - b);
    const middle = results.slice(Math.ceil(results.length * 0.1), Math.floor(results.length * 0.9));
    return middle.reduce((a,b) => a+b) / middle.length;
}

// دالة التحميل مع تعدد المسارات الديناميكي
async function runAdvancedDownload(duration) {
    let bytes = 0;
    let loadedPings = [];
    const startTime = performance.now();
    const abort = new AbortController();

    // فحص البينق المثقل
    const pinger = setInterval(async () => {
        const t0 = performance.now();
        await fetch(CONFIG.ping, { mode: 'no-cors' });
        loadedPings.push(performance.now() - t0);
    }, 200);

    const workers = Array(CONFIG.maxThreads).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                const res = await fetch(CONFIG.dl + "&cb=" + Math.random(), { signal: abort.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - startTime >= duration)) break;
                    bytes += value.length;
                    
                    const now = (performance.now() - startTime) / 1000;
                    const mbps = ((bytes * 8) / (1024 * 1024) / now);
                    // تحديث بصري سريع
                    document.getElementById('hero-num').innerText = Math.round(mbps);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    abort.abort();
    clearInterval(pinger);

    return {
        speed: ((bytes * 8) / (1024 * 1024) / (duration / 1000)).toFixed(1),
        loadedPing: (loadedPings.reduce((a,b)=>a+b, 0) / loadedPings.length)
    };
}

async function runAdvancedUpload(duration) {
    let upBytes = 0;
    const startTime = performance.now();
    const chunk = new Uint8Array(2 * 1024 * 1024); // رفع قطع 2MB لزيادة الدقة

    while (performance.now() - startTime < duration) {
        try {
            await fetch(CONFIG.ul, { method: 'POST', body: chunk, mode: 'no-cors' });
            upBytes += chunk.length;
            const now = (performance.now() - startTime) / 1000;
            const mbps = ((upBytes * 8) / (1024 * 1024) / now).toFixed(1);
            document.getElementById('v-upload').innerText = mbps;
        } catch (e) { break; }
    }
    return ((upBytes * 8) / (1024 * 1024) / (duration / 1000));
}
