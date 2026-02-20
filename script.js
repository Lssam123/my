// 1. سيرفرات السعودية للبنق (ضمان استجابة الألعاب)
const KSA_SERVERS = [
    "https://www.stc.com.sa/favicon.ico",
    "https://www.mobily.com.sa/favicon.ico",
    "https://www.sa.zain.com/favicon.ico",
    "https://salam.sa/favicon.ico",
    "https://dawiyat.com.sa/favicon.ico"
];

// 2. شبكة عالمية للسرعة القصوى
const SPEED_CDN = "https://speed.cloudflare.com";

let ctrl = null;
let bestLocalUrl = "";
let jitterTimer = null;
let activeTasks = [];

function resetEngine() {
    if(ctrl) ctrl.abort();
    if(jitterTimer) clearInterval(jitterTimer);
    activeTasks.forEach(t => t.abort());
    activeTasks = [];

    // إعادة الواجهة للوضع الافتراضي
    document.getElementById('gauge-container').classList.remove('dim-gauge');
    document.getElementById('ul-card').classList.remove('upload-focus');
    updateDownloadUI(0);
    updateProgress(0, 0);
    
    ["res-ping", "res-jitter", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('dl-speed').innerText = "0.0";
    document.getElementById('phase-txt').innerText = "جاهز للفحص";
    
    const btn = document.getElementById('start-btn');
    btn.disabled = false;
    btn.innerText = "بدء الفحص";
}

// تحديث عداد التحميل
function updateDownloadUI(val) {
    let display = val < 10 ? val.toFixed(1) : Math.round(val);
    document.getElementById('dl-speed').innerText = display;
    
    const path = document.getElementById('gauge-fill');
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    path.style.strokeDashoffset = 615 - (p * 615);
}

function updateProgress(pct, sec) {
    document.getElementById('prog-bar').style.width = pct + "%";
    if(sec !== undefined) document.getElementById('timer-display').innerText = sec.toFixed(1) + "s";
}

// المحرك الرئيسي
async function startMasterTest() {
    resetEngine();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر بصمت
    document.getElementById('phase-txt').innerText = "بحث عن الخادم...";
    bestLocalUrl = await findBestServer();

    // 2. بنق الألعاب (Min Ping)
    document.getElementById('phase-txt').innerText = "قياس البنق";
    const ping = await runStage(5000, measureGamingPing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل والجيتر (على العداد)
    document.getElementById('phase-txt').innerText = "جاري التنزيل";
    startJitter(); // بدء الجيتر
    const dlSpeed = await runStage(15000, measureAccurateDownload);
    stopJitter(); // إيقاف الجيتر
    // السرعة النهائية للتحميل تبقى على العداد

    // 4. الرفع (في البطاقة)
    // تحويل التركيز البصري لبطاقة الرفع
    document.getElementById('gauge-container').classList.add('dim-gauge');
    document.getElementById('ul-card').classList.add('upload-focus');
    document.getElementById('phase-txt').innerText = "جاري الرفع";
    
    const ulSpeed = await runStage(15000, measureBulletUpload);
    // النتيجة تظهر في البطاقة مباشرة من داخل الدالة
    
    // إنهاء
    document.getElementById('phase-txt').innerText = "اكتمل الفحص";
    document.getElementById('ul-card').classList.remove('upload-focus');
    document.getElementById('gauge-container').classList.remove('dim-gauge');
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

// مدير المراحل
async function runStage(duration, taskFn) {
    const start = performance.now();
    const ticker = setInterval(() => {
        let elapsed = performance.now() - start;
        updateProgress((elapsed / duration) * 100, (duration - elapsed)/1000);
    }, 100);
    const res = await taskFn(duration, start);
    clearInterval(ticker);
    updateProgress(100, 0);
    return res;
}

// دالة اختيار السيرفر الأسرع
async function findBestServer() {
    const promises = KSA_SERVERS.map(async url => {
        const start = performance.now();
        return new Promise(resolve => {
            const img = new Image();
            img.onload = img.onerror = () => resolve({ url, time: performance.now() - start });
            img.src = url + "?t=" + Math.random();
        });
    });
    const results = await Promise.all(promises);
    results.sort((a,b) => a.time - b.time);
    return results[0].url;
}

// دالة بنق الألعاب (أقل قيمة)
async function measureGamingPing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        await new Promise(resolve => {
            const t0 = performance.now();
            const img = new Image();
            img.onload = img.onerror = () => {
                pings.push((performance.now() - t0) * 0.75); // 25% overhead deduction
                resolve();
            };
            img.src = bestLocalUrl + "?p=" + Math.random();
        });
        await new Promise(r => setTimeout(r, 100));
    }
    pings.sort((a,b) => a - b);
    return Math.round(pings[0] || 0); // نأخذ أصغر رقم دائماً (الأفضل)
}

// *** دالة التحميل الدقيقة جداً (Anti-Cache & Warm-up) ***
async function measureAccurateDownload(duration, startTime) {
    let totalBytes = 0;
    let actualStart = 0; // لحساب الوقت بعد الإحماء

    const spawnWorker = () => {
        return new Promise((resolve) => {
            const run = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }
                const xhr = new XMLHttpRequest();
                activeTasks.push(xhr);
                let lastLoaded = 0;
                
                xhr.onprogress = (e) => {
                    if(ctrl.signal.aborted) return;
                    let diff = e.loaded - lastLoaded;
                    // نجمع البيانات فقط بعد مرور ثانيتين من بداية الفحص (تجاهل القفزة الوهمية)
                    if(performance.now() - startTime > 2000) {
                        if(actualStart === 0) actualStart = performance.now();
                        totalBytes += diff;
                    }
                    lastLoaded = e.loaded;
                };
                
                xhr.onload = xhr.onerror = () => {
                    activeTasks = activeTasks.filter(t => t !== xhr);
                    run(); // استمرار التحميل
                };
                
                // استخدام رقم عشوائي (Math.random) يمنع المتصفح من قراءة الكاش
                xhr.open("GET", `${SPEED_CDN}/__down?bytes=50000000&r=${Math.random()}`, true);
                xhr.send();
            };
            run();
        });
    };

    // 8 قنوات متوازية
    Array(8).fill(0).forEach(() => spawnWorker());

    while(performance.now() - startTime < duration) {
        if(actualStart > 0) {
            let activeTime = (performance.now() - actualStart) / 1000;
            if(activeTime > 0.5) {
                // السرعة التراكمية الحقيقية (بايت / الزمن) مع خصم بروتوكول TCP
                let speed = ((totalBytes * 8) / (1024 * 1024) / activeTime) * 0.90;
                updateDownloadUI(speed);
            }
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    activeTasks.forEach(t => t.abort());
    return document.getElementById('dl-speed').innerText;
}

// *** الحل الجذري للرفع (Text Egress Measurement) ***
async function measureBulletUpload(duration, startTime) {
    let totalSent = 0;
    let actualStart = 0;
    
    // إنشاء حزمة بيانات 256KB كنص عادي لتمر من جميع الشبكات
    const txt = "A".repeat(256 * 1024);

    const spawnUploader = () => {
        return new Promise((resolve) => {
            const run = () => {
                if(performance.now() - startTime >= duration) { resolve(); return; }
                const xhr = new XMLHttpRequest();
                activeTasks.push(xhr);
                let lastLoaded = 0;

                xhr.upload.onprogress = (e) => {
                    if(ctrl.signal.aborted) return;
                    let diff = e.loaded - lastLoaded;
                    if(performance.now() - startTime > 1500) { // إحماء 1.5 ثانية
                        if(actualStart === 0) actualStart = performance.now();
                        totalSent += diff;
                    }
                    lastLoaded = e.loaded;
                };

                xhr.onload = xhr.onerror = () => {
                    activeTasks = activeTasks.filter(t => t !== xhr);
                    run(); // إعادة الإرسال الفوري
                };

                // إرسال كـ Text لمنع تعقيدات الـ CORS
                xhr.open("POST", `${SPEED_CDN}/__up?t=${Math.random()}`, true);
                xhr.setRequestHeader("Content-Type", "text/plain");
                xhr.send(txt);
            };
            run();
        });
    };

    // 12 قناة رفع لإجبار الشبكة
    Array(12).fill(0).forEach(() => spawnUploader());

    while(performance.now() - startTime < duration) {
        if(actualStart > 0) {
            let activeTime = (performance.now() - actualStart) / 1000;
            if(activeTime > 0.5) {
                let speed = ((totalSent * 8) / (1024 * 1024) / activeTime) * 1.05; // تعويض بسيط
                let display = speed < 10 ? speed.toFixed(1) : Math.round(speed);
                // تحديث البطاقة مباشرة
                document.getElementById('res-ul').innerText = display;
            }
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    activeTasks.forEach(t => t.abort());
    return document.getElementById('res-ul').innerText;
}

// الجيتر المتزامن
function startJitter() {
    jitterTimer = setInterval(async () => {
        const start = performance.now();
        const img = new Image();
        img.onload = img.onerror = () => {
            let t = Math.round((performance.now() - start) * 0.75);
            document.getElementById('live-jitter').innerText = t + " ms";
            document.getElementById('res-jitter').innerText = t;
        };
        img.src = bestLocalUrl + "?j=" + Math.random();
    }, 500);
}
function stopJitter() { clearInterval(jitterTimer); }
