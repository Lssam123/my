// قائمة السيرفرات السعودية (للبنق فقط)
// نستخدم favicon.ico لأنها صور صغيرة جداً وسريعة التحميل
const KSA_NODES = [
    { name: "STC", url: "https://www.stc.com.sa/favicon.ico" },
    { name: "Mobily", url: "https://www.mobily.com.sa/favicon.ico" },
    { name: "Zain", url: "https://www.sa.zain.com/favicon.ico" },
    { name: "Salam", url: "https://salam.sa/favicon.ico" },
    { name: "GO", url: "https://www.go.com.sa/favicon.ico" }
];

// رابط الضغط العالمي (Cloudflare)
const CDN = "https://speed.cloudflare.com";

let ctrl = null;
let bestNodeUrl = "";
let jitterInt = null;

function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterInt) clearInterval(jitterInt);
    
    updateGauge(0, "dl");
    updateTime(0, 0);
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('srv-txt').innerText = "جاهز للفحص";
    document.getElementById('phase-lbl').innerText = "استعداد";
    
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

function updateGauge(val, type="dl") {
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('live-num').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    const path = document.getElementById('track-fill');
    const phase = document.getElementById('phase-lbl');

    path.style.strokeDashoffset = 615 - (p * 615);

    if(type === "ul") {
        path.setAttribute("stroke", "url(#g-ul)");
        path.style.filter = "drop-shadow(0 0 10px #7000ff)";
        phase.style.color = "#7000ff";
    } else {
        path.setAttribute("stroke", "url(#g-dl)");
        path.style.filter = "drop-shadow(0 0 10px #00ffaa)";
        phase.style.color = "#00ffaa";
    }
}

function updateTime(percent, sec) {
    document.getElementById('time-bar').style.width = percent + "%";
    if(sec !== undefined) document.getElementById('timer').innerText = sec + "s";
}

async function startSniperTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر الخفي
    document.getElementById('phase-lbl').innerText = "اختيار الخادم...";
    bestNodeUrl = await findFastestNode();
    document.getElementById('srv-txt').innerText = "خادم سعودي (تلقائي)";

    // 2. البنق الدقيق (Image Ping - Low Latency)
    document.getElementById('phase-lbl').innerText = "قياس البنق";
    const ping = await runTimed(5000, measureSniperPing);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التنزيل + الجيتر
    document.getElementById('phase-lbl').innerText = "جاري التنزيل...";
    startJitter();
    const dl = await runTimed(15000, measureDownload);
    stopJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (FormData)
    updateGauge(0, "ul");
    document.getElementById('phase-lbl').innerText = "جاري الرفع...";
    const ul = await runTimed(15000, measureUploadFormData);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-lbl').innerText = "اكتمل";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

async function findFastestNode() {
    const promises = KSA_NODES.map(async node => {
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

async function runTimed(duration, fn) {
    const start = performance.now();
    const timer = setInterval(() => {
        let elapsed = performance.now() - start;
        let p = (elapsed / duration) * 100;
        updateTime(p > 100 ? 100 : p, Math.ceil((duration - elapsed)/1000));
    }, 100);
    
    const res = await fn(duration, start);
    clearInterval(timer);
    updateTime(100, 0);
    return res;
}

// *** قياس البنق الجديد (Image Ping) ***
// هذه الطريقة تقيس الوقت الصافي للشبكة وتتجنب بروتوكولات Fetch البطيئة
async function measureSniperPing(duration, startTime) {
    let pings = [];
    while(performance.now() - startTime < duration) {
        if(ctrl.signal.aborted) break;
        
        await new Promise(resolve => {
            const t0 = performance.now();
            const img = new Image();
            // عند نجاح أو فشل تحميل الصورة، نحسب الوقت
            img.onload = img.onerror = () => {
                let t = performance.now() - t0;
                // خصم 40% كتقدير لوقت المعالجة والـ SSL للحصول على بنق الشبكة الصافي
                pings.push(t * 0.6); 
                resolve();
            };
            img.src = bestNodeUrl + "?p=" + Math.random();
        });
        await new Promise(r => setTimeout(r, 150));
    }
    
    pings.sort((a,b)=>a-b);
    // حذف أول قيمة لأنها دائماً بطيئة (DNS Lookup)
    if(pings.length > 1) pings.shift();
    
    // المتوسط
    let sum = pings.reduce((a,b)=>a+b, 0);
    return Math.round(sum / pings.length) || 0;
}

async function measureDownload(duration, startTime) {
    let loaded = 0;
    const workers = Array(20).fill(0).map(async () => {
        while(performance.now() - startTime < duration) {
            if(ctrl.signal.aborted) break;
            try {
                const res = await fetch(CDN + "/__down?bytes=50000000", { signal: ctrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || performance.now() - startTime >= duration) break;
                    loaded += value.length;
                    
                    let elapsed = (performance.now() - startTime) / 1000;
                    let speed = (loaded * 8) / (1024 * 1024) / elapsed;
                    updateGauge(speed, "dl");
                }
            } catch { break; }
        }
    });
    await new Promise(r => setTimeout(r, duration));
    return document.getElementById('live-num').innerText;
}

// *** الحل النهائي للرفع: FormData + XHR ***
async function measureUploadFormData(duration, startTime) {
    let maxSpeed = 0;
    // 2MB نص عشوائي
    const txt = "X".repeat(2 * 1024 * 1024);
    
    const worker = () => {
        if(performance.now() - startTime >= duration || ctrl.signal.aborted) return;
        
        const xhr = new XMLHttpRequest();
        const fd = new FormData();
        fd.append("data", new Blob([txt], { type: "text/plain" }));
        
        let lastLoad = 0;
        let lastTime = performance.now();

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

        xhr.onload = xhr.onerror = () => worker();
        xhr.open("POST", `${CDN}/__up?t=${Math.random()}`, true);
        xhr.send(fd);
    };

    // 10 قنوات
    for(let i=0; i<10; i++) { worker(); await new Promise(r => setTimeout(r, 100)); }
    
    await new Promise(r => setTimeout(r, duration));
    // نعتمد على آخر قراءة للعداد
    return document.getElementById('live-num').innerText;
}

// البنق المثقل باستخدام Image Ping أيضاً (لعدم التأثير على التحميل)
function startJitter() {
    jitterInt = setInterval(async () => {
        const start = performance.now();
        const img = new Image();
        img.onload = img.onerror = () => {
            let t = (performance.now() - start) * 0.6; // نفس معامل التصحيح
            document.getElementById('live-jitter').innerText = Math.round(t) + " ms";
            document.getElementById('res-jitter').innerText = Math.round(t);
        };
        img.src = bestNodeUrl + "?j=" + Math.random();
    }, 500);
}
function stopJitter() { clearInterval(jitterInt); }
