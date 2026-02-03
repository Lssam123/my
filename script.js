const CONFIG = {
    dl: "https://speed.cloudflare.com/__down?bytes=200000000", // 200MB لضمان عدم الانقطاع
    ping: "https://1.1.1.1/cdn-cgi/trace",
    ul: "https://httpbin.org/post",
    pTime: 5000,   // 5 ثواني للبينق
    tTime: 15000,  // 15 ثانية للتحميل والرفع
    threads: 8     // رفع عدد المسارات لزيادة دقة التشبع
};

async function masterProcess() {
    const btn = document.getElementById('btn-run');
    const log = document.getElementById('log');
    btn.disabled = true;

    try {
        // 1. فحص البينق (5ث)
        log.innerText = "تحليل زمن الاستجابة في حالة الخمول...";
        document.getElementById('card-ping').classList.add('active');
        const pingIdle = await fetchTimedPing(CONFIG.pTime);
        document.getElementById('v-ping').innerText = pingIdle.toFixed(0);
        document.getElementById('card-ping').classList.remove('active');

        // 2. فحص التحميل + البينق المثقل (15ث)
        log.innerText = "جاري اختبار استقبال البيانات تحت الضغط...";
        document.getElementById('card-loaded').classList.add('active');
        const dlData = await fetchTimedDownload(CONFIG.tTime);
        document.getElementById('main-speed').innerText = Math.round(dlData.speed);
        document.getElementById('v-loaded').innerText = dlData.loadedPing.toFixed(0);
        document.getElementById('card-loaded').classList.remove('active');

        // 3. فحص الرفع (15ث)
        log.innerText = "جاري اختبار كفاءة إرسال البيانات...";
        document.getElementById('card-upload').classList.add('active');
        const ulSpeed = await fetchTimedUpload(CONFIG.tTime);
        document.getElementById('v-upload').innerText = ulSpeed.toFixed(1);
        document.getElementById('card-upload').classList.remove('active');

        log.innerText = "اكتمل التحليل الفني للشبكة";
    } catch (e) {
        log.innerText = "حدث خطأ أثناء الفحص، يرجى المحاولة ثانية";
    } finally {
        btn.disabled = false;
    }
}

// دالة البينق المطورة
async function fetchTimedPing(ms) {
    let samples = [];
    const start = Date.now();
    while (Date.now() - start < ms) {
        const t0 = performance.now();
        await fetch(CONFIG.ping, { mode: 'no-cors', cache: 'no-cache' });
        samples.push(performance.now() - t0);
        await new Promise(r => setTimeout(r, 150));
    }
    return samples.reduce((a, b) => a + b) / samples.length;
}

// دالة التحميل العملاقة (Multithreaded + 15 Seconds)
async function fetchTimedDownload(duration) {
    let totalBytes = 0;
    let lPings = [];
    const startTime = performance.now();
    const abortCtrl = new AbortController();

    // فحص البينق المثقل كل 200 ملي ثانية
    const pinger = setInterval(async () => {
        const t0 = performance.now();
        await fetch(CONFIG.ping, { mode: 'no-cors' });
        lPings.push(performance.now() - t0);
    }, 200);

    const workers = Array(CONFIG.threads).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                const res = await fetch(CONFIG.dl + "&v=" + Math.random(), { signal: abortCtrl.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - startTime >= duration)) break;
                    totalBytes += value.length;
                    
                    const elapsed = (performance.now() - startTime) / 1000;
                    const mbps = ((totalBytes * 8) / (1024 * 1024) / elapsed);
                    // تحديث بصري انسيابي
                    document.getElementById('main-speed').innerText = Math.round(mbps);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    abortCtrl.abort();
    clearInterval(pinger);

    return {
        speed: ((totalBytes * 8) / (1024 * 1024) / (duration / 1000)).toFixed(1),
        loadedPing: lPings.reduce((a,b)=>a+b, 0) / lPings.length
    };
}

// دالة الرفع المجدولة
async function fetchTimedUpload(duration) {
    let upBytes = 0;
    const startTime = performance.now();
    const data = new Uint8Array(1024 * 1024); // 1MB

    while (performance.now() - startTime < duration) {
        try {
            await fetch(CONFIG.ul, { method: 'POST', body: data, mode: 'no-cors' });
            upBytes += data.length;
            const elapsed = (performance.now() - startTime) / 1000;
            const mbps = ((upBytes * 8) / (1024 * 1024) / elapsed);
            document.getElementById('v-upload').innerText = mbps.toFixed(1);
        } catch (e) { break; }
    }
    return ((upBytes * 8) / (1024 * 1024) / (duration / 1000));
}
