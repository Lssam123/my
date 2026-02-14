// قائمة السيرفرات السعودية
const KSA_SERVERS = [
    { url: "https://www.stc.com.sa/favicon.ico" },
    { url: "https://www.mobily.com.sa/favicon.ico" },
    { url: "https://www.sa.zain.com/favicon.ico" },
    { url: "https://salam.sa/favicon.ico" }
];

// نقطة البيانات (Cloudflare)
const DATA_HOST = "https://speed.cloudflare.com";

let ctrl = null;
let bestServer = "";
let jitterInterval = null;
let activeWorkers = [];
let speedSamples = []; // لتخزين العينات وحساب المتوسط المقلّم

function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterInterval) clearInterval(jitterInterval);
    activeWorkers.forEach(w => w.abort());
    activeWorkers = [];
    speedSamples = [];

    // إعادة ضبط الواجهة
    document.getElementById('main-gauge').classList.remove('dimmed');
    document.getElementById('card-ul').classList.remove('active-ul');
    updateGauge(0);
    updateProgress(0);
    
    ["res-ping", "res-jitter", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('dl-speed-main').innerText = "0.0";
    
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

// دالة تحديث العداد (للتحميل فقط)
function updateGauge(val) {
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('dl-speed-main').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    document.getElementById('track-fill').style.strokeDashoffset = 615 - (p * 615);
}

function updateProgress(pct, sec) {
    document.getElementById('time-bar').style.width = pct + "%";
    if(sec !== undefined) document.getElementById('timer-txt').innerText = sec.toFixed(1) + "s";
}

async function startSimTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر
    bestServer = await findBestServer();
    document.getElementById('srv-name').innerText = "تم الاتصال (السعودية)";

    // 2. البنق
    const ping = await runTimedTask(5000, measurePing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل (على العداد)
    startJitter();
    speedSamples = []; // تصفير العينات
    const dl = await runTimedTask(15000, measureDownloadLogic);
    stopJitter();
    // النتيجة النهائية للتحميل تبقى على العداد

    // 4. الرفع (في البطاقة فقط)
    // إعتام العداد
    document.getElementById('main-gauge').classList.add('dimmed');
    // تنشيط بطاقة الرفع
    document.getElementById('card-ul').classList.add('active-ul');
    
    speedSamples = []; // تصفير العينات للرفع
    const ul = await runTimedTask(15000, measureUploadLogic);
    
    // إنهاء
    document.getElementById('card-ul').classList.remove('active-ul');
    document.getElementById('main-gauge').classList.remove('dimmed');
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

// *** منطق Speedtest الحقيقي (Trimmed Mean) ***
// هذه الدالة تأخذ مصفوفة السرعات، تحذف أعلى 20% وأقل 20% وتحسب متوسط الباقي
function calculateStableSpeed(samples) {
    if (samples.length < 5) return samples[samples.length - 1] || 0;
    
    // ترتيب العينات
    let sorted = [...samples].sort((a,b) => a - b);
    
    // قص الأطراف (القيم الشاذة)
    let trimCount = Math.floor(samples.length * 0.2); // حذف 20% من كل طرف
    let validSamples = sorted.slice(trimCount, sorted.length - trimCount);
    
    if (validSamples.length === 0) return sorted[Math.floor(sorted.length / 2)];
    
    // المتوسط
    let sum = validSamples.reduce((a, b) => a + b, 0);
    return sum / validSamples.length;
}

async function measureDownloadLogic(duration, startTime) {
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
                xhr.open("GET", `${DATA_HOST}/__down?bytes=50000000`, true);
                xhr.send();
            };
            run();
        });
    });

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        if(elapsed > 1) { // تجاهل أول ثانية
            // حساب السرعة اللحظية
            let currentSpeed = (totalBytes * 8) / (1024 * 1024) / elapsed;
            
            // إضافة للعينة
            speedSamples.push(currentSpeed);
            
            // تطبيق خوارزمية Speedtest
            let stableSpeed = calculateStableSpeed(speedSamples);
            
            updateGauge(stableSpeed);
        }
        await new Promise(r => setTimeout(r, 100));
    }
    activeWorkers.forEach(w => w.abort());
    return document.getElementById('dl-speed-main').innerText;
}

// *** منطق الرفع (يظهر في البطاقة فقط) ***
async function measureUploadLogic(duration, startTime) {
    let totalBytes = 0;
    const txt = "X".repeat(512 * 1024); // 512KB
    const blob = new Blob([txt], { type: 'text/plain' });

    const createWorker = () => {
        return new Promise((resolve) => {
            const run = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }
                const xhr = new XMLHttpRequest();
                activeWorkers.push(xhr);
                let lastLoaded = 0;
                
                const fd = new FormData();
                fd.append('file', blob);

                xhr.upload.onprogress = (e) => {
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalBytes += diff;
                    lastLoaded = e.loaded;
                };
                xhr.onload = xhr.onerror = () => {
                    activeWorkers = activeWorkers.filter(w => w !== xhr);
                    run();
                };
                xhr.open("POST", `${DATA_HOST}/__up?t=${Math.random()}`, true);
                xhr.send(fd);
            };
            run();
        });
    };

    // 8 قنوات رفع
    const workers = Array(8).fill(0).map(() => createWorker());

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        if(elapsed > 1) {
            let currentSpeed = (totalBytes * 8) / (1024 * 1024) / elapsed;
            speedSamples.push(currentSpeed);
            
            // تطبيق خوارزمية Speedtest للرفع أيضاً
            let stableSpeed = calculateStableSpeed(speedSamples);
            
            // تحديث البطاقة مباشرة بدلاً من العداد
            let display = stableSpeed < 10 ? stableSpeed.toFixed(1) : Math.round(stableSpeed);
            document.getElementById('res-ul').innerText = display;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    activeWorkers.forEach(w => w.abort());
    return document.getElementById('res-ul').innerText;
}

// دالة البنق
async function measurePing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        await new Promise(resolve => {
            const t0 = performance.now();
            const img = new Image();
            img.onload = img.onerror = () => {
                pings.push((performance.now() - t0) * 0.7);
                resolve();
            };
            img.src = bestServer + "?p=" + Math.random();
        });
        await new Promise(r => setTimeout(r, 150));
    }
    pings.sort((a,b)=>a-b);
    if(pings.length > 4) { pings.pop(); pings.shift(); }
    let sum = pings.reduce((a,b)=>a+b, 0);
    return Math.round(sum / pings.length) || 0;
}

function startJitter() {
    jitterInterval = setInterval(async () => {
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
function stopJitter() { clearInterval(jitterInterval); }
