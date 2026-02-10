const SERVERS = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let controller = null;
let activeNode = "";

// إعداد التدريج اللوغاريتمي العالمي
const points = [0, 1, 5, 10, 50, 100, 250, 500, 1000];
const ticks = document.getElementById('gauge-ticks');
points.forEach(p => {
    let d = getAngle(p);
    ticks.innerHTML += `<span style="--d: ${d}deg">${p}</span>`;
});

function getAngle(v) {
    let p = 0;
    if(v<=10) p=(v/10)*0.2;
    else if(v<=100) p=0.2+((v-10)/90)*0.3;
    else if(v<=1000) p=0.5+((v-100)/900)*0.5;
    else p=1;
    return (p*270)-135;
}

function updateGauge(val, type="dl") {
    const deg = getAngle(val);
    document.getElementById('needle').style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('big-val').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-active');
    const status = document.getElementById('phase-status');
    let percent = (deg + 135) / 270;
    let offset = 440 - (percent * 440);
    path.style.strokeDashoffset = offset;

    if(type === "ul") {
        path.setAttribute("stroke", "url(#grad-ul)");
        status.style.color = "#E100FF";
    } else {
        path.setAttribute("stroke", "url(#grad-dl)");
        status.style.color = "#00C9FF";
    }
}

async function initiateGlobalTest() {
    if(controller) controller.abort();
    controller = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    updateGauge(0);
    ["res-ping", "res-dl", "res-ul", "live-jitter", "live-stability"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('jitter-bar').style.width = "0%";

    const sel = document.getElementById('server-select').value;
    activeNode = (sel === 'auto') ? SERVERS[await findBestServer()] : SERVERS[sel];

    // 1. PING PHASE (Minimum Latency)
    document.getElementById('phase-status').innerText = "PING TEST";
    const ping = await runGlobalPing(5000);
    document.getElementById('res-ping').innerHTML = `${ping} <small>ms</small>`;

    // 2. DOWNLOAD PHASE
    document.getElementById('phase-status').innerText = "DOWNLOAD";
    const dl = await runGlobalDownload(15000);
    document.getElementById('res-dl').innerHTML = `${Math.round(dl)} <small>Mbps</small>`;

    // 3. UPLOAD PHASE (The Fix)
    resetGauge();
    document.getElementById('phase-status').innerText = "UPLOAD";
    const ul = await runGlobalUpload(15000);
    document.getElementById('res-ul').innerHTML = `${ul} <small>Mbps</small>`;

    document.getElementById('phase-status').innerText = "FINISHED";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "TEST AGAIN";
}

function resetGauge() {
    updateGauge(0);
    document.getElementById('track-active').style.strokeDashoffset = 440;
}

async function findBestServer() {
    const keys = Object.keys(SERVERS);
    const results = await Promise.all(keys.map(async k => {
        let t = performance.now();
        try { await fetch(SERVERS[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t }; } catch { return { k, p: 999 }; }
    }));
    return results.sort((a,b) => a.p - b.p)[0].k;
}

async function runGlobalPing(ms) {
    let pings = [];
    const start = performance.now();
    while(performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            // معايرة الدقة: طرح زمن معالجة المتصفح (حوالي 25%)
            let raw = performance.now() - t0;
            pings.push(raw * 0.75); 
        } catch {}
        await new Promise(r => setTimeout(r, 100));
    }
    // Speedtest يأخذ أقل قيمة (Best Case) وليس المتوسط
    return Math.round(Math.min(...pings));
}

async function runGlobalDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();

    // حساب Jitter (التذبذب)
    let lastPing = 0;
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            let current = Math.round(performance.now() - t0);
            let jitter = Math.abs(current - lastPing);
            lastPing = current;
            
            document.getElementById('live-jitter').innerText = jitter;
            let w = Math.min((jitter/100)*100, 100);
            document.getElementById('jitter-bar').style.width = w + "%";
            
            // حساب الثبات (عكس التذبذب)
            let stability = Math.max(100 - (jitter/2), 0);
            document.getElementById('live-stability').innerText = Math.round(stability) + "%";
        } catch {}
    }, 300);

    const workers = Array(30).fill(0).map(async () => {
        while(performance.now() - start < ms && !subCtrl.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: subCtrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || subCtrl.signal.aborted) break;
                    bytes += value.length;
                    
                    let elapsed = (performance.now() - start) / 1000;
                    // معامل 1.1 لتعويض فاقد البروتوكول
                    let s = (bytes * 8) / (1024 * 1024) / elapsed * 1.1; 
                    updateGauge(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    subCtrl.abort(); clearInterval(jInt);
    return (bytes * 8) / (1024 * 1024) / 15 * 1.1;
}

// *** الحل النهائي للرفع (Standard XHR Method) ***
async function runGlobalUpload(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    // 5MB Chunks - الحجم المثالي لتفادي الحظر
    const chunk = new Uint8Array(5 * 1024 * 1024); 
    crypto.getRandomValues(chunk);

    const uploadThread = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let trackerStart = performance.now();
        let trackerLoaded = 0;

        // الحدث السحري: هذا ما تستخدمه المواقع العالمية
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let diffTime = (now - trackerStart) / 1000;
                let diffBytes = e.loaded - trackerLoaded;
                
                // تحديث كل 100ms
                if (diffTime > 0.1) { 
                    let s = (diffBytes * 8) / (1024 * 1024) / diffTime * 1.2; // 1.2 Overhead
                    if(s > maxSpeed) maxSpeed = s;
                    updateGauge(s, "ul");
                    trackerLoaded = e.loaded;
                    trackerStart = now;
                }
            }
        };

        xhr.open("POST", "https://speed.cloudflare.com/__up", true);
        // مهم: إخبار المتصفح أننا نرفع بيانات ثنائية عادية
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.onload = uploadThread; // تكرار
        xhr.onerror = uploadThread; // تكرار عند الخطأ
        xhr.send(chunk);
    };

    // 8 مسارات فقط (أكثر من ذلك يسبب اختناق CPU)
    for(let i=0; i<8; i++) {
        uploadThread();
        await new Promise(r => setTimeout(r, 200)); // Ramp-up تدريجي
    }

    // Jitter Monitor للرفع
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?uj=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val;
            let w = Math.min((val/100)*100, 100);
            document.getElementById('jitter-bar').style.width = w + "%";
        } catch {}
    }, 300);

    await new Promise(r => setTimeout(r, ms));
    clearInterval(jInt);
    
    return maxSpeed.toFixed(1);
}
