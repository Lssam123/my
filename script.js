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

// نظام التدريج اللوغاريتمي الدقيق
const mapSpeed = (s) => {
    let p = 0;
    if(s<=10) p=(s/10)*0.2;
    else if(s<=100) p=0.2+((s-10)/90)*0.3;
    else if(s<=1000) p=0.5+((s-100)/900)*0.5;
    else p=1;
    return (p*270)-135;
};

function update3D(val, type="dl") {
    const deg = mapSpeed(val);
    // إضافة translateZ لضمان بقاء الإبرة في طبقة الـ 3D
    document.getElementById('needle').style.transform = `translateZ(40px) translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('live-val').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-active');
    const lbl = document.getElementById('phase-lbl');
    const hud = document.querySelector('.hud-top');
    
    let percent = (deg + 135) / 270;
    let offset = 440 - (percent * 440);
    path.style.strokeDashoffset = offset;

    if(type === "ul") {
        path.setAttribute("stroke", "url(#g-purple)");
        lbl.style.color = "#ff4b1f";
        hud.style.borderBottomColor = "#ff4b1f";
    } else {
        path.setAttribute("stroke", "url(#g-cyan)");
        lbl.style.color = "#00F260";
        hud.style.borderBottomColor = "#00F260";
    }
}

async function start3DTest() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    update3D(0);
    
    const sel = document.getElementById('srv-select').value;
    activeNode = (sel === 'auto') ? NODES[await pickBest()] : NODES[sel];

    // 1. PING (Speedtest Method: Lowest Latency)
    document.getElementById('phase-lbl').innerText = "MEASURING PING";
    const ping = await runPing(5000);
    document.getElementById('res-ping').innerHTML = `${ping} <small>ms</small>`;

    // 2. DOWNLOAD (Ramp-up Streams)
    document.getElementById('phase-lbl').innerText = "DOWNLOAD TEST";
    const dl = await runDownload(15000);
    document.getElementById('res-dl').innerHTML = `${Math.round(dl)} <small>Mbps</small>`;

    // 3. UPLOAD (Blob Injection) - الحل الأكيد
    update3D(0);
    document.getElementById('phase-lbl').innerText = "UPLOAD TEST";
    const ul = await runUploadFixed(15000);
    document.getElementById('res-ul').innerHTML = `${ul} <small>Mbps</small>`;

    document.getElementById('phase-lbl').innerText = "TEST COMPLETE";
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
    let pings = [];
    const start = performance.now();
    while(performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            // سبيد تست يستخدم أقل قيمة، ونزيل 5ms كـ System Overhead
            let raw = performance.now() - t0;
            pings.push(Math.max(1, raw - 5));
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    return Math.round(Math.min(...pings));
}

async function runDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();

    // Loaded Latency Monitor (Jitter) - مثل سبيد تست
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            // هنا نعرض البنق الحالي تحت الضغط (Loaded Ping)
            let loaded = Math.round(performance.now() - t0);
            
            // إذا كان الضغط عالياً، البنق سيرتفع. نعرض القيمة كما هي
            document.getElementById('live-loaded').innerText = loaded;
            
            // شريط الرسم يمثل الخطورة (فوق 100 أحمر)
            let w = Math.min((loaded/300)*100, 100);
            document.getElementById('jitter-bar').style.width = w + "%";
            document.getElementById('jitter-bar').style.backgroundColor = loaded > 100 ? "#ff4b1f" : "#ffeb3b";
        } catch {}
    }, 250);

    // Ramp-up: ابدأ بـ 4 قنوات، ثم زدها
    const workers = Array(16).fill(0).map(async () => {
        while(performance.now() - start < ms && !subCtrl.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: subCtrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || subCtrl.signal.aborted) break;
                    bytes += value.length;
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.08;
                    update3D(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    subCtrl.abort(); clearInterval(jInt);
    return (bytes * 8) / (1024 * 1024) / 15 * 1.08;
}

// *** الحل النهائي للرفع (Blob XHR) ***
// هذا الكود يتجاوز الذاكرة العشوائية للمتصفح باستخدام Blob ثابت
async function runUploadFixed(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    
    // إنشاء كتلة ضخمة (20MB) مرة واحدة فقط في الذاكرة
    // المتصفحات تتعامل مع الـ Blobs بكفاءة ولا تعيد نسخها
    const bigBlob = new Blob([new ArrayBuffer(20 * 1024 * 1024)]); 

    const loop = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let trackerStart = performance.now();
        let trackerLoaded = 0;

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - trackerStart) / 1000;
                let dBytes = e.loaded - trackerLoaded;
                
                // تحديث كل 200ms
                if (dt > 0.2) { 
                    // 1.25 هو معامل تصحيح (Header Overhead + TCP Stack)
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.25; 
                    if(s > maxSpeed) maxSpeed = s;
                    update3D(s, "ul");
                    
                    trackerLoaded = e.loaded;
                    trackerStart = now;
                }
            }
        };

        xhr.open("POST", "https://speed.cloudflare.com/__up", true);
        xhr.onload = loop; 
        xhr.onerror = loop; 
        xhr.send(bigBlob);
    };

    // نفتح 4 قنوات فقط (لأن الحجم كبير 20MB)
    // القنوات القليلة بحجم كبير أفضل من قنوات كثيرة بحجم صغير للرفع
    for(let i=0; i<4; i++) {
        loop();
        await new Promise(r => setTimeout(r, 200));
    }

    // استمرار مراقبة البنق المثقل
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?uj=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let loaded = Math.round(performance.now() - t0);
            document.getElementById('live-loaded').innerText = loaded;
        } catch {}
    }, 250);

    await new Promise(r => setTimeout(r, ms));
    clearInterval(jInt);
    
    return maxSpeed.toFixed(1);
}
