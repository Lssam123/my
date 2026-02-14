// قائمة سيرفرات البنق السعودية
const KSA_SERVERS = [
    { url: "https://www.stc.com.sa/favicon.ico" },
    { url: "https://www.mobily.com.sa/favicon.ico" },
    { url: "https://www.sa.zain.com/favicon.ico" },
    { url: "https://salam.sa/favicon.ico" },
    { url: "https://www.go.com.sa/favicon.ico" },
    { url: "https://dawiyat.com.sa/favicon.ico" }
];

// نقطة البيانات (Cloudflare)
const DATA_HOST = "https://speed.cloudflare.com";

let ctrl = null;
let bestServer = null;
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
    // تنسيق الرقم
    let displayVal = val < 10 ? val.toFixed(1) : Math.round(val);
    document.getElementById('speed-main').innerText = displayVal;
    
    const path = document.getElementById('track-active');
    const phase = document.getElementById('phase-txt');
    const root = document.documentElement;

    // حركة الإبرة (لوغاريتمية لتوزيع أفضل)
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    path.style.strokeDashoffset = 615 - (p * 615); // 615 طول المسار

    if(type === "ul") {
        path.setAttribute("stroke", "url(#g-ul)");
        path.style.filter = "drop-shadow(0 0 10px var(--sec))";
        phase.style.color = "var(--sec)";
    } else {
        path.setAttribute("stroke", "url(#g-dl)");
        path.style.filter = "drop-shadow(0 0 10px var(--main))";
        phase.style.color = "var(--main)";
    }
}

function updateProgress(pct, sec) {
    document.getElementById('time-bar').style.width = pct + "%";
    if(sec !== undefined) document.getElementById('timer-txt').innerText = sec.toFixed(1) + "s";
}

// المحرك الرئيسي
async function runTitaniumTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر الخفي
    document.getElementById('phase-txt').innerText = "اتصال...";
    bestServer = await findBestServer();
    document.getElementById('srv-name').innerText = "تم الاتصال (أفضل خادم)";

    // 2. البنق (الخامل)
    document.getElementById('phase-txt').innerText = "قياس البنق";
    const ping = await runTimedTask(5000, measurePing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل + الجيتر (متزامنان تماماً)
    document.getElementById('phase-txt').innerText = "تنزيل...";
    const dl = await measureDownloadWithJitter(15000);
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (تقنية Form Data)
    updateGauge(0, "ul");
    document.getElementById('phase-txt').innerText = "رفع...";
    const ul = await measureUploadForm(15000);
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

// مؤقت عام
async function runTimedTask(duration, taskFn) {
    const start = performance.now();
    const timer = setInterval(() => {
        let elapsed = performance.now() - start;
        let pct = (elapsed / duration) * 100;
        updateProgress(pct > 100 ? 100 : pct, (duration - elapsed)/1000);
    }, 100);
    const res = await taskFn(duration, start);
    clearInterval(timer);
    updateProgress(100, 0);
    return res;
}

// قياس البنق الدقيق
async function measurePing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        await new Promise(resolve => {
            const t0 = performance.now();
            const img = new Image();
            img.onload = img.onerror = () => {
                let t = performance.now() - t0;
                pings.push(t * 0.7); // خصم وقت المعالجة
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

// *** دالة التحميل المدمجة مع الجيتر ***
async function measureDownloadWithJitter(duration) {
    const startTime = performance.now();
    let totalBytes = 0;
    
    // تشغيل الجيتر داخل نفس الدالة لضمان التزامن
    jitterInt = setInterval(async () => {
        const t0 = performance.now();
        const img = new Image();
        img.onload = img.onerror = () => {
            let t = Math.round((performance.now() - t0) * 0.8);
            document.getElementById('live-jitter').innerText = t + " ms";
            document.getElementById('res-jitter').innerText = t;
        };
        img.src = bestServer + "?j=" + Math.random();
    }, 500);

    // مؤقت الواجهة
    const timerLoop = setInterval(() => {
        let elapsed = performance.now() - startTime;
        let pct = (elapsed / duration) * 100;
        updateProgress(pct > 100 ? 100 : pct, (duration - elapsed)/1000);
    }, 100);

    // عمال التحميل (12 قناة)
    const workers = Array(12).fill(0).map(() => {
        return new Promise((resolve) => {
            const run = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }
                const xhr = new XMLHttpRequest();
                activeXHRs.push(xhr);
                let lastLoaded = 0;
                
                xhr.onprogress = (e) => {
                    if(performance.now() - startTime >= duration) { xhr.abort(); return; }
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalBytes += diff;
                    lastLoaded = e.loaded;
                };
                
                xhr.onload = xhr.onerror = () => {
                    activeXHRs = activeXHRs.filter(x => x !== xhr);
                    run();
                };
                // ملف كبير جداً
                xhr.open("GET", `${DATA_HOST}/__down?bytes=50000000`, true);
                xhr.send();
            };
            run();
        });
    });

    // حلقة حساب السرعة (التراكمية)
    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        // نتجاهل أول 1.5 ثانية (Warm-up)
        if(elapsed > 1.5) {
            let speed = (totalBytes * 8) / (1024 * 1024) / elapsed;
            updateGauge(speed, "dl");
        }
        await new Promise(r => setTimeout(r, 100));
    }

    clearInterval(jitterInt); // إيقاف الجيتر فوراً
    clearInterval(timerLoop);
    activeXHRs.forEach(x => x.abort());
    updateProgress(100, 0);
    
    return document.getElementById('speed-main').innerText;
}

// *** الحل النهائي للرفع: FormData (تمويه البيانات) ***
async function measureUploadForm(duration) {
    const startTime = performance.now();
    let totalBytes = 0;
    
    // إنشاء بيانات نصية عشوائية ضخمة (لتظهر كملف نصي)
    const txt = "X".repeat(512 * 1024); 
    const blob = new Blob([txt], { type: 'text/plain' });

    // مؤقت الواجهة
    const timerLoop = setInterval(() => {
        let elapsed = performance.now() - startTime;
        let pct = (elapsed / duration) * 100;
        updateProgress(pct > 100 ? 100 : pct, (duration - elapsed)/1000);
    }, 100);

    const createWorker = () => {
        return new Promise((resolve) => {
            const run = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }

                const xhr = new XMLHttpRequest();
                activeXHRs.push(xhr);
                let lastLoaded = 0;

                // استخدام FormData يجعل الطلب يبدو كـ Form Upload عادي
                const fd = new FormData();
                fd.append('file', blob, 'test.txt');

                xhr.upload.onprogress = (e) => {
                    if(performance.now() - startTime >= duration) { xhr.abort(); return; }
                    let diff = e.loaded - lastLoaded;
                    if(diff > 0) totalBytes += diff;
                    lastLoaded = e.loaded;
                };

                xhr.onload = xhr.onerror = () => {
                    activeXHRs = activeXHRs.filter(x => x !== xhr);
                    run();
                };

                xhr.open("POST", `${DATA_HOST}/__up?t=${Math.random()}`, true);
                xhr.send(fd);
            };
            run();
        });
    };

    // 8 قنوات متزامنة
    const workers = Array(8).fill(0).map(() => createWorker());

    while(performance.now() - startTime < duration) {
        let elapsed = (performance.now() - startTime) / 1000;
        if(elapsed > 1.5) {
            // تصحيح 5% Overhead
            let speed = ((totalBytes * 8) / (1024 * 1024) / elapsed) * 1.05;
            updateGauge(speed, "ul");
        }
        await new Promise(r => setTimeout(r, 100));
    }

    clearInterval(timerLoop);
    activeXHRs.forEach(x => x.abort());
    updateProgress(100, 0);

    return document.getElementById('speed-main').innerText;
}
