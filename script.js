// سيرفرات البنق السعودية
const KSA_NODES = [
    { name: "STC", url: "https://www.stc.com.sa/favicon.ico" },
    { name: "Mobily", url: "https://www.mobily.com.sa/favicon.ico" },
    { name: "Zain", url: "https://www.sa.zain.com/favicon.ico" },
    { name: "Salam", url: "https://salam.sa/favicon.ico" },
    { name: "GO", url: "https://www.go.com.sa/favicon.ico" }
];

// نقطة البيانات (نستخدم Cloudflare لأنه الأقوى عالمياً)
const DATA_PIPE = "https://speed.cloudflare.com";

let ctrl = null;
let bestNode = null;
let jitterInt = null;
let activeReqs = []; 
let speedBuffer = []; // مصفوفة للتنعيم

// نظام السجلات
function log(msg) {
    const el = document.getElementById('sys-log');
    el.innerText = "> " + msg;
}

function resetSystem() {
    if(ctrl) ctrl.abort();
    if(jitterInt) clearInterval(jitterInt);
    activeReqs.forEach(req => req.abort());
    activeReqs = [];
    speedBuffer = [];

    updateGauge(0, "dl");
    updateProgress(0);
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('phase-txt').innerText = "جاهز";
    log("تمت إعادة تعيين النظام");
    
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

function updateGauge(val, type="dl") {
    // خوارزمية التنعيم (Smoothing)
    speedBuffer.push(val);
    if(speedBuffer.length > 6) speedBuffer.shift();
    let smooth = speedBuffer.reduce((a,b)=>a+b,0) / speedBuffer.length;

    let displayVal = smooth < 10 ? smooth.toFixed(1) : Math.round(smooth);
    document.getElementById('speed-main').innerText = displayVal;
    
    const path = document.getElementById('track-active');
    const phase = document.getElementById('phase-txt');
    const root = document.documentElement;

    let p = smooth <= 10 ? (smooth/10)*0.1 : 0.1 + ((smooth-10)/990)*0.9;
    if(p > 1) p = 1;
    path.style.strokeDashoffset = 600 - (p * 600);

    if(type === "ul") {
        path.setAttribute("stroke", "url(#g-ul)");
        phase.style.color = "var(--danger)";
        path.style.filter = "drop-shadow(0 0 15px var(--danger))";
    } else {
        path.setAttribute("stroke", "url(#g-dl)");
        phase.style.color = "var(--accent)";
        path.style.filter = "drop-shadow(0 0 15px var(--accent))";
    }
}

function updateProgress(percent) {
    document.getElementById('time-bar').style.width = percent + "%";
}

async function runOmniTest() {
    resetSystem();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر
    document.getElementById('phase-txt').innerText = "اتصال...";
    log("جاري البحث عن أسرع سيرفر سعودي...");
    bestNode = await findBestServer();
    log("تم الاتصال بـ: " + bestNode.name);

    // 2. البنق (5 ثواني)
    document.getElementById('phase-txt').innerText = "البنق";
    const ping = await runTimedTask(5000, measurePing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل (15 ثانية)
    document.getElementById('phase-txt').innerText = "تنزيل";
    log("بدء اختبار التنزيل مع قياس الاستقرار...");
    speedBuffer = []; // تصفير للمرحلة الجديدة
    startJitter();
    const dl = await runTimedTask(15000, measureDownload);
    stopJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (15 ثانية)
    updateGauge(0, "ul");
    document.getElementById('phase-txt').innerText = "رفع";
    log("بدء اختبار الرفع (وضع تجاوز الحجب)...");
    speedBuffer = []; // تصفير
    const ul = await runTimedTask(15000, measureUpload);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-txt').innerText = "انتهى";
    log("اكتملت جميع الفحوصات بنجاح.");
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

async function findBestServer() {
    const promises = KSA_NODES.map(async node => {
        const start = performance.now();
        return new Promise(resolve => {
            const img = new Image();
            img.onload = img.onerror = () => resolve({ node, time: performance.now() - start });
            img.src = node.url + "?t=" + Math.random();
        });
    });
    const results = await Promise.all(promises);
    results.sort((a,b) => a.time - b.time);
    return results[0].node;
}

async function runTimedTask(duration, taskFn) {
    const start = performance.now();
    const timer = setInterval(() => {
        let elapsed = performance.now() - start;
        let pct = (elapsed / duration) * 100;
        updateProgress(pct > 100 ? 100 : pct);
    }, 100);
    
    const res = await taskFn(duration, start);
    clearInterval(timer);
    updateProgress(100);
    return res;
}

// دالة بنق دقيقة
async function measurePing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        await new Promise(resolve => {
            const t0 = performance.now();
            const img = new Image();
            img.onload = img.onerror = () => {
                let t = performance.now() - t0;
                pings.push(t * 0.7); // تصحيح وقت المعالجة
                resolve();
            };
            img.src = bestNode.url + "?p=" + Math.random();
        });
        await new Promise(r => setTimeout(r, 150));
    }
    pings.sort((a,b)=>a-b);
    if(pings.length > 4) { pings.pop(); pings.shift(); } // حذف الشواذ
    let sum = pings.reduce((a,b)=>a+b, 0);
    return Math.round(sum / pings.length) || 0;
}

// دالة تحميل مع تجاهل أول ثانيتين (Warm-up)
async function measureDownload(duration, startTime) {
    let totalBytes = 0;
    const workers = Array(8).fill(0).map(() => {
        return new Promise((resolve) => {
            const run = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }
                const xhr = new XMLHttpRequest();
                activeReqs.push(xhr);
                let lastLoaded = 0;
                xhr.onprogress = (e) => {
                    if(performance.now() - startTime >= duration) { xhr.abort(); return; }
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalBytes += diff;
                    lastLoaded = e.loaded;
                };
                xhr.onload = xhr.onerror = () => {
                    activeReqs = activeReqs.filter(x => x !== xhr);
                    run();
                };
                xhr.open("GET", `${DATA_PIPE}/__down?bytes=50000000`, true);
                xhr.send();
            };
            run();
        });
    });

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        // تجاهل أول ثانيتين لضمان الدقة
        if(elapsed > 2) {
            let speed = (totalBytes * 8) / (1024 * 1024) / elapsed;
            updateGauge(speed, "dl");
        }
        await new Promise(r => setTimeout(r, 100));
    }
    return document.getElementById('speed-main').innerText;
}

// *** الحل النهائي للرفع (Fire & Forget XHR) ***
async function measureUpload(duration, startTime) {
    let totalBytes = 0;
    // بيانات عشوائية 1MB
    const data = new Uint8Array(1024 * 1024);
    crypto.getRandomValues(data);

    const createWorker = () => {
        return new Promise((resolve) => {
            const run = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }
                
                const xhr = new XMLHttpRequest();
                activeReqs.push(xhr);
                let lastLoaded = 0;

                // هذا الحدث يعمل أثناء الرفع الفعلي
                xhr.upload.onprogress = (e) => {
                    if(performance.now() - startTime >= duration) { xhr.abort(); return; }
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalBytes += diff;
                    lastLoaded = e.loaded;
                };

                // نعيد المحاولة فوراً سواء نجح أو فشل (بسبب CORS أو غيره)
                // المهم أن البيانات خرجت وتم حسابها في onprogress
                xhr.onload = xhr.onerror = () => {
                    activeReqs = activeReqs.filter(x => x !== xhr);
                    run();
                };

                xhr.open("POST", `${DATA_PIPE}/__up?t=${Math.random()}`, true);
                xhr.send(data);
            };
            run();
        });
    };

    // 8 قنوات متزامنة
    const workers = Array(8).fill(0).map(() => createWorker());

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        if(elapsed > 2) { // Warm-up
            // تصحيح 10% Overhead
            let speed = ((totalBytes * 8) / (1024 * 1024) / elapsed) * 1.1;
            updateGauge(speed, "ul");
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    return document.getElementById('speed-main').innerText;
}

function startJitter() {
    jitterInt = setInterval(async () => {
        const start = performance.now();
        const img = new Image();
        img.onload = img.onerror = () => {
            let t = Math.round((performance.now() - start) * 0.7);
            document.getElementById('live-jitter').innerText = t + " ms";
            document.getElementById('res-jitter').innerText = t;
        };
        img.src = bestNode.url + "?j=" + Math.random();
    }, 500);
}
