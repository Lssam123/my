// قائمة السيرفرات السعودية
const KSA_NODES = [
    { name: "STC", url: "https://www.stc.com.sa/favicon.ico" },
    { name: "Mobily", url: "https://www.mobily.com.sa/favicon.ico" },
    { name: "Zain", url: "https://www.sa.zain.com/favicon.ico" },
    { name: "Salam", url: "https://salam.sa/favicon.ico" },
    { name: "Dawiyat", url: "https://dawiyat.com.sa/favicon.ico" }
];

// نقطة ضغط البيانات (Cloudflare - الأفضل عالمياً للسرعة)
const DATA_NODE = "https://speed.cloudflare.com";

let ctrl = null;
let activePingNode = "";
let jitterInterval = null;

// إعادة الضبط
function resetSystem() {
    if(ctrl) ctrl.abort();
    if(jitterInterval) clearInterval(jitterInterval);
    
    updateGauge(0, "dl");
    updateProgress(0, 0);
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('server-status').innerText = "تلقائي (KSA)";
    document.getElementById('phase-txt').innerText = "جاهز";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

// تحديث العداد
function updateGauge(val, type="dl") {
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('speed-val').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    const path = document.getElementById('track-active');
    const phase = document.getElementById('phase-txt');
    
    // 615 طول المسار
    path.style.strokeDashoffset = 615 - (p * 615);

    if(type === "ul") {
        path.setAttribute("stroke", "url(#g-ul)");
        path.style.filter = "drop-shadow(0 0 10px #bd00ff)";
        phase.style.color = "#bd00ff";
    } else {
        path.setAttribute("stroke", "url(#g-dl)");
        path.style.filter = "drop-shadow(0 0 10px #00ffcc)";
        phase.style.color = "#00ffcc";
    }
}

function updateProgress(percent, seconds) {
    document.getElementById('progress-fill').style.width = percent + "%";
    if(seconds !== undefined) document.getElementById('timer-display').innerText = seconds + "s";
}

// المحرك الرئيسي
async function startSystem() {
    resetSystem();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر
    document.getElementById('phase-txt').innerText = "بحث عن خادم...";
    activePingNode = await findBestServer();
    document.getElementById('server-status').innerText = "متصل بـ: " + activePingNode.name;

    // 2. البنق (5 ثواني)
    document.getElementById('phase-txt').innerText = "قياس الاستجابة";
    const ping = await runTimedTask(5000, measurePing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل + الجيتر (15 ثانية)
    document.getElementById('phase-txt').innerText = "جاري التنزيل...";
    startJitter();
    const dl = await runTimedTask(15000, measureDownload);
    stopJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (15 ثانية) - الطريقة الجديدة
    updateGauge(0, "ul");
    document.getElementById('phase-txt').innerText = "جاري الرفع...";
    const ul = await runTimedTask(15000, measureUploadOnProgress);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-txt').innerText = "اكتمل الفحص";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

// دالة الوقت العامة
async function runTimedTask(duration, taskFn) {
    const start = performance.now();
    const timerLoop = setInterval(() => {
        let elapsed = performance.now() - start;
        let pct = (elapsed / duration) * 100;
        let left = Math.ceil((duration - elapsed) / 1000);
        if(pct > 100) pct = 100;
        if(left < 0) left = 0;
        updateProgress(pct, left);
    }, 100);

    const result = await taskFn(duration, start);
    clearInterval(timerLoop);
    updateProgress(100, 0);
    return result;
}

// البحث عن أفضل سيرفر
async function findBestServer() {
    const promises = KSA_NODES.map(async node => {
        const start = performance.now();
        try {
            await fetch(node.url + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            return { node, time: performance.now() - start };
        } catch { return { node, time: 9999 }; }
    });
    const results = await Promise.all(promises);
    results.sort((a,b) => a.time - b.time);
    return results[0].node;
}

// قياس البنق (مع تصفية القيم الشاذة)
async function measurePing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        let t0 = performance.now();
        try {
            await fetch(activePingNode.url + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            pings.push((performance.now() - t0) * 0.9);
        } catch {}
        await new Promise(r => setTimeout(r, 200));
    }
    // حذف أعلى وأقل قيمة للدقة
    pings.sort((a,b)=>a-b);
    if(pings.length > 4) { pings.pop(); pings.shift(); }
    
    // المتوسط الحسابي
    let sum = pings.reduce((a, b) => a + b, 0);
    return Math.round(sum / pings.length) || 0;
}

// قياس التحميل
async function measureDownload(duration, startTime) {
    let loadedBytes = 0;
    const workers = Array(20).fill(0).map(async () => {
        while(performance.now() - startTime < duration) {
            if(ctrl.signal.aborted) break;
            try {
                const res = await fetch(DATA_NODE + "/__down?bytes=50000000", { signal: ctrl.signal });
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
    return document.getElementById('speed-val').innerText;
}

// *** الحل السحري للرفع: القياس أثناء الخروج (OnProgress) ***
async function measureUploadOnProgress(duration, startTime) {
    let maxSpeed = 0;
    // بيانات عشوائية 2MB
    const data = new Uint8Array(2 * 1024 * 1024); 
    crypto.getRandomValues(data);

    const worker = () => {
        if(performance.now() - startTime >= duration || ctrl.signal.aborted) return;

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();

        // السر هنا: نحسب السرعة من هذا الحدث، لا ننتظر الرد!
        xhr.upload.onprogress = (e) => {
            if(performance.now() - startTime >= duration) { xhr.abort(); return; }
            
            if(e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let diff = e.loaded - lastLoad;
                
                // تحديث العداد فوراً
                if (dt > 0.15) {
                    let s = (diff * 8) / (1024 * 1024) / dt * 1.1; // 10% Overhead correction
                    if(s > maxSpeed) maxSpeed = s;
                    updateGauge(s, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        xhr.onload = () => worker();
        xhr.onerror = () => worker(); // حتى لو حصل خطأ CORS، نعيد المحاولة

        // إرسال البيانات
        xhr.open("POST", `${DATA_NODE}/__up?t=${Math.random()}`, true);
        xhr.send(data);
    };

    // 8 قنوات رفع متوازية
    for(let i=0; i<8; i++) {
        worker();
        await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, duration));
    
    // نستخدم آخر قراءة للعداد لأنها تمثل التدفق الحالي
    return document.getElementById('speed-val').innerText;
}

// البنق المثقل (يعمل مع التحميل)
function startJitter() {
    jitterInterval = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activePingNode.url + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val + " ms";
            document.getElementById('res-jitter').innerText = val;
        } catch {}
    }, 500);
}
function stopJitter() { clearInterval(jitterInterval); }
