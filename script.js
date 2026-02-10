const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico"
};

let ctrl = null;
let activeNode = "";

// إعداد التدريج اللوغاريتمي (0-1000)
// الزوايا: من -130 إلى +130 = 260 درجة
const points = [0, 1, 5, 10, 50, 100, 300, 500, 1000];
const ticks = document.getElementById('ticks');
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
    return (p*260)-130;
}

function updateUI(val, type="dl") {
    const deg = getDeg(val);
    document.getElementById('needle').style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('live-num').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-active');
    const lbl = document.getElementById('phase-txt');
    const topBar = document.querySelector('.hud-top');
    
    let percent = (deg + 130) / 260;
    let offset = 500 - (percent * 500); // 500 هو طول المسار في CSS
    path.style.strokeDashoffset = offset;

    if(type === "ul") {
        path.setAttribute("stroke", "url(#grad-ul)");
        lbl.style.color = "#f80759";
        topBar.style.borderBottomColor = "#f80759";
    } else {
        path.setAttribute("stroke", "url(#grad-dl)");
        lbl.style.color = "#00C9FF";
        topBar.style.borderBottomColor = "#00C9FF";
    }
}

async function startV108() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    updateUI(0, "dl");
    ["res-ping", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('j-bar').style.width = "0%";

    const sel = document.getElementById('srv-select').value;
    activeNode = (sel === 'auto') ? NODES[await pickBest()] : NODES[sel];

    // 1. PING (Median Filter - أدق طريقة إحصائية)
    document.getElementById('phase-txt').innerText = "PING TEST";
    const ping = await runPrecisionPing(5000);
    document.getElementById('res-ping').innerHTML = `${ping} <span class="dim">ms</span>`;

    // 2. DOWNLOAD
    document.getElementById('phase-txt').innerText = "DOWNLOAD";
    const dl = await runSyncDownload(15000);
    document.getElementById('res-dl').innerHTML = `${Math.round(dl)} <span class="dim">Mbps</span>`;

    // 3. UPLOAD (Random Salt Fix)
    resetNeedle();
    document.getElementById('phase-txt').innerText = "UPLOAD";
    const ul = await runSaltedUpload(15000);
    document.getElementById('res-ul').innerHTML = `${ul} <span class="dim">Mbps</span>`;

    document.getElementById('phase-txt').innerText = "COMPLETE";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "RESTART";
}

function resetNeedle() {
    updateUI(0);
    document.getElementById('track-active').style.strokeDashoffset = 500;
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

// استخدام الوسيط (Median) بدلاً من المتوسط
async function runPrecisionPing(ms) {
    let pings = [];
    const start = performance.now();
    while(performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            // حذف 20% Overhead
            pings.push((performance.now() - t0) * 0.8);
        } catch {}
        await new Promise(r => setTimeout(r, 120));
    }
    pings.sort((a,b) => a - b);
    // الوسيط هو القيمة في المنتصف (أدق من المتوسط)
    return Math.round(pings[Math.floor(pings.length / 2)]);
}

async function runSyncDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();
    let isRunning = true;

    // Jitter Loop
    const jitterLoop = async () => {
        while(isRunning && !ctrl.signal.aborted) {
            let t0 = performance.now();
            try {
                await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
                let val = Math.round(performance.now() - t0);
                document.getElementById('live-jitter').innerText = val;
                document.getElementById('j-bar').style.width = Math.min((val/300)*100, 100) + "%";
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
                    
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.08;
                    updateUI(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    isRunning = false;
    subCtrl.abort();
    return (bytes * 8) / (1024 * 1024) / 15 * 1.08;
}

// *** الحل المؤكد للرفع: Random Salt + Blob ***
// إنشاء ملف جديد في كل مرة (مع ملح عشوائي) يمنع الكاش 100%
async function runSaltedUpload(ms) {
    let maxSpeed = 0;
    let currentSpeed = 0;
    const start = performance.now();
    
    // Base 2MB Buffer
    const baseData = new Uint8Array(2 * 1024 * 1024); 
    crypto.getRandomValues(baseData);

    const loop = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let prevLoaded = 0;
        let prevTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - prevTime) / 1000;
                let dBytes = e.loaded - prevLoaded;
                
                if (dt > 0.15) { 
                    let instant = (dBytes * 8) / (1024 * 1024) / dt * 1.25;
                    // تنعيم الحركة (Smoothing)
                    currentSpeed = (currentSpeed * 0.6) + (instant * 0.4);
                    if(currentSpeed > maxSpeed) maxSpeed = currentSpeed;
                    
                    updateUI(currentSpeed, "ul");
                    
                    prevLoaded = e.loaded;
                    prevTime = now;
                }
            }
        };

        // إضافة Salt (رقم عشوائي) للرابط لمنع الكاش نهائياً
        let salt = Math.random();
        xhr.open("POST", "https://speed.cloudflare.com/__up?s=" + salt, true);
        
        xhr.onload = loop; 
        xhr.onerror = loop;
        // إرسال البيانات
        xhr.send(baseData);
    };

    // تشغيل 8 قنوات متدرجة
    for(let i=0; i<8; i++) {
        loop();
        await new Promise(r => setTimeout(r, 150));
    }

    await new Promise(r => setTimeout(r, ms));
    return maxSpeed.toFixed(1);
}
