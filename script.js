const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico"
};

let ctrl = null;
let activeNode = "";

// تدريج العداد
const pts = [0, 1, 5, 10, 50, 100, 300, 500, 1000];
const ticks = document.getElementById('ticks');
pts.forEach(p => {
    let d = getDeg(p);
    ticks.innerHTML += `<span style="--d: ${d}deg">${p}</span>`;
});

function getDeg(v) {
    let p = 0;
    if(v<=10) p=(v/10)*0.1;
    else if(v<=100) p=0.1+((v-10)/90)*0.3;
    else if(v<=1000) p=0.4+((v-100)/900)*0.6;
    else p=1;
    return (p*360); // دائرة كاملة
}

function updateHUD(val, type="dl") {
    const ring = document.getElementById('track-fill');
    const lbl = document.getElementById('phase-lbl');
    const dot = document.getElementById('status-dot');
    
    document.getElementById('live-val').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    // محيط الدائرة 628
    let p = val <= 100 ? (val/100)*0.4 : 0.4 + ((val-100)/900)*0.6;
    if(p > 1) p = 1;
    let offset = 628 - (p * 628);
    
    ring.style.strokeDashoffset = offset;

    if(type === "ul") {
        ring.style.stroke = "url(#grad-ul)";
        lbl.style.color = "var(--red)";
        dot.style.backgroundColor = "var(--red)";
    } else {
        ring.style.stroke = "url(#grad-dl)";
        lbl.style.color = "var(--blue)";
        dot.style.backgroundColor = "var(--blue)";
    }
    
    // Pulse effect
    dot.style.boxShadow = `0 0 15px ${type === "ul" ? "var(--red)" : "var(--blue)"}`;
}

async function startSmartTest() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    updateHUD(0, "dl");
    ["res-ping", "res-dl", "res-ul", "res-jitter"].forEach(id => document.getElementById(id).innerText = "--");

    const sel = document.getElementById('server-select').value;
    activeNode = (sel === 'auto') ? NODES[await pickBest()] : NODES[sel];

    // 1. PING (Median)
    document.getElementById('phase-lbl').innerText = "PING";
    const ping = await runPing(4000);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 2. DOWNLOAD (Stable Streams)
    document.getElementById('phase-lbl').innerText = "DOWNLOAD";
    const dl = await runStableDownload(15000);
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 3. UPLOAD (Smart Scaling)
    updateHUD(0, "ul");
    document.getElementById('phase-lbl').innerText = "UPLOAD";
    const ul = await runSmartUpload(15000);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-lbl').innerText = "DONE";
    document.getElementById('status-dot').style.backgroundColor = "#00ff00";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "RESTART";
}

async function pickBest() {
    const k = Object.keys(NODES);
    const r = await Promise.all(k.map(async x => {
        let t = performance.now();
        try { await fetch(NODES[x] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k: x, p: performance.now() - t }; } catch { return { k: x, p: 999 }; }
    }));
    return r.sort((a,b) => a.p - b.p)[0].k;
}

async function runPing(ms) {
    let list = [];
    const start = performance.now();
    while(performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            list.push((performance.now() - t0) * 0.8);
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    list.sort((a,b)=>a-b);
    return Math.round(list[Math.floor(list.length/2)] || 0);
}

// تحميل مستقر (30 مسار كحد أقصى)
async function runStableDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();

    // Jitter Monitor (Concurrent)
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            document.getElementById('res-jitter').innerText = Math.round(performance.now() - t0) + " ms";
        } catch {}
    }, 400);

    const workers = Array(30).fill(0).map(async () => {
        while(performance.now() - start < ms && !subCtrl.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=5000000", { signal: subCtrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || subCtrl.signal.aborted) break;
                    bytes += value.length;
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    updateHUD(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    subCtrl.abort(); clearInterval(jInt);
    return (bytes * 8) / (1024 * 1024) / 15 * 1.05;
}

// *** الرفع الذكي (Smart Auto-Scaling) ***
// يبدأ بـ 4 قنوات، ثم يزيد إذا كان الاتصال مستقراً
async function runSmartUpload(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    // 1MB Chunk (Best for XHR)
    const data = new Uint8Array(1024 * 1024); 
    crypto.getRandomValues(data);

    const worker = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let dBytes = e.loaded - lastLoad;
                
                if (dt > 0.2) { 
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.25;
                    if(s > maxSpeed) maxSpeed = s;
                    updateHUD(s, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        // Cache Buster
        xhr.open("POST", `https://speed.cloudflare.com/__up?ts=${Date.now() + Math.random()}`, true);
        xhr.onload = worker; 
        xhr.onerror = worker; 
        xhr.send(data);
    };

    // البدء المتدرج (لتفادي الحظر)
    // 4 قنوات أساسية
    for(let i=0; i<4; i++) {
        worker();
        await new Promise(r => setTimeout(r, 100));
    }
    
    // بعد ثانية، إضافة 2 إضافية إذا لزم الأمر
    await new Promise(r => setTimeout(r, 1000));
    worker(); worker();

    await new Promise(r => setTimeout(r, ms - 1000));
    return maxSpeed.toFixed(1);
}
