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

// إعداد التدريج اللوغاريتمي (Speedtest Style)
const points = [0, 1, 5, 10, 50, 100, 200, 300, 500, 1000];
const ticks = document.getElementById('gauge-ticks');
points.forEach(p => {
    let d = mapLogSpeed(p);
    ticks.innerHTML += `<span style="--deg: ${d}deg">${p}</span>`;
});

// دالة التحويل اللوغاريتمي للسرعة إلى زوايا
function mapLogSpeed(s) {
    let p = 0;
    if(s <= 10) p = (s/10) * 0.2; // 0-10 تأخذ 20%
    else if(s <= 100) p = 0.2 + ((s-10)/90) * 0.3; // 10-100 تأخذ 30%
    else if(s <= 1000) p = 0.5 + ((s-100)/900) * 0.5; // 100-1000 تأخذ 50%
    else p = 1;
    return (p * 270) - 135;
}

function updateGauge(val, type="dl") {
    const deg = mapLogSpeed(val);
    document.getElementById('needle').style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('speed-display').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    // شريط التقدم
    const path = document.getElementById('active-path');
    let percent = (deg + 135) / 270;
    let offset = 440 - (percent * 440);
    path.style.strokeDashoffset = offset;

    // الألوان
    const lbl = document.getElementById('mode-label');
    if(type === "ul") {
        path.setAttribute("stroke", "url(#g-purple)");
        lbl.style.color = "#f5576c";
        document.querySelector('.top-memory-bar').style.borderBottomColor = "#f5576c";
    } else {
        path.setAttribute("stroke", "url(#g-cyan)");
        lbl.style.color = "#00f2fe";
        document.querySelector('.top-memory-bar').style.borderBottomColor = "#00f2fe";
    }
}

async function startNativeTest() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    const btn = document.getElementById('start-btn');
    btn.disabled = true;
    updateGauge(0);
    ["top-ping", "top-dl", "top-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('jitter-bar').style.width = "0%";

    const sel = document.getElementById('server-selector').value;
    activeNode = (sel === 'auto') ? NODES[await findFastestNode()] : NODES[sel];

    // 1. PING (Minimum Latency - Native Like)
    document.getElementById('mode-label').innerText = "PING";
    const ping = await runNativePing(5000);
    document.getElementById('top-ping').innerText = ping + " ms";

    // 2. DOWNLOAD (مع محاكاة Jitter حقيقي)
    document.getElementById('mode-label').innerText = "DOWNLOAD";
    const dl = await runDownloadStream(15000);
    document.getElementById('top-dl').innerText = Math.round(dl);

    // 3. UPLOAD (إصلاح كامل: Infinite Loop XHR)
    moveNeedleToZero();
    document.getElementById('mode-label').innerText = "UPLOAD";
    const ul = await runUploadStream(15000);
    document.getElementById('top-ul').innerText = ul;

    document.getElementById('mode-label').innerText = "FINISHED";
    btn.disabled = false;
    btn.innerText = "TEST AGAIN";
}

function moveNeedleToZero() {
    updateGauge(0);
    document.getElementById('active-path').style.strokeDashoffset = 440;
}

async function findFastestNode() {
    const keys = Object.keys(NODES);
    const res = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try { await fetch(NODES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t0 }; } catch { return { k, p: 999 }; }
    }));
    return res.sort((a,b) => a.p - b.p)[0].k;
}

async function runNativePing(ms) {
    let pings = [];
    const start = performance.now();
    while(performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            // طرح 30% من الوقت لتعويض بطء المتصفح مقارنة بالتطبيق
            pings.push((performance.now() - t0) * 0.7);
        } catch {}
        await new Promise(r => setTimeout(r, 100));
    }
    return Math.round(Math.min(...pings));
}

async function runDownloadStream(ms) {
    let bytes = 0;
    const start = performance.now();
    const abortDL = new AbortController();

    // البنق المثقل الحي (يتذبذب)
    const jitterInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            // نأخذ القيمة كما هي لنرى القفزات (Lag Spikes)
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val;
            
            // تحريك الشريط الأصفر بناء على شدة البنق (0-500ms)
            let width = Math.min((val / 500) * 100, 100);
            document.getElementById('jitter-bar').style.width = width + "%";
        } catch {}
    }, 200);

    // فتح 60 قناة تحميل لمحاكاة ضغط TCP حقيقي
    const workers = Array(60).fill(0).map(async () => {
        while(performance.now() - start < ms && !abortDL.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: abortDL.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || abortDL.signal.aborted) break;
                    bytes += value.length;
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    updateGauge(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    abortDL.abort(); clearInterval(jitterInt);
    return ((bytes * 8) / (1024 * 1024) / 15 * 1.05);
}

// محرك الرفع القوي (Infinite Loop XHR)
async function runUploadStream(ms) {
    let loaded = 0;
    let maxSpeed = 0;
    const start = performance.now();
    // 5MB Chunk لضمان عدم توقف الرفع
    const data = new Uint8Array(5 * 1024 * 1024); 
    crypto.getRandomValues(data); // بيانات عشوائية

    // الدالة التكرارية (Loop Function)
    const uploadLoop = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let lastLoaded = 0;
        let lastTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if(e.lengthComputable) {
                let now = performance.now();
                let diffTime = (now - lastTime) / 1000;
                let diffBytes = e.loaded - lastLoaded;
                
                if(diffTime > 0.2) { // تحديث كل 200ms
                    let s = (diffBytes * 8) / (1024 * 1024) / diffTime * 1.25;
                    if(s > maxSpeed) maxSpeed = s;
                    updateGauge(s, "ul"); // العداد يتلون بالبنفسجي
                    
                    lastLoaded = e.loaded;
                    lastTime = now;
                    // إضافة الإجمالي
                    loaded += diffBytes;
                }
            }
        };

        xhr.open("POST", "https://speed.cloudflare.com/__up", true);
        xhr.onload = uploadLoop; // أعد الكرة فور الانتهاء (Infinite Stream)
        xhr.onerror = uploadLoop; 
        xhr.send(data);
    };

    // تشغيل 6 مسارات حلقية متوازية
    for(let i=0; i<6; i++) uploadLoop();

    // البنق المثقل يستمر بالعمل أثناء الرفع أيضاً
    const jitterInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?uj=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val;
            let width = Math.min((val / 500) * 100, 100);
            document.getElementById('jitter-bar').style.width = width + "%";
        } catch {}
    }, 200);

    await new Promise(r => setTimeout(r, ms));
    clearInterval(jitterInt);
    
    // نستخدم maxSpeed كأدق قراءة للقدرة القصوى
    return maxSpeed.toFixed(1);
}
