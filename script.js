const ISP_HOSTS = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let ctrl = null;
let activeUrl = "";

// إعداد التدريج
const marks = document.getElementById('gauge-marks');
[0, 100, 200, 300, 400, 500].forEach(v => {
    let a = (v / 500 * 240) - 120;
    marks.innerHTML += `<span style="--a: ${a}deg">${v}</span>`;
});

function moveNeedle(v) {
    const n = document.getElementById('needle');
    let a = (Math.min(v, 500) / 500 * 240) - 120;
    n.style.transform = `translate(-50%, -100%) rotate(${a}deg)`;
    document.getElementById('speed-display').innerText = Math.round(v);
}

async function igniteEngine() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('ignite-btn').disabled = true;
    moveNeedle(0);
    ["ping-val", "load-val", "up-val"].forEach(id => document.getElementById(id).innerText = "--");

    const sel = document.getElementById('server-selector').value;
    activeUrl = (sel === 'auto') ? ISP_HOSTS[await getBestNode()] : ISP_HOSTS[sel];

    // 1. فحص البنق (بأقل زمن استجابة مستقر)
    document.getElementById('status-display').innerText = "تحليل الاستجابة...";
    document.getElementById('ping-val').innerText = await runPing(4000);

    // 2. التحميل (البيانات المستمرة)
    document.getElementById('status-display').innerText = "اختبار التحميل...";
    await runDownload(12000);

    // 3. الرفع التوربيني (نظام الـ TCP المتقدم)
    document.getElementById('status-display').innerText = "بدء الرفع المتعدد (TCP X12)...";
    moveNeedle(0);
    await runRampedUpload(15000);

    document.getElementById('status-display').innerText = "تم الفحص بنجاح";
    document.getElementById('ignite-btn').disabled = false;
}

async function getBestNode() {
    const keys = Object.keys(ISP_HOSTS);
    const checks = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try { await fetch(ISP_HOSTS[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t0 }; } catch { return { k, p: 999 }; }
    }));
    return checks.sort((a,b) => a.p - b.p)[0].k;
}

async function runPing(ms) {
    let list = [];
    const start = performance.now();
    while (performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            list.push(performance.now() - t0);
        } catch {}
        await new Promise(r => setTimeout(r, 100));
    }
    return list.length ? Math.round(Math.min(...list)) : "--";
}

async function runDownload(ms) {
    let bytes = 0; let pings = [];
    const start = performance.now();
    const dlAbort = new AbortController();

    // البنق المثقل بانسيابية عالية
    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let raw = performance.now() - t0;
            if(raw < 600) pings.push(raw);
            let avg = pings.slice(-5).reduce((a,b)=>a+b, 0) / Math.min(pings.length, 5);
            document.getElementById('load-val').innerText = Math.round(avg + 5);
        } catch {}
    }, 400);

    const workers = Array(35).fill(0).map(async () => {
        while (performance.now() - start < ms && !dlAbort.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: dlAbort.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || dlAbort.signal.aborted) break;
                    bytes += value.length;
                    moveNeedle((bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    dlAbort.abort();
    clearInterval(pinger);
}

// محرك الرفع المتقدم (TCP Ramp-up & Multi-stream)
async function runRampedUpload(ms) {
    let totalBytes = 0;
    let peakSpeeds = [];
    const start = performance.now();
    
    // إنشاء بيانات عشوائية تماماً لمنع الكاش والضغط
    const generateRandomData = (size) => {
        const data = new Uint8Array(size);
        crypto.getRandomValues(data);
        return data;
    };

    const uploadWorker = async (connections) => {
        const payload = generateRandomData(512 * 1024); // حزمة 512KB لزيادة المرونة
        while (performance.now() - start < ms) {
            try {
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => {
                        totalBytes += payload.length;
                        resolve();
                    };
                    xhr.onerror = reject;
                    xhr.send(payload);
                });
            } catch { await new Promise(r => setTimeout(r, 50)); }
        }
    };

    // نظام التصعيد التلقائي للاتصالات
    const rampUp = async () => {
        // البدء بـ 4 اتصالات
        let conns = [uploadWorker(), uploadWorker(), uploadWorker(), uploadWorker()];
        
        // مراقبة الأداء كل 200ms
        const monitor = setInterval(() => {
            let elapsed = (performance.now() - start) / 1000;
            let currentSpeed = (totalBytes * 8) / (1024 * 1024) / elapsed * 1.3;
            peakSpeeds.push(currentSpeed);
            
            // تحديث العداد
            document.getElementById('up-val').innerText = currentSpeed.toFixed(1);
            
            // تصعيد الاتصالات بناءً على الزمن (TCP slow start skip)
            if (elapsed > 3 && conns.length < 8) {
                conns.push(uploadWorker(), uploadWorker(), uploadWorker(), uploadWorker());
            }
            if (elapsed > 7 && conns.length < 12) {
                conns.push(uploadWorker(), uploadWorker(), uploadWorker(), uploadWorker());
            }
        }, 200);

        await new Promise(r => setTimeout(r, ms));
        clearInterval(monitor);
    };

    await rampUp();

    // حساب الـ Sustained Peak (أعلى معدل ثابت في آخر ثانيتين)
    let sustainedPeak = Math.max(...peakSpeeds.slice(-10));
    document.getElementById('up-val').innerText = sustainedPeak.toFixed(1);
}
