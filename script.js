/** * محرك فحص السرعة المتوازي - مشروع تخرج
 * تم تحسين هذا الكود ليعمل بـ 6 مسارات تحميل متزامنة لضمان تشبع القناة
 */

const CONFIG = {
    testFile: "https://speed.cloudflare.com/__down?bytes=50000000",
    pingSvc: "https://1.1.1.1/cdn-cgi/trace",
    threads: 6 // عدد المسارات المتزامنة للدقة القصوى
};

const dom = {
    btn: document.getElementById('start-btn'),
    mainSpeed: document.getElementById('main-speed'),
    ping: document.getElementById('ping'),
    jitter: document.getElementById('jitter'),
    loaded: document.getElementById('loaded-ping'),
    dl: document.getElementById('dl-res'),
    ul: document.getElementById('ul-res'),
    status: document.getElementById('status'),
    app: document.getElementById('app')
};

async function startAnalysis() {
    dom.btn.disabled = true;
    dom.app.classList.add('scanning');
    dom.status.innerText = "جاري معاينة جودة القناة...";

    // 1. قياس الـ Ping الخامل بدقة إحصائية
    const idleStats = await getPingStats(10);
    dom.ping.innerText = idleStats.avg.toFixed(1);
    dom.jitter.innerText = idleStats.jitter.toFixed(1);

    // 2. قياس التحميل المتوازي + Ping المثقل
    dom.status.innerText = "جاري اختبار التحميل المتعدد (Multi-threading)...";
    const downloadStats = await performParallelDownload();
    dom.dl.innerText = downloadStats.speed;
    dom.loaded.innerText = downloadStats.loadedPing.toFixed(1);

    // 3. قياس الرفع
    dom.status.innerText = "جاري اختبار الرفع الحي...";
    const uploadSpeed = await performUploadTest();
    dom.ul.innerText = uploadSpeed;

    dom.status.innerText = "اكتمل التحليل الفني بنجاح";
    dom.app.classList.remove('scanning');
    dom.btn.disabled = false;
}

async function getPingStats(samples) {
    let results = [];
    for(let i=0; i<samples; i++) {
        const start = performance.now();
        await fetch(CONFIG.pingSvc + "?n=" + i, { mode: 'no-cors', cache: 'no-cache' });
        results.push(performance.now() - start);
    }
    // تصفية القيم الشاذة (أعلى وأدنى قيمة)
    results.sort((a, b) => a - b);
    const filtered = results.slice(1, -1); 
    const avg = filtered.reduce((a, b) => a + b) / filtered.length;
    return { avg, jitter: results[results.length-1] - results[0] };
}

async function performParallelDownload() {
    const startTime = performance.now();
    let totalBytes = 0;
    let loadedPings = [];

    // مراقبة الـ Ping أثناء الضغط
    const monitor = setInterval(async () => {
        const pStart = performance.now();
        await fetch(CONFIG.pingSvc + "?load=true", { mode: 'no-cors' });
        loadedPings.push(performance.now() - pStart);
    }, 200);

    // تشغيل عدة مسارات تحميل في نفس الوقت
    const downloadThreads = Array(CONFIG.threads).fill(0).map(async () => {
        const response = await fetch(CONFIG.testFile + "&t=" + Math.random());
        const reader = response.body.getReader();
        while(true) {
            const {done, value} = await reader.read();
            if (done) break;
            totalBytes += value.length;
            
            // تحديث الواجهة اللحظي
            const elapsed = (performance.now() - startTime) / 1000;
            const mbps = ((totalBytes * 8) / (1024 * 1024) / elapsed).toFixed(2);
            dom.mainSpeed.innerText = Math.floor(mbps);
        }
    });

    await Promise.all(downloadThreads);
    clearInterval(monitor);

    const finalTime = (performance.now() - startTime) / 1000;
    return {
        speed: ((totalBytes * 8) / (1024 * 1024) / finalTime).toFixed(2),
        loadedPing: loadedPings.reduce((a,b)=>a+b, 0) / loadedPings.length
    };
}

async function performUploadTest() {
    // محاكاة رفع بيانات 8MB
    const blob = new Blob([new Uint8Array(8 * 1024 * 1024)]);
    const start = performance.now();
    await fetch('https://httpbin.org/post', { method: 'POST', body: blob });
    const duration = (performance.now() - start) / 1000;
    return ((blob.size * 8) / (1024 * 1024) / duration).toFixed(2);
}

dom.btn.onclick = startAnalysis;
