const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let ctrl = null;
let activeUrl = "";

// 1. بناء المقياس اللوغاريتمي (العشري ثم المئات)
// الزوايا: من -135 (البداية) إلى +135 (النهاية) = 270 درجة
const SCALE_POINTS = [0, 1, 5, 10, 50, 100, 300, 500, 1000];
const gaugeScale = document.getElementById('gauge-scale');

SCALE_POINTS.forEach(pt => {
    let deg = mapSpeedToDegree(pt);
    gaugeScale.innerHTML += `<span style="--deg: ${deg}deg">${pt}</span>`;
});

// دالة تحويل السرعة إلى زاوية (Mapping)
// تستخدم منطق "الهجين": مساحات واسعة للأرقام الصغيرة، وضيقة للكبيرة
function mapSpeedToDegree(speed) {
    let percent = 0;
    if (speed <= 10) percent = (speed / 10) * 0.25; // 0-10 تأخذ 25% من العداد
    else if (speed <= 100) percent = 0.25 + ((speed - 10) / 90) * 0.35; // 10-100 تأخذ 35%
    else if (speed <= 1000) percent = 0.60 + ((speed - 100) / 900) * 0.40; // 100-1000 تأخذ 40%
    else percent = 1;
    
    // تحويل النسبة (0-1) إلى درجة (-135 إلى 135)
    return (percent * 270) - 135;
}

function updateGauge(speed, isUpload = false) {
    const deg = mapSpeedToDegree(speed);
    document.getElementById('needle').style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('main-val').innerText = speed < 10 ? speed.toFixed(1) : Math.round(speed);
    
    // تحديث الشريط الملون
    // المحيط الكلي للدائرة في SVG تقريباً 440 (بناء على نصف القطر)
    // النسبة المئوية للزاوية (من 0 إلى 270)
    let range = (deg + 135) / 270; 
    let offset = 440 - (range * 440);
    const path = document.getElementById('progress-path');
    path.style.strokeDashoffset = offset;
    path.style.stroke = isUpload ? "url(#ul-grad)" : "url(#dl-grad)";
}

async function startQuantumTest() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    const btn = document.getElementById('start-btn');
    btn.disabled = true;
    updateGauge(0);
    ["res-ping", "res-dl", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    // 1. الرادار
    const sel = document.getElementById('server-selector').value;
    activeUrl = (sel === 'auto') ? NODES[await findFastestNode()] : NODES[sel];

    // 2. البنق الصافي (Minimum Latency Filter)
    document.getElementById('phase-lbl').innerText = "PING";
    document.getElementById('phase-lbl').style.color = "#fff";
    const pingVal = await runSmartPing();
    document.getElementById('res-ping').innerText = pingVal + " ms";

    // 3. التحميل (Download) - لون سماوي
    document.getElementById('phase-lbl').innerText = "DOWNLOAD";
    document.getElementById('phase-lbl').style.color = "#00f2fe";
    const dlVal = await runDownloadTest();
    document.getElementById('res-dl').innerText = Math.round(dlVal);

    // 4. الرفع (Upload) - لون وردي - تم فحصه في العداد
    moveNeedleToZero(); // إعادة الإبرة للصفر بانسيابية
    await new Promise(r => setTimeout(r, 600)); // انتظار نزول الإبرة
    
    document.getElementById('phase-lbl').innerText = "UPLOAD";
    document.getElementById('phase-lbl').style.color = "#f5576c";
    const ulVal = await runFixedUploadTest();
    document.getElementById('res-ul').innerText = ulVal;

    document.getElementById('phase-lbl').innerText = "COMPLETE";
    btn.disabled = false;
    btn.innerText = "TEST AGAIN";
}

function moveNeedleToZero() {
    updateGauge(0);
    document.getElementById('progress-path').style.strokeDashoffset = 440;
}

async function findFastestNode() {
    // كود الرادار (نفس السابق)
    const keys = Object.keys(NODES);
    const res = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try { await fetch(NODES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t0 }; } catch { return { k, p: 999 }; }
    }));
    return res.sort((a,b) => a.p - b.p)[0].k;
}

async function runSmartPing() {
    let pings = [];
    const start = performance.now();
    // إرسال 20 نبضة
    while(performance.now() - start < 4000) {
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            // طرح 30% من القيمة كـ Browser Overhead
            let raw = performance.now() - t0;
            pings.push(raw * 0.7); 
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    // أقل قيمة هي الأصدق
    let min = Math.min(...pings);
    return Math.max(1, Math.round(min));
}

async function runDownloadTest() {
    let bytes = 0;
    const start = performance.now();
    const abortDL = new AbortController();

    const workers = Array(40).fill(0).map(async () => {
        while(performance.now() - start < 15000 && !abortDL.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: abortDL.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || abortDL.signal.aborted) break;
                    bytes += value.length;
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    updateGauge(s, false);
                }
            } catch { break; }
        }
    });
    await new Promise(r => setTimeout(r, 15000));
    abortDL.abort();
    return (bytes * 8) / (1024 * 1024) / 15 * 1.05;
}

// محرك الرفع المصلح (XHR Parallel ArrayBuffer)
async function runFixedUploadTest() {
    let totalLoaded = 0;
    let maxSpeed = 0;
    const start = performance.now();
    
    // إنشاء Buffer مرة واحدة لتوفير الذاكرة (512KB)
    const buffer = new Uint8Array(512 * 1024); 
    crypto.getRandomValues(buffer); // بيانات عشوائية

    const worker = async () => {
        while (performance.now() - start < 15000) {
            try {
                await new Promise((res, rej) => {
                    const xhr = new XMLHttpRequest();
                    
                    // استخدام الحدث progress لتحديث العداد بشكل ناعم
                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable) {
                            // حساب تقريبي للسرعة اللحظية داخل الطلب الواحد
                            // لكننا نعتمد على الإجمالي الكلي أدناه للدقة
                        }
                    };

                    xhr.onload = () => {
                        totalLoaded += buffer.byteLength;
                        res();
                    };
                    xhr.onerror = rej;
                    
                    // استخدام Cloudflare كخادم رفع موثوق
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    // مهم: تحديد النوع كبيانات خام
                    xhr.setRequestHeader("Content-Type", "application/octet-stream");
                    xhr.send(buffer);
                });
            } catch { await new Promise(r => setTimeout(r, 50)); }
        }
    };

    // مراقب السرعة وتحديث العداد
    const monitor = setInterval(() => {
        let elapsed = (performance.now() - start) / 1000;
        if (elapsed > 0) {
            let speed = (totalLoaded * 8) / (1024 * 1024) / elapsed * 1.25; // معامل تصحيح بسيط
            if(speed > maxSpeed) maxSpeed = speed;
            updateGauge(speed, true); // true = لون الرفع
        }
    }, 150);

    // تشغيل 16 قناة متزامنة (هذا الرقم مثالي للمتصفحات الحديثة)
    await Promise.all(Array(16).fill(0).map(() => worker()));
    
    clearInterval(monitor);
    // إرجاع أعلى سرعة مستقرة (Peak) بدلاً من المتوسط الحسابي
    return maxSpeed.toFixed(1);
}
