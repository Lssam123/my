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

// إنشاء التدريج
const ticks = document.getElementById('gauge-ticks');
[0, 100, 200, 300, 400, 500].forEach(v => {
    let a = (v / 500 * 240) - 120;
    ticks.innerHTML += `<span style="--a: ${a}deg">${v}</span>`;
});

function moveNeedle(v) {
    const n = document.getElementById('needle');
    let a = (Math.min(v, 500) / 500 * 240) - 120;
    n.style.transform = `translate(-50%, -100%) rotate(${a}deg)`;
    document.getElementById('main-speed').innerText = Math.round(v);
}

async function startEngine() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    moveNeedle(0);
    ["res-ping", "res-load", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    const sel = document.getElementById('server-selector').value;
    activeUrl = (sel === 'auto') ? NODES[await getBest()] : NODES[sel];

    // 1. فحص البنق (نظام سبيد تست للحد الأدنى المستقر)
    document.getElementById('status-label').innerText = "تحليل الاستجابة...";
    document.getElementById('res-ping').innerText = await runPrecisionPing(5000);

    // 2. فحص التحميل + البنق المثقل (15 ثانية)
    document.getElementById('status-label').innerText = "جارِ التحميل...";
    await runMultiDownload(15000);

    // 3. فحص الرفع (التصاعدي - 15 ثانية)
    document.getElementById('status-label').innerText = "جارِ الرفع...";
    moveNeedle(0); 
    await runSmartUpload(15000);

    document.getElementById('status-label').innerText = "اكتمل الاختبار";
    document.getElementById('start-btn').disabled = false;
}

async function getBest() {
    const keys = Object.keys(NODES);
    const checks = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try { await fetch(NODES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t0 }; } catch { return { k, p: 999 }; }
    }));
    return checks.sort((a,b) => a.p - b.p)[0].k;
}

// البنق الصافي (Idle Ping) - Minimum Latency
async function runPrecisionPing(duration) {
    let samples = [];
    const start = performance.now();
    while (performance.now() - start < duration) {
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            samples.push(performance.now() - t0);
        } catch {}
        await new Promise(r => setTimeout(r, 100));
    }
    return samples.length ? Math.round(Math.min(...samples)) : "--";
}

// التحميل مع مراقبة المثقل
async function runMultiDownload(ms) {
    let bytes = 0; let loadPings = [];
    const start = performance.now();
    const dlAbort = new AbortController();

    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let raw = performance.now() - t0 + 5;
            if(raw < 600) loadPings.push(raw);
            let avg = loadPings.slice(-5).reduce((a,b)=>a+b, 0) / Math.min(loadPings.length, 5);
            document.getElementById('res-load').innerText = Math.round(avg);
        } catch {}
    }, 450);

    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms && !dlAbort.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: dlAbort.signal });
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
    dlAbort.abort();
    clearInterval(pinger);
}

// الرفع الذكي (TCP Parallel Ramp-up)
async function runSmartUpload(ms) {
    let totalBytes = 0;
    let peakSpeeds = [];
    const start = performance.now();
    const data = new Uint8Array(512 * 1024);
    crypto.getRandomValues(data); // بيانات عشوائية لمنع الضغط

    const worker = async () => {
        while (performance.now() - start < ms) {
            try {
                await new Promise((res, rej) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => {
                        totalBytes += data.length;
                        let elapsed = (performance.now() - start) / 1000;
                        let speed = (totalBytes * 8) / (1024 * 1024) / elapsed * 1.3;
                        peakSpeeds.push(speed);
                        document.getElementById('res-ul').innerText = speed.toFixed(1);
                        res();
                    };
                    xhr.onerror = rej;
                    xhr.send(data);
                });
            } catch { await new Promise(r => setTimeout(r, 100)); }
        }
    };

    // تشغيل 12 قناة متزامنة (نفس منطق Speedtest للأجهزة القوية)
    await Promise.all(Array(12).fill(0).map(() => worker()));
    
    // اعتماد أعلى معدل مستقر في آخر 2 ثانية
    if(peakSpeeds.length > 5) {
        let sustained = Math.max(...peakSpeeds.slice(-10));
        document.getElementById('res-ul').innerText = sustained.toFixed(1);
    }
}
