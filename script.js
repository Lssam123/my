const CORE = {
    stc_ping: "https://www.stc.com.sa/favicon.ico",
    dl_node: "https://speed.cloudflare.com/__down?bytes=26214400", // 25MB
    ul_node: "https://httpbin.org/post",
    ping_node: "https://1.1.1.1/cdn-cgi/trace",
    threads: 32 // أقصى عدد مسارات لتجاوز الحظر وإشباع القناة
};

async function runV15Engine() {
    const status = document.getElementById('status');
    const btn = document.querySelector('.btn');
    btn.disabled = true;

    // 1. فحص بينق STC المخفي (Precision Idle)
    status.innerText = "جاري المعايرة المخفية عبر سيرفرات STC...";
    const hiddenStcPing = await measureHiddenPing();
    console.log("Hidden STC Ping Reference:", hiddenStcPing.toFixed(2));

    // 2. الداونلود بـ 32 مسار (ملفات 25MB) + البينق المثقل
    status.innerText = "جاري إطلاق 32 مسار تحميل (25MB Chunks)...";
    document.getElementById('c-loaded').classList.add('active');
    const dlMetrics = await runHyperDL(12000);
    document.getElementById('v-dl').innerText = Math.round(dlMetrics.speed);
    document.getElementById('v-loaded').innerText = dlMetrics.loadedPing.toFixed(1);
    document.getElementById('c-loaded').classList.remove('active');

    // 3. الابلود (ملفات 20MB) مع تقنية Anti-Ban
    status.innerText = "جاري تحليل الرفع (20MB Chunks) مع تقنية منع الحظر...";
    document.getElementById('c-ul').classList.add('active');
    const ulSpeed = await runHyperUL(10000);
    document.getElementById('v-ul').innerText = ulSpeed.toFixed(1);
    document.getElementById('c-ul').classList.remove('active');

    status.innerText = "اكتمل الفحص بأعلى دقة فيزيائية ممكنة.";
    btn.disabled = false;
}

// دالة البينق المخفي (STC)
async function measureHiddenPing() {
    let results = [];
    for(let i=0; i<15; i++) {
        const t0 = performance.now();
        await fetch(CORE.stc_ping + "?cache=" + Math.random(), { mode: 'no-cors' });
        results.push(performance.now() - t0);
    }
    return results.sort((a,b)=>a-b)[Math.floor(results.length/2)];
}

// محرك التحميل الفائق (32 مسار)
async function runHyperDL(ms) {
    let bytes = 0;
    let loadedPings = [];
    const start = performance.now();
    const abort = new AbortController();

    // فحص البينق العالمي أثناء الضغط
    const pinger = setInterval(async () => {
        const t0 = performance.now();
        await fetch(CORE.ping_node, { mode: 'no-cors' });
        loadedPings.push(performance.now() - t0);
    }, 150);

    const streams = Array(CORE.threads).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                // استخدام معرفات فريدة لتجنب الحظر
                const uniqueID = Math.random().toString(36).substring(7);
                const res = await fetch(CORE.dl_node + "&id=" + uniqueID, { signal: abort.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - start >= ms)) break;
                    bytes += value.length;
                    const elapsed = (performance.now() - start) / 1000;
                    if (elapsed > 1.5) {
                        const mbps = (bytes * 8) / (1024 * 1024) / elapsed;
                        document.getElementById('v-dl').innerText = Math.round(mbps);
                    }
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    abort.abort();
    clearInterval(pinger);
    return {
        speed: (bytes * 8) / (1024 * 1024) / (ms / 1000),
        loadedPing: loadedPings.reduce((a,b)=>a+b,0) / loadedPings.length
    };
}

// محرك الرفع الفائق (20MB Chunks)
async function runHyperUL(ms) {
    let upBytes = 0;
    const start = performance.now();
    const payload = new Uint8Array(20 * 1024 * 1024); // ملف رفع 20MB

    const uploaders = Array(12).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const uniqueID = Math.random().toString(36).substring(7);
                await fetch(CORE.ul_node + "?ban_prevent=" + uniqueID, {
                    method: 'POST',
                    body: payload,
                    mode: 'no-cors'
                });
                upBytes += payload.length;
                const elapsed = (performance.now() - start) / 1000;
                document.getElementById('v-ul').innerText = ((upBytes * 8) / (1024 * 1024) / elapsed).toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (upBytes * 8) / (1024 * 1024) / (ms / 1000);
}
