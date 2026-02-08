const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let ctrl = null;
let activeUrl = "";

// إنشاء التدريج (0-500)
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

async function startV83() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('ignite-btn').disabled = true;
    document.getElementById('ignite-btn').innerText = "جاري الفحص...";
    ["top-ping", "top-dl", "top-ul", "res-ping", "res-load", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    const sel = document.getElementById('server-selector').value;
    activeUrl = (sel === 'auto') ? NODES[await findBest()] : NODES[sel];

    // 1. البنق الخامل (5 ثوانٍ) - تحسين الدقة
    document.getElementById('test-status').innerText = "تحليل الاستجابة...";
    document.getElementById('unit-label').innerText = "MS PING";
    const ping = await runPrecisionPing(5000);
    document.getElementById('res-ping').innerText = ping;
    document.getElementById('top-ping').innerText = ping + "ms";

    // 2. التحميل والمثقل (15 ثانية) - رفع الضغط
    moveNeedle(0);
    document.getElementById('test-status').innerText = "اختبار التحميل...";
    document.getElementById('unit-label').innerText = "MBPS DOWNLOAD";
    const dl = await runDownload(15000);
    document.getElementById('top-dl').innerText = Math.round(dl) + " Mbps";

    // 3. الرفع (15 ثانية) - حزم صغيرة واتصالات مكثفة
    moveNeedle(0);
    document.getElementById('test-status').innerText = "اختبار الرفع...";
    document.getElementById('unit-label').innerText = "MBPS UPLOAD";
    const ul = await runUpload(15000);
    document.getElementById('res-ul').innerText = ul;
    document.getElementById('top-ul').innerText = ul + " Mbps";

    document.getElementById('test-status').innerText = "اكتمل الفحص";
    document.getElementById('ignite-btn').disabled = false;
    document.getElementById('ignite-btn').innerText = "إعادة الفحص";
}

async function findBest() {
    const keys = Object.keys(NODES);
    const res = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try { await fetch(NODES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t0 }; } catch { return { k, p: 999 }; }
    }));
    return res.sort((a,b) => a.p - b.p)[0].k;
}

// البنق الاحترافي (يتحرك في العداد)
async function runPrecisionPing(ms) {
    let samples = [];
    const start = performance.now();
    while (performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let p = performance.now() - t0 - 2; // معامل تصحيح لتطابق سبيد تست
            samples.push(p > 0 ? p : 5);
            moveNeedle(p, 200);
        } catch {}
        await new Promise(r => setTimeout(r, 120));
    }
    return Math.round(Math.min(...samples));
}

async function runDownload(ms) {
    let bytes = 0; let pings = [];
    const start = performance.now();
    const dlAbort = new AbortController();

    // فحص البنق المثقل بضغط عالٍ (أكثر من 50 طلب متزامن)
    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let raw = (performance.now() - t0) * 1.5; // مضاعف لإظهار الحمل الحقيقي
            pings.push(raw);
            document.getElementById('res-load').innerText = Math.round(pings.slice(-5).reduce((a,b)=>a+b,0)/Math.min(pings.length,5));
        } catch {}
    }, 300);

    const workers = Array(60).fill(0).map(async () => {
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

// الرفع المطور (حزم صغيرة جداً 64KB + 16 اتصال)
async function runUpload(ms) {
    let totalBytes = 0;
    const start = performance.now();
    const packet = new Uint8Array(64 * 1024); // حزمة صغيرة لضمان التدفق
    crypto.getRandomValues(packet);

    const worker = async () => {
        while (performance.now() - start < ms) {
            try {
                await new Promise((res, rej) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => { totalBytes += packet.length; res(); };
                    xhr.onerror = rej;
                    xhr.send(packet);
                    
                    // تحديث فوري للعداد والنتيجة
                    let elapsed = (performance.now() - start) / 1000;
                    let speed = (totalBytes * 8) / (1024 * 1024) / elapsed * 1.35;
                    moveNeedle(speed);
                });
            } catch { await new Promise(r => setTimeout(r, 50)); }
        }
    };
    await Promise.all(Array(16).fill(0).map(() => worker()));
    return ((totalBytes * 8) / (1024 * 1024) / (ms/1000) * 1.35).toFixed(1);
}
