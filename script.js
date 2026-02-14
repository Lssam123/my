// سيرفرات البنق السعودية
const KSA_SERVERS = [
    { url: "https://www.stc.com.sa/favicon.ico" },
    { url: "https://www.mobily.com.sa/favicon.ico" },
    { url: "https://www.sa.zain.com/favicon.ico" },
    { url: "https://salam.sa/favicon.ico" }
];

// Cloudflare للسرعة
const SPEED_HOST = "https://speed.cloudflare.com";

let ctrl = null;
let bestPingNode = "";
let jitterTimer = null;
let activeWorkers = []; // لتخزين الطلبات النشطة

function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterTimer) clearInterval(jitterTimer);
    activeWorkers.forEach(w => w.abort());
    activeWorkers = [];

    updateGauge(0, "dl");
    updateProgress(0);
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('phase-txt').innerText = "جاهز";
    document.getElementById('srv-txt').innerText = "تلقائي (KSA)";
    document.getElementById('conn-count').innerText = "Threads: 0";
    
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

function updateGauge(val, type="dl") {
    let displayVal = val < 10 ? val.toFixed(1) : Math.round(val);
    document.getElementById('speed-big').innerText = displayVal;
    
    const path = document.getElementById('track-fill');
    const phase = document.getElementById('phase-txt');
    const root = document.documentElement;

    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    path.style.strokeDashoffset = 615 - (p * 615);

    if(type === "ul") {
        path.setAttribute("stroke", "url(#g-ul)");
        path.style.filter = "drop-shadow(0 0 20px var(--speed-ul))";
        phase.style.color = "var(--speed-ul)";
    } else {
        path.setAttribute("stroke", "url(#g-dl)");
        path.style.filter = "drop-shadow(0 0 20px var(--speed-dl))";
        phase.style.color = "var(--speed-dl)";
    }
}

function updateProgress(percent) {
    document.getElementById('time-bar').style.width = percent + "%";
}

async function startTurboTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر
    document.getElementById('phase-txt').innerText = "اتصال...";
    bestPingNode = await findBestServer();
    document.getElementById('srv-txt').innerText = "تم الاتصال";

    // 2. البنق
    document.getElementById('phase-txt').innerText = "PING";
    const ping = await runTimer(5000, measurePing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل (منطق التوربو)
    document.getElementById('phase-txt').innerText = "DOWNLOAD";
    startJitter();
    const dl = await runTimer(15000, measureTurboDownload);
    stopJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (منطق القوة الغاشمة)
    updateGauge(0, "ul");
    document.getElementById('phase-txt').innerText = "UPLOAD";
    const ul = await runTimer(15000, measureBruteUpload);
    document.getElementById('res-ul').innerText = ul;

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

async function runTimer(duration, fn) {
    const start = performance.now();
    const timer = setInterval(() => {
        let elapsed = performance.now() - start;
        updateProgress((elapsed / duration) * 100);
    }, 100);
    const res = await fn(duration, start);
    clearInterval(timer);
    updateProgress(100);
    return res;
}

async function measurePing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        await new Promise(resolve => {
            const t0 = performance.now();
            const img = new Image();
            img.onload = img.onerror = () => {
                let t = performance.now() - t0;
                pings.push(t * 0.7); // تصحيح 30%
                resolve();
            };
            img.src = bestPingNode + "?p=" + Math.random();
        });
        await new Promise(r => setTimeout(r, 100));
    }
    pings.sort((a,b)=>a-b);
    if(pings.length > 5) { pings.pop(); pings.shift(); }
    let sum = pings.reduce((a,b)=>a+b, 0);
    return Math.round(sum / pings.length) || 0;
}

// *** منطق التحميل التوربيني (Speedtest Logic) ***
async function measureTurboDownload(duration, startTime) {
    let totalBytes = 0;
    let connections = 4; // نبدأ بـ 4
    let lastLoadedMap = new Map(); // لتتبع كل اتصال

    const spawnWorker = () => {
        const xhr = new XMLHttpRequest();
        activeWorkers.push(xhr);
        lastLoadedMap.set(xhr, 0);
        
        xhr.onprogress = (e) => {
            if(ctrl.signal.aborted) return;
            let last = lastLoadedMap.get(xhr);
            let diff = e.loaded - last;
            if(diff > 0) totalBytes += diff;
            lastLoadedMap.set(xhr, e.loaded);
        };
        
        xhr.onload = xhr.onerror = () => {
            activeWorkers = activeWorkers.filter(w => w !== xhr);
            lastLoadedMap.delete(xhr);
            // إذا لم ينته الوقت، افتح واحداً جديداً
            if(performance.now() - startTime < duration) spawnWorker();
        };

        xhr.open("GET", `${SPEED_HOST}/__down?bytes=50000000`, true);
        xhr.send();
    };

    // البدء بـ 4
    for(let i=0; i<4; i++) spawnWorker();

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        
        // حساب السرعة الحالية
        let speed = (totalBytes * 8) / (1024 * 1024) / elapsed;
        
        // *** منطق التدرج (Ramping) ***
        // إذا السرعة عالية، نزيد عدد الاتصالات
        if(speed > 50 && connections < 8) { connections = 8; for(let i=0; i<4; i++) spawnWorker(); }
        if(speed > 100 && connections < 16) { connections = 16; for(let i=0; i<8; i++) spawnWorker(); }
        if(speed > 300 && connections < 24) { connections = 24; for(let i=0; i<8; i++) spawnWorker(); }
        
        document.getElementById('conn-count').innerText = "Threads: " + activeWorkers.length;
        
        if(elapsed > 1.5) updateGauge(speed, "dl");
        await new Promise(r => setTimeout(r, 100));
    }

    activeWorkers.forEach(w => w.abort());
    return document.getElementById('speed-big').innerText;
}

// *** منطق الرفع بالقوة الغاشمة (Brute Force Upload) ***
async function measureBruteUpload(duration, startTime) {
    let totalBytes = 0;
    // بيانات عشوائية 1MB
    const data = new Uint8Array(1024 * 1024);
    crypto.getRandomValues(data);
    
    // خريطة لتتبع التقدم
    let lastLoadedMap = new Map();

    const spawnUploader = () => {
        const xhr = new XMLHttpRequest();
        activeWorkers.push(xhr);
        lastLoadedMap.set(xhr, 0);

        // مراقبة الخروج من الجهاز
        xhr.upload.onprogress = (e) => {
            let last = lastLoadedMap.get(xhr);
            let diff = e.loaded - last;
            if(diff > 0) totalBytes += diff;
            lastLoadedMap.set(xhr, e.loaded);
        };

        // عند الفشل أو النجاح، أعد المحاولة فوراً
        xhr.onload = xhr.onerror = () => {
            activeWorkers = activeWorkers.filter(w => w !== xhr);
            lastLoadedMap.delete(xhr);
            if(performance.now() - startTime < duration) spawnUploader();
        };

        // Timeout قصير جداً (2 ثانية) لقتل الاتصالات الميتة
        xhr.timeout = 2000; 
        xhr.ontimeout = () => { xhr.abort(); };

        xhr.open("POST", `${SPEED_HOST}/__up?t=${Math.random()}`, true);
        xhr.send(data);
    };

    // ابدأ بـ 8 قنوات فوراً (لإجبار الشبكة)
    for(let i=0; i<8; i++) spawnUploader();

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        
        // إذا السرعة منخفضة جداً، أضف قنوات إضافية
        let speed = (totalBytes * 8) / (1024 * 1024) / elapsed;
        if(elapsed > 2 && speed < 1 && activeWorkers.length < 16) {
            spawnUploader(); spawnUploader(); // أضف 2
        }

        document.getElementById('conn-count').innerText = "Threads: " + activeWorkers.length;

        if(elapsed > 1.5) {
            // تصحيح بسيط للبروتوكول
            updateGauge(speed * 1.05, "ul");
        }
        await new Promise(r => setTimeout(r, 100));
    }

    activeWorkers.forEach(w => w.abort());
    return document.getElementById('speed-big').innerText;
}

function startJitter() {
    jitterInt = setInterval(async () => {
        const start = performance.now();
        const img = new Image();
        img.onload = img.onerror = () => {
            let t = Math.round((performance.now() - start) * 0.8);
            document.getElementById('live-jitter').innerText = t + " ms";
            document.getElementById('res-jitter').innerText = t;
        };
        img.src = bestPingNode + "?j=" + Math.random();
    }, 500);
}
function stopJitter() { clearInterval(jitterInt); }
