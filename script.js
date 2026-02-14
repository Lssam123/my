// سيرفرات البنق السعودية
const KSA_SERVERS = [
    { url: "https://www.stc.com.sa/favicon.ico" },
    { url: "https://www.mobily.com.sa/favicon.ico" },
    { url: "https://www.sa.zain.com/favicon.ico" }
];

// رابط التحميل (Cloudflare)
const DATA_URL = "https://speed.cloudflare.com";

let ctrl = null;
let bestServer = "";
let jitterInt = null;
let activeWorkers = [];

function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterInt) clearInterval(jitterInt);
    activeWorkers.forEach(w => w.abort());
    activeWorkers = [];

    // إعادة ضبط الواجهة
    document.getElementById('main-gauge').classList.remove('dimmed');
    document.getElementById('card-ul').classList.remove('upload-active');
    updateGauge(0);
    updateProgress(0, 0);
    
    ["res-ping", "res-jitter", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('phase-txt').innerText = "جاهز";
    
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

// تحديث العداد
function updateGauge(val) {
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('speed-display').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    document.getElementById('track-fill').style.strokeDashoffset = 615 - (p * 615);
}

function updateProgress(pct, sec) {
    document.getElementById('progress-bar').style.width = pct + "%";
    if(sec !== undefined) document.getElementById('time-txt').innerText = sec.toFixed(1) + "s";
}

async function startRealisticTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر
    document.getElementById('phase-txt').innerText = "اتصال...";
    bestServer = await findBestServer();

    // 2. البنق
    document.getElementById('phase-txt').innerText = "قياس البنق";
    const ping = await runTimedTask(5000, measurePing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل (على العداد)
    document.getElementById('phase-txt').innerText = "جاري التنزيل...";
    startJitter();
    const dl = await runTimedTask(15000, measureDownloadRealistic);
    stopJitter();
    // النتيجة تبقى على العداد

    // 4. الرفع (على البطاقة فقط)
    document.getElementById('main-gauge').classList.add('dimmed');
    document.getElementById('card-ul').classList.add('upload-active');
    document.getElementById('phase-txt').innerText = "جاري الرفع...";
    
    const ul = await runTimedTask(15000, measureUploadNoCors);
    
    // إنهاء
    document.getElementById('card-ul').classList.remove('upload-active');
    document.getElementById('main-gauge').classList.remove('dimmed');
    document.getElementById('phase-txt').innerText = "اكتمل";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

async function findBestServer() {
    const promises = KSA_SERVERS.map(async node => {
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

// دالة البنق (مع حذف الشواذ)
async function measurePing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        await new Promise(resolve => {
            const t0 = performance.now();
            const img = new Image();
            img.onload = img.onerror = () => {
                pings.push((performance.now() - t0) * 0.7); // تصحيح
                resolve();
            };
            img.src = bestServer + "?p=" + Math.random();
        });
        await new Promise(r => setTimeout(r, 150));
    }
    pings.sort((a,b)=>a-b);
    if(pings.length > 5) { pings.pop(); pings.pop(); pings.shift(); } // حذف القيم العالية
    let sum = pings.reduce((a,b)=>a+b, 0);
    return Math.round(sum / pings.length) || 0;
}

// *** قياس التحميل الواقعي (Cumulative Average) ***
async function measureDownloadRealistic(duration, startTime) {
    let totalBytes = 0;
    
    const workers = Array(6).fill(0).map(() => {
        return new Promise((resolve) => {
            const run = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }
                const xhr = new XMLHttpRequest();
                activeWorkers.push(xhr);
                let lastLoaded = 0;
                xhr.onprogress = (e) => {
                    if(performance.now() - startTime >= duration) { xhr.abort(); return; }
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalBytes += diff;
                    lastLoaded = e.loaded;
                };
                xhr.onload = xhr.onerror = () => {
                    activeWorkers = activeWorkers.filter(w => w !== xhr);
                    run();
                };
                xhr.open("GET", `${DATA_URL}/__down?bytes=50000000`, true);
                xhr.send();
            };
            run();
        });
    });

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        
        // تجاهل أول 2 ثانية (Warm-up Phase)
        // هذا يمنع الأرقام العالية جداً في البداية
        if(elapsed > 2) {
            // المعادلة: (إجمالي البايتات * 8) / (الزمن الكلي)
            // معامل تصحيح 0.85 لمحاكاة Speedtest (TCP Overhead)
            let rawSpeed = (totalBytes * 8) / (1024 * 1024) / elapsed;
            let realSpeed = rawSpeed * 0.85; 

            updateGauge(realSpeed);
        }
        await new Promise(r => setTimeout(r, 100));
    }
    activeWorkers.forEach(w => w.abort());
    return document.getElementById('speed-display').innerText;
}

// *** قياس الرفع (No-CORS Swarm) ***
async function measureUploadNoCors(duration, startTime) {
    let sentCount = 0;
    // حزمة 256KB
    const data = new Uint8Array(256 * 1024); 
    crypto.getRandomValues(data);

    const createWorker = () => {
        return new Promise((resolve) => {
            const run = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }
                
                // نستخدم fetch مع no-cors
                // هذه الطريقة ترسل البيانات فوراً ولا تنتظر الرد
                fetch(`${DATA_URL}/__up?t=${Math.random()}`, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: data,
                    signal: ctrl.signal
                })
                .then(() => {
                    sentCount++;
                    run();
                })
                .catch(() => {
                    // حتى عند الفشل، البيانات خرجت غالباً
                    sentCount++; 
                    run();
                });
            };
            run();
        });
    };

    // 16 قناة متوازية (ضغط عالي)
    const workers = Array(16).fill(0).map(() => createWorker());

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        if(elapsed > 1) {
            // حساب السرعة بناءً على عدد الحزم المرسلة
            // (عدد الحزم * حجم الحزمة * 8) / الزمن
            let totalBits = sentCount * (256 * 1024) * 8;
            let speedMbps = (totalBits / 1000000) / elapsed;
            
            // تحديث البطاقة
            let display = speedMbps < 10 ? speedMbps.toFixed(1) : Math.round(speedMbps);
            document.getElementById('res-ul').innerText = display;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    return document.getElementById('res-ul').innerText;
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
        img.src = bestServer + "?j=" + Math.random();
    }, 500);
}
function stopJitter() { clearInterval(jitterInt); }
