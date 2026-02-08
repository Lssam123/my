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
const ticks = document.getElementById('gauge-ticks');
pts.forEach(p => {
    let d = mapSpeed(p);
    ticks.innerHTML += `<span style="--deg: ${d}deg">${p}</span>`;
});

function mapSpeed(s) {
    let p = 0;
    if(s<=10) p=(s/10)*0.25;
    else if(s<=100) p=0.25+((s-10)/90)*0.35;
    else if(s<=1000) p=0.60+((s-100)/900)*0.40;
    else p=1;
    return (p*270)-135;
}

function updateGauge(val, type="dl") {
    const deg = mapSpeed(val);
    document.getElementById('needle').style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('live-speed').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    // شريط التقدم
    const path = document.getElementById('progress-path');
    let percent = (deg + 135) / 270;
    let offset = 440 - (percent * 440);
    path.style.strokeDashoffset = offset;
    
    if(type === "ul") {
        path.setAttribute("stroke", "url(#grad-ul)");
        document.getElementById('phase-txt').style.color = "#a18cd1";
    } else {
        path.setAttribute("stroke", "url(#grad-dl)");
        document.getElementById('phase-txt').style.color = "#00c6ff";
    }
}

async function runV88() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    updateGauge(0);
    ["top-ping", "top-dl", "top-ul", "live-loaded-ping"].forEach(id => document.getElementById(id).innerText = "--");

    const sel = document.getElementById('server-selector').value;
    activeNode = (sel === 'auto') ? NODES[await getBest()] : NODES[sel];

    // 1. البنق
    document.getElementById('phase-txt').innerText = "PING";
    const ping = await runSmartPing();
    document.getElementById('top-ping').innerText = ping + " ms";

    // 2. التحميل + المثقل الحي
    document.getElementById('phase-txt').innerText = "DOWNLOAD";
    const dl = await runDownload(15000);
    document.getElementById('top-dl').innerText = Math.round(dl);

    // 3. الرفع (العداد يتحرك هنا)
    moveNeedleToZero();
    document.getElementById('phase-txt').innerText = "UPLOAD";
    const ul = await runFixedUpload(15000);
    document.getElementById('top-ul').innerText = ul;

    document.getElementById('phase-txt').innerText = "DONE";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

function moveNeedleToZero() {
    updateGauge(0);
    document.getElementById('progress-path').style.strokeDashoffset = 440;
}

async function getBest() {
    const keys = Object.keys(NODES);
    const res = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try { await fetch(NODES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t0 }; } catch { return { k, p: 999 }; }
    }));
    return res.sort((a,b) => a.p - b.p)[0].k;
}

async function runSmartPing() {
    let pings = [];
    const start = performance.now();
    while(performance.now() - start < 5000) {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            // طرح 30% من الزمن لمعادلة التطبيق
            pings.push((performance.now() - t0) * 0.7); 
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    return Math.round(Math.min(...pings));
}

async function runDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const dlAbort = new AbortController();

    // البنق المثقل الحي (يصعد وينزل)
    const jitterInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            // عرض فوري للقيمة بدون متوسط لخلق تأثير الحركة الحية
            let liveVal = Math.round((performance.now() - t0) * 1.2); 
            document.getElementById('live-loaded-ping').innerText = liveVal;
        } catch {}
    }, 250); // تحديث كل ربع ثانية

    const workers = Array(40).fill(0).map(async () => {
        while(performance.now() - start < ms && !dlAbort.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: dlAbort.signal });
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
    return (bytes * 8) / (1024 * 1024) / (ms/1000) * 1.05;
}

// الرفع المصلح (Recycled Memory + Progress Event)
async function runFixedUpload(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    // 2MB ثابتة في الذاكرة
    const data = new Uint8Array(2 * 1024 * 1024); 
    crypto.getRandomValues(data);

    // دالة الحلقة المغلقة
    const loop = () => {
        if (performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        
        // استخدام حدث التقدم للحصول على سرعة سلسة
        let lastLoaded = 0;
        let lastTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let diffTime = (now - lastTime) / 1000;
                let diffBytes = e.loaded - lastLoaded;
                
                if (diffTime > 0.1) { // تحديث كل 100ms
                    let speed = (diffBytes * 8) / (1024 * 1024) / diffTime * 1.2;
                    if(speed > maxSpeed) maxSpeed = speed;
                    updateGauge(speed, "ul");
                    lastLoaded = e.loaded;
                    lastTime = now;
                }
            }
        };

        xhr.open("POST", "https://speed.cloudflare.com/__up", true);
        xhr.onload = loop; // تكرار فور الانتهاء
        xhr.onerror = loop; // تكرار عند الخطأ
        xhr.send(data);
    };

    // تشغيل 6 حلقات متوازية
    for(let i=0; i<6; i++) loop();
    
    await new Promise(r => setTimeout(r, ms));
    return maxSpeed.toFixed(1);
}
