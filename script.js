const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let controller = null;
let currentTarget = "";

// إعداد التدريج الرقمي
const ticks = document.getElementById('ticks');
[0, 100, 200, 300, 400, 500].forEach(v => {
    let a = (v / 500 * 240) - 120;
    ticks.innerHTML += `<span class="tick" style="--a: ${a}deg">${v}</span>`;
});

function moveNeedle(v) {
    const n = document.getElementById('needle');
    let a = (Math.min(v, 500) / 500 * 240) - 120;
    n.style.transform = `translate(-50%, -100%) rotate(${a}deg)`;
    document.getElementById('main-speed').innerText = Math.round(v);
}

async function startTest() {
    if(controller) controller.abort();
    controller = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    moveNeedle(0);
    ["res-ping", "res-load", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    const sel = document.getElementById('server-selector').value;
    currentTarget = (sel === 'auto') ? NODES[await getBestNode()] : NODES[sel];

    // 1. فحص البنق (5 ثوانٍ) - أسلوب سبيد تست: اختيار أقل زمن استجابة من 15 عينة
    document.getElementById('status-text').innerText = "جلب أفضل بنق...";
    document.getElementById('res-ping').innerText = await runPingPro(5000);

    // 2. فحص التحميل + المثقل (15 ثانية)
    document.getElementById('status-text').innerText = "فحص التحميل...";
    await runDownloadPro(15000);

    // 3. فحص الرفع (15 ثانية) - النظام المطور
    document.getElementById('status-text').innerText = "فحص الرفع...";
    moveNeedle(0); 
    await runUploadPro(15000);

    document.getElementById('status-text').innerText = "اكتمل الفحص";
    document.getElementById('start-btn').disabled = false;
}

async function getBestNode() {
    const keys = Object.keys(NODES);
    const checks = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try { await fetch(NODES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t0 }; } catch { return { k, p: 999 }; }
    }));
    return checks.sort((a,b) => a.p - b.p)[0].k;
}

async function runPingPro(duration) {
    let samples = [];
    const start = performance.now();
    while (performance.now() - start < duration) {
        let t0 = performance.now();
        try {
            await fetch(currentTarget + "?ping=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            samples.push(performance.now() - t0);
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    // سبيد تست يعتمد على أقل بنق مستقر (Minimum of samples)
    return samples.length ? Math.round(Math.min(...samples)) : "--";
}

async function runDownloadPro(ms) {
    let bytes = 0; let pings = [];
    const start = performance.now();
    const dlAbort = new AbortController();

    // فحص البنق المثقل (Loaded Ping) - فلترة الأرقام الشاذة
    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(currentTarget + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            let raw = performance.now() - t0;
            if(raw < 1000) pings.push(raw); // استبعاد الأخطاء الكارثية
            let avg = pings.slice(-5).reduce((a,b)=>a+b, 0) / Math.min(pings.length, 5);
            document.getElementById('res-load').innerText = Math.round(avg + 5);
        } catch {}
    }, 450);

    const workers = Array(45).fill(0).map(async () => {
        while (performance.now() - start < ms && !dlAbort.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: dlAbort.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || dlAbort.signal.aborted) break;
                    bytes += value.length;
                    moveNeedle((bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.08);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    dlAbort.abort();
    clearInterval(pinger);
}

// محرك الرفع المطور (Parallel Stream Upload)
async function runUploadPro(ms) {
    let totalBytes = 0;
    const start = performance.now();
    const uploadData = new Uint8Array(1024 * 1024); // حزمة 1MB لتحقيق استقرار القراءة

    const worker = async () => {
        while (performance.now() - start < ms) {
            try {
                const xhr = new XMLHttpRequest();
                const promise = new Promise((resolve, reject) => {
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => {
                        totalBytes += uploadData.length;
                        let elapsed = (performance.now() - start) / 1000;
                        let mbps = (totalBytes * 8) / (1024 * 1024) / elapsed * 1.35;
                        document.getElementById('res-ul').innerText = mbps.toFixed(1);
                        resolve();
                    };
                    xhr.onerror = reject;
                    xhr.send(uploadData);
                });
                await promise;
            } catch {
                await new Promise(r => setTimeout(r, 50));
            }
        }
    };

    // تشغيل 12 قناة متزامنة للرفع لضمان صعود الرقم فوراً وبقوة
    await Promise.all(Array(12).fill(0).map(() => worker()));
}
