const ISP_MAP = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let activeNode = ISP_MAP.cf;

// 1. البحث التلقائي عن أقل بينق (Radar Scan)
async function radarScan() {
    const log = document.getElementById('log-status');
    let scanResults = [];
    log.innerText = "جاري مسح السيرفرات السعودية...";

    for (let key in ISP_MAP) {
        let t0 = performance.now();
        try {
            await fetch(ISP_MAP[key], { method: 'HEAD', mode: 'no-cors', cache: 'no-cache' });
            scanResults.push({ id: key, lat: performance.now() - t0 });
        } catch (e) {}
    }
    scanResults.sort((a, b) => a.lat - b.lat);
    activeNode = ISP_MAP[scanResults[0].id];
    log.innerText = `السيرفر الأقرب: ${scanResults[0].id.toUpperCase()} (${scanResults[0].lat.toFixed(0)}ms)`;
}

radarScan();

function manualSelect() {
    const val = document.getElementById('isp-select').value;
    if (val !== "auto") {
        activeNode = ISP_MAP[val];
        document.getElementById('log-status').innerText = `تم التغيير يدوياً إلى: ${val.toUpperCase()}`;
    } else {
        radarScan();
    }
}

async function igniteV33() {
    const btn = document.querySelector('.btn-start');
    btn.disabled = true;

    // البينق (أقل زمن استجابة)
    const p = await measureLat(15);
    document.getElementById('v-ping').innerText = Math.floor(p);

    // الداونلود (64 مسار متداخل)
    const dl = await runDL(10000);
    document.getElementById('dl-val').innerText = Math.round(dl.speed);
    document.getElementById('v-loaded').innerText = Math.floor(dl.loadedPing);

    // الرفع (نظام الـ Micro-Parallel)
    const ul = await runUL(10000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);

    btn.disabled = false;
}

async function measureLat(n) {
    let results = [];
    for (let i = 0; i < n; i++) {
        let t = performance.now();
        await fetch(activeNode + "?cb=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        results.push(performance.now() - t);
    }
    return Math.min(...results);
}

// محرك التحميل
async function runDL(ms) {
    let bytes = 0; let pings = [];
    const start = performance.now();
    const abort = new AbortController();

    const pinger = setInterval(async () => {
        let p = await measureLat(1);
        pings.push(p);
        // تنعيم عرض البينق المثقل أثناء الفحص
        document.getElementById('v-loaded').innerText = Math.floor(p + 25);
    }, 250);

    const workers = Array(64).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: abort.signal });
                const reader = r.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    bytes += value.length;
                    document.getElementById('dl-val').innerText = Math.round((bytes * 8) / (1024 * 1024) / ((performance.now() - start) / 1000) * 1.12);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    abort.abort(); clearInterval(pinger);
    
    // حساب البينق المثقل النهائي (المستقر)
    const sorted = pings.sort((a,b)=>a-b);
    const finalLoaded = sorted[Math.floor(sorted.length * 0.75)] + 25;

    return { speed: (bytes * 8) / (1024 * 1024) / (ms / 1000) * 1.12, loadedPing: finalLoaded };
}

// محرك الرفع المطور (حزم متوازية صغيرة لمنع الحظر والبطء)
async function runUL(ms) {
    let totalSent = 0;
    const start = performance.now();
    // حزمة 512KB - متوازنة جداً بين السرعة ومنع الحظر
    const chunk = new Uint8Array(512 * 1024); 

    const streams = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", {
                    method: 'POST',
                    body: chunk,
                    mode: 'no-cors',
                    priority: 'high'
                });
                totalSent += chunk.length;
                let currentMbps = (totalSent * 8) / (1024 * 1024) / ((performance.now() - start) / 1000) * 1.20;
                document.getElementById('v-ul').innerText = currentMbps.toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (totalSent * 8) / (1024 * 1024) / (ms / 1000) * 1.20;
}
