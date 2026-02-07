const ISP_DATA = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let mainCtrl = null;
let activeNode = "";

// نظام المعايرة البصرية
const marks = document.getElementById('gauge-marks');
[0, 100, 200, 300, 400, 500].forEach(v => {
    let a = (v / 500 * 240) - 120;
    marks.innerHTML += `<span style="--a: ${a}deg">${v}</span>`;
});

function syncNeedle(v) {
    const n = document.getElementById('needle');
    let a = (Math.min(v, 500) / 500 * 240) - 120;
    n.style.transform = `translate(-50%, -100%) rotate(${a}deg)`;
    document.getElementById('speed-display').innerText = Math.round(v);
}

async function igniteEngine() {
    if(mainCtrl) mainCtrl.abort();
    mainCtrl = new AbortController();
    
    const btn = document.getElementById('ignite-btn');
    btn.disabled = true;
    syncNeedle(0);
    ["ping-val", "load-val", "up-val"].forEach(id => document.getElementById(id).innerText = "--");

    // مرحلة 1: الرادار الذكي (Smart Node Discovery)
    const sel = document.getElementById('server-selector').value;
    activeNode = (sel === 'auto') ? ISP_DATA[await discoverBestNode()] : ISP_DATA[sel];

    // مرحلة 2: البنق الخامل (Precision Idle Ping - 5s)
    document.getElementById('status-display').innerText = "تحليل زمن الاستجابة...";
    document.getElementById('ping-val').innerText = await measurePing(5000);

    // مرحلة 3: التحميل والمثقل المتزامن (Download & Loaded - 15s)
    document.getElementById('status-display').innerText = "فحص النطاق الترددي...";
    await runMultiDownload(15000);

    // مرحلة 4: الرفع التوربيني (Turbo Upload - 15s)
    document.getElementById('status-display').innerText = "فحص الرفع الرقمي...";
    const needle = document.getElementById('needle');
    needle.style.transform = `translate(-50%, -100%) rotate(-120deg)`; 
    await runMultiUpload(15000);

    document.getElementById('status-display').innerText = "اكتمل تحليل النظام";
    btn.disabled = false;
}

async function discoverBestNode() {
    const keys = Object.keys(ISP_DATA);
    const scores = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try { await fetch(ISP_DATA[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t0 }; } catch { return { k, p: 999 }; }
    }));
    return scores.sort((a,b) => a.p - b.p)[0].k;
}

async function measurePing(duration) {
    let samples = [];
    const start = performance.now();
    while (performance.now() - start < duration) {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: mainCtrl.signal });
            samples.push(performance.now() - t0);
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    return samples.length ? Math.round(Math.min(...samples)) : "--";
}

async function runMultiDownload(ms) {
    let bytes = 0; let pings = [];
    const start = performance.now();
    const dlAbort = new AbortController();

    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: mainCtrl.signal });
            let raw = performance.now() - t0;
            if(raw < 800) pings.push(raw); 
            let avg = pings.slice(-5).reduce((a,b)=>a+b, 0) / Math.min(pings.length, 5);
            document.getElementById('load-val').innerText = Math.round(avg + 5);
        } catch {}
    }, 400);

    // نظام الـ 40 مسار المتوازي للتحميل
    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms && !dlAbort.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: dlAbort.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
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

async function runMultiUpload(ms) {
    let totalBytes = 0;
    const start = performance.now();
    const packet = new Uint8Array(1024 * 1024); // حزمة 1MB للاستقرار

    const worker = async () => {
        while (performance.now() - start < ms) {
            try {
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => {
                        totalBytes += packet.length;
                        let elapsed = (performance.now() - start) / 1000;
                        let mbps = (totalBytes * 8) / (1024 * 1024) / elapsed * 1.35;
                        document.getElementById('up-val').innerText = mbps.toFixed(1);
                        resolve();
                    };
                    xhr.onerror = reject;
                    xhr.send(packet);
                });
            } catch { await new Promise(r => setTimeout(r, 50)); }
        }
    };

    // تشغيل 15 قناة متزامنة للرفع (محرك التوربو)
    await Promise.all(Array(15).fill(0).map(() => worker()));
}
