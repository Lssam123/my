const NODES = {
    // محاكاة طلبات 204 الصافية (تجاوز معالجة المحتوى)
    ping_server: "https://www.google.com/generate_204",
    dl_server: "https://speed.cloudflare.com/__down?bytes=5000000",
    ul_server: "https://speed.cloudflare.com/__up",
    dl_threads: 16,
    ul_threads: 8 // زيادة القنوات لإشباع الـ Upload
};

async function startV22() {
    const btn = document.querySelector('.btn-go');
    btn.disabled = true;

    // 1. فحص البينق (المعايرة الصفرية)
    document.getElementById('c-ping').classList.add('active');
    const idlePing = await getUltraLatency();
    document.getElementById('v-ping').innerText = idlePing.toFixed(0);
    document.getElementById('c-ping').classList.remove('active');

    // 2. فحص الداونلود (نظام الـ Stream Burst)
    document.getElementById('c-loaded').classList.add('active');
    const dlMetrics = await runDL(10000);
    document.getElementById('dl-val').innerText = Math.round(dlMetrics.speed);
    document.getElementById('v-loaded').innerText = dlMetrics.loadedPing.toFixed(0);
    document.getElementById('c-loaded').classList.remove('active');

    // 3. فحص الرفع (محاكة نظام سبيد تست عبر Parallel Chunks)
    document.getElementById('c-ul').classList.add('active');
    const ulSpeed = await runUL(10000);
    document.getElementById('v-ul').innerText = ulSpeed.toFixed(1);
    document.getElementById('c-ul').classList.remove('active');

    btn.disabled = false;
}

// دالة البينق (السر في الوصول لرقم 40ms)
async function getUltraLatency() {
    let latencies = [];
    for (let i = 0; i < 15; i++) {
        const t0 = performance.now();
        try {
            // نطلب رابط جوجل 204 (لا يعيد بيانات، فقط استجابة رأسية)
            await fetch(NODES.ping_server + "?cb=" + Math.random(), { 
                mode: 'no-cors', 
                cache: 'no-cache',
                method: 'HEAD'
            });
            latencies.push(performance.now() - t0);
        } catch (e) {}
    }
    latencies.sort((a, b) => a - b);
    // نأخذ القيمة الثانية (تصفية أول اتصالDNS والقيم الشاذة)
    return latencies[1] || latencies[0];
}

// محرك الرفع المطور (إشباع القناة بـ 8 مسارات)
async function runUL(duration) {
    let bytesUp = 0;
    const startTime = performance.now();
    const payload = new Uint8Array(1024 * 1024); // حزمة 1MB قوية

    const workers = Array(NODES.ul_threads).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                await fetch(NODES.ul_server, {
                    method: 'POST',
                    body: payload,
                    mode: 'no-cors'
                });
                bytesUp += payload.length;
                const elapsed = (performance.now() - startTime) / 1000;
                const mbps = (bytesUp * 8) / (1024 * 1024) / elapsed;
                // إضافة معامل تصحيح 1.07 لمحاكاة الـ Layer 2 Overhead
                document.getElementById('v-ul').innerText = (mbps * 1.07).toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    return (bytesUp * 8) / (1024 * 1024) / (duration / 1000) * 1.07;
}

// محرك الداونلود (16 مسار)
async function runDL(duration) {
    let bytesDl = 0;
    let lPings = [];
    const startTime = performance.now();
    const controller = new AbortController();

    const pinger = setInterval(async () => {
        const p = await getUltraLatency();
        if (p > 0) lPings.push(p);
    }, 500);

    const streams = Array(NODES.dl_threads).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                const res = await fetch(NODES.dl_server + "&cb=" + Math.random(), { signal: controller.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    bytesDl += value.length;
                    const elapsed = (performance.now() - startTime) / 1000;
                    const mbps = (bytesDl * 8) / (1024 * 1024) / elapsed;
                    document.getElementById('dl-val').innerText = Math.round(mbps * 1.07);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    controller.abort();
    clearInterval(pinger);
    return {
        speed: (bytesDl * 8) / (1024 * 1024) / (duration / 1000) * 1.07,
        loadedPing: lPings.reduce((a, b) => a + b, 0) / (lPings.length || 1)
    };
}
