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

// إعداد التدريج اللوغاريتمي (0-1000)
const points = [0, 1, 5, 10, 50, 100, 300, 500, 1000];
const ticks = document.getElementById('gauge-ticks');
points.forEach(p => {
    let d = mapSpeed(p);
    ticks.innerHTML += `<span style="--deg: ${d}deg">${p}</span>`;
});

function mapSpeed(s) {
    let p = 0;
    if(s <= 10) p = (s/10) * 0.2;
    else if(s <= 100) p = 0.2 + ((s-10)/90) * 0.3;
    else if(s <= 1000) p = 0.5 + ((s-100)/900) * 0.5;
    else p = 1;
    return (p * 270) - 135;
}

function updateGauge(val, type="dl") {
    const deg = mapSpeed(val);
    document.getElementById('needle').style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('live-speed').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    // المسار الملون
    const path = document.getElementById('track-active');
    let percent = (deg + 135) / 270;
    let offset = 440 - (percent * 440);
    path.style.strokeDashoffset = offset;

    const lbl = document.getElementById('status-phase');
    const bar = document.querySelector('.top-history');

    if(type === "ul") {
        path.setAttribute("stroke", "url(#grad-ul)");
        lbl.style.color = "#f5576c";
        bar.style.borderBottomColor = "#f5576c";
    } else {
        path.setAttribute("stroke", "url(#grad-dl)");
        lbl.style.color = "#00f2fe";
        bar.style.borderBottomColor = "#00f2fe";
    }
}

async function startEngineV90() {
    // 1. إعادة تعيين كاملة (Reset Logic)
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('action-btn').disabled = true;
    updateGauge(0, "dl");
    ["final-ping", "final-dl", "final-ul", "live-jitter-val"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('jitter-bar').style.width = "0%";

    // 2. اختيار السيرفر
    const sel = document.getElementById('server-select').value;
    activeNode = (sel === 'auto') ? NODES[await findFastest()] : NODES[sel];

    // 3. البنق (Clean Ping)
    document.getElementById('status-phase').innerText = "PING";
    const ping = await runCleanPing(4000);
    document.getElementById('final-ping').innerText = ping + " ms";

    // 4. التحميل (Download + Live Jitter)
    document.getElementById('status-phase').innerText = "DOWNLOAD";
    const dl = await runDownloadStream(15000);
    document.getElementById('final-dl').innerText = Math.round(dl) + " Mbps";

    // 5. الرفع (Upload - Fixed Logic)
    resetNeedle();
    document.getElementById('status-phase').innerText = "UPLOAD";
    const ul = await runUploadStream(15000);
    document.getElementById('final-ul').innerText = ul + " Mbps";

    document.getElementById('status-phase').innerText = "FINISHED";
    document.getElementById('action-btn').disabled = false;
    document.getElementById('action-btn').innerText = "إعادة الفحص";
}

function resetNeedle() {
    updateGauge(0);
    document.getElementById('track-active').style.strokeDashoffset = 440;
}

async function findFastest() {
    const keys = Object.keys(NODES);
    const res = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try { await fetch(NODES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t0 }; } catch { return { k, p: 999 }; }
    }));
    return res.sort((a,b) => a.p - b.p)[0].k;
}

async function runCleanPing(ms) {
    let list = [];
    const start = performance.now();
    while(performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            // طرح 25% من الزمن كـ Overhead للمتصفح
            list.push((performance.now() - t0) * 0.75);
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    return Math.round(Math.min(...list));
}

async function runDownloadStream(ms) {
    let bytes = 0;
    const start = performance.now();
    const dlAbort = new AbortController();

    // البنق المثقل الحي (Live Jitter Effect)
    const jitterInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            // قيمة حية لحظية
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter-val').innerText = val;
            let width = Math.min((val / 400) * 100, 100);
            document.getElementById('jitter-bar').style.width = width + "%";
        } catch {}
    }, 200);

    const workers = Array(50).fill(0).map(async () => {
        while(performance.now() - start < ms && !dlAbort.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: dlAbort.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || dlAbort.signal.aborted) break;
                    bytes += value.length;
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    updateGauge(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    dlAbort.abort(); clearInterval(jitterInt);
    return (bytes * 8) / (1024 * 1024) / 15 * 1.05;
}

// محرك الرفع المستقر (XHR + Progress Event)
async function runUploadStream(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    // 2MB Chunk لضمان العمل على جميع الشبكات
    const data = new Uint8Array(2 * 1024 * 1024); 
    crypto.getRandomValues(data);

    // دالة الحلقة المغلقة
    const loop = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let lastLoaded = 0;
        let lastTime = performance.now();

        // هذا الحدث هو السر: يعطي قراءات لحظية قبل اكتمال الرفع
        xhr.upload.onprogress = (e) => {
            if(e.lengthComputable) {
                let now = performance.now();
                let diffTime = (now - lastTime) / 1000;
                let diffBytes = e.loaded - lastLoaded;
                
                // تحديث كل 200 ملي ثانية لتجنب قفزات العداد
                if(diffTime > 0.2) {
                    let s = (diffBytes * 8) / (1024 * 1024) / diffTime * 1.25;
                    if(s > maxSpeed) maxSpeed = s;
                    updateGauge(s, "ul");
                    lastLoaded = e.loaded;
                    lastTime = now;
                }
            }
        };

        xhr.open("POST", "https://speed.cloudflare.com/__up", true);
        xhr.onload = loop; // إعادة الكرة
        xhr.onerror = loop;
        xhr.send(data);
    };

    // تشغيل 20 قناة متزامنة (Shotgun Approach)
    for(let i=0; i<20; i++) {
        loop();
        // تأخير بسيط بين كل قناة لمنع خنق المتصفح في البداية
        await new Promise(r => setTimeout(r, 50));
    }
    
    // البنق المثقل يستمر
    const jitterInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?uj=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter-val').innerText = val;
            let width = Math.min((val / 400) * 100, 100);
            document.getElementById('jitter-bar').style.width = width + "%";
        } catch {}
    }, 200);

    await new Promise(r => setTimeout(r, ms));
    clearInterval(jitterInt);
    
    return maxSpeed.toFixed(1);
}
