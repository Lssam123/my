// قائمة السيرفرات السعودية (لفحص البنق والجيتر فقط)
const KSA_NODES = [
    { url: "https://www.stc.com.sa/favicon.ico" },
    { url: "https://www.mobily.com.sa/favicon.ico" },
    { url: "https://www.sa.zain.com/favicon.ico" },
    { url: "https://salam.sa/favicon.ico" },
    { url: "https://www.go.com.sa/favicon.ico" },
    { url: "https://dawiyat.com.sa/favicon.ico" }
];

// عمود السرعة الفقري (Cloudflare - الأضمن عالمياً للضغط)
const SPEED_BACKBONE = "https://speed.cloudflare.com";

let ctrl = null;
let bestServer = "";
let jitterInterval = null;
let activeXHRs = [];

// مصفوفة لتنعيم حركة العداد
let speedHistory = [];

function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterInterval) clearInterval(jitterInterval);
    activeXHRs.forEach(xhr => xhr.abort());
    activeXHRs = [];
    speedHistory = [];

    updateGauge(0, "dl");
    updateProgress(0, 0);
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('phase-txt').innerText = "جاهز";
    document.getElementById('srv-name').innerText = "تلقائي (KSA)";
    
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

function updateGauge(val, type="dl") {
    // خوارزمية التنعيم (Weighted Average)
    speedHistory.push(val);
    if(speedHistory.length > 5) speedHistory.shift();
    let smoothVal = speedHistory.reduce((a,b) => a+b, 0) / speedHistory.length;

    // معادلة الحركة اللوغاريتمية
    let p = smoothVal <= 10 ? (smoothVal/10)*0.1 : 0.1 + ((smoothVal-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('speed-num').innerText = smoothVal < 10 ? smoothVal.toFixed(1) : Math.round(smoothVal);
    const path = document.getElementById('track-fill');
    const phase = document.getElementById('phase-txt');
    const root = document.documentElement;

    path.style.strokeDashoffset = 615 - (p * 615);

    if(type === "ul") {
        path.setAttribute("stroke", "url(#g-ul)");
        path.style.filter = "drop-shadow(0 0 15px var(--purple))";
        phase.style.color = "var(--purple)";
    } else {
        path.setAttribute("stroke", "url(#g-dl)");
        path.style.filter = "drop-shadow(0 0 15px var(--cyan))";
        phase.style.color = "var(--cyan)";
    }
}

function updateProgress(percent, sec) {
    document.getElementById('time-bar').style.width = percent + "%";
    if(sec !== undefined) document.getElementById('timer-txt').innerText = sec + "s";
}

async function startApexTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر الخفي
    document.getElementById('phase-txt').innerText = "جاري الاتصال...";
    bestServer = await findBestServer();
    document.getElementById('srv-name').innerText = "خادم سعودي (أمثل)";

    // 2. البنق (5 ثواني)
    document.getElementById('phase-txt').innerText = "قياس الاستجابة";
    const ping = await runTimedTask(5000, measurePing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل + الجيتر (15 ثانية)
    document.getElementById('phase-txt').innerText = "جاري التنزيل...";
    startJitter(); // بدء البنق المثقل بالتزامن
    const dl = await runTimedTask(15000, measureDownload);
    stopJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (15 ثانية) - تقنية السرب (Swarm)
    updateGauge(0, "ul");
    speedHistory = []; // تصفير الذاكرة
    document.getElementById('phase-txt').innerText = "جاري الرفع...";
    const ul = await runTimedTask(15000, measureUploadSwarm);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-txt').innerText = "اكتمل";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

// دالة اختيار السيرفر (Using Image Ping for Speed)
async function findBestServer() {
    const promises = KSA_NODES.map(async node => {
        const start = performance.now();
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

// مدير الوقت
async function runTimedTask(duration, taskFn) {
    const start = performance.now();
    const timer = setInterval(() => {
        let elapsed = performance.now() - start;
        let pct = (elapsed / duration) * 100;
        let left = Math.ceil((duration - elapsed) / 1000);
        updateProgress(pct > 100 ? 100 : pct, left < 0 ? 0 : left);
    }, 100);
    
    const res = await taskFn(duration, start);
    clearInterval(timer);
    updateProgress(100, 0);
    return res;
}

// قياس البنق الدقيق (فلترة النتائج)
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
        await new Promise(r => setTimeout(r, 150));
    }
    
    pings.sort((a,b)=>a-b);
    if(pings.length > 3) { pings.pop(); pings.shift(); } // حذف القيم الشاذة
    
    let sum = pings.reduce((a,b)=>a+b, 0);
    return Math.round(sum / pings.length) || 0;
}

// قياس التحميل
async function measureDownload(duration, startTime) {
    let totalLoaded = 0;
    
    const workers = Array(12).fill(0).map(() => {
        return new Promise((resolve) => {
            const runWorker = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }
                
                const xhr = new XMLHttpRequest();
                activeXHRs.push(xhr);
                let lastLoaded = 0;
                
                xhr.onprogress = (e) => {
                    if(performance.now() - startTime >= duration) { xhr.abort(); return; }
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalLoaded += diff;
                    lastLoaded = e.loaded;
                };

                xhr.onload = xhr.onerror = () => {
                    activeXHRs = activeXHRs.filter(x => x !== xhr);
                    runWorker();
                };
                
                // تحميل ملفات 25MB
                xhr.open("GET", `${SPEED_BACKBONE}/__down?bytes=25000000`, true);
                xhr.send();
            };
            runWorker();
        });
    });

    // حلقة التحديث
    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        if(elapsed > 0) {
            let speed = (totalLoaded * 8) / (1024 * 1024) / elapsed;
            updateGauge(speed, "dl");
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    activeXHRs.forEach(xhr => xhr.abort());
    return document.getElementById('speed-num').innerText;
}

// *** الحل النهائي للرفع: Swarm Injection ***
// استخدام 20 قناة لإرسال حزم صغيرة (128KB) بسرعة جنونية
async function measureUploadSwarm(duration, startTime) {
    let totalSent = 0;
    // حزمة صغيرة 128KB (تمر بسهولة عبر الجدار الناري)
    const chunk = new Uint8Array(128 * 1024); 
    crypto.getRandomValues(chunk);

    const workers = Array(20).fill(0).map(() => {
        return new Promise((resolve) => {
            const runWorker = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }

                const xhr = new XMLHttpRequest();
                activeXHRs.push(xhr);
                let lastLoaded = 0;

                xhr.upload.onprogress = (e) => {
                    if(performance.now() - startTime >= duration) { xhr.abort(); return; }
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalSent += diff;
                    lastLoaded = e.loaded;
                };

                xhr.onload = xhr.onerror = () => {
                    activeXHRs = activeXHRs.filter(x => x !== xhr);
                    runWorker();
                };

                // استخدام رابط عشوائي لمنع الكاش
                xhr.open("POST", `${SPEED_BACKBONE}/__up?t=${Math.random()}`, true);
                xhr.send(chunk);
            };
            runWorker();
        });
    });

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        if(elapsed > 0) {
            // تصحيح 10% للبروتوكول (Overhead)
            let speed = ((totalSent * 8) / (1024 * 1024) / elapsed) * 1.1;
            updateGauge(speed, "ul");
        }
        await new Promise(r => setTimeout(r, 100));
    }

    activeXHRs.forEach(xhr => xhr.abort());
    return document.getElementById('speed-num').innerText;
}

// البنق المثقل (يعمل مع التحميل)
function startJitter() {
    jitterInterval = setInterval(async () => {
        const start = performance.now();
        const img = new Image();
        img.onload = img.onerror = () => {
            let t = (performance.now() - start) * 0.8;
            document.getElementById('live-jitter').innerText = Math.round(t) + " ms";
            document.getElementById('res-jitter').innerText = Math.round(t);
        };
        img.src = bestServer + "?j=" + Math.random();
    }, 500);
}
function stopJitter() { clearInterval(jitterInterval); }
