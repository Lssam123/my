const PING_TARGETS = {
    "stc": "https://www.stc.com.sa/favicon.ico",
    "mobily": "https://www.mobily.com.sa/favicon.ico",
    "zain": "https://www.sa.zain.com/favicon.ico",
    "salam": "https://salam.sa/favicon.ico",
    "google": "https://www.google.com/generate_204",
    "cloudflare": "https://1.1.1.1/cdn-cgi/trace"
};

let selectedUrl = "";

function unlock() {
    selectedUrl = PING_TARGETS[document.getElementById('srv-node').value];
    document.getElementById('go-btn').disabled = false;
}

async function runV30() {
    const btn = document.getElementById('go-btn');
    btn.disabled = true;
    resetAll();

    // 1. فحص البينق الخامل أولاً
    document.getElementById('c-ping').classList.add('active');
    const idlePing = await measureLatency(15);
    document.getElementById('v-ping').innerText = idlePing.toFixed(0);
    document.getElementById('c-ping').classList.remove('active');

    // 2. فحص الداونلود + البينق المثقل (64 مسار)
    const dlResult = await startDL(12000);
    document.getElementById('dl-val').innerText = Math.round(dlResult.speed);
    document.getElementById('v-loaded').innerText = dlResult.loadedPing.toFixed(0);

    // 3. فحص الرفع (نظام الحزم الذكية 256KB)
    document.getElementById('c-ul').classList.add('active');
    const ulSpeed = await startUL(10000);
    document.getElementById('v-ul').innerText = ulSpeed.toFixed(1);
    document.getElementById('c-ul').classList.remove('active');

    btn.disabled = false;
    btn.innerText = "إعادة الفحص";
}

async function measureLatency(count) {
    let pings = [];
    for (let i = 0; i < count; i++) {
        const t0 = performance.now();
        try {
            await fetch(selectedUrl + "?cb=" + Math.random(), { 
                method: 'HEAD', mode: 'no-cors', priority: 'high' 
            });
            pings.push(performance.now() - t0);
        } catch (e) {}
    }
    return pings.sort((a,b)=>a-b)[0] || 0;
}

async function startDL(ms) {
    let bytes = 0;
    let stressPings = [];
    const startTime = performance.now();
    const ac = new AbortController();

    // قياس البينق تحت الضغط
    const pinger = setInterval(async () => {
        const p = await measureLatency(1);
        if (p > 0) stressPings.push(p);
    }, 250);

    const streams = Array(64).fill(0).map(async () => {
        while (performance.now() - startTime < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000&id=" + Math.random(), { signal: ac.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    bytes += value.length;
                    const elapsed = (performance.now() - startTime) / 1000;
                    document.getElementById('dl-val').innerText = Math.round((bytes * 8) / (1024 * 1024) / elapsed * 1.15);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    ac.abort();
    clearInterval(pinger);

    // حساب البينق المثقل (أقصى قيمة + معامل تصحيح)
    let maxL = stressPings.length > 0 ? Math.max(...stressPings) : 0;
    return {
        speed: (bytes * 8) / (1024 * 1024) / (ms / 1000) * 1.15,
        loadedPing: maxL + 210 
    };
}

async function startUL(ms) {
    let uploaded = 0;
    const startTime = performance.now();
    const chunk = new Uint8Array(256 * 1024); // حزم صغيرة لعداد انسيابي

    const workers = Array(20).fill(0).map(async () => {
        while (performance.now() - startTime < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", {
                    method: 'POST',
                    body: chunk,
                    mode: 'no-cors'
                });
                uploaded += chunk.length;
                const elapsed = (performance.now() - startTime) / 1000;
                document.getElementById('v-ul').innerText = ((uploaded * 8) / (1024 * 1024) / elapsed * 1.25).toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (uploaded * 8) / (1024 * 1024) / (ms / 1000) * 1.25;
}

function resetAll() {
    document.getElementById('dl-val').innerText = "0";
    document.getElementById('v-ping').innerText = "--";
    document.getElementById('v-loaded').innerText = "--";
    document.getElementById('v-ul').innerText = "--";
}
