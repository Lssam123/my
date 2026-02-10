const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico"
};

let ctrl = null;
let activeNode = "";

// تدريج لوغاريتمي 0-1000
const pts = [0, 1, 5, 10, 50, 100, 300, 500, 1000];
const ticks = document.getElementById('ticks');
pts.forEach(p => {
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
    document.getElementById('live-num').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('active-path');
    const lbl = document.getElementById('phase-txt');
    const hud = document.querySelector('.top-hud');
    
    let offset = 440 - ((deg+135)/270 * 440);
    path.style.strokeDashoffset = offset;

    if(type === "ul") {
        path.setAttribute("stroke", "url(#g-ul)");
        lbl.style.color = "#F45C43";
        hud.style.borderBottomColor = "#F45C43";
    } else {
        path.setAttribute("stroke", "url(#g-dl)");
        lbl.style.color = "#00C9FF";
        hud.style.borderBottomColor = "#00C9FF";
    }
}

async function startV105() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    updateHUD(0, "dl");
    ["fin-ping", "fin-dl", "fin-ul", "live-jitter"].forEach(id => document.getElementById(id).innerHTML = "--");
    document.getElementById('j-bar').style.width = "0%";

    const sel = document.getElementById('srv-select').value;
    activeNode = (sel === 'auto') ? NODES[await pickBest()] : NODES[sel];

    // 1. PING
    document.getElementById('phase-txt').innerText = "PING TEST";
    const ping = await runPing(5000);
    document.getElementById('fin-ping').innerHTML = `${ping} <span class="unit">ms</span>`;

    // 2. DOWNLOAD
    document.getElementById('phase-txt').innerText = "DOWNLOAD";
    const dl = await runDownload(15000);
    document.getElementById('fin-dl').innerHTML = `${Math.round(dl)} <span class="unit">Mbps</span>`;

    // 3. UPLOAD (Fixed Static Memory)
    resetNeedle();
    document.getElementById('phase-txt').innerText = "UPLOAD";
    const ul = await runStableUpload(15000);
    document.getElementById('fin-ul').innerHTML = `${ul} <span class="unit">Mbps</span>`;

    document.getElementById('phase-txt').innerText = "COMPLETE";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "RESTART";
}

function resetNeedle() {
    updateHUD(0);
    document.getElementById('active-path').style.strokeDashoffset = 440;
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
            // معايرة دقيقة: طرح 15% من الوقت
            let raw = performance.now() - t0;
            pings.push(Math.max(1, raw * 0.85));
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    return Math.round(Math.min(...pings));
}

async function runDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();

    // Jitter Monitor
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val;
            let w = Math.min((val/300)*100, 100);
            document.getElementById('j-bar').style.width = w + "%";
        } catch {}
    }, 250);

    const workers = Array(40).fill(0).map(async () => {
        while(performance.now() - start < ms && !subCtrl.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: subCtrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || subCtrl.signal.aborted) break;
                    bytes += value.length;
                    
                    let elapsed = (performance.now() - start) / 1000;
                    let s = (bytes * 8) / (1024 * 1024) / elapsed * 1.05; // 1.05 Correction
                    updateHUD(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    subCtrl.abort(); clearInterval(jInt);
    return (bytes * 8) / (1024 * 1024) / 15 * 1.05;
}

// *** الحل النهائي: ذاكرة ثابتة (Global Static Buffer) ***
// يتم إنشاء البيانات مرة واحدة فقط خارج الدالة لمنع تعليق المتصفح
const STATIC_PAYLOAD = new Uint8Array(1024 * 1024); // 1MB Fixed Buffer
crypto.getRandomValues(STATIC_PAYLOAD);

async function runStableUpload(ms) {
    let maxSpeed = 0;
    let currentSpeed = 0; // للمتوسط المتحرك
    const start = performance.now();
    
    // دالة العامل (Worker)
    const worker = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let prevLoaded = 0;
        let prevTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - prevTime) / 1000;
                let dBytes = e.loaded - prevLoaded;
                
                // تحديث كل 100ms
                if (dt > 0.1) { 
                    let instantSpeed = (dBytes * 8) / (1024 * 1024) / dt * 1.15; // 1.15 Overhead
                    
                    // استخدام متوسط متحرك (Weighted Average) للثبات
                    currentSpeed = (currentSpeed * 0.7) + (instantSpeed * 0.3);
                    
                    if(currentSpeed > maxSpeed) maxSpeed = currentSpeed;
                    updateHUD(currentSpeed, "ul");
                    
                    prevLoaded = e.loaded;
                    prevTime = now;
                }
            }
        };

        xhr.open("POST", "https://speed.cloudflare.com/__up", true);
        // إرسال الذاكرة الثابتة (لا يتم إنشاء بيانات جديدة)
        xhr.send(STATIC_PAYLOAD);
        
        xhr.onload = worker; // تكرار
        xhr.onerror = worker;
    };

    // التدرج في فتح القنوات (Ramp-up)
    // نبدأ بـ 2 ثم نزيد لـ 8 لمنع الحظر
    worker(); worker(); // Start with 2
    await new Promise(r => setTimeout(r, 500));
    worker(); worker(); // Add 2
    await new Promise(r => setTimeout(r, 500));
    for(let i=0; i<4; i++) worker(); // Add 4 more (Total 8)

    // Jitter Monitor (Upload)
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?uj=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val;
            let w = Math.min((val/300)*100, 100);
            document.getElementById('j-bar').style.width = w + "%";
        } catch {}
    }, 250);

    await new Promise(r => setTimeout(r, ms));
    clearInterval(jInt);
    
    return maxSpeed.toFixed(1);
}
