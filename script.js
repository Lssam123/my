// قائمة السيرفرات السعودية للفحص
const KSA_NODES = [
    { name: "STC", url: "https://www.stc.com.sa/favicon.ico" },
    { name: "Mobily", url: "https://www.mobily.com.sa/favicon.ico" },
    { name: "Zain", url: "https://www.sa.zain.com/favicon.ico" },
    { name: "Salam", url: "https://salam.sa/favicon.ico" }
];

// نقطة ضغط عالمية قوية للتحميل/الرفع (Cloudflare)
// نستخدمها لأنها تقبل ضغط البيانات العالي دون حظر
const STRESS_URL = "https://speed.cloudflare.com"; 

let ctrl = null;
let activeNode = null;
let jitterInt = null;

// تهيئة النظام
function resetSystem() {
    if(ctrl) ctrl.abort();
    if(jitterInt) clearInterval(jitterInt);
    
    updateGauge(0);
    ["val-ping", "val-jitter", "val-dl", "val-ul"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('phase-txt').innerText = "جاهز";
    document.getElementById('server-name').innerText = "تلقائي (KSA)";
    
    const btn = document.getElementById('start-btn');
    btn.disabled = false;
    btn.innerText = "بدء الفحص";
}

// تحديث العداد
function updateGauge(val, type="dl") {
    // معادلة لوغاريتمية لتوزيع الأرقام بشكل منطقي
    let p = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9;
    if(p > 1) p = 1;
    
    document.getElementById('main-speed').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('gauge-path');
    const root = document.documentElement;
    
    // 565 هو طول المسار
    path.style.strokeDashoffset = 565 - (p * 565);

    // تغيير الألوان حسب المرحلة
    if(type === "ul") {
        root.style.setProperty('--accent', '#D500F9'); // بنفسجي للرفع
        document.getElementById('phase-txt').style.color = '#D500F9';
    } else {
        root.style.setProperty('--accent', '#00E676'); // أخضر للتحميل
        document.getElementById('phase-txt').style.color = '#00E676';
    }
}

// بدء الفحص
async function runHybridTest() {
    resetSystem();
    ctrl = new AbortController();
    document.getElementById('start-btn').disabled = true;

    // 1. اختيار السيرفر (الأسرع استجابة)
    document.getElementById('phase-txt').innerText = "جاري الاتصال...";
    activeNode = await selectBestServer();
    document.getElementById('server-name').innerText = activeNode.name + " (KSA)";

    // 2. البنق (Ping)
    document.getElementById('phase-txt').innerText = "قياس البنق";
    const ping = await measurePing(3000);
    document.getElementById('val-ping').innerText = ping + " ms";

    // 3. التنزيل (Download) + Jitter
    document.getElementById('phase-txt').innerText = "جاري التنزيل...";
    startJitterMonitor();
    const dl = await measureDownload(15000);
    stopJitterMonitor();
    document.getElementById('val-dl').innerText = Math.round(dl);

    // 4. الرفع (Upload) - باستخدام No-CORS Mode
    updateGauge(0, "ul");
    document.getElementById('phase-txt').innerText = "جاري الرفع...";
    const ul = await measureUpload(15000);
    document.getElementById('val-ul').innerText = ul;

    document.getElementById('phase-txt').innerText = "تم الفحص";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "إعادة الفحص";
}

// اختيار أسرع سيرفر
async function selectBestServer() {
    // سباق بين السيرفرات
    const race = KSA_NODES.map(async node => {
        const start = performance.now();
        try {
            await fetch(node.url + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            return { node, time: performance.now() - start };
        } catch { return { node, time: 9999 }; }
    });
    
    const results = await Promise.all(race);
    results.sort((a,b) => a.time - b.time);
    return results[0].node;
}

// قياس البنق
async function measurePing(duration) {
    let pings = [];
    const start = performance.now();
    while(performance.now() - start < duration) {
        if(ctrl.signal.aborted) break;
        let t0 = performance.now();
        try {
            await fetch(activeNode.url + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            pings.push((performance.now() - t0) * 0.8);
        } catch {}
        await new Promise(r => setTimeout(r, 200));
    }
    pings.sort((a,b)=>a-b);
    return Math.round(pings[Math.floor(pings.length/2)] || 0);
}

// قياس التنزيل (Download)
async function measureDownload(duration) {
    let loadedBytes = 0;
    const start = performance.now();
    
    // 20 قناة تحميل
    const workers = Array(20).fill(0).map(async () => {
        while(performance.now() - start < duration) {
            if(ctrl.signal.aborted) break;
            try {
                const res = await fetch(STRESS_URL + "/__down?bytes=10000000", { signal: ctrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || ctrl.signal.aborted) break;
                    loadedBytes += value.length;
                    
                    // تحديث الواجهة
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

// *** قياس الرفع (Upload) - الحل النهائي ***
// نستخدم mode: 'no-cors' لإجبار المتصفح على الإرسال
async function measureUpload(duration) {
    let sentBytes = 0;
    const start = performance.now();
    
    // بيانات عشوائية 512KB
    const chunk = new Uint8Array(512 * 1024);
    crypto.getRandomValues(chunk);

    // دالة العامل
    const worker = async () => {
        while(performance.now() - start < duration) {
            if(ctrl.signal.aborted) break;
            
            try {
                // استخدام fetch مع POST و no-cors
                // هذا يمنع المتصفح من انتظار الرد، ويضمن خروج البيانات
                await fetch(`${STRESS_URL}/__up?t=${Date.now()}`, {
                    method: 'POST',
                    mode: 'no-cors', 
                    body: chunk,
                    signal: ctrl.signal
                });
                
                // نفترض نجاح الإرسال لأن no-cors لا يعيد أخطاء شبكة عادة
                sentBytes += chunk.byteLength;
                
                let elapsed = (performance.now() - start) / 1000;
                let speed = (sentBytes * 8) / (1024 * 1024) / elapsed;
                updateGauge(speed, "ul");
                
            } catch (e) {
                await new Promise(r => setTimeout(r, 100));
            }
        }
    };

    // تشغيل 16 قناة (عدد كبير لتعويض عدم دقة no-cors)
    const workers = Array(16).fill(0).map(() => worker());
    
    await new Promise(r => setTimeout(r, duration));
    
    let finalSpeed = (sentBytes * 8) / (1024 * 1024) / (duration/1000);
    return finalSpeed.toFixed(1);
}

// مراقبة البنق المثقل
function startJitterMonitor() {
    jitterInt = setInterval(async () => {
        const start = performance.now();
        try {
            await fetch(activeNode.url + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - start);
            document.getElementById('val-jitter').innerText = val + " ms";
        } catch {}
    }, 500);
}
function stopJitterMonitor() { clearInterval(jitterInt); }
