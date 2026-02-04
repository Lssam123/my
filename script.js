const CORE = {
    ping_node: "https://1.1.1.1/cdn-cgi/trace", // خادم Cloudflare القريب
    dl_node: "https://speed.cloudflare.com/__down?bytes=1048576", // حزم 1MB
    ul_node: "https://speed.cloudflare.com/__up",
    dl_threads: 12, // عدد مسارات متوازن
    ul_threads: 4   // مسارات قليلة لضمان استقرار الرفع
};

async function initTest() {
    const btn = document.querySelector('.btn-start');
    const status = document.getElementById('status');
    btn.disabled = true;

    // 1. فحص البينق (HEAD Request لضمان رقم حقيقي تحت 50ms)
    status.innerText = "جاري قياس استجابة الشبكة (Zero-Payload)...";
    document.getElementById('b-ping').classList.add('active');
    const idlePing = await getPrecisionPing();
    document.getElementById('v-ping').innerText = idlePing.toFixed(1);
    document.getElementById('b-ping').classList.remove('active');

    // 2. فحص الداونلود + البينق المثقل
    status.innerText = "جاري فحص التحميل (Parallel Streams)...";
    document.getElementById('b-loaded').classList.add('active');
    const dlMetrics = await runDownload(8000); // فحص لمدة 8 ثوانٍ
    document.getElementById('dl-val').innerText = Math.round(dlMetrics.speed);
    document.getElementById('v-loaded').innerText = dlMetrics.loadedPing.toFixed(1);
    document.getElementById('b-loaded').classList.remove('active');

    // 3. فحص الرفع (حل مشكلة التوقف عبر حزم 512KB)
    status.innerText = "جاري فحص الرفع (Stable Chunks)...";
    document.getElementById('b-ul').classList.add('active');
    const ulSpeed = await runUpload(8000);
    document.getElementById('v-ul').innerText = ulSpeed.toFixed(1);
    document.getElementById('b-ul').classList.remove('active');

    status.innerText = "اكتمل الفحص.";
    btn.disabled = false;
}

// دالة البينق الحقيقي (تجاهل وقت معالجة البيانات)
async function getPrecisionPing() {
    let pings = [];
    for (let i = 0; i < 15; i++) {
        const t0 = performance.now();
        try {
            // استخدام HEAD يعطي زمن الاستجابة فقط دون تحميل محتوى
            await fetch(CORE.ping_node, { method: 'HEAD', mode: 'no-cors', cache: 'no-cache' });
            pings.push(performance.now() - t0);
        } catch (e) {}
    }
    // السر: حذف أول 5 قراءات (التحمية) وأخذ الحد الأدنى (Best Case)
    const cleanPings = pings.slice(5).sort((a, b) => a - b);
    return cleanPings[0] || 0;
}

// محرك الرفع المستقر (حزم صغيرة وتكرار عالٍ)
async function runUpload(duration) {
    let bytesUp = 0;
    const start = performance.now();
    const chunk = new Uint8Array(512 * 1024); // حزمة 512KB فقط لتجنب الحظر

    const workers = Array(CORE.ul_threads).fill(0).map(async () => {
        while (performance.now() - start < duration) {
            try {
                await fetch(CORE.ul_node, {
                    method: 'POST',
                    body: chunk,
                    mode: 'no-cors'
                });
                bytesUp += chunk.length;
                const elapsed = (performance.now() - start) / 1000;
                document.getElementById('v-ul').innerText = ((bytesUp * 8) / (1024 * 1024) / elapsed).toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    return (bytesUp * 8) / (1024 * 1024) / (duration / 1000);
}

// محرك التحميل (حزم 1MB وتكرار عالٍ)
async function runDownload(duration) {
    let bytesDl = 0;
    let lPings = [];
    const start = performance.now();
    const abort = new AbortController();

    // فحص البينق أثناء الضغط (Loaded Ping)
    const pinger = setInterval(async () => {
        const p = await getPrecisionPing();
        if (p > 0) lPings.push(p);
    }, 400);

    const streams = Array(CORE.dl_threads).fill(0).map(async () => {
        while (performance.now() - start < duration) {
            try {
                const res = await fetch(CORE.dl_node + "&nocache=" + Math.random(), { signal: abort.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    bytesDl += value.length;
                    const elapsed = (performance.now() - start) / 1000;
                    document.getElementById('dl-val').innerText = Math.round((bytesDl * 8) / (1024 * 1024) / elapsed);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    abort.abort();
    clearInterval(pinger);
    return {
        speed: (bytesDl * 8) / (1024 * 1024) / (duration / 1000),
        loadedPing: lPings.reduce((a, b) => a + b, 0) / lPings.length
    };
}
