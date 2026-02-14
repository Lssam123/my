// قائمة السيرفرات السعودية (للبنق فقط)
const KSA_NODES = [
    { id: 1, url: "https://www.stc.com.sa/favicon.ico" },
    { id: 2, url: "https://www.mobily.com.sa/favicon.ico" },
    { id: 3, url: "https://www.sa.zain.com/favicon.ico" },
    { id: 4, url: "https://salam.sa/favicon.ico" },
    { id: 5, url: "https://www.go.com.sa/favicon.ico" },
    { id: 6, url: "https://dawiyat.com.sa/favicon.ico" }
];

// نقطة الضغط (Bandwidth) - نستخدم Cloudflare لضمان عمل الرفع
const STRESS_NODE = "https://speed.cloudflare.com";

let ctrl = null;
let activePingUrl = "";
let jitterInt = null;

function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterInt) clearInterval(jitterInt);
    
    updateGauge(0);
    updateTimer(0);
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('server-status').innerText = "جاهز للفحص";
    document.getElementById('phase-txt').innerText = "استعداد";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

function updateGauge(val, type="dl") {
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('speed-text').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    const path = document.getElementById('gauge-fill');
    const root = document.documentElement;
    const txt = document.getElementById('phase-txt');

    // 565 طول المسار
    path.style.strokeDashoffset = 565 - (p * 565);

    if(type === "ul") {
        root.style.setProperty('--main-color', '#00ccff'); // لون الرفع
        txt.style.color = '#00ccff';
    } else {
        root.style.setProperty('--main-color', '#00ff88'); // لون التحميل
        txt.style.color = '#00ff88';
    }
}

function updateTimer(percent, timeLeft) {
    document.getElementById('time-bar').style.width = percent + "%";
    if(timeLeft !== undefined) document.getElementById('timer-text').innerText = timeLeft + "s";
}

async function startPhantomTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر الخفي
    document.getElementById('phase-txt').innerText = "بحث عن الخادم...";
    // نختار السيرفر الأسرع دون إظهار اسمه
    activePingUrl = await findFastestServer();
    document.getElementById('server-status').innerText = "تم تحديد أفضل خادم";

    // 2. البنق (4 ثواني)
    document.getElementById('phase-txt').innerText = "قياس الاستجابة";
    const ping = await runTimedTask(4000, measurePing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التنزيل (15 ثانية)
    document.getElementById('phase-txt').innerText = "جاري التنزيل...";
    startJitter();
    const dl = await runTimedTask(15000, measureDownload);
    stopJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (15 ثانية)
    updateGauge(0, "ul");
    document.getElementById('phase-txt').innerText = "جاري الرفع...";
    const ul = await runTimedTask(15000, measureUpload);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-txt').innerText = "اكتمل";
    document.getElementById('server-status').innerText = "النتائج النهائية";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

// دالة البحث الصامت
async function findFastestServer() {
    const promises = KSA_NODES.map(async node => {
        const start = performance.now();
        try {
            await fetch(node.url + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            return { url: node.url, time: performance.now() - start };
        } catch { return { url: node.url, time: 9999 }; }
    });
    
    const results = await Promise.all(promises);
    results.sort((a,b) => a.time - b.time);
    return results[0].url; // نرجع الرابط فقط
}

// دالة إدارة الوقت (Timer Manager)
async function runTimedTask(duration, taskFunction) {
    const start = performance.now();
    let result = 0;
    
    // حلقة تحديث الوقت
    const timerLoop = setInterval(() => {
        let elapsed = performance.now() - start;
        let pct = (elapsed / duration) * 100;
        let left = Math.ceil((duration - elapsed) / 1000);
        if(pct > 100) pct = 100;
        if(left < 0) left = 0;
        updateTimer(pct, left);
    }, 100);

    // تشغيل المهمة
    result = await taskFunction(duration, start);
    
    clearInterval(timerLoop);
    updateTimer(100, 0);
    return result;
}

// مهمة البنق
async function measurePing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        let t0 = performance.now();
        try {
            await fetch(activePingUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            pings.push((performance.now() - t0) * 0.8);
        } catch {}
        await new Promise(r => setTimeout(r, 200));
    }
    pings.sort((a,b)=>a-b);
    return Math.round(pings[Math.floor(pings.length/2)] || 0);
}

// مهمة التنزيل
async function measureDownload(duration, startTime) {
    let loadedBytes = 0;
    
    const workers = Array(20).fill(0).map(async () => {
        while(performance.now() - startTime < duration) {
            if(ctrl.signal.aborted) break;
            try {
                const res = await fetch(STRESS_URL + "/__down?bytes=25000000", { signal: ctrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || performance.now() - startTime >= duration) break;
                    loadedBytes += value.length;
                    
                    let elapsed = (performance.now() - startTime) / 1000;
                    let speed = (loadedBytes * 8) / (1024 * 1024) / elapsed;
                    updateGauge(speed, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    let finalSpeed = (loadedBytes * 8) / (1024 * 1024) / (duration/1000);
    return finalSpeed.toFixed(1);
}

// مهمة الرفع (XHR with Random Data)
async function measureUpload(duration, startTime) {
    let sentBytes = 0;
    // بيانات عشوائية 1MB
    const data = new Uint8Array(1024 * 1024);
    crypto.getRandomValues(data);

    const worker = () => {
        if(performance.now() - startTime >= duration || ctrl.signal.aborted) return;

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if(performance.now() - startTime >= duration) { xhr.abort(); return; }
            if(e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let diff = e.loaded - lastLoad;
                if(dt > 0.15) {
                    let s = (diff * 8) / (1024 * 1024) / dt * 1.1; // 10% Overhead
                    updateGauge(s, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        xhr.onload = () => { sentBytes += data.byteLength; worker(); };
        xhr.onerror = () => worker();

        // استخدام POST مع رابط متغير
        xhr.open("POST", `${STRESS_URL}/__up?t=${Math.random()}`, true);
        xhr.send(data);
    };

    // 8 قنوات رفع
    for(let i=0; i<8; i++) { worker(); await new Promise(r => setTimeout(r, 100)); }

    await new Promise(r => setTimeout(r, duration));
    
    // نعتمد على آخر قراءة للعداد لدقة أعلى في الرفع
    return document.getElementById('speed-text').innerText;
}

// البنق المثقل
function startJitter() {
    jitterInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activePingUrl + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val + " ms";
            document.getElementById('res-jitter').innerText = val;
        } catch {}
    }, 500);
}
function stopJitter() { clearInterval(jitterInt); }
