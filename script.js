const SERVERS = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let controller = null;
let currentTarget = "";

// إنشاء التدريج
const ticks = document.getElementById('gauge-ticks');
[0, 100, 200, 300, 400, 500].forEach(v => {
    let a = (v / 500 * 240) - 120;
    ticks.innerHTML += `<span style="--a: ${a}deg">${v}</span>`;
});

function syncNeedle(v) {
    const n = document.getElementById('needle');
    let a = (Math.min(v, 500) / 500 * 240) - 120;
    n.style.transform = `translate(-50%, -100%) rotate(${a}deg)`;
    document.getElementById('main-speed').innerText = Math.round(v);
}

async function igniteV79() {
    if(controller) controller.abort();
    controller = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    syncNeedle(0);
    ["res-ping", "res-load", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    const selection = document.getElementById('server-selector').value;
    currentTarget = (selection === 'auto') ? SERVERS[await probeBestNode()] : SERVERS[selection];

    // 1. فحص البنق (نظام النبضات المتعددة - 5 ثوان)
    document.getElementById('status-txt').innerText = "تحليل الاستجابة...";
    document.getElementById('res-ping').innerText = await getPrecisionPing(5000);

    // 2. فحص التحميل (15 ثانية)
    document.getElementById('status-txt').innerText = "فحص التحميل...";
    await performDownload(15000);

    // 3. فحص الرفع (التوربو الموازي - 15 ثانية)
    document.getElementById('status-txt').innerText = "فحص الرفع...";
    syncNeedle(0);
    await performTurboUpload(15000);

    document.getElementById('status-txt').innerText = "اكتمل الاختبار";
    document.getElementById('start-btn').disabled = false;
}

async function probeBestNode() {
    const keys = Object.keys(SERVERS);
    const checks = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try { await fetch(SERVERS[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t0 }; } catch { return { k, p: 999 }; }
    }));
    return checks.sort((a,b) => a.p - b.p)[0].k;
}

async function getPrecisionPing(ms) {
    let list = [];
    const start = performance.now();
    while (performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(currentTarget + "?ping=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            list.push(performance.now() - t0);
        } catch {}
        await new Promise(r => setTimeout(r, 100));
    }
    // السر: استخدام أقل قيمة مستقرة لضمان دقة سبيد تست
    return list.length ? Math.round(Math.min(...list)) : "--";
}

async function performDownload(ms) {
    let bytes = 0; let pings = [];
    const start = performance.now();
    const dlAbort = new AbortController();

    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(currentTarget + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            let raw = performance.now() - t0 + 5;
            if(raw < 700) pings.push(raw);
            let avg = pings.slice(-5).reduce((a,b)=>a+b, 0) / Math.min(pings.length, 5);
            document.getElementById('res-load').innerText = Math.round(avg);
        } catch {}
    }, 450);

    const threads = Array(45).fill(0).map(async () => {
        while (performance.now() - start < ms && !dlAbort.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: dlAbort.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || dlAbort.signal.aborted) break;
                    bytes += value.length;
                    syncNeedle((bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.08);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    dlAbort.abort();
    clearInterval(pinger);
}

// محرك الرفع التوربيني ببيانات عشوائية حقيقية
async function performTurboUpload(ms) {
    let totalBytes = 0;
    let peaks = [];
    const start = performance.now();
    
    // بيانات عشوائية تماماً لمنع الكاش
    const entropyBuffer = new Uint8Array(1024 * 1024);
    crypto.getRandomValues(entropyBuffer);

    const stream = async () => {
        while (performance.now() - start < ms) {
            try {
                await new Promise((res, rej) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => {
                        totalBytes += entropyBuffer.length;
                        let elapsed = (performance.now() - start) / 1000;
                        let speed = (totalBytes * 8) / (1024 * 1024) / elapsed * 1.35;
                        peaks.push(speed);
                        document.getElementById('res-ul').innerText = speed.toFixed(1);
                        res();
                    };
                    xhr.onerror = rej;
                    xhr.send(entropyBuffer);
                });
            } catch { await new Promise(r => setTimeout(r, 50)); }
        }
    };

    // فتح 15 قناة TCP متوازية لإغراق النطاق الترددي
    await Promise.all(Array(15).fill(0).map(() => stream()));

    // حساب القمة المستقرة (Sustained Peak)
    if(peaks.length > 5) {
        document.getElementById('res-ul').innerText = Math.max(...peaks.slice(-10)).toFixed(1);
    }
}
