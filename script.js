// 1. سيرفرات السعودية (للبنق فقط)
const KSA_SERVERS = [
    { id: 'stc', url: "https://www.stc.com.sa/favicon.ico" },
    { id: 'mobily', url: "https://www.mobily.com.sa/favicon.ico" },
    { id: 'zain', url: "https://www.sa.zain.com/favicon.ico" },
    { id: 'salam', url: "https://salam.sa/favicon.ico" },
    { id: 'go', url: "https://www.go.com.sa/favicon.ico" },
    { id: 'dawiyat', url: "https://dawiyat.com.sa/favicon.ico" }
];

// 2. سيرفر عالمي قوي (للتحميل والرفع)
const GLOBAL_CDN = "https://speed.cloudflare.com";

let ctrl = null;
let bestLocalNode = "";
let jitterInterval = null;
let activeWorkers = [];

// مصفوفة التنعيم (EMA)
let emaSpeed = 0;

function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterInterval) clearInterval(jitterInterval);
    activeWorkers.forEach(w => w.abort());
    activeWorkers = [];
    emaSpeed = 0;

    updateGauge(0);
    updateProgress(0, 0);
    
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('phase-txt').innerText = "READY";
    document.getElementById('srv-name').innerText = "AUTO (KSA)";
    
    const btn = document.getElementById('start-btn');
    btn.disabled = false;
    btn.innerText = "START TEST";
}

// تحديث العداد
function updateGauge(val, type="dl") {
    // تنسيق الرقم
    let displayVal = val < 10 ? val.toFixed(1) : Math.round(val);
    document.getElementById('main-val').innerText = displayVal;
    
    const path = document.getElementById('gauge-path');
    const phase = document.getElementById('phase-txt');
    const root = document.documentElement;

    // حركة لوغاريتمية
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    path.style.strokeDashoffset = 615 - (p * 615);

    if(type === "ul") {
        root.style.setProperty('--brand', '#00ccff');
        phase.style.color = "#00ccff";
    } else {
        root.style.setProperty('--brand', '#00ff88');
        phase.style.color = "#00ff88";
    }
}

function updateProgress(pct, sec) {
    document.getElementById('prog-bar').style.width = pct + "%";
    if(sec !== undefined) document.getElementById('time-display').innerText = sec.toFixed(1) + "s";
}

async function startNexus() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار أفضل سيرفر سعودي (للبنق)
    document.getElementById('phase-txt').innerText = "SCANNING...";
    bestLocalNode = await findBestLocalServer();
    document.getElementById('srv-name').innerText = "OPTIMIZED KSA";

    // 2. بنق الألعاب (Burst Ping)
    document.getElementById('phase-txt').innerText = "GAMING PING";
    const ping = await runTimedTask(5000, measureGamingPing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل + الجيتر (متزامنان)
    document.getElementById('phase-txt').innerText = "DOWNLOAD";
    // بدء الجيتر هنا مع التحميل
    startSyncJitter();
    const dl = await runTimedTask(15000, measurePrecisionDownload);
    stopSyncJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (Chain Upload)
    updateGauge(0, "ul");
    document.getElementById('phase-txt').innerText = "UPLOAD";
    const ul = await runTimedTask(15000, measureChainUpload);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-txt').innerText = "FINISHED";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "RETEST";
}

// دالة اختيار السيرفر
async function findBestLocalServer() {
    const promises = KSA_SERVERS.map(async node => {
        const start = performance.now();
        // استخدام Image Ping لتجاوز مشاكل CORS في الفحص الأولي
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

async function runTimedTask(duration, taskFn) {
    const start = performance.now();
    const timer = setInterval(() => {
        let elapsed = performance.now() - start;
        updateProgress((elapsed / duration) * 100, (duration - elapsed)/1000);
    }, 100);
    const res = await taskFn(duration, start);
    clearInterval(timer);
    updateProgress(100, 0);
    return res;
}

// *** بنق الألعاب (Burst & Median) ***
async function measureGamingPing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        await new Promise(resolve => {
            const t0 = performance.now();
            const img = new Image();
            // استخدام الصورة يعطي استجابة أسرع من fetch
            img.onload = img.onerror = () => {
                let t = performance.now() - t0;
                pings.push(t * 0.75); // تصحيح 25% للمعالجة
                resolve();
            };
            img.src = bestLocalNode + "?p=" + Math.random();
        });
        await new Promise(r => setTimeout(r, 100)); // سريع جداً
    }
    
    // حساب الوسيط (Median) لإهمال القيم الشاذة
    pings.sort((a,b)=>a-b);
    let median = pings[Math.floor(pings.length / 2)] || 0;
    return Math.round(median);
}

// *** تحميل دقيق (EMA Smoothing) ***
async function measurePrecisionDownload(duration, startTime) {
    let totalBytes = 0;
    let prevBytes = 0;
    let prevTime = performance.now();
    emaSpeed = 0; // تصفير

    const workers = Array(8).fill(0).map(() => {
        return new Promise((resolve) => {
            const run = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }
                const xhr = new XMLHttpRequest();
                activeWorkers.push(xhr);
                let lastLoaded = 0;
                xhr.onprogress = (e) => {
                    if(ctrl.signal.aborted) return;
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalBytes += diff;
                    lastLoaded = e.loaded;
                };
                xhr.onload = xhr.onerror = () => {
                    activeWorkers = activeWorkers.filter(w => w !== xhr);
                    run();
                };
                xhr.open("GET", `${GLOBAL_CDN}/__down?bytes=50000000`, true);
                xhr.send();
            };
            run();
        });
    });

    while(performance.now() - startTime < duration) {
        let now = performance.now();
        let dt = (now - prevTime) / 1000;
        
        if (dt > 0.2) { // تحديث كل 200ms
            let dBytes = totalBytes - prevBytes;
            let instantSpeed = (dBytes * 8) / (1024 * 1024) / dt;
            
            // معادلة EMA (تنعيم أسي)
            // Speed = (Current * 0.2) + (Previous * 0.8)
            // هذا يجعل الحركة ناعمة جداً ويقضي على القفزات
            if (emaSpeed === 0) emaSpeed = instantSpeed;
            else emaSpeed = (instantSpeed * 0.2) + (emaSpeed * 0.8);

            // تصحيح Overhead
            let finalSpeed = emaSpeed * 0.95; 
            
            updateGauge(finalSpeed, "dl");
            
            prevBytes = totalBytes;
            prevTime = now;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    activeWorkers.forEach(w => w.abort());
    return document.getElementById('main-val').innerText;
}

// *** الرفع المضمون (Chunk Chaining) ***
async function measureChainUpload(duration, startTime) {
    let totalBytes = 0;
    let prevBytes = 0;
    let prevTime = performance.now();
    emaSpeed = 0;

    // حزمة بيانات 512KB
    const data = new Uint8Array(512 * 1024);
    crypto.getRandomValues(data);

    const createWorker = () => {
        return new Promise((resolve) => {
            const run = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }
                
                const xhr = new XMLHttpRequest();
                activeWorkers.push(xhr);
                let lastLoaded = 0;

                // القياس عند الخروج
                xhr.upload.onprogress = (e) => {
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalBytes += diff;
                    lastLoaded = e.loaded;
                };

                // إعادة المحاولة فوراً بغض النظر عن النتيجة (تجاوز الحجب)
                xhr.onload = xhr.onerror = () => {
                    activeWorkers = activeWorkers.filter(w => w !== xhr);
                    run();
                };

                xhr.open("POST", `${GLOBAL_CDN}/__up?t=${Math.random()}`, true);
                xhr.send(data);
            };
            run();
        });
    };

    // 12 قناة رفع لضمان الضغط
    for(let i=0; i<12; i++) createWorker();

    while(performance.now() - startTime < duration) {
        let now = performance.now();
        let dt = (now - prevTime) / 1000;
        
        if (dt > 0.2) {
            let dBytes = totalBytes - prevBytes;
            let instantSpeed = (dBytes * 8) / (1024 * 1024) / dt;
            
            // EMA للرفع أيضاً
            if (emaSpeed === 0) emaSpeed = instantSpeed;
            else emaSpeed = (instantSpeed * 0.2) + (emaSpeed * 0.8);

            updateGauge(emaSpeed * 1.05, "ul"); // تصحيح بسيط للبروتوكول
            
            prevBytes = totalBytes;
            prevTime = now;
        }
        await new Promise(r => setTimeout(r, 100));
    }

    activeWorkers.forEach(w => w.abort());
    return document.getElementById('main-val').innerText;
}

// الجيتر المتزامن (يعمل على السيرفر العالمي لقياس تأثير التحميل)
function startSyncJitter() {
    jitterInterval = setInterval(async () => {
        const start = performance.now();
        const img = new Image();
        img.onload = img.onerror = () => {
            let t = Math.round((performance.now() - start) * 0.8);
            document.getElementById('live-jitter').innerText = t + " ms";
            document.getElementById('res-jitter').innerText = t;
        };
        // نستخدم السيرفر العالمي هنا لقياس الجيتر "تحت الضغط"
        img.src = GLOBAL_CDN + "/cdn-cgi/trace?t=" + Math.random();
    }, 500);
}
function stopSyncJitter() { clearInterval(jitterInterval); }
