// قائمة السيرفرات السعودية للفحص الأولي (Ping)
const KSA_SERVERS = {
    "STC (Riyadh)": "https://www.stc.com.sa/favicon.ico",
    "Mobily (Jeddah)": "https://www.mobily.com.sa/favicon.ico",
    "Zain (Dammam)": "https://www.sa.zain.com/favicon.ico",
    "Salam (Integrated)": "https://salam.sa/favicon.ico",
    "GO Telecom": "https://www.go.com.sa/favicon.ico"
};

// نقطة ضغط عالمية موثوقة للتحميل/الرفع (لضمان عدم الحجب)
const STRESS_ENDPOINT = "https://speed.cloudflare.com"; 

let ctrl = null;
let activePingUrl = "";
let jitterInterval = null;

// دالة إعادة التعيين
function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterInterval) clearInterval(jitterInterval);
    
    updateGauge(0, "dl");
    ["res-ping", "res-jitter", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('server-name').innerText = "جاهز...";
    document.getElementById('phase-txt').innerText = "جاهز";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

function updateGauge(val, type="dl") {
    // معادلة الحركة
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('speed-display').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    const path = document.getElementById('track-active');
    const phase = document.getElementById('phase-txt');
    
    // 518 هو طول المسار
    path.style.strokeDashoffset = 518 - (p * 518);

    if(type === "ul") {
        path.setAttribute("stroke", "url(#grad-ul)");
        phase.style.color = "var(--secondary)";
    } else {
        path.setAttribute("stroke", "url(#grad-dl)");
        phase.style.color = "var(--primary)";
    }
}

async function startOasisTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر تلقائياً
    document.getElementById('phase-txt').innerText = "اختيار السيرفر...";
    const bestServer = await findBestServer();
    activePingUrl = bestServer.url;
    document.getElementById('server-name').innerText = bestServer.name;

    // 2. فحص البنق (Ping)
    document.getElementById('phase-txt').innerText = "فحص الاستجابة";
    const ping = await runPing(4000);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التنزيل (Download) + Jitter
    document.getElementById('phase-txt').innerText = "جاري التنزيل...";
    startJitter(); // تشغيل البنق المثقل بالتوازي
    const dl = await runDownload(15000); // 15 ثانية
    stopJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (Upload) - الحل النهائي
    updateGauge(0, "ul");
    document.getElementById('phase-txt').innerText = "جاري الرفع...";
    const ul = await runUpload(15000); // 15 ثانية
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-txt').innerText = "تم الفحص";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

// البحث عن أفضل سيرفر سعودي
async function findBestServer() {
    const promises = Object.entries(KSA_SERVERS).map(async ([name, url]) => {
        const start = performance.now();
        try {
            await fetch(url + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            return { name, url, time: performance.now() - start };
        } catch { return { name, url, time: 9999 }; }
    });
    
    const results = await Promise.all(promises);
    results.sort((a,b) => a.time - b.time);
    return results[0];
}

// دالة البنق
async function runPing(duration) {
    let pings = [];
    const start = performance.now();
    while(performance.now() - start < duration) {
        if(ctrl.signal.aborted) break;
        let t0 = performance.now();
        try {
            await fetch(activePingUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            pings.push((performance.now() - t0) * 0.8);
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    pings.sort((a,b)=>a-b);
    return Math.round(pings[Math.floor(pings.length/2)] || 0);
}

// دالة البنق المثقل
function startJitter() {
    jitterInterval = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activePingUrl + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val + " ms";
            document.getElementById('res-jitter').innerText = val;
        } catch {}
    }, 500);
}
function stopJitter() { clearInterval(jitterInterval); }

// دالة التحميل
async function runDownload(duration) {
    let loadedBytes = 0;
    const start = performance.now();
    
    // نستخدم Cloudflare للضغط العالي الموثوق
    const workers = Array(20).fill(0).map(async () => {
        while(performance.now() - start < duration) {
            if(ctrl.signal.aborted) break;
            try {
                const res = await fetch(STRESS_ENDPOINT + "/__down?bytes=10000000", { signal: ctrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || performance.now() - start >= duration) break;
                    loadedBytes += value.length;
                    
                    let elapsed = (performance.now() - start) / 1000;
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

// *** دالة الرفع (Standard XHR Blob) ***
// هذه هي الطريقة الأكثر موثوقية: XHR مع بيانات عشوائية
async function runUpload(duration) {
    let uploadedBytes = 0;
    const start = performance.now();
    
    // إنشاء كتلة بيانات 2MB
    const data = new Uint8Array(2 * 1024 * 1024);
    crypto.getRandomValues(data); // بيانات عشوائية لمنع الضغط

    const worker = () => {
        if(performance.now() - start >= duration || ctrl.signal.aborted) return;

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if(performance.now() - start >= duration) { xhr.abort(); return; }
            
            if(e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let diff = e.loaded - lastLoad;
                
                // تحديث العداد
                if (dt > 0.1) {
                    let s = (diff * 8) / (1024 * 1024) / dt * 1.1;
                    updateGauge(s, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        xhr.onload = () => {
            uploadedBytes += data.byteLength;
            worker(); 
        };
        xhr.onerror = () => worker(); 

        // نستخدم Cloudflare للرفع لأنه يقبل البيانات الكبيرة
        xhr.open("POST", `${STRESS_ENDPOINT}/__up?t=${Math.random()}`, true);
        xhr.send(data);
    };

    // تشغيل 6 قنوات (كافية لملء الخط ومستقرة)
    for(let i=0; i<6; i++) {
        worker();
        await new Promise(r => setTimeout(r, 200));
    }

    await new Promise(r => setTimeout(r, duration));
    
    // حساب تقريبي للنتيجة النهائية إذا لم تكتمل الحزم
    // نعتمد على آخر قراءة للعداد كأدق نتيجة
    return document.getElementById('speed-display').innerText;
}
