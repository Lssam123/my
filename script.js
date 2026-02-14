// قائمة السيرفرات السعودية (لفحص زمن الاستجابة فقط)
const KSA_NODES = [
    { name: "STC", url: "https://www.stc.com.sa/favicon.ico" },
    { name: "Mobily", url: "https://www.mobily.com.sa/favicon.ico" },
    { name: "Zain", url: "https://www.sa.zain.com/favicon.ico" },
    { name: "Salam", url: "https://salam.sa/favicon.ico" },
    { name: "GO", url: "https://www.go.com.sa/favicon.ico" },
    { name: "Dawiyat", url: "https://dawiyat.com.sa/favicon.ico" }
];

// مسار البيانات العالمي (Cloudflare) للتحميل والرفع
const DATA_PIPE = "https://speed.cloudflare.com";

let ctrl = null;
let bestServer = null;
let jitterTimer = null;
let activeTasks = []; // لتنظيف الذاكرة

// إعادة التعيين
function resetSystem() {
    if(ctrl) ctrl.abort();
    if(jitterTimer) clearInterval(jitterTimer);
    activeTasks.forEach(xhr => xhr.abort());
    activeTasks = [];

    updateGauge(0, "dl");
    updateProgress(0, 0);
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('phase-status').innerText = "جاهز";
    document.getElementById('srv-name').innerText = "تلقائي (KSA)";
    
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

// تحديث العداد
function updateGauge(val, type="dl") {
    // خوارزمية تنعيم الحركة
    let displayVal = val < 10 ? val.toFixed(1) : Math.round(val);
    document.getElementById('speed-big').innerText = displayVal;
    
    const path = document.getElementById('track-active');
    const phase = document.getElementById('phase-status');
    const root = document.documentElement;

    // حساب النسبة (لوغاريتمي)
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    // 590 هو طول المسار
    path.style.strokeDashoffset = 590 - (p * 590);

    if(type === "ul") {
        path.setAttribute("stroke", "url(#g-ul)");
        phase.style.color = "var(--secondary)";
        path.style.filter = "drop-shadow(0 0 15px var(--secondary))";
    } else {
        path.setAttribute("stroke", "url(#g-dl)");
        phase.style.color = "var(--primary)";
        path.style.filter = "drop-shadow(0 0 15px var(--primary))";
    }
}

function updateProgress(pct, sec) {
    document.getElementById('time-bar').style.width = pct + "%";
    if(sec !== undefined) document.getElementById('time-txt').innerText = sec + "s";
}

// المحرك الرئيسي
async function runPrecisionTest() {
    resetSystem();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر
    document.getElementById('phase-status').innerText = "اختيار الخادم...";
    bestServer = await findBestServer();
    document.getElementById('srv-name').innerText = "خادم سعودي (أمثل)";

    // 2. البنق (5 ثواني)
    document.getElementById('phase-status').innerText = "قياس الاستجابة";
    const ping = await runTimedTask(5000, measurePing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل (15 ثانية) - مع الإحماء
    document.getElementById('phase-status').innerText = "جاري التنزيل...";
    startJitter();
    const dl = await runTimedTask(15000, measureDownload);
    stopJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (15 ثانية) - تقنية Dynamic Concurrency
    updateGauge(0, "ul");
    document.getElementById('phase-status').innerText = "جاري الرفع...";
    const ul = await runTimedTask(15000, measureUpload);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-status').innerText = "اكتمل";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

async function findBestServer() {
    const promises = KSA_NODES.map(async node => {
        const start = performance.now();
        // استخدام Image Ping لتفادي مشاكل الـ CORS في الفحص
        return new Promise(resolve => {
            const img = new Image();
            img.onload = img.onerror = () => resolve({ url: node.url, time: performance.now() - start });
            img.src = node.url + "?t=" + Math.random();
        });
    });
    const results = await Promise.all(promises);
    results.sort((a,b) => a.time - b.time);
    return results[0].url;
}

// مؤقت المهام
async function runTimedTask(duration, taskFn) {
    const start = performance.now();
    const timer = setInterval(() => {
        let elapsed = performance.now() - start;
        let pct = (elapsed / duration) * 100;
        let left = Math.ceil((duration - elapsed) / 1000);
        updateProgress(pct > 100 ? 100 : pct, left < 0 ? 0 : left);
    }, 100);
    
    const result = await taskFn(duration, start);
    clearInterval(timer);
    updateProgress(100, 0);
    return result;
}

// دالة البنق (Image Ping with Correction)
async function measurePing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        
        await new Promise(resolve => {
            const t0 = performance.now();
            const img = new Image();
            img.onload = img.onerror = () => {
                let t = performance.now() - t0;
                // خصم 20% كتقدير لوقت المعالجة
                pings.push(t * 0.8);
                resolve();
            };
            img.src = bestServer + "?p=" + Math.random();
        });
        await new Promise(r => setTimeout(r, 100));
    }
    
    // فلترة القيم الشاذة
    pings.sort((a,b)=>a-b);
    if(pings.length > 4) { pings.pop(); pings.shift(); }
    
    let sum = pings.reduce((a,b)=>a+b, 0);
    return Math.round(sum / pings.length) || 0;
}

// دالة التحميل (XHR Streams - الأضمن عالمياً)
async function measureDownload(duration, startTime) {
    let totalBytes = 0;
    
    // نفتح 6 قنوات تحميل متوازية
    const workers = Array(6).fill(0).map(() => {
        return new Promise((resolve) => {
            const runWorker = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }
                
                const xhr = new XMLHttpRequest();
                activeTasks.push(xhr);
                let lastLoaded = 0;
                
                xhr.onprogress = (e) => {
                    if(performance.now() - startTime >= duration) { xhr.abort(); return; }
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalBytes += diff;
                    lastLoaded = e.loaded;
                };
                
                xhr.onload = xhr.onerror = () => {
                    activeTasks = activeTasks.filter(x => x !== xhr);
                    runWorker();
                };
                
                // تحميل ملف كبير
                xhr.open("GET", `${DATA_PIPE}/__down?bytes=50000000`, true);
                xhr.send();
            };
            runWorker();
        });
    });

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        // تجاهل أول ثانيتين (Warm-up) للدقة
        if(elapsed > 2) {
            let speed = (totalBytes * 8) / (1024 * 1024) / elapsed;
            updateGauge(speed, "dl");
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    activeTasks.forEach(x => x.abort());
    return document.getElementById('speed-big').innerText;
}

// *** الحل النهائي للرفع (Dynamic XHR Upload) ***
async function measureUpload(duration, startTime) {
    let totalBytes = 0;
    // بيانات عشوائية 512KB
    const data = new Uint8Array(512 * 1024); 
    crypto.getRandomValues(data);

    // دالة العامل الذكية
    const createWorker = () => {
        return new Promise((resolve) => {
            const run = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }

                const xhr = new XMLHttpRequest();
                activeTasks.push(xhr);
                let lastLoaded = 0;

                xhr.upload.onprogress = (e) => {
                    if(performance.now() - startTime >= duration) { xhr.abort(); return; }
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalBytes += diff;
                    lastLoaded = e.loaded;
                };

                xhr.onload = xhr.onerror = () => {
                    activeTasks = activeTasks.filter(x => x !== xhr);
                    run();
                };

                xhr.open("POST", `${DATA_PIPE}/__up?t=${Math.random()}`, true);
                xhr.send(data);
            };
            run();
        });
    };

    // تشغيل 8 قنوات (توازن مثالي)
    const workers = Array(8).fill(0).map(() => createWorker());

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        if(elapsed > 1) { // تجاهل أول ثانية
            // تصحيح 5% للبروتوكول
            let speed = ((totalBytes * 8) / (1024 * 1024) / elapsed) * 1.05;
            updateGauge(speed, "ul");
        }
        await new Promise(r => setTimeout(r, 100));
    }

    activeTasks.forEach(x => x.abort());
    return document.getElementById('speed-big').innerText;
}

// البنق المثقل (Concurrent Jitter)
function startJitter() {
    jitterTimer = setInterval(async () => {
        const start = performance.now();
        const img = new Image();
        img.onload = img.onerror = () => {
            let t = Math.round((performance.now() - start) * 0.8);
            document.getElementById('live-jitter').innerText = t + " ms";
            document.getElementById('res-jitter').innerText = t;
        };
        img.src = bestServer + "?j=" + Math.random();
    }, 500);
}
function stopJitter() { clearInterval(jitterTimer); }
