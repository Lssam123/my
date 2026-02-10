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

// إعداد العداد اللوغاريتمي
const pts = [0, 1, 5, 10, 50, 100, 300, 500, 1000];
const ring = document.getElementById('ticks-ring');
pts.forEach(p => {
    let d = getDeg(p);
    ring.innerHTML += `<span style="--d: ${d}deg">${p}</span>`;
});

function getDeg(v) {
    let p = 0;
    if(v<=10) p=(v/10)*0.2;
    else if(v<=100) p=0.2+((v-10)/90)*0.3;
    else if(v<=1000) p=0.5+((v-100)/900)*0.5;
    else p=1;
    return (p*270)-135;
}

function updateUI(val, type="dl") {
    const deg = getDeg(val);
    document.getElementById('needle-arm').style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('big-speed').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const arc = document.getElementById('active-arc');
    const lbl = document.getElementById('test-phase');
    
    let offset = 440 - ((deg+135)/270 * 440);
    arc.style.strokeDashoffset = offset;

    if(type === "ul") {
        arc.setAttribute("stroke", "url(#g-purple)");
        lbl.style.color = "#d482ff";
    } else {
        arc.setAttribute("stroke", "url(#g-cyan)");
        lbl.style.color = "#00C9FF";
    }
}

async function startV91() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    updateUI(0, "dl");
    ["final-ping", "final-dl", "final-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('j-bar').style.width = "0%";

    const sel = document.getElementById('srv-select').value;
    activeNode = (sel === 'auto') ? NODES[await pickServer()] : NODES[sel];

    // 1. PING
    document.getElementById('test-phase').innerText = "PING";
    const ping = await runPing(5000);
    document.getElementById('final-ping').innerText = ping + " ms";

    // 2. DOWNLOAD
    document.getElementById('test-phase').innerText = "DOWNLOAD";
    const dl = await runDownload(15000);
    document.getElementById('final-dl').innerText = Math.round(dl) + " Mbps";

    // 3. UPLOAD (Dynamic Fix)
    updateUI(0, "ul"); // إعادة العداد للصفر
    document.getElementById('test-phase').innerText = "UPLOAD";
    const ul = await runDynamicUpload(15000);
    document.getElementById('final-ul').innerText = ul + " Mbps";

    document.getElementById('test-phase').innerText = "DONE";
    document.getElementById('start-btn').disabled = false;
}

async function pickServer() {
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
            // طرح 20-30% كـ Overhead (وقت معالجة المتصفح)
            let raw = performance.now() - t0;
            list.push(raw * 0.75); 
        } catch {}
        await new Promise(r => setTimeout(r, 120));
    }
    return Math.round(Math.min(...list));
}

async function runDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();

    // البنق المثقل الحي
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val;
            document.getElementById('j-bar').style.width = Math.min((val/400)*100, 100) + "%";
        } catch {}
    }, 200);

    const workers = Array(40).fill(0).map(async () => {
        while(performance.now() - start < ms && !subCtrl.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: subCtrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || subCtrl.signal.aborted) break;
                    bytes += value.length;
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    updateUI(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    subCtrl.abort(); clearInterval(jInt);
    return (bytes * 8) / (1024 * 1024) / 15 * 1.05;
}

// محرك الرفع الديناميكي (الحل النهائي)
async function runDynamicUpload(ms) {
    let totalSent = 0;
    let maxSpeed = 0;
    const start = performance.now();
    
    // إنشاء بيانات عشوائية بحجم صغير (256KB) لتبدأ بسرعة
    const smallChunk = new Uint8Array(256 * 1024); 
    crypto.getRandomValues(smallChunk);

    // دالة العامل الذكي
    const worker = async () => {
        while (performance.now() - start < ms) {
            try {
                await new Promise((res, rej) => {
                    const xhr = new XMLHttpRequest();
                    
                    // استخدام timeout لمنع التعليق
                    xhr.timeout = 2000; 

                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable) {
                            // التحديث اللحظي للعداد
                            // نحسب السرعة اللحظية هنا فقط للعرض
                        }
                    };

                    xhr.onload = () => {
                        totalSent += smallChunk.length;
                        res();
                    };
                    
                    // إذا علق، أعد المحاولة فوراً
                    xhr.ontimeout = () => { res(); }; 
                    xhr.onerror = () => { res(); };

                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.send(smallChunk);
                });
            } catch { await new Promise(r => setTimeout(r, 20)); }
        }
    };

    // مراقب السرعة الرئيسي
    const monitor = setInterval(() => {
        let elapsed = (performance.now() - start) / 1000;
        if(elapsed > 0.1) {
            // معامل تصحيح 1.2 لأن XHR له Header overhead
            let speed = (totalSent * 8) / (1024 * 1024) / elapsed * 1.25;
            if(speed > maxSpeed) maxSpeed = speed;
            updateUI(speed, "ul");
        }
    }, 150);

    // تشغيل 24 مسار متوازي بحجم صغير (Shotgun approach)
    // هذا الأسلوب يضمن أن بعض المسارات ستنجح حتى لو فشل البعض الآخر
    const threads = Array(24).fill(0).map(() => worker());
    
    // البنق المثقل يستمر أثناء الرفع
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?uj=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val;
            document.getElementById('j-bar').style.width = Math.min((val/400)*100, 100) + "%";
        } catch {}
    }, 200);

    await Promise.all(threads); // انتظر انتهاء الوقت
    clearInterval(monitor);
    clearInterval(jInt);

    return maxSpeed.toFixed(1);
}
