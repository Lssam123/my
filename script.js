const CORE_RESOURCES = {
    // سيرفر STC للفحص الصامت للبينق
    ping_server: "https://www.stc.com.sa/favicon.ico",
    // سيرفرات عالمية للتحميل والرفع
    global_dl: "https://speed.cloudflare.com/__down?bytes=26214400", // ملف 25MB للداونلود
    global_ul: "https://httpbin.org/post", 
    global_ping: "https://1.1.1.1/cdn-cgi/trace",
    dl_threads: 30, // عدد مسارات ضخم لتجاوز الحظر
    ul_threads: 12  // مسارات متوازنة للرفع
};

async function startV16Engine() {
    const btn = document.querySelector('.go-btn');
    const status = document.getElementById('status-msg');
    btn.disabled = true;

    // 1. فحص البينق (يتم من STC داخلياً ولكن يظهر كـ "بينق عام")
    status.innerText = "جاري معايرة زمن الاستجابة الأولي...";
    document.getElementById('c-idle').classList.add('active');
    const idleVal = await runSilentPing();
    document.getElementById('v-idle').innerText = idleVal.toFixed(1);
    document.getElementById('c-idle').classList.remove('active');

    // 2. فحص التحميل (25MB Chunks) + البينق المثقل
    status.innerText = "جاري تشغيل 30 مسار تحميل عالمي...";
    document.getElementById('c-loaded').classList.add('active');
    const dlMetrics = await runHyperDownload(12000);
    document.getElementById('dl-text').innerText = Math.round(dlMetrics.speed);
    document.getElementById('v-loaded').innerText = dlMetrics.loadedPing.toFixed(1);
    document.getElementById('c-loaded').classList.remove('active');

    // 3. فحص الرفع (20MB Chunks) مع منع الحظر
    status.innerText = "جاري تحليل سرعة الإرسال (الرفع المطور)...";
    document.getElementById('c-ul').classList.add('active');
    const ulSpeed = await runHyperUpload(10000);
    document.getElementById('v-ul').innerText = ulSpeed.toFixed(1);
    document.getElementById('c-ul').classList.remove('active');

    status.innerText = "تمت عملية الفحص بنجاح.";
    btn.disabled = false;
}

// فحص البينق الصامت (لا يظهر المصدر للمستخدم)
async function runSilentPing() {
    let pings = [];
    for(let i=0; i<12; i++) {
        const t0 = performance.now();
        try {
            await fetch(CORE_RESOURCES.ping_server + "?v=" + Math.random(), { mode: 'no-cors' });
            pings.push(performance.now() - t0);
        } catch(e) {}
    }
    pings.sort((a,b) => a-b);
    return pings[Math.floor(pings.length / 2)]; // القيمة الوسيطة لدقة مذهلة
}

// محرك التحميل (30 مسار + ملفات 25MB)
async function runHyperDownload(ms) {
    let totalBytes = 0;
    let lPings = [];
    const start = performance.now();
    const controller = new AbortController();

    const pinger = setInterval(async () => {
        const t0 = performance.now();
        await fetch(CORE_RESOURCES.global_ping, { mode: 'no-cors' });
        lPings.push(performance.now() - t0);
    }, 150);

    const streams = Array(CORE_RESOURCES.dl_threads).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                // تقنية Anti-Ban عبر توليد مسارات فريدة
                const streamID = Math.random().toString(36).substring(7);
                const res = await fetch(CORE_RESOURCES.global_dl + "&stream=" + streamID, { signal: controller.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - start >= ms)) break;
                    totalBytes += value.length;
                    const elapsed = (performance.now() - start) / 1000;
                    if (elapsed > 1.5) {
                        const speed = (totalBytes * 8) / (1024 * 1024) / elapsed;
                        document.getElementById('dl-text').innerText = Math.round(speed);
                    }
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    controller.abort();
    clearInterval(pinger);
    return {
        speed: (totalBytes * 8) / (1024 * 1024) / (ms / 1000),
        loadedPing: lPings.reduce((a,b)=>a+b,0) / lPings.length
    };
}

// محرك الرفع (12 مسار + ملفات 20MB)
async function runHyperUpload(ms) {
    let upBytes = 0;
    const start = performance.now();
    const blob = new Blob([new Uint8Array(20 * 1024 * 1024)]); // ملف رفع 20MB

    const uploaders = Array(CORE_RESOURCES.ul_threads).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const uniqueKey = Math.random().toString(36).substring(7);
                await fetch(CORE_RESOURCES.global_ul + "?auth=" + uniqueKey, {
                    method: 'POST',
                    body: blob,
                    mode: 'no-cors'
                });
                upBytes += blob.size;
                const elapsed = (performance.now() - start) / 1000;
                document.getElementById('v-ul').innerText = ((upBytes * 8) / (1024 * 1024) / elapsed).toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (upBytes * 8) / (1024 * 1024) / (ms / 1000);
}
