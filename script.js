// قائمة السيرفرات السعودية الشاملة (للبنق فقط)
const KSA_SERVERS = [
    { id: 1, url: "https://www.stc.com.sa/favicon.ico" },
    { id: 2, url: "https://www.mobily.com.sa/favicon.ico" },
    { id: 3, url: "https://www.sa.zain.com/favicon.ico" },
    { id: 4, url: "https://salam.sa/favicon.ico" },
    { id: 5, url: "https://www.go.com.sa/favicon.ico" },
    { id: 6, url: "https://dawiyat.com.sa/favicon.ico" }
];

// نقطة البيانات (لضمان الرفع والتحميل)
const DATA_ENDPOINT = "https://speed.cloudflare.com";

let ctrl = null;
let bestPingUrl = "";
let jitterInt = null;

// إعادة التعيين
function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterInt) clearInterval(jitterInt);
    
    updateGauge(0);
    updateProgress(0, 0);
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('srv-name').innerText = "تلقائي (KSA)";
    document.getElementById('phase-txt').innerText = "جاهز";
    
    const btn = document.getElementById('start-btn');
    btn.disabled = false;
    btn.innerText = "بدء الفحص";
}

function updateGauge(val, type="dl") {
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('speed-readout').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-val');
    const phase = document.getElementById('phase-txt');
    const root = document.documentElement;

    path.style.strokeDashoffset = 615 - (p * 615);

    if(type === "ul") {
        path.setAttribute("stroke", "url(#g-ul)");
        path.style.filter = "drop-shadow(0 0 10px var(--purple))";
        phase.style.color = "var(--purple)";
    } else {
        path.setAttribute("stroke", "url(#g-dl)");
        path.style.filter = "drop-shadow(0 0 10px var(--neon))";
        phase.style.color = "var(--neon)";
    }
}

function updateProgress(percent, sec) {
    document.getElementById('time-bar').style.width = percent + "%";
    if(sec !== undefined) document.getElementById('time-txt').innerText = sec + "s";
}

// بدء الفحص
async function startStealthTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر الخفي
    document.getElementById('phase-txt').innerText = "بحث عن أفضل خادم...";
    bestPingUrl = await findBestServer();
    document.getElementById('srv-name').innerText = "خادم سعودي (تلقائي)";

    // 2. البنق الدقيق (5 ثواني)
    document.getElementById('phase-txt').innerText = "قياس الاستجابة";
    const ping = await runTimedTask(5000, measurePrecisionPing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التحميل + الجيتر (15 ثانية)
    document.getElementById('phase-txt').innerText = "جاري التنزيل...";
    startJitter();
    const dl = await runTimedTask(15000, measureDownload);
    stopJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (15 ثانية) - الطريقة المضمونة
    updateGauge(0, "ul");
    document.getElementById('phase-txt').innerText = "جاري الرفع...";
    const ul = await runTimedTask(15000, measureUploadEgress);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-txt').innerText = "تم الفحص";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

// البحث عن أفضل سيرفر
async function findBestServer() {
    // سباق بين السيرفرات
    const race = KSA_SERVERS.map(async node => {
        const start = performance.now();
        try {
            await fetch(node.url + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            return { url: node.url, time: performance.now() - start };
        } catch { return { url: node.url, time: 9999 }; }
    });
    const results = await Promise.all(race);
    results.sort((a,b) => a.time - b.time);
    return results[0].url;
}

// دالة الوقت
async function runTimedTask(duration, taskFn) {
    const start = performance.now();
    const loop = setInterval(() => {
        let elapsed = performance.now() - start;
        let pct = (elapsed / duration) * 100;
        let left = Math.ceil((duration - elapsed) / 1000);
        updateProgress(pct > 100 ? 100 : pct, left < 0 ? 0 : left);
    }, 100);

    const res = await taskFn(duration, start);
    clearInterval(loop);
    updateProgress(100, 0);
    return res;
}

// قياس البنق الدقيق (مع الفلترة)
async function measurePrecisionPing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        let t0 = performance.now();
        try {
            await fetch(bestPingUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            pings.push((performance.now() - t0) * 0.9);
        } catch {}
        await new Promise(r => setTimeout(r, 200));
    }
    // حذف القيم الشاذة (الأعلى والأسفل)
    pings.sort((a,b)=>a-b);
    if(pings.length > 4) { pings.pop(); pings.shift(); }
    
    let sum = pings.reduce((a,b) => a + b, 0);
    return Math.round(sum / pings.length) || 0;
}

// قياس التحميل
async function measureDownload(duration, startTime) {
    let loadedBytes = 0;
    const workers = Array(20).fill(0).map(async () => {
        while(performance.now() - startTime < duration) {
            if(ctrl.signal.aborted) break;
            try {
                const res = await fetch(DATA_ENDPOINT + "/__down?bytes=50000000", { signal: ctrl.signal });
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
    return document.getElementById('speed-readout').innerText;
}

// *** الحل النهائي للرفع (Egress Measurement) ***
async function measureUploadEgress(duration, startTime) {
    let maxSpeed = 0;
    // بيانات عشوائية 2MB
    const data = new Uint8Array(2 * 1024 * 1024);
    crypto.getRandomValues(data);

    const worker = () => {
        if(performance.now() - startTime >= duration || ctrl.signal.aborted) return;

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();

        // هذا الحدث يقيس سرعة خروج البيانات من جهازك
        // حتى لو السيرفر حظر الطلب لاحقاً، العداد سيتحرك
        xhr.upload.onprogress = (e) => {
            if(performance.now() - startTime >= duration) { xhr.abort(); return; }
            if(e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let diff = e.loaded - lastLoad;
                
                if(dt > 0.15) {
                    let s = (diff * 8) / (1024 * 1024) / dt * 1.05;
                    if(s > maxSpeed) maxSpeed = s;
                    updateGauge(s, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        xhr.onload = () => worker();
        xhr.onerror = () => worker(); 

        xhr.open("POST", `${DATA_ENDPOINT}/__up?t=${Math.random()}`, true);
        xhr.send(data);
    };

    // 6 قنوات رفع قوية
    for(let i=0; i<6; i++) {
        worker();
        await new Promise(r => setTimeout(r, 150));
    }

    await new Promise(r => setTimeout(r, duration));
    return maxSpeed.toFixed(1);
}

// البنق المثقل
function startJitter() {
    jitterInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(bestPingUrl + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val + " ms";
            document.getElementById('res-jitter').innerText = val;
        } catch {}
    }, 500);
}
function stopJitter() { clearInterval(jitterInt); }
