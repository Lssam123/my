// سيرفرات البنق السعودية (للحصول على بنق الألعاب)
const KSA_SERVERS = [
    { url: "https://www.stc.com.sa/favicon.ico" },
    { url: "https://www.mobily.com.sa/favicon.ico" },
    { url: "https://www.sa.zain.com/favicon.ico" },
    { url: "https://salam.sa/favicon.ico" },
    { url: "https://www.go.com.sa/favicon.ico" }
];

// السيرفر العالمي للضغط (Global Anycast)
const GLOBAL_CDN = "https://speed.cloudflare.com";

let ctrl = null;
let bestServerUrl = "";
let jitterInt = null;
let activeWorkers = [];
// مصفوفة لتخزين متوسط السرعات لضمان الاستقرار
let speedBuffer = [];

function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterInt) clearInterval(jitterInt);
    activeWorkers.forEach(w => w.abort());
    activeWorkers = [];
    speedBuffer = [];

    updateGauge(0);
    updateProgress(0, 0);
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('phase-txt').innerText = "جاهز";
    document.getElementById('srv-display').innerText = "تلقائي (KSA)";
    
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

function updateGauge(val, type="dl") {
    // استخدام المتوسط لتقليل الاهتزاز
    speedBuffer.push(val);
    if(speedBuffer.length > 5) speedBuffer.shift();
    let smoothVal = speedBuffer.reduce((a,b)=>a+b,0) / speedBuffer.length;

    let display = smoothVal < 10 ? smoothVal.toFixed(1) : Math.round(smoothVal);
    document.getElementById('speed-main').innerText = display;
    
    const path = document.getElementById('gauge-path');
    const phase = document.getElementById('phase-txt');
    const root = document.documentElement;

    let p = smoothVal <= 10 ? (smoothVal/10)*0.1 : 0.1 + ((smoothVal-10)/990)*0.9;
    if(p > 1) p = 1;
    path.style.strokeDashoffset = 615 - (p * 615);

    if(type === "ul") {
        root.style.setProperty('--dl', '#ff0050'); // أحمر للرفع
        phase.style.color = "#ff0050";
    } else {
        root.style.setProperty('--dl', '#00f2ea'); // سماوي للتحميل
        phase.style.color = "#00f2ea";
    }
}

function updateProgress(pct, sec) {
    document.getElementById('progress').style.width = pct + "%";
    if(sec !== undefined) document.getElementById('timer').innerText = sec.toFixed(1) + "s";
}

async function startOrbitalTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر السعودي
    document.getElementById('phase-txt').innerText = "جاري الاتصال...";
    bestServerUrl = await findBestServer();
    document.getElementById('srv-display').innerText = "أفضل خادم سعودي";

    // 2. بنق الألعاب (Burst Mode)
    document.getElementById('phase-txt').innerText = "قياس الاستجابة";
    const ping = await runTimedTask(5000, measureGamePing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل (Global Saturation)
    document.getElementById('phase-txt').innerText = "جاري التنزيل...";
    speedBuffer = []; // تصفير
    startSyncJitter(); // تشغيل الجيتر
    const dl = await runTimedTask(15000, measureGlobalDownload);
    stopSyncJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (Blind Pulse)
    updateGauge(0, "ul");
    document.getElementById('phase-txt').innerText = "جاري الرفع...";
    speedBuffer = []; // تصفير
    const ul = await runTimedTask(15000, measureBlindUpload);
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

// قياس بنق دقيق (Median of Bursts)
async function measureGamePing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        await new Promise(resolve => {
            const t0 = performance.now();
            const img = new Image();
            img.onload = img.onerror = () => {
                let t = performance.now() - t0;
                pings.push(t * 0.8); // تصحيح وقت المعالجة
                resolve();
            };
            img.src = bestServerUrl + "?p=" + Math.random();
        });
        await new Promise(r => setTimeout(r, 100)); // Burst سريع
    }
    pings.sort((a,b)=>a-b);
    let median = pings[Math.floor(pings.length / 2)] || 0;
    return Math.round(median);
}

// *** منطق التحميل المشبع (16 Stream Saturation) ***
async function measureGlobalDownload(duration, startTime) {
    let totalBytes = 0;
    let prevBytes = 0;
    let prevTime = performance.now();

    // نفتح 16 قناة (مثل Speedtest)
    const workers = Array(16).fill(0).map(() => {
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
                    run(); // إعادة التشغيل فوراً لضمان الإشباع
                };
                
                // طلب ملف ضخم 50MB لكل قناة
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
            let speed = (dBytes * 8) / (1024 * 1024) / dt;
            
            // تجاهل القفزات غير المنطقية (أكبر من 1000 مثلاً في البداية)
            if(speed > 0 && speed < 5000) {
                updateGauge(speed, "dl");
            }
            
            prevBytes = totalBytes;
            prevTime = now;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    activeWorkers.forEach(w => w.abort());
    return document.getElementById('speed-main').innerText;
}

// *** الحل النهائي للرفع: Blind Pulse (تجاهل الأخطاء) ***
async function measureBlindUpload(duration, startTime) {
    let totalBytes = 0;
    let prevBytes = 0;
    let prevTime = performance.now();

    // حزمة 512KB
    const data = new Uint8Array(512 * 1024);
    crypto.getRandomValues(data);

    const createWorker = () => {
        return new Promise((resolve) => {
            const run = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }

                const xhr = new XMLHttpRequest();
                activeWorkers.push(xhr);
                let lastLoaded = 0;

                // نحسب البيانات وهي تخرج
                xhr.upload.onprogress = (e) => {
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalBytes += diff;
                    lastLoaded = e.loaded;
                };

                // السر هنا: نعيد المحاولة فوراً سواء نجح أو فشل
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

    // 12 قناة رفع متوازية
    for(let i=0; i<12; i++) createWorker();

    while(performance.now() - startTime < duration) {
        let now = performance.now();
        let dt = (now - prevTime) / 1000;
        
        if (dt > 0.2) {
            let dBytes = totalBytes - prevBytes;
            let speed = (dBytes * 8) / (1024 * 1024) / dt;
            
            // تصحيح بروتوكول بسيط
            updateGauge(speed * 1.05, "ul");
            
            prevBytes = totalBytes;
            prevTime = now;
        }
        await new Promise(r => setTimeout(r, 100));
    }

    activeWorkers.forEach(w => w.abort());
    return document.getElementById('speed-main').innerText;
}

// الجيتر المتزامن (يعمل على السيرفر العالمي)
function startSyncJitter() {
    jitterInt = setInterval(async () => {
        const start = performance.now();
        const img = new Image();
        img.onload = img.onerror = () => {
            let t = Math.round((performance.now() - start) * 0.8);
            document.getElementById('live-jitter').innerText = t + " ms";
            document.getElementById('res-jitter').innerText = t;
        };
        // نضرب السيرفر العالمي لمعرفة تأثير التحميل عليه
        img.src = GLOBAL_CDN + "/cdn-cgi/trace?t=" + Math.random();
    }, 500);
}
function stopSyncJitter() { clearInterval(jitterInt); }
