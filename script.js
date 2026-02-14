const KSA_SERVERS = [
    { url: "https://www.stc.com.sa/favicon.ico" },
    { url: "https://www.mobily.com.sa/favicon.ico" },
    { url: "https://www.sa.zain.com/favicon.ico" },
    { url: "https://salam.sa/favicon.ico" },
    { url: "https://www.go.com.sa/favicon.ico" },
    { url: "https://dawiyat.com.sa/favicon.ico" }
];

const CDN_BASE = "https://speed.cloudflare.com";

let ctrl = null;
let bestServerUrl = "";
let jitterInt = null;
let activeXHRs = [];

function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterInt) clearInterval(jitterInt);
    activeXHRs.forEach(xhr => xhr.abort());
    activeXHRs = [];

    updateGauge(0, "dl");
    updateProgress(0, 0);
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('phase-txt').innerText = "جاهز";
    document.getElementById('srv-name').innerText = "تلقائي (KSA)";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

function updateGauge(val, type="dl") {
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('speed-big').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    const path = document.getElementById('track-fill');
    const phase = document.getElementById('phase-txt');
    const root = document.documentElement;

    path.style.strokeDashoffset = 615 - (p * 615);

    if(type === "ul") {
        path.setAttribute("stroke", "url(#g-ul)");
        phase.style.color = "var(--sec)";
        path.style.filter = "drop-shadow(0 0 15px var(--sec))";
    } else {
        path.setAttribute("stroke", "url(#g-dl)");
        phase.style.color = "var(--main)";
        path.style.filter = "drop-shadow(0 0 15px var(--main));"
    }
}

function updateProgress(percent, sec) {
    document.getElementById('time-bar').style.width = percent + "%";
    if(sec !== undefined) document.getElementById('timer').innerText = sec + "s";
}

async function startQuantumTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر الخفي
    document.getElementById('phase-txt').innerText = "بحث عن خادم...";
    bestServerUrl = await findBestServer();
    document.getElementById('srv-name').innerText = "خادم سعودي (أمثل)";

    // 2. البنق الدقيق (5 ثواني)
    document.getElementById('phase-txt').innerText = "قياس الاستجابة";
    const ping = await runTimedTask(5000, measureQuantumPing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل (15 ثانية)
    document.getElementById('phase-txt').innerText = "جاري التنزيل...";
    startJitter();
    const dl = await runTimedTask(15000, measureDownloadXHR);
    stopJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (15 ثانية) - التقنية الجديدة
    updateGauge(0, "ul");
    document.getElementById('phase-txt').innerText = "جاري الرفع...";
    const ul = await runTimedTask(15000, measureUploadFragmented);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-txt').innerText = "اكتمل";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

async function findBestServer() {
    const promises = KSA_SERVERS.map(async node => {
        const start = performance.now();
        // نستخدم Image لأنه أسرع ولا يتأثر بالـ CORS في مرحلة الاكتشاف
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

// قياس البنق الدقيق (Image Ping مع فلترة قوية)
async function measureQuantumPing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        
        await new Promise(resolve => {
            const t0 = performance.now();
            const img = new Image();
            img.onload = img.onerror = () => {
                let t = performance.now() - t0;
                // خصم 30% كتقدير لوقت معالجة الصورة للحصول على بنق الشبكة الصافي
                pings.push(t * 0.7); 
                resolve();
            };
            img.src = bestServerUrl + "?p=" + Math.random();
        });
        await new Promise(r => setTimeout(r, 100)); // تسريع الفحص
    }
    
    // فلترة القيم الشاذة (حذف أعلى 20% وأقل 20%)
    pings.sort((a,b)=>a-b);
    let slice = Math.floor(pings.length * 0.2);
    if (pings.length > 5) pings = pings.slice(slice, pings.length - slice);
    
    let sum = pings.reduce((a,b)=>a+b, 0);
    return Math.round(sum / pings.length) || 0;
}

// تحميل XHR
async function measureDownloadXHR(duration, startTime) {
    let totalLoaded = 0;
    
    const workers = Array(6).fill(0).map(() => {
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
                
                xhr.open("GET", `${CDN_BASE}/__down?bytes=50000000`, true);
                xhr.send();
            };
            runWorker();
        });
    });

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        let speed = (totalLoaded * 8) / (1024 * 1024) / elapsed;
        updateGauge(speed, "dl");
        await new Promise(r => setTimeout(r, 100));
    }
    return document.getElementById('speed-big').innerText;
}

// *** الحل النهائي للرفع: حزم صغيرة سريعة (Fragmented Upload) ***
// هذا يمنع السيرفر من رفض الطلب لأنه يراه صغيراً، لكن الكثرة تصنع السرعة
async function measureUploadFragmented(duration, startTime) {
    let totalSent = 0;
    // حزمة صغيرة 256KB لضمان القبول
    const data = new Uint8Array(256 * 1024); 
    crypto.getRandomValues(data);

    const workers = Array(12).fill(0).map(() => {
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

                // إرسال طلب جديد بمعلمة عشوائية
                xhr.open("POST", `${CDN_BASE}/__up?frag=${Math.random()}`, true);
                xhr.send(data);
            };
            runWorker();
        });
    });

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        // تصحيح بسيط للـ Overhead الناتج عن كثرة الطلبات الصغيرة
        let speed = ((totalSent * 8) / (1024 * 1024) / elapsed) * 1.05;
        updateGauge(speed, "ul");
        await new Promise(r => setTimeout(r, 100));
    }
    return document.getElementById('speed-big').innerText;
}

function startJitter() {
    jitterInt = setInterval(async () => {
        const start = performance.now();
        const img = new Image();
        img.onload = img.onerror = () => {
            let t = (performance.now() - start) * 0.7; // نفس معامل تصحيح البنق
            document.getElementById('live-jitter').innerText = Math.round(t) + " ms";
            document.getElementById('res-jitter').innerText = Math.round(t);
        };
        img.src = bestServerUrl + "?j=" + Math.random();
    }, 500);
}
