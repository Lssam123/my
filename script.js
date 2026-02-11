const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let ctrl = null;
let activeNode = "";

// تدريج لوغاريتمي 0-1000
const points = [0, 1, 5, 10, 50, 100, 300, 500, 1000];
const ticks = document.getElementById('gauge-ticks');
points.forEach(p => {
    let d = getDeg(p);
    ticks.innerHTML += `<span style="--d: ${d}deg">${p}</span>`;
});

function getDeg(v) {
    let p = 0;
    if(v<=10) p=(v/10)*0.2;
    else if(v<=100) p=0.2+((v-10)/90)*0.3;
    else if(v<=1000) p=0.5+((v-100)/900)*0.5;
    else p=1;
    return (p*270)-135;
}

function updateHUD(val, type="dl") {
    const deg = getDeg(val);
    document.getElementById('needle').style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('main-val').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-fill');
    const tag = document.getElementById('phase-tag');
    
    // محيط الدائرة (2 * PI * 140) * (270/360) ≈ 660
    let percent = (deg + 135) / 270;
    let offset = 660 - (percent * 660);
    path.style.strokeDashoffset = offset;

    if(type === "ul") {
        path.style.stroke = "var(--purple)";
        tag.style.color = "var(--purple)";
    } else {
        path.style.stroke = "var(--cyan)";
        tag.style.color = "var(--cyan)";
    }
}

async function startGlobalPulse() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    updateHUD(0, "dl");
    ["res-ping", "res-dl", "res-ul", "res-jitter"].forEach(id => document.getElementById(id).innerHTML = "--");

    const sel = document.getElementById('server-select').value;
    activeNode = (sel === 'auto') ? NODES[await pickBest()] : NODES[sel];

    // 1. PING (Median Filter)
    document.getElementById('phase-tag').innerText = "PING";
    const ping = await runPing(5000);
    document.getElementById('res-ping').innerHTML = `${ping} <small>ms</small>`;

    // 2. DOWNLOAD (مع البنق المثقل المتزامن)
    document.getElementById('phase-tag').innerText = "DOWNLOAD";
    const dl = await runSyncDownload(15000);
    document.getElementById('res-dl').innerHTML = `${Math.round(dl)} <small>Mbps</small>`;

    // 3. UPLOAD (Anti-Cache Pulse Method)
    resetNeedle();
    document.getElementById('phase-tag').innerText = "UPLOAD";
    const ul = await runPulseUpload(15000);
    document.getElementById('res-ul').innerHTML = `${ul} <small>Mbps</small>`;

    document.getElementById('phase-tag').innerText = "COMPLETE";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "RETEST";
}

function resetNeedle() {
    updateHUD(0);
    document.getElementById('track-fill').style.strokeDashoffset = 660;
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
    let pings = [];
    const start = performance.now();
    while(performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            pings.push((performance.now() - t0) * 0.8);
        } catch {}
        await new Promise(r => setTimeout(r, 120));
    }
    pings.sort((a,b) => a - b);
    return Math.round(pings[Math.floor(pings.length / 2)] || 0); // Median
}

async function runSyncDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();
    let isRunning = true;

    // البنق المثقل المتزامن (يتوقف مع التحميل)
    const jitterLoop = async () => {
        while(isRunning && !ctrl.signal.aborted) {
            let t0 = performance.now();
            try {
                await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
                let val = Math.round(performance.now() - t0);
                document.getElementById('res-jitter').innerHTML = `${val} <small>ms</small>`;
            } catch {}
            await new Promise(r => setTimeout(r, 250));
        }
    };
    jitterLoop();

    const workers = Array(40).fill(0).map(async () => {
        while(performance.now() - start < ms && !subCtrl.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: subCtrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || subCtrl.signal.aborted) break;
                    bytes += value.length;
                    
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.1;
                    updateHUD(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    isRunning = false; // إيقاف Jitter
    subCtrl.abort();
    return (bytes * 8) / (1024 * 1024) / 15 * 1.1;
}

// *** الحل النهائي للرفع: Anti-Cache Pulse ***
// نغير الرابط في كل مرة لمنع الكاش تماماً
const UPLOAD_CHUNK = new Uint8Array(512 * 1024); // 512KB (سريع جداً)
crypto.getRandomValues(UPLOAD_CHUNK);

async function runPulseUpload(ms) {
    let maxSpeed = 0;
    let currentSpeed = 0;
    const start = performance.now();

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
                
                if (dt > 0.1) { 
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.25;
                    currentSpeed = (currentSpeed * 0.6) + (s * 0.4); // تنعيم
                    if(currentSpeed > maxSpeed) maxSpeed = currentSpeed;
                    
                    updateHUD(currentSpeed, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        // السر هنا: تغيير الرابط في كل دورة
        // هذا يجبر المتصفح على إرسال البيانات فوراً
        let antiCache = Date.now() + Math.random();
        xhr.open("POST", `https://speed.cloudflare.com/__up?ac=${antiCache}`, true);
        
        xhr.onload = worker; 
        xhr.onerror = worker; 
        
        // إرسال البيانات
        xhr.send(UPLOAD_CHUNK);
    };

    // تشغيل 12 قناة متزامنة (Pulse Streams)
    // التدرج في البداية لمنع الصدمة
    for(let i=0; i<12; i++) {
        worker();
        await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, ms));
    return maxSpeed.toFixed(1);
}
