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

// إعداد التدريج اللوغاريتمي الدقيق
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
    document.getElementById('needle-arm').style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('live-speed').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    // شريط التقدم
    const path = document.getElementById('track-progress');
    let percent = (deg + 135) / 270;
    let offset = 440 - (percent * 440);
    path.style.strokeDashoffset = offset;

    // ألوان الحالة
    const lbl = document.getElementById('phase-txt');
    const bar = document.querySelector('.telemetry-bar');

    if(type === "ul") {
        path.setAttribute("stroke", "url(#grad-ul)");
        lbl.style.color = "#F45C43";
        bar.style.borderBottomColor = "#F45C43";
    } else {
        path.setAttribute("stroke", "url(#grad-dl)");
        lbl.style.color = "#00C9FF";
        bar.style.borderBottomColor = "#00C9FF";
    }
}

async function startV100() {
    // إعادة تعيين قوية
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('ignite-btn').disabled = true;
    updateHUD(0, "dl");
    ["final-ping", "final-dl", "final-ul", "live-jitter", "live-peak"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('jitter-bar').style.width = "0%";

    const sel = document.getElementById('srv-select').value;
    activeNode = (sel === 'auto') ? NODES[await pickBest()] : NODES[sel];

    // 1. البنق (Native-like)
    document.getElementById('phase-txt').innerText = "PING";
    const ping = await runPing(5000);
    document.getElementById('final-ping').innerHTML = `${ping} <small>ms</small>`;

    // 2. التحميل (Download)
    document.getElementById('phase-txt').innerText = "DOWNLOAD";
    const dl = await runDownload(15000);
    document.getElementById('final-dl').innerHTML = `${Math.round(dl)} <small>Mbps</small>`;

    // 3. الرفع (Upload - XHR Progress Method)
    resetNeedle();
    document.getElementById('phase-txt').innerText = "UPLOAD";
    const ul = await runUploadXHR(15000);
    document.getElementById('final-ul').innerHTML = `${ul} <small>Mbps</small>`;

    document.getElementById('phase-txt').innerText = "COMPLETED";
    document.getElementById('ignite-btn').disabled = false;
    document.getElementById('ignite-btn').innerText = "RESTART SYSTEM";
}

function resetNeedle() {
    updateHUD(0);
    document.getElementById('track-progress').style.strokeDashoffset = 440;
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
            // استبعاد وقت معالجة المتصفح (حوالي 4-10ms)
            let raw = performance.now() - t0;
            let net = Math.max(1, raw - 5); 
            pings.push(net);
        } catch {}
        await new Promise(r => setTimeout(r, 120));
    }
    // أقل قيمة هي الأصدق
    return Math.round(Math.min(...pings));
}

async function runDownload(ms) {
    let bytes = 0;
    let maxP = 0;
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
            document.getElementById('jitter-bar').style.width = w + "%";
        } catch {}
    }, 250);

    // 40 Threads
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
                    let s = (bytes * 8) / (1024 * 1024) / elapsed * 1.1; // 1.1 correction
                    if(s > maxP) { maxP = s; document.getElementById('live-peak').innerText = Math.round(maxP); }
                    updateHUD(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    subCtrl.abort(); clearInterval(jInt);
    return (bytes * 8) / (1024 * 1024) / 15 * 1.1;
}

// *** الحل النهائي للرفع (XMLHttpRequest Progress) ***
async function runUploadXHR(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    // 2MB Chunk Size (Sweet spot)
    const data = new Uint8Array(2 * 1024 * 1024); 
    crypto.getRandomValues(data);

    const loop = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let prevLoaded = 0;
        let prevTime = performance.now();

        // هذا الحدث يعمل في الخلفية أثناء الرفع
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - prevTime) / 1000;
                let dBytes = e.loaded - prevLoaded;

                if (dt > 0.15) { // تحديث كل 150ms
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.3; // 1.3 Overhead correction
                    if(s > maxSpeed) { 
                        maxSpeed = s; 
                        document.getElementById('live-peak').innerText = maxSpeed.toFixed(1);
                    }
                    updateHUD(s, "ul");
                    prevLoaded = e.loaded;
                    prevTime = now;
                }
            }
        };

        xhr.open("POST", "https://speed.cloudflare.com/__up", true);
        xhr.onload = loop; 
        xhr.onerror = loop; // استمرار حتى عند الخطأ
        xhr.send(data);
    };

    // 12 مسار متوازي (كافٍ لإغراق أي خط منزلي)
    for(let i=0; i<12; i++) {
        loop();
        await new Promise(r => setTimeout(r, 100)); // تأخير بسيط لمنع الصدمة
    }

    // Jitter أثناء الرفع
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?uj=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val;
            let w = Math.min((val/300)*100, 100);
            document.getElementById('jitter-bar').style.width = w + "%";
        } catch {}
    }, 250);

    await new Promise(r => setTimeout(r, ms));
    clearInterval(jInt);
    return maxSpeed.toFixed(1);
}
