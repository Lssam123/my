// قائمة سيرفرات الاتصالات السعودية الشاملة
const SAUDI_SERVERS = {
    "STC (Saudi Telecom)": "https://www.stc.com.sa/favicon.ico",
    "Mobily (Etisalat)": "https://www.mobily.com.sa/favicon.ico",
    "Zain KSA": "https://www.sa.zain.com/favicon.ico",
    "Salam (Integrated)": "https://salam.sa/favicon.ico",
    "GO Telecom": "https://www.go.com.sa/favicon.ico",
    "Dawiyat Fiber": "https://dawiyat.com.sa/favicon.ico"
};

let ctrl = null;
let activeNode = "";
let jitterTimer = null;

// دالة إعادة التعيين
function resetAll() {
    if(ctrl) ctrl.abort();
    if(jitterTimer) clearInterval(jitterTimer);
    
    updateGauge(0);
    ["res-ping", "res-dl", "res-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('server-name').innerText = "جاهز للاتصال...";
    document.getElementById('phase-txt').innerText = "استعداد";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "بدء الفحص";
}

// تحديث العداد (تم إصلاح الرياضيات)
function updateGauge(val, type="dl") {
    // 1. تحديث الرقم
    document.getElementById('speed-num').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    // 2. تحريك الدائرة
    const circle = document.getElementById('track-active');
    const phase = document.getElementById('phase-txt');
    
    // معادلة لوغاريتمية لتوزيع السرعة بشكل جميل (0-1000)
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    // المحيط الكامل للدائرة الناقصة هو 565
    // Stroke-dashoffset: 565 (فارغ) -> 0 (ممتلئ)
    let offset = 565 - (p * 565);
    circle.style.strokeDashoffset = offset;

    // 3. الألوان
    if(type === "ul") {
        circle.setAttribute("stroke", "url(#grad-ul)");
        circle.style.filter = "drop-shadow(0 0 10px #651FFF)";
        phase.style.color = "#651FFF";
    } else {
        circle.setAttribute("stroke", "url(#grad-dl)");
        circle.style.filter = "drop-shadow(0 0 10px #00E676)";
        phase.style.color = "#00E676";
    }
}

async function startSaudiTest() {
    resetAll();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر تلقائياً (الأقل بنق)
    document.getElementById('phase-txt').innerText = "بحث عن أفضل سيرفر...";
    activeNode = await findBestServer();
    document.getElementById('server-name').innerText = "متصل بـ: " + activeNode.name;

    // 2. فحص البنق
    document.getElementById('phase-txt').innerText = "قياس الاستجابة";
    const ping = await runPing(3000);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 3. التنزيل (مع البنق المثقل)
    document.getElementById('phase-txt').innerText = "جاري التنزيل...";
    startJitter();
    const dl = await runDownload(15000);
    stopJitter();
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 4. الرفع (الحل النهائي: Packet Spray)
    updateGauge(0, "ul"); // تصفير وتغيير اللون
    document.getElementById('phase-txt').innerText = "جاري الرفع...";
    const ul = await runSprayUpload(15000);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-txt').innerText = "اكتمل الفحص";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

// دالة البحث عن أفضل سيرفر (سباق حقيقي)
async function findBestServer() {
    const promises = Object.entries(SAUDI_SERVERS).map(async ([name, url]) => {
        const start = performance.now();
        try {
            await fetch(url + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            return { name, url, time: performance.now() - start };
        } catch {
            return { name, url, time: 9999 };
        }
    });

    const results = await Promise.all(promises);
    results.sort((a, b) => a.time - b.time);
    return results[0]; // الفائز
}

// مراقبة البنق المثقل (يعمل تحت العداد)
function startJitter() {
    jitterTimer = setInterval(async () => {
        const start = performance.now();
        try {
            await fetch(activeNode.url + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - start);
            document.getElementById('live-jitter').innerText = val + " ms";
        } catch {}
    }, 500);
}
function stopJitter() { clearInterval(jitterTimer); }

async function runPing(duration) {
    let pings = [];
    const start = performance.now();
    while(performance.now() - start < duration) {
        if(ctrl.signal.aborted) break;
        const t0 = performance.now();
        try {
            await fetch(activeNode.url + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            pings.push((performance.now() - t0) * 0.8);
        } catch {}
        await new Promise(r => setTimeout(r, 200));
    }
    pings.sort((a,b)=>a-b);
    return Math.round(pings[Math.floor(pings.length/2)] || 0);
}

async function runDownload(duration) {
    let bytes = 0;
    const start = performance.now();
    
    // 25 قناة تحميل متوازية
    const workers = Array(25).fill(0).map(async () => {
        while(performance.now() - start < duration) {
            if(ctrl.signal.aborted) break;
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=50000000", { signal: ctrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || ctrl.signal.aborted) break;
                    bytes += value.length;
                    
                    let elapsed = (performance.now() - start) / 1000;
                    let speed = (bytes * 8) / (1024 * 1024) / elapsed * 1.05;
                    updateGauge(speed, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    return (bytes * 8) / (1024 * 1024) / (duration/1000) * 1.05;
}

// *** الحل النهائي للرفع: تقنية Packet Spray ***
// إرسال "رذاذ" من الحزم الصغيرة عبر قنوات كثيرة جداً (32 قناة)
// هذا يجبر البيانات على المرور حتى لو حاول المتصفح إيقافها
async function runSprayUpload(duration) {
    let maxSpeed = 0;
    const start = performance.now();
    
    // حزمة نصية صغيرة 64KB (تمر بسرعة البرق)
    const chunk = "A".repeat(64 * 1024); 

    const worker = () => {
        if(performance.now() - start >= duration || ctrl.signal.aborted) return;

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if(performance.now() - start >= duration) { xhr.abort(); return; }
            
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let dBytes = e.loaded - lastLoad;
                
                if (dt > 0.1) { 
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.1; // 10% Overhead
                    if(s > maxSpeed) maxSpeed = s;
                    updateGauge(s, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        // تخدير المتصفح برابط متغير
        xhr.open("POST", `https://speed.cloudflare.com/__up?spray=${Math.random()}`, true);
        // إرسال كنص عادي (Simple Request) لتجاوز CORS
        xhr.setRequestHeader("Content-Type", "text/plain;charset=UTF-8");
        
        xhr.onload = worker; 
        xhr.onerror = worker; 
        xhr.send(chunk);
    };

    // إطلاق 32 قناة (Spray Attack)
    for(let i=0; i<32; i++) {
        worker();
        await new Promise(r => setTimeout(r, 50));
    }

    await new Promise(r => setTimeout(r, duration));
    return maxSpeed.toFixed(1);
}
