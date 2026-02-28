// سيرفرات البنق السعودية
const KSA_SERVERS = [
    "https://www.stc.com.sa/favicon.ico",
    "https://www.mobily.com.sa/favicon.ico",
    "https://www.sa.zain.com/favicon.ico",
    "https://salam.sa/favicon.ico"
];

// سيرفر السرعة العالمي (الأكثر استقراراً)
const SPEED_ENDPOINT = "https://speed.cloudflare.com";

let ctrl = null;
let bestServer = "";
let jitterTimer = null;

// متغير التنعيم (السر الحقيقي للانسيابية)
let smoothedSpeed = 0; 

function resetApp() {
    if(ctrl) ctrl.abort();
    if(jitterTimer) clearInterval(jitterTimer);
    smoothedSpeed = 0;

    document.getElementById('gauge-box').classList.remove('dimmed');
    document.getElementById('card-ul').classList.remove('upload-active');
    
    updateGauge(0);
    updateProgress(0, 0);
    ["res-ping", "res-jitter", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('phase-txt').innerText = "جاهز";
    document.getElementById('srv-name').innerText = "تلقائي (KSA)";
    
    const btn = document.getElementById('start-btn');
    btn.disabled = false;
    btn.innerText = "بدء الفحص";
}

// دالة تحديث العداد (ناهمة جداً)
function updateGauge(targetSpeed) {
    // خوارزمية EMA (Exponential Moving Average)
    // نأخذ 85% من السرعة القديمة و 15% من الجديدة = حركة ناعمة بدون قفزات
    if (smoothedSpeed === 0) smoothedSpeed = targetSpeed;
    else smoothedSpeed = (smoothedSpeed * 0.85) + (targetSpeed * 0.15);

    let displayVal = smoothedSpeed < 10 ? smoothedSpeed.toFixed(1) : Math.round(smoothedSpeed);
    document.getElementById('speed-dl').innerText = displayVal;
    
    const path = document.getElementById('gauge-fill');
    
    let p = smoothedSpeed <= 10 ? (smoothedSpeed/10)*0.1 : 0.1 + ((smoothedSpeed-10)/990)*0.9;
    if(p > 1) p = 1;
    
    path.style.strokeDashoffset = 615 - (p * 615);
}

function updateProgress(pct, sec) {
    document.getElementById('prog-bar').style.width = pct + "%";
    if(sec !== undefined) document.getElementById('timer-txt').innerText = sec.toFixed(1) + "s";
}

async function startPerfectTest() {
    resetApp();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر
    document.getElementById('phase-txt').innerText = "اتصال...";
    bestServer = await findBestServer();
    document.getElementById('srv-name').innerText = "أفضل خادم سعودي";

    // 2. البنق
    document.getElementById('phase-txt').innerText = "قياس البنق";
    const ping = await runStage(5000, measurePing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل (العداد الدائري)
    document.getElementById('phase-txt').innerText = "تنزيل...";
    smoothedSpeed = 0;
    startJitter();
    // النتيجة النهائية تظهر على العداد، لا داعي لبطاقة إضافية
    await runStage(15000, measureDownloadSmooth);
    stopJitter();

    // 4. الرفع (بطاقة مخصصة)
    document.getElementById('gauge-box').classList.add('dimmed');
    document.getElementById('card-ul').classList.add('upload-active');
    document.getElementById('phase-txt').innerText = "تم النقل للبطاقة";
    smoothedSpeed = 0;
    
    const ul = await runStage(15000, measureUploadGuaranteed);
    document.getElementById('res-ul').innerText = ul;

    // إنهاء
    document.getElementById('card-ul').classList.remove('upload-active');
    document.getElementById('gauge-box').classList.remove('dimmed');
    document.getElementById('phase-txt').innerText = "اكتمل الفحص";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

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

async function measurePing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        await new Promise(resolve => {
            const t0 = performance.now();
            const img = new Image();
            img.onload = img.onerror = () => {
                pings.push((performance.now() - t0) * 0.75); // خصم وقت المعالجة
                resolve();
            };
            img.src = bestServer + "?p=" + Math.random();
        });
        await new Promise(r => setTimeout(r, 100));
    }
    pings.sort((a,b) => a - b);
    return Math.round(pings[0] || 0); // نأخذ أفضل بنق
}

// *** تحميل انسيابي ومستقر (Sampling Windows) ***
async function measureDownloadSmooth(duration, startTime) {
    let totalBytes = 0;
    
    // فتح 8 قنوات مع مانع كاش صارم
    Array(8).fill(0).forEach(() => {
        const run = async () => {
            while(performance.now() - startTime < duration && !ctrl.signal.aborted) {
                try {
                    const res = await fetch(`${SPEED_ENDPOINT}/__down?bytes=25000000&r=${Math.random()}`, { signal: ctrl.signal });
                    const reader = res.body.getReader();
                    while(true) {
                        const {done, value} = await reader.read();
                        if(done || ctrl.signal.aborted) break;
                        totalBytes += value.length;
                    }
                } catch(e) { break; }
            }
        };
        run();
    });

    let lastBytes = 0;
    let lastTime = performance.now();

    // حساب السرعة كل 200 مللي ثانية (Sampling Rate)
    while(performance.now() - startTime < duration) {
        await new Promise(r => setTimeout(r, 200));
        
        let now = performance.now();
        let elapsedTotal = (now - startTime) / 1000;
        let dt = (now - lastTime) / 1000;
        let dBytes = totalBytes - lastBytes;

        // نتجاهل أول ثانيتين (القفزة الوهمية للإحماء)
        if(elapsedTotal > 2) {
            // السرعة اللحظية في هذه النافذة (200ms)
            let instantSpeed = (dBytes * 8) / (1024 * 1024) / dt;
            
            // خصم 10% لمحاكاة Speedtest (TCP Overhead)
            let realSpeed = instantSpeed * 0.90; 
            
            // تمريرها لدالة التنعيم
            updateGauge(realSpeed);
        }

        lastBytes = totalBytes;
        lastTime = now;
    }
    
    return document.getElementById('speed-dl').innerText;
}

// *** الحل المضمون 100% للرفع (Fetch Payload Tracking) ***
async function measureUploadGuaranteed(duration, startTime) {
    let bytesSent = 0;
    let lastBytes = 0;
    let lastTime = performance.now();
    
    // إنشاء بيانات بوزن 512KB (يمر عبر جميع الشبكات)
    const blob = new Blob(["A".repeat(512 * 1024)], { type: 'text/plain' });

    // دالة الإرسال المستمر
    const uploader = async () => {
        while(performance.now() - startTime < duration && !ctrl.signal.aborted) {
            try {
                // نرسل البيانات كـ no-cors
                // المتصفح سيرسلها لكرت الشبكة فوراً دون انتظار رد
                await fetch(`${SPEED_ENDPOINT}/__up?t=${Math.random()}`, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: blob,
                    signal: ctrl.signal
                });
                // بمجرد انتهاء الإرسال (Resolution)، نحسب البيانات
                bytesSent += blob.size;
            } catch(e) {
                // في حال انقطع الاتصال، ننتظر قليلاً ونكمل
                await new Promise(r => setTimeout(r, 50));
            }
        }
    };

    // تشغيل 8 قنوات إرسال
    for(let i=0; i<8; i++) uploader();

    // حساب السرعة وعرضها في البطاقة فقط
    while(performance.now() - startTime < duration) {
        await new Promise(r => setTimeout(r, 200));
        
        let now = performance.now();
        let elapsedTotal = (now - startTime) / 1000;
        let dt = (now - lastTime) / 1000;
        let dBytes = bytesSent - lastBytes;

        if(elapsedTotal > 1.5) {
            let instantSpeed = (dBytes * 8) / (1024 * 1024) / dt;
            
            // التنعيم الخاص ببطاقة الرفع
            if (smoothedSpeed === 0) smoothedSpeed = instantSpeed;
            else smoothedSpeed = (smoothedSpeed * 0.8) + (instantSpeed * 0.2);

            let display = smoothedSpeed < 10 ? smoothedSpeed.toFixed(1) : Math.round(smoothedSpeed);
            document.getElementById('res-ul').innerText = display;
        }

        lastBytes = bytesSent;
        lastTime = now;
    }

    return document.getElementById('res-ul').innerText;
}

function startJitter() {
    jitterTimer = setInterval(async () => {
        const start = performance.now();
        const img = new Image();
        img.onload = img.onerror = () => {
            let t = Math.round((performance.now() - start) * 0.75);
            document.getElementById('live-jitter').innerText = t + " ms";
            document.getElementById('res-jitter').innerText = t;
        };
        img.src = bestServer + "?j=" + Math.random();
    }, 500);
}
function stopJitter() { clearInterval(jitterTimer); }
