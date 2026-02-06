const SERVERS = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let optimalNode = SERVERS.stc;

// 1. خوارزمية اختيار المسار الأفضل (ليس فقط الأسرع بل الأكثر استقراراً)
async function findBestPath() {
    const status = document.getElementById('path-info');
    let candidates = [];
    
    for (let key in SERVERS) {
        let pings = [];
        for(let i=0; i<3; i++) { // فحص الاستقرار عبر 3 نبضات
            let t0 = performance.now();
            try {
                await fetch(SERVERS[key], { method: 'HEAD', mode: 'no-cors', cache: 'no-cache' });
                pings.push(performance.now() - t0);
            } catch(e) {}
        }
        if(pings.length > 0) {
            let avg = pings.reduce((a,b)=>a+b)/pings.length;
            let jitter = Math.max(...pings) - Math.min(...pings);
            candidates.push({id: key, score: avg + (jitter * 2)}); // تفضيل الثبات على السرعة اللحظية
        }
    }
    candidates.sort((a,b) => a.score - b.score);
    optimalNode = SERVERS[candidates[0].id];
    status.innerText = `تم اختيار مسار: ${candidates[0].id.toUpperCase()} (مستقر)`;
}

findBestPath();

async function runV32() {
    const btn = document.querySelector('.btn-ignite');
    btn.disabled = true;

    // قياس البينق الصافي
    document.getElementById('c1').classList.add('active');
    const p = await getPrecisionPing(10);
    document.getElementById('v-ping').innerText = Math.floor(p);
    document.getElementById('c1').classList.remove('active');

    // الداونلود (64 مسار متداخل)
    document.getElementById('c2').classList.add('active');
    const dl = await executeDownload(12000);
    document.getElementById('dl-display').innerText = Math.round(dl.speed);
    document.getElementById('v-loaded').innerText = Math.floor(dl.loadedPing);
    document.getElementById('c2').classList.remove('active');

    // الرفع (نظام Micro-Bursting بـ 50 مسار)
    document.getElementById('c3').classList.add('active');
    const ul = await executeUpload(10000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);
    document.getElementById('c3').classList.remove('active');

    btn.disabled = false;
}

async function getPrecisionPing(n) {
    let res = [];
    for(let i=0; i<n; i++) {
        let t = performance.now();
        await fetch(optimalNode + "?r=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        res.push(performance.now() - t);
    }
    return Math.min(...res);
}

// محاكي الداونلود
async function executeDownload(ms) {
    let totalBytes = 0;
    let smoothPing = 0;
    const start = performance.now();
    const ctrl = new AbortController();

    const pinger = setInterval(async () => {
        let p = await getPrecisionPing(1);
        smoothPing = smoothPing === 0 ? p : (smoothPing * 0.8 + p * 0.2);
        document.getElementById('v-loaded').innerText = Math.floor(smoothPing + 20);
    }, 250);

    const workers = Array(64).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: ctrl.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    totalBytes += value.length;
                    let mbps = (totalBytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.12;
                    document.getElementById('dl-display').innerText = Math.round(mbps);
                }
            } catch(e){ break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    ctrl.abort(); clearInterval(pinger);
    return { speed: (totalBytes*8)/(1024*1024)/(ms/1000)*1.12, loadedPing: smoothPing + 20 };
}

// محرك الرفع (Micro-Bursting - السرعة الفائقة والحماية)
async function executeUpload(ms) {
    let totalSent = 0;
    const start = performance.now();
    // حزم مجهرية (64KB) لتجنب كشف نمط "اختبار السرعة" من قبل المزود
    const microChunk = new Uint8Array(64 * 1024); 

    // 50 مسار متوازي (تكرار سريع جداً)
    const streams = Array(50).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", {
                    method: 'POST',
                    body: microChunk,
                    mode: 'no-cors',
                    priority: 'high'
                });
                totalSent += microChunk.length;
                let mbps = (totalSent * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.22;
                document.getElementById('v-ul').innerText = mbps.toFixed(1);
            } catch(e){ break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (totalSent*8)/(1024*1024)/(ms/1000)*1.22;
}
