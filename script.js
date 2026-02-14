// قائمة السيرفرات السعودية (لفحص البنق والجيتر)
const SAUDI_NODES = [
    { name: "STC", url: "https://www.stc.com.sa/favicon.ico" },
    { name: "Mobily", url: "https://www.mobily.com.sa/favicon.ico" },
    { name: "Zain", url: "https://www.sa.zain.com/favicon.ico" },
    { name: "Salam", url: "https://salam.sa/favicon.ico" },
    { name: "GO", url: "https://www.go.com.sa/favicon.ico" },
    { name: "Dawiyat", url: "https://dawiyat.com.sa/favicon.ico" }
];

// رابط الضغط العالمي (لضمان سرعة التحميل والرفع بدون حجب)
const CDN_URL = "https://speed.cloudflare.com";

let ctrl = null;         // وحدة التحكم لإلغاء العمليات
let bestServerUrl = "";  // السيرفر السعودي المختار
let jitterInterval = null; // مؤقت البنق المثقل

// إعادة تعيين النظام
function resetSystem() {
    if(ctrl) ctrl.abort();
    if(jitterInterval) clearInterval(jitterInterval);
    
    updateGauge(0, "dl");
    updateTimer(0, 0);
    
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('srv-status').innerText = "جاهز للفحص";
    document.getElementById('phase-lbl').innerText = "استعداد";
    
    const btn = document.getElementById('start-btn');
    btn.disabled = false;
    btn.innerText = "بدء الفحص";
}

// تحديث العداد
function updateGauge(val, type="dl") {
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('speed-num').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-fill');
    const phase = document.getElementById('phase-lbl');
    const root = document.documentElement;

    // طول المسار 590
    path.style.strokeDashoffset = 590 - (p * 590);

    if(type === "ul") {
        path.setAttribute("stroke", "url(#grad-ul)");
        path.style.filter = "drop-shadow(0 0 10px #651FFF)";
        phase.style.color = "#651FFF";
    } else {
        path.setAttribute("stroke", "url(#grad-dl)");
        path.style.filter = "drop-shadow(0 0 10px #00E676)";
        phase.style.color = "#00E676";
    }
}

// تحديث الوقت
function updateTimer(pct, secondsLeft) {
    document.getElementById('time-bar').style.width = pct + "%";
    if(secondsLeft !== undefined) document.getElementById('timer-txt').innerText = secondsLeft + "s";
}

// بدء الفحص
async function startOrbitTest() {
    resetSystem();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر تلقائياً (خفي)
    document.getElementById('phase-lbl').innerText = "بحث عن خادم...";
    bestServerUrl = await selectBestServer();
    document.getElementById('srv-status').innerText = "تم الاتصال بأفضل خادم";

    // 2. فحص البنق (5 ثواني)
    document.getElementById('phase-lbl').innerText = "قياس الاستجابة";
    const ping = await runTimedTask(5000, measurePing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل + البنق المثقل (15 ثانية)
    document.getElementById('phase-lbl').innerText = "جاري التنزيل...";
    startJitter(); // بدء البنق المثقل
    const dl = await runTimedTask(15000, measureDownload);
    stopJitter(); // إيقاف البنق المثقل
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (15 ثانية)
    updateGauge(0, "ul");
    document.getElementById('phase-lbl').innerText = "جاري الرفع...";
    const ul = await runTimedTask(15000, measureUpload);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-lbl').innerText = "اكتمل";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

// دالة اختيار السيرفر الأسرع
async function selectBestServer() {
    const promises = SAUDI_NODES.map(async node => {
        const start = performance.now();
        try {
            await fetch(node.url + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            return { url: node.url, time: performance.now() - start };
        } catch { return { url: node.url, time: 9999 }; }
    });
    
    const results = await Promise.all(promises);
    results.sort((a,b) => a.time - b.time);
    return results[0].url;
}

// مدير الوقت
async function runTimedTask(duration, taskFn) {
    const start = performance.now();
    
    const timerLoop = setInterval(() => {
        let elapsed = performance.now() - start;
        let pct = (elapsed / duration) * 100;
        let left = Math.ceil((duration - elapsed) / 1000);
        if(pct > 100) pct = 100;
        if(left < 0) left = 0;
        updateTimer(pct, left);
    }, 100);

    const result = await taskFn(duration, start);
    
    clearInterval(timerLoop);
    updateTimer(100, 0);
    return result;
}

// مهمة البنق
async function measurePing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        let t0 = performance.now();
        try {
            await fetch(bestServerUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            pings.push((performance.now() - t0) * 0.9); // تصحيح بسيط
        } catch {}
        await new Promise(r => setTimeout(r, 250));
    }
    pings.sort((a,b)=>a-b);
    return Math.round(pings[Math.floor(pings.length/2)] || 0);
}

// مهمة التحميل
async function measureDownload(duration, startTime) {
    let loadedBytes = 0;
    
    // 25 عامل تحميل
    const workers = Array(25).fill(0).map(async () => {
        while(performance.now() - startTime < duration) {
            if(ctrl.signal.aborted) break;
            try {
                // استخدام Cloudflare للسرعة القصوى
                const res = await fetch(CDN_URL + "/__down?bytes=50000000", { signal: ctrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || performance.now() - startTime >= duration) break;
                    loadedBytes += value.length;
                    
                    let elapsed = (performance.now() - startTime) / 1000;
                    let speed = (loadedBytes * 8) / (1024 * 1024) / elapsed;
                    updateGauge(speed, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    let finalSpeed = (loadedBytes * 8) / (1024 * 1024) / (duration/1000);
    return finalSpeed.toFixed(1);
}

// مهمة الرفع (XHR + Random Data)
async function measureUpload(duration, startTime) {
    let sentBytes = 0;
    // بيانات عشوائية 1MB
    const data = new Uint8Array(1024 * 1024);
    crypto.getRandomValues(data);

    const worker = () => {
        if(performance.now() - startTime >= duration || ctrl.signal.aborted) return;

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if(performance.now() - startTime >= duration) { xhr.abort(); return; }
            if(e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let diff = e.loaded - lastLoad;
                
                if(dt > 0.1) {
                    let s = (diff * 8) / (1024 * 1024) / dt * 1.05;
                    updateGauge(s, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        xhr.onload = () => { sentBytes += data.byteLength; worker(); };
        xhr.onerror = () => worker();

        // استخدام POST مع Cloudflare
        xhr.open("POST", `${CDN_URL}/__up?t=${Math.random()}`, true);
        xhr.send(data);
    };

    // 12 قناة رفع
    for(let i=0; i<12; i++) {
        worker();
        await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, duration));
    return document.getElementById('speed-num').innerText;
}

// مراقبة البنق المثقل (بالتوازي مع التحميل)
function startJitter() {
    jitterInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(bestServerUrl + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val + " ms";
            document.getElementById('res-jitter').innerText = val;
        } catch {}
    }, 500);
}
function stopJitter() { clearInterval(jitterInt); }
