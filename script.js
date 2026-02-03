const API_URLS = {
    dl: "https://speed.cloudflare.com/__down?bytes=250000000",
    ping: "https://1.1.1.1/cdn-cgi/trace",
    ul: "https://httpbin.org/post"
};

async function runEngine() {
    const btn = document.getElementById('launch-btn');
    const msg = document.getElementById('status-msg');
    const aura = document.getElementById('aura');
    
    btn.disabled = true;
    aura.style.opacity = "0.4";

    try {
        // 1. فحص البينق الخامل بدقة (5 ثوانٍ)
        msg.innerText = "قياس استقرار زمن الاستجابة (خامل)...";
        document.getElementById('box-ping').classList.add('active');
        const idlePing = await measurePing(5000);
        document.getElementById('v-ping').innerText = idlePing.toFixed(0);
        document.getElementById('box-ping').classList.remove('active');

        // 2. فحص التحميل + البينق المثقل (15 ثانية)
        msg.innerText = "تحليل كفاءة التحميل والضغط المتوازي...";
        document.getElementById('box-loaded').classList.add('active');
        const dlResult = await measureDownload(15000);
        document.getElementById('main-val').innerText = dlResult.speed;
        document.getElementById('v-loaded').innerText = dlResult.loadedPing.toFixed(0);
        document.getElementById('box-loaded').classList.remove('active');

        // 3. فحص الرفع (15 ثانية)
        msg.innerText = "تحليل قدرة الرفع للإرسال الحي...";
        document.getElementById('box-upload').classList.add('active');
        const ulSpeed = await measureUpload(15000);
        document.getElementById('v-upload').innerText = ulSpeed.toFixed(1);
        document.getElementById('box-upload').classList.remove('active');

        msg.innerText = "اكتمل الفحص: النتائج معايرة بدقة إحصائية";
    } catch (e) {
        msg.innerText = "فشل في الاتصال، تحقق من الشبكة";
    } finally {
        btn.disabled = false;
        aura.style.opacity = "0.1";
    }
}

// دالة البينق مع استبعاد القيم الشاذة
async function measurePing(duration) {
    let pings = [];
    const start = Date.now();
    while (Date.now() - start < duration) {
        const t0 = performance.now();
        await fetch(API_URLS.ping, { mode: 'no-cors', cache: 'no-cache' });
        pings.push(performance.now() - t0);
        await new Promise(r => setTimeout(r, 150));
    }
    // تصفية إحصائية (حذف أعلى وأدنى 10%)
    pings.sort((a, b) => a - b);
    const trim = Math.floor(pings.length * 0.1);
    const filtered = pings.slice(trim, -trim);
    return filtered.reduce((a, b) => a + b) / filtered.length;
}

// دالة التحميل العملاقة (Multithreaded + High Precision)
async function measureDownload(duration) {
    let totalBytes = 0;
    let loadedPings = [];
    const startTest = performance.now();
    const controller = new AbortController();

    // فحص البينق المثقل (Bufferbloat)
    const monitor = setInterval(async () => {
        const t0 = performance.now();
        await fetch(API_URLS.ping, { mode: 'no-cors' });
        loadedPings.push(performance.now() - t0);
    }, 250);

    // استخدام 10 مسارات تحميل متوازية (Parallel Fetching)
    const threads = 10;
    const downloadWorkers = Array(threads).fill(0).map(async () => {
        while (performance.now() - startTest < duration) {
            try {
                const res = await fetch(API_URLS.dl + "&cb=" + Math.random(), { signal: controller.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - startTest >= duration)) break;
                    totalBytes += value.length;
                    
                    const elapsed = (performance.now() - startTest) / 1000;
                    const mbps = ((totalBytes * 8) / (1024 * 1024) / elapsed);
                    // تحديث بصري سلس
                    document.getElementById('main-val').innerText = Math.round(mbps);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    controller.abort();
    clearInterval(monitor);

    const finalSpeed = ((totalBytes * 8) / (1024 * 1024) / (duration / 1000)).toFixed(1);
    return {
        speed: finalSpeed,
        loadedPing: (loadedPings.reduce((a,b)=>a+b, 0) / loadedPings.length)
    };
}

async function measureUpload(duration) {
    let uploaded = 0;
    const startTime = performance.now();
    const data = new Uint8Array(1024 * 1024); // 1MB chunks

    while (performance.now() - startTime < duration) {
        try {
            await fetch(API_URLS.ul, { method: 'POST', body: data, mode: 'no-cors' });
            uploaded += data.length;
            const elapsed = (performance.now() - startTime) / 1000;
            const mbps = ((uploaded * 8) / (1024 * 1024) / elapsed);
            document.getElementById('v-upload').innerText = mbps.toFixed(1);
        } catch (e) { break; }
    }
    return ((uploaded * 8) / (1024 * 1024) / (duration / 1000));
}
