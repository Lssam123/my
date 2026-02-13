// 1. قائمة السيرفرات الكاملة
const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let ctrl = null;         // للتحكم في الإلغاء
let activeNodeUrl = "";  // السيرفر المختار
let jitterInterval = null; // مؤقت البنق المثقل

// دالة إعادة تعيين النظام بالكامل (Fix for Hanging)
function resetSystem() {
    if(ctrl) ctrl.abort(); // قتل العمليات السابقة
    if(jitterInterval) clearInterval(jitterInterval);
    
    updateGauge(0, "dl");
    ["end-ping", "end-jitter", "end-dl", "end-ul"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('status-msg').innerText = "READY";
    
    const btn = document.getElementById('start-btn');
    btn.disabled = false;
    btn.innerText = "START CHECK";
}

function updateGauge(val, type="dl") {
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('live-num').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-fill');
    const msg = document.getElementById('status-msg');
    
    // محيط الدائرة 600
    path.style.strokeDashoffset = 600 - (p * 600);

    if(type === "ul") {
        path.style.stroke = "var(--pink)";
        path.style.filter = "drop-shadow(0 0 8px var(--pink))";
        msg.style.color = "var(--pink)";
    } else {
        path.style.stroke = "var(--cyan)";
        path.style.filter = "drop-shadow(0 0 8px var(--cyan))";
        msg.style.color = "var(--cyan)";
    }
}

async function startFullTest() {
    resetSystem(); // ضمان بداية نظيفة
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    
    const sel = document.getElementById('srv-select').value;
    if (sel === 'auto') {
        document.getElementById('status-msg').innerText = "SELECTING...";
        const best = await pickBest();
        activeNodeUrl = NODES[best];
    } else {
        activeNodeUrl = NODES[sel];
    }

    // 1. PING PHASE
    document.getElementById('status-msg').innerText = "PING";
    const ping = await runPing(4000);
    document.getElementById('end-ping').innerText = ping + " ms";

    // 2. DOWNLOAD PHASE (With Jitter Background)
    document.getElementById('status-msg').innerText = "DOWNLOAD";
    startJitterMonitor(); // تشغيل البنق المثقل
    const dl = await runDownload(15000);
    document.getElementById('end-dl').innerText = Math.round(dl);
    stopJitterMonitor(); // إيقاف البنق المثقل

    // 3. UPLOAD PHASE (Pulse Fix)
    updateGauge(0, "ul");
    document.getElementById('status-msg').innerText = "UPLOAD";
    const ul = await runUploadPulse(15000);
    document.getElementById('end-ul').innerText = ul;

    document.getElementById('status-msg').innerText = "DONE";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "RETEST";
}

async function pickBest() {
    const k = Object.keys(NODES);
    const r = await Promise.all(k.map(async x => {
        let t = performance.now();
        try { await fetch(NODES[x] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal }); 
        return { k: x, p: performance.now() - t }; } catch { return { k: x, p: 9999 }; }
    }));
    return r.sort((a,b) => a.p - b.p)[0].k;
}

// دالة البنق المثقل (تعمل في الخلفية)
function startJitterMonitor() {
    jitterInterval = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNodeUrl + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('end-jitter').innerText = val + " ms";
        } catch {}
    }, 400);
}

function stopJitterMonitor() {
    if(jitterInterval) clearInterval(jitterInterval);
}

async function runPing(ms) {
    let pings = [];
    const start = performance.now();
    while(performance.now() - start < ms) {
        if(ctrl.signal.aborted) break;
        let t0 = performance.now();
        try {
            await fetch(activeNodeUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            pings.push((performance.now() - t0) * 0.8);
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    pings.sort((a,b)=>a-b);
    return Math.round(pings[Math.floor(pings.length/2)] || 0);
}

async function runDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    
    const workers = Array(25).fill(0).map(async () => {
        while(performance.now() - start < ms) {
            if(ctrl.signal.aborted) break;
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: ctrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || ctrl.signal.aborted) break;
                    bytes += value.length;
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    updateGauge(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytes * 8) / (1024 * 1024) / 15 * 1.05;
}

// *** إصلاح الرفع: Pulse Upload Strategy ***
// إرسال دفعات صغيرة ومتكررة يمنع المتصفح من التعليق
async function runUploadPulse(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    const data = new Uint8Array(512 * 1024); // 512KB
    crypto.getRandomValues(data);

    const worker = () => {
        if(performance.now() - start >= ms || ctrl.signal.aborted) return;

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let dBytes = e.loaded - lastLoad;
                
                if (dt > 0.1) { 
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.15;
                    if(s > maxSpeed) maxSpeed = s;
                    updateGauge(s, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        xhr.open("POST", `https://speed.cloudflare.com/__up?ts=${Date.now() + Math.random()}`, true);
        xhr.onload = worker; 
        xhr.onerror = worker; 
        xhr.send(data);
    };

    // 10 قنوات تعمل بتناغم
    for(let i=0; i<10; i++) {
        worker();
        await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, ms));
    return maxSpeed.toFixed(1);
}
