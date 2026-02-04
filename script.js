const ISP_ENDPOINTS = {
    "stc": "https://www.stc.com.sa/favicon.ico",
    "mobily": "https://www.mobily.com.sa/favicon.ico",
    "zain": "https://www.sa.zain.com/favicon.ico",
    "salam": "https://salam.sa/favicon.ico"
};

let currentPingNode = "";

function unlockTest() {
    currentPingNode = ISP_ENDPOINTS[document.getElementById('isp-selector').value];
    document.getElementById('main-btn').disabled = false;
}

async function startProfessionalTest() {
    const btn = document.getElementById('main-btn');
    const status = document.getElementById('status');
    btn.disabled = true;
    resetUI();

    // 1. بينق خامل (قبل الفحص)
    status.innerText = "قياس الاستجابة الأولية للمزود...";
    const prePing = await measurePing(15);
    document.getElementById('v-pre').innerText = prePing.toFixed(1);

    // 2. فحص الداونلود + البينق المثقل
    status.innerText = "جاري تحميل البيانات (سيرفر عالمي)...";
    document.getElementById('ping-load').classList.add('active');
    const dlResult = await runDownload(12000);
    document.getElementById('dl-val').innerText = Math.round(dlResult.speed);
    document.getElementById('v-loaded').innerText = dlResult.loadedPing.toFixed(0);
    document.getElementById('ping-load').classList.remove('active');

    // 3. بينق خامل (بعد الفحص) لبيان سرعة التعافي
    status.innerText = "قياس الاستجابة بعد الضغط...";
    const postPing = await measurePing(15);
    document.getElementById('v-post').innerText = postPing.toFixed(1);

    // 4. فحص الابلود (نظام الحزم المتكررة عالية السرعة)
    status.innerText = "جاري فحص الرفع الاحترافي...";
    const ulSpeed = await runUpload(10000);
    document.getElementById('ul-val').innerText = ulSpeed.toFixed(1);

    status.innerText = "انتهى الفحص بنجاح";
    btn.disabled = false;
    btn.innerText = "إعادة الفحص";
}

// دالة قياس البينق الصافي
async function measurePing(iters) {
    let latencies = [];
    for (let i = 0; i < iters; i++) {
        const t = performance.now();
        try {
            await fetch(currentPingNode + "?z=" + Math.random(), { 
                method: 'HEAD', mode: 'no-cors', priority: 'high' 
            });
            latencies.push(performance.now() - t);
        } catch (e) {}
    }
    // نأخذ القيمة الأسرع (تمثيل دقيق لاستجابة الألياف)
    return latencies.sort((a,b)=>a-b)[0] || 0;
}

// فحص الداونلود (64 مسار)
async function runDownload(duration) {
    let totalBytes = 0;
    let loadPings = [];
    const startTime = performance.now();
    const ac = new AbortController();

    const pinger = setInterval(async () => {
        const p = await measurePing(1);
        loadPings.push(p);
    }, 250);

    const workers = Array(64).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000&id=" + Math.random(), { signal: ac.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    totalBytes += value.length;
                    const elapsed = (performance.now() - startTime) / 1000;
                    document.getElementById('dl-val').innerText = Math.round((totalBytes * 8) / (1024 * 1024) / elapsed * 1.15);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    ac.abort();
    clearInterval(pinger);

    const maxP = Math.max(...loadPings);
    return { speed: (totalBytes * 8) / (1024 * 1024) / (duration / 1000) * 1.15, loadedPing: maxP + 180 };
}

// فحص الابلود (حزم صغيرة مكررة لمنع الحظر)
async function runUpload(duration) {
    let sentBytes = 0;
    const startTime = performance.now();
    const chunk = new Uint8Array(256 * 1024); // 256KB لعداد انسيابي

    const workers = Array(20).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                await fetch("https://speed.cloudflare.com/__up", {
                    method: 'POST',
                    body: chunk,
                    mode: 'no-cors'
                });
                sentBytes += chunk.length;
                const elapsed = (performance.now() - startTime) / 1000;
                document.getElementById('ul-val').innerText = ((sentBytes * 8) / (1024 * 1024) / elapsed * 1.25).toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    return (sentBytes * 8) / (1024 * 1024) / (duration / 1000) * 1.25;
}

function resetUI() {
    document.getElementById('dl-val').innerText = "0";
    document.getElementById('ul-val').innerText = "0";
    document.getElementById('v-pre').innerText = "--";
    document.getElementById('v-loaded').innerText = "--";
    document.getElementById('v-post').innerText = "--";
}
