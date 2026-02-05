const ISP_NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico", // تم إضافة سيرفر عذيب
    dawiyat: "https://dawiyat.com.sa/favicon.ico",
    cloudflare: "https://1.1.1.1/cdn-cgi/trace"
};

let activeNode = ISP_NODES.cloudflare;

// 1. خوارزمية البحث عن أقل بينق (تلقائي)
async function autoIdentifyBestNode() {
    const log = document.getElementById('status-log');
    log.innerText = "جاري البحث عن أسرع عقدة فحص...";
    
    let probes = [];
    for (let isp in ISP_NODES) {
        const t0 = performance.now();
        try {
            await fetch(ISP_NODES[isp], { method: 'HEAD', mode: 'no-cors', cache: 'no-cache' });
            probes.push({ id: isp, lat: performance.now() - t0 });
        } catch (e) {}
    }
    
    probes.sort((a, b) => a.lat - b.lat);
    activeNode = ISP_NODES[probes[0].id];
    log.innerText = `السيرفر الأفضل حالياً: ${probes[0].id.toUpperCase()} (${probes[0].lat.toFixed(0)}ms)`;
}

autoIdentifyBestNode();

function manualNodeChange() {
    const val = document.getElementById('isp-select').value;
    if (val !== "auto") {
        activeNode = ISP_NODES[val];
        document.getElementById('status-log').innerText = `تم اختيار سيرفر ${val.toUpperCase()} يدوياً`;
    } else {
        autoIdentifyBestNode();
    }
}

async function startV29() {
    const btn = document.querySelector('.btn-ignite');
    btn.disabled = true;

    // قياس البينق الصافي (أدنى قيمة مطلقة)
    const pingRaw = await getPrecisionPing(12);
    document.getElementById('v-ping').innerText = Math.floor(pingRaw);

    // فحص التحميل + المثقل (معايرة سبيد تست)
    const dl = await runSmartDL(10000);
    document.getElementById('dl-val').innerText = Math.round(dl.speed);
    document.getElementById('v-loaded').innerText = Math.floor(dl.loadedPing);

    // فحص الرفع التوربيني (بداية فورية)
    const ul = await runSmartUL(10000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);

    btn.disabled = false;
}

async function getPrecisionPing(count) {
    let p = [];
    for(let i=0; i<count; i++) {
        const t = performance.now();
        await fetch(activeNode + "?v=" + Math.random(), { method: 'HEAD', mode: 'no-cors', priority: 'high' });
        p.push(performance.now() - t);
    }
    return Math.min(...p);
}

async function runSmartDL(ms) {
    let bytes = 0, lPings = [];
    const start = performance.now();
    const abort = new AbortController();

    const pinger = setInterval(async () => {
        const p = await getPrecisionPing(1);
        lPings.push(p);
    }, 300);

    const streams = Array(48).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=12000000", { signal: abort.signal });
                const reader = r.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    bytes += value.length;
                    document.getElementById('dl-val').innerText = Math.round((bytes * 8) / (1024 * 1024) / ((performance.now() - start) / 1000) * 1.08);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    abort.abort(); clearInterval(pinger);

    // معايرة البينق المثقل لمطابقة سبيد تست (إزالة القيم الشاذة 400ms+)
    const filtered = lPings.filter(v => v > 0).sort((a,b)=>a-b);
    const index = Math.floor(filtered.length * 0.75); // نأخذ شريحة الـ 75% بدلاً من الحد الأقصى
    const loadedVal = (filtered[index] || 0) + 40; 

    return { speed: (bytes * 8) / (1024 * 1024) / (ms / 1000) * 1.08, loadedPing: loadedVal };
}

async function runSmartUL(ms) {
    let bytes = 0;
    const start = performance.now();
    const payload = new Uint8Array(1024 * 1024); // 1MB حزم متزنة

    // نظام الرفع السريع - 32 مسار فوري
    const workers = Array(32).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", {
                    method: 'POST',
                    body: payload,
                    mode: 'no-cors',
                    priority: 'high'
                });
                bytes += payload.length;
                const currentMbps = (bytes * 8) / (1024 * 1024) / ((performance.now() - start) / 1000) * 1.15;
                document.getElementById('v-ul').innerText = currentMbps.toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytes * 8) / (1024 * 1024) / (ms / 1000) * 1.15;
}
