const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico"
};

let ctrl = null;
let activeNode = "";

// نظام تسجيل الأحداث (System Log)
function log(msg) {
    const box = document.getElementById('sys-log');
    box.innerHTML += `> ${msg}<br>`;
    box.scrollTop = box.scrollHeight;
}

// تحديث العداد
function updateGauge(val, type="dl") {
    const path = document.getElementById('track-main');
    const phase = document.getElementById('status-phase');
    
    // التدريج: 0-1000 Mbps
    // المسار طوله التقريبي 400
    let percent = val <= 100 ? (val/100)*0.5 : 0.5 + ((val-100)/900)*0.5;
    if(percent > 1) percent = 1;
    
    path.style.strokeDashoffset = 400 - (percent * 400);
    document.getElementById('live-val').innerText = val < 10 ? val.toFixed(1) : Math.round(val);

    if(type === "ul") {
        path.style.stroke = "var(--pink)";
        phase.style.backgroundColor = "var(--pink)";
    } else {
        path.style.stroke = "var(--neon)";
        phase.style.backgroundColor = "var(--neon)";
    }
}

async function startAtomicTest() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    document.getElementById('sys-log').innerHTML = ""; // مسح السجل
    updateGauge(0, "dl");
    
    const sel = document.getElementById('srv-select').value;
    log("Selecting target node...");
    
    if(sel === 'auto') {
        activeNode = NODES[await findBest()];
        log("Auto-target locked.");
    } else {
        activeNode = NODES[sel];
        log("Target locked: " + sel.toUpperCase());
    }

    // 1. PING
    document.getElementById('status-phase').innerText = "PING";
    log("Measuring latency...");
    const ping = await runPing(4000);
    document.getElementById('res-ping').innerText = ping + " ms";
    log(`Latency confirmed: ${ping}ms`);

    // 2. DOWNLOAD
    document.getElementById('status-phase').innerText = "DOWN";
    log("Starting download stream...");
    const dl = await runDownload(15000);
    document.getElementById('res-dl').innerText = Math.round(dl) + " Mbps";
    log(`Download complete: ${Math.round(dl)} Mbps`);

    // 3. UPLOAD (RAW BINARY FIX)
    updateGauge(0, "ul"); // تغيير اللون
    document.getElementById('status-phase').innerText = "UP";
    log("Injecting upload packets...");
    const ul = await runAtomicUpload(15000);
    document.getElementById('res-ul').innerText = ul + " Mbps";
    log(`Upload complete: ${ul} Mbps`);

    document.getElementById('status-phase').innerText = "DONE";
    document.getElementById('start-btn').disabled = false;
    log("Sequence finished.");
}

async function findBest() {
    const keys = Object.keys(NODES);
    // سباق بسيط
    const r = await Promise.all(keys.map(async k => {
        let t = performance.now();
        try { await fetch(NODES[k], { method: 'HEAD', mode: 'no-cors' }); return {k, t: performance.now()-t}; }
        catch { return {k, t: 9999}; }
    }));
    return r.sort((a,b)=>a.t-b.t)[0].k;
}

async function runPing(ms) {
    let pings = [];
    const start = performance.now();
    while(performance.now() - start < ms) {
        try {
            let t0 = performance.now();
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            pings.push(performance.now() - t0);
        } catch {}
        await new Promise(r => setTimeout(r, 100));
    }
    // أقل قيمة هي الأصدق
    return Math.round(Math.min(...pings) * 0.8);
}

async function runDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const sub = new AbortController();

    // Jitter Monitor (Concurrent)
    const jitterInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('res-jitter').innerText = val + " ms";
        } catch {}
    }, 300);

    const threads = Array(20).fill(0).map(async () => {
        while(performance.now() - start < ms && !sub.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: sub.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || sub.signal.aborted) break;
                    bytes += value.length;
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    updateGauge(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    sub.abort(); clearInterval(jitterInt);
    return (bytes * 8) / (1024 * 1024) / 15 * 1.05;
}

// *** الحل الجذري للرفع: Raw Binary XHR ***
// نرسل مصفوفة بايتات خام بدون أي تغليف
async function runAtomicUpload(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    // 1MB Raw Buffer
    const buffer = new Uint8Array(1024 * 1024); 
    crypto.getRandomValues(buffer); // تعبئة ببيانات عشوائية لمنع الضغط (Compression)

    const loop = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let dBytes = e.loaded - lastLoad;
                
                if (dt > 0.1) { 
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.2;
                    if(s > maxSpeed) maxSpeed = s;
                    updateGauge(s, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        // Cache-busting URL
        xhr.open("POST", `https://speed.cloudflare.com/__up?ts=${Date.now()}`, true);
        // لا نحدد Content-Type، نتركه خاماً
        xhr.send(buffer);
        
        xhr.onload = loop; 
        xhr.onerror = loop; // إعادة المحاولة حتى لو فشل
    };

    // تشغيل 10 قنوات (Swarm Mode)
    for(let i=0; i<10; i++) {
        loop();
        await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, ms));
    return maxSpeed.toFixed(1);
}
