const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico"
};

let ctrl = null; // وحدة التحكم لإيقاف العمليات السابقة
let activeNodeUrl = "";

// دالة إعادة الفحص (Reset)
function resetSystem() {
    if(ctrl) ctrl.abort(); // إيقاف أي فحص جاري فوراً
    
    updateGauge(0, "dl");
    ["end-ping", "end-dl", "end-ul"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('status-msg').innerText = "READY";
    
    const btn = document.getElementById('start-btn');
    btn.disabled = false;
    btn.innerText = "START";
}

function updateGauge(val, type="dl") {
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('live-num').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-fill');
    const msg = document.getElementById('status-msg');
    
    path.style.strokeDashoffset = 660 - (p * 660);

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

async function startTest() {
    resetSystem(); // تنظيف قبل البدء
    ctrl = new AbortController(); // وحدة تحكم جديدة
    
    document.getElementById('start-btn').disabled = true;
    
    const sel = document.getElementById('srv-select').value;
    if (sel === 'auto') {
        document.getElementById('status-msg').innerText = "SELECTING...";
        const best = await pickBest();
        activeNodeUrl = NODES[best];
    } else {
        activeNodeUrl = NODES[sel];
    }

    // 1. PING
    document.getElementById('status-msg').innerText = "PING";
    const ping = await runPing(4000);
    document.getElementById('end-ping').innerText = ping + " ms";

    // 2. DOWNLOAD
    document.getElementById('status-msg').innerText = "DOWNLOAD";
    const dl = await runDownload(15000);
    document.getElementById('end-dl').innerText = Math.round(dl);

    // 3. UPLOAD (إصلاح: بيانات عشوائية ثنائية)
    updateGauge(0, "ul");
    document.getElementById('status-msg').innerText = "UPLOAD";
    const ul = await runBinaryUpload(15000);
    document.getElementById('end-ul').innerText = ul;

    document.getElementById('status-msg').innerText = "DONE";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "TEST AGAIN";
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
    
    // استخدام Fetch Stream
    const workers = Array(30).fill(0).map(async () => {
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

// *** الحل المؤكد للرفع: Binary Random Blob ***
// استخدام بيانات عشوائية ثنائية يمنع التوقف
async function runBinaryUpload(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    
    // 1MB Random Noise
    const data = new Uint8Array(1024 * 1024);
    crypto.getRandomValues(data); // تعبئة عشوائية

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
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.2;
                    if(s > maxSpeed) maxSpeed = s;
                    updateGauge(s, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        xhr.open("POST", `https://speed.cloudflare.com/__up?ts=${Date.now()}`, true);
        xhr.onload = worker; 
        xhr.onerror = worker; 
        xhr.send(data);
    };

    // 8 قنوات (عدد مثالي للاستقرار)
    for(let i=0; i<8; i++) {
        worker();
        await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, ms));
    return maxSpeed.toFixed(1);
}
