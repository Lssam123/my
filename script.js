const SERVERS = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico"
};

let ctrl = null;
let activeUrl = "";
let jitterTimer = null;

// مصفوفة التنعيم (لحركة العداد)
let speedBuffer = [];

function updateGauge(val, type="dl") {
    // 1. خوارزمية التنعيم (Weighted Moving Average)
    speedBuffer.push(val);
    if(speedBuffer.length > 5) speedBuffer.shift();
    // حساب المتوسط المرجح
    let smoothedVal = speedBuffer.reduce((a, b) => a + b, 0) / speedBuffer.length;

    // 2. تحديث الرقم
    document.getElementById('speed-val').innerText = smoothedVal < 10 ? smoothedVal.toFixed(1) : Math.round(smoothedVal);
    
    // 3. تحريك العداد
    const path = document.getElementById('gauge-path');
    const txt = document.getElementById('status-txt');
    const root = document.documentElement;

    // معادلة لوغاريتمية دقيقة (0-1000)
    let p = 0;
    if(smoothedVal <= 10) p = (smoothedVal/10)*0.1;
    else if(smoothedVal <= 100) p = 0.1 + ((smoothedVal-10)/90)*0.3;
    else if(smoothedVal <= 1000) p = 0.4 + ((smoothedVal-100)/900)*0.6;
    else p = 1;

    // محيط الدائرة 565
    path.style.strokeDashoffset = 565 - (p * 565);

    // تغيير الألوان
    if(type === "ul") {
        root.style.setProperty('--main', '#ff0055'); // Pink
        txt.style.color = '#ff0055';
    } else {
        root.style.setProperty('--main', '#00e5ff'); // Cyan
        txt.style.color = '#00e5ff';
    }
}

function updateProgress(percent) {
    document.getElementById('progress-bar').style.width = percent + "%";
}

async function startEngine() {
    // إعادة تعيين قوية
    if(ctrl) ctrl.abort();
    if(jitterTimer) clearInterval(jitterTimer);
    ctrl = new AbortController();
    speedBuffer = [];
    
    document.getElementById('start-btn').disabled = true;
    updateGauge(0, "dl");
    ["res-ping", "res-dl", "res-ul", "res-jitter", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    
    const sel = document.getElementById('server-select').value;
    activeUrl = (sel === 'auto') ? SERVERS[await findBest()] : SERVERS[sel];

    // 1. PING (Cold Start Fix)
    document.getElementById('status-txt').innerText = "PING";
    const ping = await runPrecisionPing(4000);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 2. DOWNLOAD (مع البنق المثقل)
    document.getElementById('status-txt').innerText = "DOWNLOAD";
    startJitter();
    const dl = await runDownloadStream(15000); // 15 ثانية
    stopJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 3. UPLOAD (إصلاح: XHR String Stream)
    updateGauge(0, "ul");
    speedBuffer = []; // تصفير الذاكرة للرفع
    document.getElementById('status-txt').innerText = "UPLOAD";
    const ul = await runUploadString(15000); // 15 ثانية
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('status-txt').innerText = "FINISHED";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "RETEST";
}

async function findBest() {
    const keys = Object.keys(SERVERS);
    // نفحص أول استجابة فقط
    const r = await Promise.any(keys.map(async k => {
        try { 
            await fetch(SERVERS[k], { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal }); 
            return k; 
        } catch { return "stc"; } // Default fallback
    }));
    return r;
}

// فحص البنق بدقة
async function runPrecisionPing(duration) {
    let pings = [];
    const start = performance.now();
    let count = 0;
    
    while(performance.now() - start < duration) {
        if(ctrl.signal.aborted) break;
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let t = performance.now() - t0;
            // تجاهل أول 3 قراءات (Cold Start)
            if(count > 2) pings.push(t);
            count++;
        } catch {}
        updateProgress(((performance.now()-start)/duration)*100);
        await new Promise(r => setTimeout(r, 150));
    }
    
    pings.sort((a,b)=>a-b);
    // الوسيط الحسابي (Median)
    return Math.round(pings[Math.floor(pings.length/2)] || 0);
}

// فحص التحميل
async function runDownloadStream(duration) {
    let loadedBytes = 0;
    const start = performance.now();
    let isRunning = true;

    // قاطع الوقت
    setTimeout(() => isRunning = false, duration);

    // مؤقت تحديث الواجهة (منفصل عن التحميل)
    const uiLoop = setInterval(() => {
        if(!isRunning) return;
        let elapsed = (performance.now() - start) / 1000;
        let bps = (loadedBytes * 8) / elapsed;
        let mbps = bps / (1024 * 1024);
        updateGauge(mbps, "dl");
        updateProgress((elapsed * 1000 / duration) * 100);
    }, 200);

    // 20 قناة تحميل
    const workers = Array(20).fill(0).map(async () => {
        while(isRunning && !ctrl.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=50000000", { signal: ctrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    if(!isRunning) { reader.cancel(); break; }
                    const {done, value} = await reader.read();
                    if(done) break;
                    loadedBytes += value.length;
                }
            } catch { break; }
        }
    });

    while(isRunning) await new Promise(r => setTimeout(r, 100));
    clearInterval(uiLoop);
    
    // النتيجة النهائية
    return ((loadedBytes * 8) / (1024 * 1024) / (duration/1000)).toFixed(1);
}

// *** الحل الذهبي للرفع: XHR String Upload ***
// إرسال نصوص بدلاً من ملفات (Blob) يمنع الحظر ويضمن الحساب الدقيق
async function runUploadString(duration) {
    let uploadedBytes = 0;
    const start = performance.now();
    let isRunning = true;
    
    // إنشاء نص عشوائي طويل (1MB)
    // النصوص تمر عبر الجدران النارية أسهل من الملفات الثنائية
    const chunkData = "x".repeat(1024 * 1024); 

    setTimeout(() => isRunning = false, duration);

    const uiLoop = setInterval(() => {
        if(!isRunning) return;
        let elapsed = (performance.now() - start) / 1000;
        // تصحيح Overhead بنسبة 10%
        let speed = ((uploadedBytes * 8) / (1024 * 1024) / elapsed) * 1.1; 
        updateGauge(speed, "ul");
        updateProgress((elapsed * 1000 / duration) * 100);
    }, 200);

    const worker = () => {
        if(!isRunning || ctrl.signal.aborted) return;

        const xhr = new XMLHttpRequest();
        let prevLoaded = 0;

        xhr.upload.onprogress = (e) => {
            if(!isRunning) { xhr.abort(); return; }
            if(e.lengthComputable) {
                let diff = e.loaded - prevLoaded;
                if(diff > 0) {
                    uploadedBytes += diff;
                    prevLoaded = e.loaded;
                }
            }
        };

        xhr.onload = () => worker(); // تكرار فوري
        xhr.onerror = () => worker();

        // استخدام POST مع معلمة عشوائية
        xhr.open("POST", `https://speed.cloudflare.com/__up?ts=${Date.now()}-${Math.random()}`, true);
        // تعيين النوع كنص عادي
        xhr.setRequestHeader("Content-Type", "text/plain;charset=UTF-8");
        xhr.send(chunkData);
    };

    // تشغيل 8 قنوات متوازية
    for(let i=0; i<8; i++) {
        worker();
        await new Promise(r => setTimeout(r, 100)); // تدرج بسيط
    }

    while(isRunning) await new Promise(r => setTimeout(r, 100));
    clearInterval(uiLoop);
    
    // حساب السرعة النهائية
    return (((uploadedBytes * 8) / (1024 * 1024) / (duration/1000)) * 1.1).toFixed(1);
}

// مراقبة البنق المثقل
function startJitter() {
    jitterTimer = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val + " ms";
            document.getElementById('res-jitter').innerText = val;
        } catch {}
    }, 500);
}
function stopJitter() { if(jitterTimer) clearInterval(jitterTimer); }
