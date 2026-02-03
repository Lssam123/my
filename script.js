const RESOURCES = {
    dl_url: "https://speed.cloudflare.com/__down?bytes=500000000",
    ul_url: "https://httpbin.org/post",
    // قائمة السيرفرات لاختيار الأقرب (Precision Targeting)
    ping_targets: [
        "https://1.1.1.1/cdn-cgi/trace",
        "https://8.8.8.8/favicon.ico",
        "https://speed.cloudflare.com/cdn-cgi/trace"
    ],
    threads: 24 // رفع عدد المسارات لضمان إشباع الشبكة
};

async function runExtremeEngine() {
    const btn = document.getElementById('run-btn');
    const log = document.getElementById('log-status');
    btn.disabled = true;

    // 1. فحص البينق الفائق (تعدد المصادر)
    log.innerText = "جاري البحث عن أقرب نقطة استجابة ومعايرة البينق...";
    document.getElementById('box-idle').classList.add('active');
    const idlePing = await getPrecisionPing();
    document.getElementById('v-idle').innerText = idlePing.toFixed(1);
    document.getElementById('box-idle').classList.remove('active');

    // 2. التحميل العملاق + البينق المثقل (الدقة القصوى)
    log.innerText = "جاري إشباع النطاق الترددي بـ 24 مسار وقياس البينق تحت الضغط...";
    document.getElementById('box-loaded').classList.add('active');
    const dlMetrics = await runHyperDownload(15000);
    document.getElementById('dl-display').innerText = Math.round(dlMetrics.speed);
    document.getElementById('v-loaded').innerText = dlMetrics.loadedPing.toFixed(1);
    document.getElementById('box-loaded').classList.remove('active');

    // 3. الرفع بكتل ضخمة (Extreme Upload)
    log.innerText = "جاري تحليل الرفع باستخدام كتل بيانات 25MB...";
    document.getElementById('box-upload').classList.add('active');
    const ulSpeed = await runHyperUpload(15000);
    document.getElementById('v-upload').innerText = ulSpeed.toFixed(1);
    document.getElementById('box-upload').classList.remove('active');

    log.innerText = "تم الانتهاء: المعايرة تمت بدقة مخبرية";
    btn.disabled = false;
}

// دالة البينق (تختار الأسرع من 3 مصادر عالمية)
async function getPrecisionPing() {
    let allResults = [];
    for (let target of RESOURCES.ping_targets) {
        let pings = [];
        for (let i = 0; i < 15; i++) {
            const t0 = performance.now();
            try {
                await fetch(target, { mode: 'no-cors', cache: 'no-cache' });
                pings.push(performance.now() - t0);
            } catch (e) {}
        }
        allResults.push(...pings);
    }
    allResults.sort((a, b) => a - b);
    // نأخذ أفضل 20% من القراءات (الاستجابة الحقيقية للسيرفر الأقرب)
    const bestSection = allResults.slice(0, Math.floor(allResults.length * 0.2));
    return bestSection.reduce((a, b) => a + b) / bestSection.length;
}

// محرك التحميل بـ 24 مسار
async function runHyperDownload(ms) {
    let totalBytes = 0;
    let lPings = [];
    const start = performance.now();
    const controller = new AbortController();

    const monitorPing = setInterval(async () => {
        const t0 = performance.now();
        try {
            await fetch(RESOURCES.ping_targets[0], { mode: 'no-cors' });
            lPings.push(performance.now() - t0);
        } catch (e) {}
    }, 150);

    const workers = Array(RESOURCES.threads).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch(RESOURCES.dl_url + "&nocache=" + Math.random(), { signal: controller.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - start >= ms)) break;
                    totalBytes += value.length;
                    const mbps = ((totalBytes * 8) / (1024 * 1024) / ((performance.now() - start) / 1000));
                    document.getElementById('dl-display').innerText = Math.round(mbps);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    controller.abort();
    clearInterval(monitorPing);

    return {
        speed: (totalBytes * 8) / (1024 * 1024) / (ms / 1000),
        loadedPing: lPings.reduce((a, b) => a + b) / lPings.length
    };
}

// محرك الرفع بكتل بيانات ضخمة (حل مشكلة بطء الرفع)
async function runHyperUpload(ms) {
    let upBytes = 0;
    const start = performance.now();
    // إنشاء كتلة بيانات ضخمة 25 ميجابايت لضمان تشبع الرفع
    const largeBlob = new Blob([new Uint8Array(25 * 1024 * 1024)]);

    while (performance.now() - start < ms) {
        try {
            await fetch(RESOURCES.ul_url, { method: 'POST', body: largeBlob, mode: 'no-cors' });
            upBytes += largeBlob.size;
            const mbps = ((upBytes * 8) / (1024 * 1024) / ((performance.now() - start) / 1000));
            document.getElementById('v-upload').innerText = mbps.toFixed(1);
        } catch (e) { break; }
    }
    return (upBytes * 8) / (1024 * 1024) / (ms / 1000);
}
