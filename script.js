const URLS = {
    // سيرفر STC للفحص المحلي (مخفي)
    local: "https://www.stc.com.sa/favicon.ico",
    // سيرفرات الاختبار العالمية
    dl: "https://speed.cloudflare.com/__down?bytes=8388608", // حزم 8MB للداونلود
    ul: "https://httpbin.org/post",
    ping: "https://1.1.1.1/cdn-cgi/trace"
};

async function startEngine() {
    const btn = document.querySelector('.btn');
    btn.disabled = true;

    // 1. فحص البينق الخامل (تصحيح الـ 900ms عبر طلب HEAD)
    const idlePing = await measureLatency(URLS.local);
    document.getElementById('v-ping').innerText = idlePing.toFixed(1);

    // 2. فحص الداونلود + البينق المثقل (24 مسار)
    const dlMetrics = await runDownloadTest(10000);
    document.getElementById('v-dl').innerText = Math.round(dlMetrics.speed);
    document.getElementById('v-loaded').innerText = dlMetrics.loadedPing.toFixed(1);

    // 3. فحص الابلود (حل مشكلة التوقف عبر حزم 4MB)
    const ulSpeed = await runUploadTest(10000);
    document.getElementById('v-ul').innerText = ulSpeed.toFixed(1);

    btn.disabled = false;
}

// دالة البينق فائقة الدقة (تجاوز الـ Handshake الطويل)
async function measureLatency(url) {
    const samples = [];
    for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        try {
            // طلب HEAD فقط لتقليل المعالجة
            await fetch(url + "?t=" + Math.random(), { method: 'HEAD', mode: 'no-cors', cache: 'no-cache' });
            samples.push(performance.now() - t0);
        } catch (e) {}
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)]; // القيمة الوسيطة
}

// محرك التحميل (حزم 8MB لضمان السرعة وتجنب الحظر)
async function runDownloadTest(duration) {
    let bytes = 0;
    let pings = [];
    const start = performance.now();
    const controller = new AbortController();

    const pinger = setInterval(async () => {
        const p = await measureLatency(URLS.ping);
        pings.push(p);
    }, 250);

    const workers = Array(24).fill(0).map(async () => {
        while (performance.now() - start < duration) {
            try {
                const res = await fetch(URLS.dl + "&cache=" + Math.random(), { signal: controller.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    bytes += value.length;
                    const elapsed = (performance.now() - start) / 1000;
                    if (elapsed > 1) {
                        const mbps = (bytes * 8) / (1024 * 1024) / elapsed;
                        document.getElementById('v-dl').innerText = Math.round(mbps);
                    }
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    controller.abort();
    clearInterval(pinger);
    return {
        speed: (bytes * 8) / (1024 * 1024) / (duration / 1000),
        loadedPing: pings.reduce((a, b) => a + b, 0) / pings.length
    };
}

// محرك الرفع المستقر (حزم 4MB لتجنب حظر المتصفح)
async function runUploadTest(duration) {
    let bytesUploaded = 0;
    const start = performance.now();
    const data = new Uint8Array(4 * 1024 * 1024); // حزمة 4MB مثالية

    const uploadWorkers = Array(12).fill(0).map(async () => {
        while (performance.now() - start < duration) {
            try {
                await fetch(URLS.ul + "?b=" + Math.random(), {
                    method: 'POST',
                    body: data,
                    mode: 'no-cors'
                });
                bytesUploaded += data.length;
                const elapsed = (performance.now() - start) / 1000;
                const mbps = (bytesUploaded * 8) / (1024 * 1024) / elapsed;
                document.getElementById('v-ul').innerText = mbps.toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    return (bytesUploaded * 8) / (1024 * 1024) / (duration / 1000);
}
