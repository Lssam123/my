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
let jitterInt = null;

// إعادة تعيين شاملة
function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterInt) clearInterval(jitterInt);
    
    updateGauge(0, "dl");
    updateTimer(0);
    ["res-ping", "res-dl", "res-ul", "res-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('status-txt').innerText = "READY";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "START TEST";
}

function updateTimer(percent) {
    document.getElementById('time-bar').style.width = percent + "%";
}

function updateGauge(val, type="dl") {
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('live-num').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-fill');
    // محيط الدائرة 600
    path.style.strokeDashoffset = 600 - (p * 600);

    if(type === "ul") {
        path.style.stroke = "url(#g-ul)";
        path.style.filter = "drop-shadow(0 0 10px var(--ul-color))";
        document.getElementById('status-txt').style.color = "var(--ul-color)";
    } else {
        path.style.stroke = "url(#g-dl)";
        path.style.filter = "drop-shadow(0 0 10px var(--dl-color))";
        document.getElementById('status-txt').style.color = "var(--dl-color)";
    }
}

async function runSyncTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    const sel = document.getElementById('srv-select').value;
    if(sel === 'auto') {
        document.getElementById('status-txt').innerText = "SEARCHING...";
        const best = await findBest();
        activeUrl = NODES[best];
    } else {
        activeUrl = NODES[sel];
    }

    // 1. PING (3 Seconds)
    document.getElementById('status-txt').innerText = "PING";
    const ping = await runTimedPing(3000);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 2. DOWNLOAD + JITTER (SYNCED - 10 Seconds)
    document.getElementById('status-txt').innerText = "DOWNLOAD";
    // تشغيل الجيتر والتحميل معاً
    startJitter(); 
    const dl = await runTimedDownload(10000);
    stopJitter(); // إيقاف الجيتر فور انتهاء التحميل
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 3. UPLOAD (10 Seconds)
    updateGauge(0, "ul");
    document.getElementById('status-txt').innerText = "UPLOAD";
    const ul = await runTimedUpload(10000);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('status-txt').innerText = "COMPLETE";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "TEST AGAIN";
}

// دالة البنق المثقل (تعمل في الخلفية)
function startJitter() {
    jitterInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('res-jitter').innerText = val + " ms";
        } catch {}
    }, 400); // تحديث كل 400ms
}

function stopJitter() {
    if(jitterInt) clearInterval(jitterInt);
}

async function findBest() {
    const keys = Object.keys(NODES);
    const r = await Promise.all(keys.map(async k => {
        let t = performance.now();
        try { await fetch(NODES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal }); return {k, t: performance.now()-t}; }
        catch { return {k, t: 9999}; }
    }));
    return r.sort((a,b)=>a.t-b.t)[0].k;
}

// الدوال الزمنية (Timed Functions)
async function runTimedPing(duration) {
    const start = performance.now();
    let pings = [];
    while(performance.now() - start < duration) {
        if(ctrl.signal.aborted) break;
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            pings.push((performance.now() - t0) * 0.8);
        } catch {}
        updateTimer(((performance.now() - start)/duration)*100);
        await new Promise(r => setTimeout(r, 200));
    }
    pings.sort((a,b)=>a-b);
    return Math.round(pings[Math.floor(pings.length/2)] || 0);
}

async function runTimedDownload(duration) {
    let bytes = 0;
    const start = performance.now();
    
    const workers = Array(30).fill(0).map(async () => {
        while(performance.now() - start < duration) {
            if(ctrl.signal.aborted) break;
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=5000000", { signal: ctrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || ctrl.signal.aborted) break;
                    bytes += value.length;
                    
                    let elapsed = (performance.now() - start);
                    let s = (bytes * 8) / (1024 * 1024) / (elapsed/1000) * 1.05;
                    updateGauge(s, "dl");
                    updateTimer((elapsed/duration)*100);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    return (bytes * 8) / (1024 * 1024) / (duration/1000) * 1.05;
}

// *** إصلاح الرفع: Swarm Pulse ***
async function runTimedUpload(duration) {
    let maxSpeed = 0;
    const start = performance.now();
    // بيانات عشوائية 1MB
    const data = new Uint8Array(1024 * 1024);
    crypto.getRandomValues(data);

    const worker = () => {
        if(performance.now() - start >= duration || ctrl.signal.aborted) return;

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let dBytes = e.loaded - lastLoad;
                
                if (dt > 0.15) { 
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.2;
                    if(s > maxSpeed) maxSpeed = s;
                    updateGauge(s, "ul");
                    updateTimer(((now - start)/duration)*100);
                    
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        // منع الكاش
        xhr.open("POST", `https://speed.cloudflare.com/__up?ts=${Date.now() + Math.random()}`, true);
        xhr.onload = worker; 
        xhr.onerror = worker; 
        xhr.send(data);
    };

    // 8 قنوات (Stable Swarm)
    for(let i=0; i<8; i++) {
        worker();
        await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, duration));
    return maxSpeed.toFixed(1);
}
