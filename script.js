/**
 * نظام تحليل الشبكة المتقدم - النسخة النهائية لمشروع التخرج
 * الخوارزمية: مسارات متوازية مجدولة زمنياً (15 ثانية / 5 ثواني)
 */

const ENDPOINTS = {
    dl: "https://speed.cloudflare.com/__down?bytes=150000000",
    ping: "https://1.1.1.1/cdn-cgi/trace",
    ul: "https://httpbin.org/post"
};

async function startFinalTest() {
    const btn = document.getElementById('main-btn');
    const progress = document.getElementById('progress-text');
    btn.disabled = true;

    // المرحلة الأولى: البينق الخامل (5 ثواني)
    progress.innerText = "جاري قياس زمن الاستجابة الخامل...";
    document.getElementById('box-ping').classList.add('active');
    const idlePing = await runIdlePing(5000);
    document.getElementById('res-ping').innerText = idlePing.toFixed(0);
    document.getElementById('box-ping').classList.remove('active');

    // المرحلة الثانية: التحميل + البينق المثقل (15 ثانية)
    progress.innerText = "جاري تحليل سرعة التحميل والضغط...";
    document.getElementById('box-loaded').classList.add('active');
    const dlData = await runDownloadAnalysis(15000);
    document.getElementById('display-main').innerText = dlData.speed;
    document.getElementById('res-loaded').innerText = dlData.loadedPing.toFixed(0);
    document.getElementById('box-loaded').classList.remove('active');

    // المرحلة الثالثة: الرفع (15 ثانية)
    progress.innerText = "جاري تحليل كفاءة الرفع...";
    document.getElementById('box-upload').classList.add('active');
    const ulSpeed = await runUploadAnalysis(15000);
    document.getElementById('res-upload').innerText = ulSpeed;
    document.getElementById('box-upload').classList.remove('active');

    progress.innerText = "تم الانتهاء من التحليل الشامل";
    btn.disabled = false;
}

// دالة قياس البينق الخامل
async function runIdlePing(ms) {
    let pings = [];
    const start = Date.now();
    while (Date.now() - start < ms) {
        const t0 = performance.now();
        try {
            await fetch(ENDPOINTS.ping, { mode: 'no-cors', cache: 'no-cache' });
            pings.push(performance.now() - t0);
        } catch(e) {}
        await new Promise(r => setTimeout(r, 200));
    }
    return pings.length ? (pings.reduce((a,b)=>a+b)/pings.length) : 0;
}

// دالة التحميل المتقدمة (15 ثانية)
async function runDownloadAnalysis(ms) {
    let bytes = 0;
    let loadedPings = [];
    const startTime = performance.now();
    const controller = new AbortController();

    // فحص البينق أثناء التحميل النشط (Bufferbloat)
    const pinger = setInterval(async () => {
        const t0 = performance.now();
        try {
            await fetch(ENDPOINTS.ping, { mode: 'no-cors' });
            loadedPings.push(performance.now() - t0);
        } catch(e) {}
    }, 300);

    const threads = 6;
    const downloadJobs = Array(threads).fill(0).map(async () => {
        while (performance.now() - startTime < ms) {
            try {
                const res = await fetch(ENDPOINTS.dl + "&nocache=" + Math.random(), { signal: controller.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - startTime >= ms)) break;
                    bytes += value.length;
                    
                    const elapsed = (performance.now() - startTime) / 1000;
                    const mbps = ((bytes * 8) / (1024 * 1024) / elapsed);
                    // تحديث العداد المركزي
                    document.getElementById('display-main').innerText = mbps.toFixed(mbps > 10 ? 0 : 1);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    controller.abort();
    clearInterval(pinger);

    return {
        speed: ((bytes * 8) / (1024 * 1024) / (ms / 1000)).toFixed(1),
        loadedPing: loadedPings.length ? (loadedPings.reduce((a,b)=>a+b)/loadedPings.length) : 0
    };
}

// دالة الرفع المتقدمة (15 ثانية)
async function runUploadAnalysis(ms) {
    let uploaded = 0;
    const startTime = performance.now();
    const data = new Uint8Array(1024 * 1024); // 1MB chunk

    while (performance.now() - startTime < ms) {
        try {
            await fetch(ENDPOINTS.ul, { method: 'POST', body: data, mode: 'no-cors' });
            uploaded += data.length;
            const elapsed = (performance.now() - startTime) / 1000;
            const mbps = ((uploaded * 8) / (1024 * 1024) / elapsed).toFixed(1);
            document.getElementById('res-upload').innerText = mbps;
        } catch (e) { break; }
    }
    return ((uploaded * 8) / (1024 * 1024) / (ms / 1000)).toFixed(1);
}
