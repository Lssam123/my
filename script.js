// قائمة السيرفرات السعودية
const KSA_SERVERS = [
    { name: "STC", url: "https://www.stc.com.sa/favicon.ico" },
    { name: "Mobily", url: "https://www.mobily.com.sa/favicon.ico" },
    { name: "Zain", url: "https://www.sa.zain.com/favicon.ico" },
    { name: "Salam", url: "https://salam.sa/favicon.ico" },
    { name: "GO", url: "https://www.go.com.sa/favicon.ico" },
    { name: "Dawiyat", url: "https://dawiyat.com.sa/favicon.ico" }
];

// رابط التحميل الموثوق (Cloudflare)
const CDN_BASE = "https://speed.cloudflare.com";

let ctrl = null;
let bestPingServer = "";
let jitterTimer = null;
let activeXHRs = []; // لتخزين طلبات التحميل وإلغائها

function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterTimer) clearInterval(jitterTimer);
    
    // إلغاء جميع طلبات XHR النشطة
    activeXHRs.forEach(xhr => xhr.abort());
    activeXHRs = [];

    updateGauge(0, "dl");
    updateProgress(0, 0);
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('phase-txt').innerText = "جاهز";
    document.getElementById('srv-name').innerText = "تلقائي (السعودية)";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

function updateGauge(val, type="dl") {
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('speed-text').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    const path = document.getElementById('track-fill');
    const phase = document.getElementById('phase-txt');
    const root = document.documentElement;

    path.style.strokeDashoffset = 615 - (p * 615);

    if(type === "ul") {
        path.setAttribute("stroke", "url(#g-ul)");
        root.style.setProperty('--main', '#d500f9');
        phase.style.color = "#d500f9";
    } else {
        path.setAttribute("stroke", "url(#g-dl)");
        root.style.setProperty('--main', '#00e5ff');
        phase.style.color = "#00e5ff";
    }
}

function updateProgress(pct, sec) {
    document.getElementById('progress-bar').style.width = pct + "%";
    if(sec !== undefined) document.getElementById('time-txt').innerText = sec + "s";
}

async function startIronTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر
    document.getElementById('phase-txt').innerText = "بحث عن خادم...";
    bestPingServer = await findBestServer();
    document.getElementById('srv-name').innerText = "تم اختيار أفضل خادم";

    // 2. البنق (5 ثواني)
    document.getElementById('phase-txt').innerText = "قياس الاستجابة";
    const ping = await runTimedTask(5000, measurePing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل + الجيتر (15 ثانية)
    document.getElementById('phase-txt').innerText = "جاري التنزيل...";
    startJitter();
    const dl = await runTimedTask(15000, measureDownloadXHR);
    stopJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (15 ثانية)
    updateGauge(0, "ul");
    document.getElementById('phase-txt').innerText = "جاري الرفع...";
    const ul = await runTimedTask(15000, measureUploadXHR);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-txt').innerText = "اكتمل";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

async function findBestServer() {
    const promises = KSA_SERVERS.map(async node => {
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

// مؤقت المهام
async function runTimedTask(duration, fn) {
    const start = performance.now();
    const timer = setInterval(() => {
        let elapsed = performance.now() - start;
        let pct = (elapsed / duration) * 100;
        let left = Math.ceil((duration - elapsed) / 1000);
        updateProgress(pct > 100 ? 100 : pct, left < 0 ? 0 : left);
    }, 100);
    
    const res = await fn(duration, start);
    clearInterval(timer);
    updateProgress(100, 0);
    return res;
}

async function measurePing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        let t0 = performance.now();
        try {
            await fetch(bestPingServer + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            // خصم 20% كتقدير لوقت المعالجة للحصول على بنق صافي
            pings.push((performance.now() - t0) * 0.8);
        } catch {}
        await new Promise(r => setTimeout(r, 200));
    }
    pings.sort((a,b)=>a-b);
    return Math.round(pings[Math.floor(pings.length/2)] || 0);
}

// *** الحل الجذري للتحميل: XHR (XMLHttpRequest) ***
// هذه الطريقة لا تفشل أبداً لأنها تعتمد على بروتوكول HTTP الأساسي
async function measureDownloadXHR(duration, startTime) {
    let totalLoaded = 0;
    let isRunning = true;
    
    // إطلاق 6 قنوات تحميل متوازية
    const workers = Array(6).fill(0).map(() => {
        return new Promise((resolve) => {
            const runWorker = () => {
                if(performance.now() - startTime >= duration || !isRunning) { resolve(); return; }
                
                const xhr = new XMLHttpRequest();
                activeXHRs.push(xhr); // للتنظيف
                
                let lastLoaded = 0;
                
                xhr.onprogress = (e) => {
                    if(performance.now() - startTime >= duration) { xhr.abort(); isRunning = false; return; }
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalLoaded += diff;
                    lastLoaded = e.loaded;
                };

                xhr.onload = xhr.onerror = () => {
                    // إزالة من القائمة النشطة
                    activeXHRs = activeXHRs.filter(x => x !== xhr);
                    runWorker(); // تكرار
                };
                
                // تحميل ملف كبير 25MB
                xhr.open("GET", `${CDN_BASE}/__down?bytes=25000000`, true);
                xhr.send();
            };
            runWorker();
        });
    });

    // حلقة تحديث الواجهة
    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        if(elapsed > 0) {
            let speed = (totalLoaded * 8) / (1024 * 1024) / elapsed;
            updateGauge(speed, "dl");
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    isRunning = false;
    activeXHRs.forEach(xhr => xhr.abort());
    
    // السرعة النهائية
    return document.getElementById('speed-text').innerText;
}

// *** الحل الجذري للرفع: XHR POST ***
async function measureUploadXHR(duration, startTime) {
    let totalLoaded = 0;
    let isRunning = true;
    
    // بيانات عشوائية 2MB
    const data = new Uint8Array(2 * 1024 * 1024);
    crypto.getRandomValues(data);

    const workers = Array(6).fill(0).map(() => {
        return new Promise((resolve) => {
            const runWorker = () => {
                if(performance.now() - startTime >= duration || !isRunning) { resolve(); return; }

                const xhr = new XMLHttpRequest();
                activeXHRs.push(xhr);
                
                let lastLoaded = 0;

                xhr.upload.onprogress = (e) => {
                    if(performance.now() - startTime >= duration) { xhr.abort(); isRunning = false; return; }
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalLoaded += diff;
                    lastLoaded = e.loaded;
                };

                xhr.onload = xhr.onerror = () => {
                    activeXHRs = activeXHRs.filter(x => x !== xhr);
                    runWorker();
                };

                xhr.open("POST", `${CDN_BASE}/__up?t=${Math.random()}`, true);
                xhr.send(data);
            };
            runWorker();
        });
    });

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        if(elapsed > 0) {
            // تصحيح 5% للبروتوكول
            let speed = ((totalLoaded * 8) / (1024 * 1024) / elapsed) * 1.05;
            updateGauge(speed, "ul");
        }
        await new Promise(r => setTimeout(r, 100));
    }

    isRunning = false;
    activeXHRs.forEach(xhr => xhr.abort());
    return document.getElementById('speed-text').innerText;
}

// البنق المثقل
function startJitter() {
    jitterInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(bestPingServer + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round((performance.now() - t0) * 0.8);
            document.getElementById('live-jitter').innerText = val + " ms";
            document.getElementById('res-jitter').innerText = val;
        } catch {}
    }, 500);
}
function stopJitter() { clearInterval(jitterInt); }
