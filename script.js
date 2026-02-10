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
const points = [0, 1, 10, 50, 100, 300, 500, 1000];
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
    document.getElementById('big-speed').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-main');
    const status = document.getElementById('status-text');
    let percent = (deg + 135) / 270;
    let offset = 440 - (percent * 440);
    path.style.strokeDashoffset = offset;

    if(type === "ul") {
        path.setAttribute("stroke", "url(#grad-magenta)");
        status.style.color = "#fd1d1d";
    } else {
        path.setAttribute("stroke", "url(#grad-cyan)");
        status.style.color = "#00F260";
    }
}

async function startHoloTest() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    updateHUD(0, "dl");
    ["val-ping", "val-jitter", "final-dl", "final-ul"].forEach(id => document.getElementById(id).innerHTML = "--");

    const sel = document.getElementById('server-select').value;
    activeNode = (sel === 'auto') ? NODES[await pickBest()] : NODES[sel];

    // 1. PING (Idle)
    document.getElementById('status-text').innerText = "PING CHECK";
    const ping = await runPing(4000);
    document.getElementById('val-ping').innerHTML = `${ping} <small>ms</small>`;

    // 2. DOWNLOAD + LOADED PING (متزامن)
    document.getElementById('status-text').innerText = "DOWNLOAD";
    const dl = await runSyncDownload(15000);
    document.getElementById('final-dl').innerText = Math.round(dl);

    // 3. UPLOAD (Fixed Cascading)
    resetNeedle();
    document.getElementById('status-text').innerText = "UPLOAD";
    const ul = await runCascadingUpload(15000);
    document.getElementById('final-ul').innerText = ul;

    document.getElementById('status-text').innerText = "COMPLETE";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "RESTART";
}

function resetNeedle() {
    updateHUD(0);
    document.getElementById('track-main').style.strokeDashoffset = 440;
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
            list.push((performance.now() - t0) * 0.7);
        } catch {}
        await new Promise(r => setTimeout(r, 120));
    }
    return Math.round(Math.min(...list));
}

// دمج التحميل مع البنق المثقل (Sync Logic)
async function runSyncDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();
    let lastJitterCheck = 0;

    const workers = Array(40).fill(0).map(async () => {
        while(performance.now() - start < ms && !subCtrl.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: subCtrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || subCtrl.signal.aborted) break;
                    bytes += value.length;
                    
                    let now = performance.now();
                    // تحديث العداد
                    let s = (bytes * 8) / (1024 * 1024) / ((now - start)/1000) * 1.1;
                    updateHUD(s, "dl");

                    // فحص البنق المثقل "داخل" حلقة التحميل (Synchronous check)
                    // نتحقق كل 500ms فقط لتوفير الموارد
                    if (now - lastJitterCheck > 500) {
                        checkLoadedPing();
                        lastJitterCheck = now;
                    }
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    subCtrl.abort();
    return (bytes * 8) / (1024 * 1024) / 15 * 1.1;
}

// دالة فرعية للبنق المثقل
async function checkLoadedPing() {
    let t0 = performance.now();
    try {
        await fetch(activeNode + "?lj=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
        let val = Math.round(performance.now() - t0);
        // عرض الرقم فقط (بدون خط)
        document.getElementById('val-jitter').innerHTML = `${val} <small>ms</small>`;
    } catch {}
}

// الرفع بنظام الشلال (Cascading) لضمان العمل
async function runCascadingUpload(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    // حزمة 1MB سريعة التجهيز
    const chunk = new Uint8Array(1024 * 1024); 
    crypto.getRandomValues(chunk);

    const loop = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let prevTime = performance.now();
        let prevLoad = 0;

        xhr.upload.onprogress = (e) => {
            if(e.lengthComputable) {
                let now = performance.now();
                let dt = (now - prevTime) / 1000;
                let dBytes = e.loaded - prevLoad;
                
                if(dt > 0.15) {
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.2;
                    if(s > maxSpeed) maxSpeed = s;
                    updateHUD(s, "ul");
                    prevLoad = e.loaded;
                    prevTime = now;
                }
            }
        };

        xhr.open("POST", "https://speed.cloudflare.com/__up", true);
        xhr.onload = loop; 
        xhr.onerror = loop;
        xhr.send(chunk);
    };

    // البدء بقناة واحدة، ثم زيادتها تدريجياً (Slow Start Fix)
    // هذا يمنع اختناق المتصفح في البداية
    loop(); // 1
    await new Promise(r => setTimeout(r, 200));
    loop(); // 2
    await new Promise(r => setTimeout(r, 200));
    loop(); // 3
    loop(); // 4

    await new Promise(r => setTimeout(r, ms));
    return maxSpeed.toFixed(1);
}
