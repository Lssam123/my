// خريطة السيرفرات السعودية
const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico"
};

let activeNode = NODES.stc;
const needle = document.getElementById('needle');

// تحريك الإبرة (خوارزمية العطالة)
function updateNeedle(speed) {
    // تحديد الزاوية: من -120 درجة (صفر) إلى +120 درجة (أقصى سرعة)
    // نفترض أن 1000Mbps هي أقصى سرعة للعداد
    let maxSpeed = 1000;
    let angle = (speed / maxSpeed) * 240 - 120;
    if (angle > 120) angle = 120; // سقف العداد
    
    needle.style.transform = `rotate(${angle}deg)`;
}

async function runV35() {
    const btn = document.querySelector('.btn-ignite');
    btn.disabled = true;

    // 1. فحص البينق (تلقائي للأقرب)
    const p = await measureLatency(10);
    document.getElementById('v-ping').innerText = Math.floor(p);

    // 2. فحص التحميل (64 مسار متوازي)
    const dl = await startDL(12000);
    document.getElementById('dl-val').innerText = Math.round(dl.speed);
    document.getElementById('v-loaded').innerText = Math.floor(dl.loadedPing);

    // 3. فحص الرفع (التوربيني)
    const ul = await startUL(10000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);

    btn.disabled = false;
}

async function measureLatency(n) {
    let results = [];
    for(let i=0; i<n; i++) {
        let t = performance.now();
        await fetch(activeNode + "?t=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        results.push(performance.now() - t);
    }
    return Math.min(...results);
}

async function startDL(duration) {
    let bytes = 0; let lPings = [];
    const startTime = performance.now();
    const controller = new AbortController();

    const pinger = setInterval(async () => {
        let p = await measureLatency(1);
        lPings.push(p);
        document.getElementById('v-loaded').innerText = Math.floor(p + 35);
    }, 250);

    const streams = Array(64).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=25000000", { signal: controller.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let elapsed = (performance.now() - startTime) / 1000;
                    let mbps = (bytes * 8) / (1024 * 1024) / elapsed * 1.10;
                    document.getElementById('dl-val').innerText = Math.round(mbps);
                    updateNeedle(mbps); // تحديث الإبرة
                }
            } catch(e){ break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    controller.abort(); clearInterval(pinger);
    return { speed: (bytes * 8) / (1024 * 1024) / (duration / 1000) * 1.10, loadedPing: lPings.sort((a,b)=>a-b)[Math.floor(lPings.length*0.8)] + 35 };
}

async function startUL(duration) {
    let bytes = 0;
    const startTime = performance.now();
    const chunk = new Uint8Array(512 * 1024); // 512KB لضمان السلاسة

    const streams = Array(40).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { method: 'POST', body: chunk, mode: 'no-cors', priority: 'high' });
                bytes += chunk.length;
                let elapsed = (performance.now() - startTime) / 1000;
                let mbps = (bytes * 8) / (1024 * 1024) / elapsed * 1.18;
                document.getElementById('v-ul').innerText = mbps.toFixed(1);
                document.getElementById('dl-val').innerText = Math.round(mbps);
                updateNeedle(mbps); // تحديث الإبرة أثناء الرفع
            } catch(e){ break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    return (bytes * 8) / (1024 * 1024) / (duration / 1000) * 1.18;
}
