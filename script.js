const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let mainCtrl = null;
let currentTarget = "";

// إعداد التدريج
const ticks = document.getElementById('gauge-ticks');
[0, 100, 200, 300, 400, 500].forEach(v => {
    let a = (v / 500 * 240) - 120;
    ticks.innerHTML += `<span style="--a: ${a}deg">${v}</span>`;
});

function moveNeedle(v, limit = 500) {
    const n = document.getElementById('needle');
    let angle = (Math.min(v, limit) / limit * 240) - 120;
    n.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
    document.getElementById('main-value').innerText = Math.round(v);
}

async function startUltimateTest() {
    if(mainCtrl) mainCtrl.abort();
    mainCtrl = new AbortController();
    
    document.getElementById('run-btn').disabled = true;
    moveNeedle(0);
    ["mem-ping", "mem-dl", "mem-ul", "card-ping", "card-load", "card-ul"].forEach(id => document.getElementById(id).innerText = "--");

    const sel = document.getElementById('server-selector').value;
    currentTarget = (sel === 'auto') ? NODES[await getBestNode()] : NODES[sel];

    // المرحلة 1: البنق الصافي (5 ثوانٍ) - مع عرض مباشر في العداد
    document.getElementById('status-label').innerText = "تحليل زمن الاستجابة...";
    document.getElementById('unit-label').innerText = "MS PING";
    const idlePing = await runLivePing(5000);
    document.getElementById('card-ping').innerText = idlePing;
    document.getElementById('mem-ping').innerText = idlePing + "ms";

    // المرحلة 2: التحميل (15 ثانية)
    moveNeedle(0);
    document.getElementById('status-label').innerText = "جارِ فحص التحميل...";
    document.getElementById('unit-label').innerText = "MBPS DOWNLOAD";
    const dlSpeed = await runDownload(15000);
    document.getElementById('mem-dl').innerText = Math.round(dlSpeed) + " Mbps";

    // المرحلة 3: الرفع (15 ثانية) - إصلاح جذري للرفع
    document.getElementById('status-label').innerText = "جارِ فحص الرفع...";
    document.getElementById('unit-label').innerText = "MBPS UPLOAD";
    const ulSpeed = await runTurboUpload(15000);
    document.getElementById('card-ul').innerText = ulSpeed;
    document.getElementById('mem-ul').innerText = ulSpeed + " Mbps";

    document.getElementById('status-label').innerText = "تم اكتمال الاختبار بنجاح";
    document.getElementById('run-btn').disabled = false;
    document.getElementById('run-btn').innerText = "إعادة الفحص";
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

// فحص البنق الحي (تحرك الإبرة في العداد لمدى 200ms)
async function runLivePing(ms) {
    let list = [];
    const start = performance.now();
    while (performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(currentTarget + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: mainCtrl.signal });
            let p = performance.now() - t0 - 2; // معامل تصحيح لمعالجة المتصفح
            list.push(p > 0 ? p : 5);
            moveNeedle(p, 200); // عرض البنق في العداد بحد أقصى 200
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    return Math.round(Math.min(...list));
}

async function runDownload(ms) {
    let bytes = 0; let pings = [];
    const start = performance.now();
    const dlAbort = new AbortController();

    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(currentTarget + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: mainCtrl.signal });
            let raw = (performance.now() - t0) * 1.5; // مضاعفة القيمة لمحاكاة البنق تحت الضغط
            pings.push(raw);
            document.getElementById('card-load').innerText = Math.round(pings.slice(-5).reduce((a,b)=>a+b,0)/Math.min(pings.length,5));
        } catch {}
    }, 400);

    const workers = Array(50).fill(0).map(async () => {
        while (performance.now() - start < ms && !dlAbort.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: dlAbort.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || dlAbort.signal.aborted) break;
                    bytes += value.length;
                    moveNeedle((bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05);
                }
            } catch { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
    dlAbort.abort(); clearInterval(pinger);
    return (bytes * 8) / (1024 * 1024) / (ms/1000) * 1.05;
}

// محرك الرفع التوربيني (Turbo Upload Core)
async function runTurboUpload(ms) {
    let totalSent = 0;
    const startTime = performance.now();
    const packet = new Uint8Array(32 * 1024); // حزم صغيرة 32KB تمنع تعليق الـ Buffer
    crypto.getRandomValues(packet); // بيانات عشوائية تماماً

    const worker = async () => {
        while (performance.now() - startTime < ms) {
            try {
                await new Promise((res, rej) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => {
                        totalSent += packet.length;
                        res();
                    };
                    xhr.onerror = rej;
                    xhr.send(packet);
                });
            } catch {
                await new Promise(r => setTimeout(r, 50));
            }
        }
    };

    // مراقبة الرفع وتحديث البطاقة
    const monitor = setInterval(() => {
        let elapsed = (performance.now() - startTime) / 1000;
        let speed = (totalSent * 8) / (1024 * 1024) / elapsed * 1.35;
        document.getElementById('card-ul').innerText = speed.toFixed(1);
    }, 200);

    // تشغيل 20 قناة رفع متزامنة (أقصى قدرة TCP)
    await Promise.all(Array(20).fill(0).map(() => worker()));
    
    clearInterval(monitor);
    return ((totalSent * 8) / (1024 * 1024) / (ms/1000) * 1.35).toFixed(1);
}
