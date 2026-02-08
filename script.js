const SERVERS = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let controller = null;
let currentUrl = "";

// إعداد التدريج (0-500)
const ticks = document.getElementById('gauge-ticks');
[0, 100, 200, 300, 400, 500].forEach(v => {
    let a = (v / 500 * 240) - 120;
    ticks.innerHTML += `<span style="--a: ${a}deg">${v}</span>`;
});

function moveNeedle(val, maxRange = 500) {
    const n = document.getElementById('needle');
    // إذا كان الفحص بنق، نجعل الحد الأقصى 200 ليكون التحرك واضحاً
    let limit = (maxRange === 200) ? 200 : 500; 
    let angle = (Math.min(val, limit) / limit * 240) - 120;
    n.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
    document.getElementById('main-value').innerText = Math.round(val);
}

async function startUnifiedTest() {
    if(controller) controller.abort();
    controller = new AbortController();
    
    document.getElementById('ignite-btn').disabled = true;
    ["top-ping", "top-dl", "top-ul", "res-ping", "res-load", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    const sel = document.getElementById('server-selector').value;
    currentUrl = (sel === 'auto') ? SERVERS[await findBest()] : SERVERS[sel];

    // المرحلة 1: البنق التفاعلي (5 ثوانٍ) في العداد
    document.getElementById('test-status').innerText = "فحص الاستجابة الحية...";
    document.getElementById('unit-label').innerText = "MS PING";
    const finalPing = await runLivePing(5000);
    document.getElementById('top-ping').innerText = finalPing + "ms";
    document.getElementById('res-ping').innerText = finalPing;

    // المرحلة 2: التحميل (15 ثانية) في العداد
    moveNeedle(0);
    document.getElementById('test-status').innerText = "فحص التحميل...";
    document.getElementById('unit-label').innerText = "MBPS DOWNLOAD";
    const finalDL = await runDownload(15000);
    document.getElementById('top-dl').innerText = Math.round(finalDL) + " Mbps";

    // المرحلة 3: الرفع (15 ثانية) في العداد
    moveNeedle(0);
    document.getElementById('test-status').innerText = "فحص الرفع...";
    document.getElementById('unit-label').innerText = "MBPS UPLOAD";
    const finalUL = await runUpload(15000);
    document.getElementById('top-ul').innerText = finalUL + " Mbps";
    document.getElementById('res-ul').innerText = finalUL;

    document.getElementById('test-status').innerText = "اكتمل الفحص";
    document.getElementById('ignite-btn').disabled = false;
}

async function findBest() {
    const keys = Object.keys(SERVERS);
    const res = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try { await fetch(SERVERS[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t0 }; } catch { return { k, p: 999 }; }
    }));
    return res.sort((a,b) => a.p - b.p)[0].k;
}

// البنق التفاعلي (يصعد وينزل في العداد)
async function runLivePing(ms) {
    let samples = [];
    const start = performance.now();
    while (performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(currentUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            let p = performance.now() - t0;
            samples.push(p);
            moveNeedle(p, 200); // استخدام مدى 200 للبنق
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    return Math.round(Math.min(...samples));
}

async function runDownload(ms) {
    let bytes = 0; let pings = [];
    const start = performance.now();
    const dlAbort = new AbortController();

    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(currentUrl + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            let raw = performance.now() - t0 + 10;
            if(raw < 600) pings.push(raw);
            document.getElementById('res-load').innerText = Math.round(pings.slice(-5).reduce((a,b)=>a+b,0)/Math.min(pings.length,5));
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
    dlAbort.abort(); clearInterval(pinger);
    return (bytes * 8) / (1024 * 1024) / (ms/1000) * 1.05;
}

// الرفع المطور (XHR Multi-Stream)
async function runUpload(ms) {
    let totalBytes = 0;
    const start = performance.now();
    const data = new Uint8Array(256 * 1024);
    crypto.getRandomValues(data); // بيانات عشوائية

    const worker = async () => {
        while (performance.now() - start < ms) {
            try {
                await new Promise((res, rej) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => {
                        totalBytes += data.length;
                        let s = (totalBytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.35;
                        moveNeedle(s);
                        res();
                    };
                    xhr.onerror = rej;
                    xhr.send(data);
                });
            } catch { await new Promise(r => setTimeout(r, 100)); }
        }
    };
    await Promise.all(Array(12).fill(0).map(() => worker()));
    return ((totalBytes * 8) / (1024 * 1024) / (ms/1000) * 1.35).toFixed(1);
}
