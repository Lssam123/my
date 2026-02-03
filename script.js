const RESOURCES = {
    // ملفات ضخمة لضمان استقرار الفحص
    downloadFile: "https://speed.cloudflare.com/__down?bytes=524288000", // 500MB
    uploadEndpoint: "https://httpbin.org/post", 
    pingTarget: "https://1.1.1.1/cdn-cgi/trace",
    threads: 16 // 16 مسار متزامن
};

async function startUltraPrecisionTest() {
    const btn = document.getElementById('run-btn');
    const log = document.getElementById('engine-log');
    btn.disabled = true;

    // 1. فحص البينق والتذبذب (Jitter)
    log.innerText = "جاري إجراء فحص بينق عالي التردد...";
    document.getElementById('c-ping').classList.add('active');
    document.getElementById('c-jitter').classList.add('active');
    const pingMetrics = await measureHighFrequencyPing(5000);
    document.getElementById('v-ping').innerText = pingMetrics.avg.toFixed(1);
    document.getElementById('v-jitter').innerText = pingMetrics.jitter.toFixed(1);
    document.getElementById('c-ping').classList.remove('active');
    document.getElementById('c-jitter').classList.remove('active');

    // 2. فحص التحميل (500MB Payload)
    log.innerText = "جاري تحميل ملف 500MB لإشباع النطاق الترددي...";
    const dlResult = await runUltraDownload(15000);
    document.getElementById('dl-val').innerText = dlResult;

    // 3. فحص الرفع (Dynamic Payload)
    log.innerText = "جاري إرسال ملفات اختبار (Upload Analysis)...";
    document.getElementById('c-upload').classList.add('active');
    const ulResult = await runUltraUpload(15000);
    document.getElementById('v-upload').innerText = ulResult;
    document.getElementById('c-upload').classList.remove('active');

    log.innerText = "تمت المعايرة بنجاح وفق المعايير القياسية";
    btn.disabled = false;
}

// دالة البينق المتطورة لقياس التذبذب (Jitter)
async function measureHighFrequencyPing(ms) {
    let pings = [];
    const start = Date.now();
    while (Date.now() - start < ms) {
        const t0 = performance.now();
        await fetch(RESOURCES.pingTarget, { mode: 'no-cors', cache: 'no-cache' });
        pings.push(performance.now() - t0);
        await new Promise(r => setTimeout(r, 50)); // نبضة كل 50 ملي ثانية
    }
    
    // حساب المتوسط
    const avg = pings.reduce((a, b) => a + b) / pings.length;
    
    // حساب التذبذب (الفرق المتوسط بين القراءات المتتالية)
    let totalJitter = 0;
    for (let i = 1; i < pings.length; i++) {
        totalJitter += Math.abs(pings[i] - pings[i-1]);
    }
    const jitter = totalJitter / (pings.length - 1);
    
    return { avg, jitter };
}

// محرك التحميل بملف 500MB
async function runUltraDownload(duration) {
    let bytesReceived = 0;
    const startTime = performance.now();
    const abort = new AbortController();

    const workers = Array(RESOURCES.threads).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                const res = await fetch(RESOURCES.downloadFile + "&nocache=" + Math.random(), { signal: abort.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - startTime >= duration)) break;
                    bytesReceived += value.length;
                    
                    const elapsed = (performance.now() - startTime) / 1000;
                    if (elapsed > 1) { // استقرار TCP
                        const mbps = ((bytesReceived * 8) / (1024 * 1024) / elapsed);
                        document.getElementById('dl-val').innerText = Math.round(mbps);
                    }
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    abort.abort();
    return ((bytesReceived * 8) / (1024 * 1024) / (duration / 1000)).toFixed(1);
}

// محرك الرفع بملف مخصص 50MB
async function runUltraUpload(duration) {
    let bytesUploaded = 0;
    const startTime = performance.now();
    const blob = new Blob([new Uint8Array(50 * 1024 * 1024)]); // ملف رفع 50MB خام

    while (performance.now() - startTime < duration) {
        try {
            await fetch(RESOURCES.uploadEndpoint, { method: 'POST', body: blob, mode: 'no-cors' });
            bytesUploaded += blob.size;
            const elapsed = (performance.now() - startTime) / 1000;
            const mbps = ((bytesUploaded * 8) / (1024 * 1024) / elapsed).toFixed(1);
            document.getElementById('v-upload').innerText = mbps;
        } catch (e) { break; }
    }
    return ((bytesUploaded * 8) / (1024 * 1024) / (duration / 1000)).toFixed(1);
}
