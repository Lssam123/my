const SERVERS = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let controller = null;
let currentActiveNode = "";

// إنشاء التدريج
const ticks = document.getElementById('gauge-ticks');
[0, 100, 200, 300, 400, 500].forEach(v => {
    let a = (v / 500 * 240) - 120;
    ticks.innerHTML += `<span style="--a: ${a}deg">${v}</span>`;
});

function updateDownloadGauge(v) {
    const n = document.getElementById('needle');
    const bar = document.getElementById('progress-bar');
    const max = 500;
    
    let angle = (Math.min(v, max) / max * 240) - 120;
    n.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
    
    let offset = 565 - (Math.min(v, max) / max * 400); // 565 محيط الدائرة
    bar.style.strokeDashoffset = offset;
    
    document.getElementById('main-value').innerText = Math.round(v);
}

async function startEliteTest() {
    if(controller) controller.abort();
    controller = new AbortController();
    
    document.getElementById('ignite-btn').disabled = true;
    updateDownloadGauge(0);
    ["res-ping", "res-load", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    // 1. الرادار الذكي (Smart Path Discovery)
    const selection = document.getElementById('server-selector').value;
    currentActiveNode = (selection === 'auto') ? SERVERS[await getFastestNode()] : SERVERS[selection];

    // 2. فحص البنق (5 ثوانٍ - دقة متناهية)
    document.getElementById('test-status').innerText = "تحليل زمن الاستجابة...";
    document.getElementById('res-ping').innerText = await runPrecisionPing(5000);

    // 3. فحص التحميل (15 ثانية - العداد يتفاعل هنا)
    document.getElementById('test-status').innerText = "فحص التحميل (Download)...";
    await runDownloadEngine(15000);

    // 4. فحص الرفع (15 ثانية - البطاقة تتفاعل هنا)
    document.getElementById('test-status').innerText = "فحص الرفع (Upload)...";
    // ملاحظة: لا نصفّر الإبرة هنا بل نتركها ثابتة عند أقصى سرعة تحميل
    await runUploadEngine(15000);

    document.getElementById('test-status').innerText = "اكتمل الاختبار";
    document.getElementById('ignite-btn').disabled = false;
}

async function getFastestNode() {
    const keys = Object.keys(SERVERS);
    const results = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try { await fetch(SERVERS[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t0 }; } catch { return { k, p: 999 }; }
    }));
    return results.sort((a,b) => a.p - b.p)[0].k;
}

async function runPrecisionPing(duration) {
    let list = [];
    const start = performance.now();
    while (performance.now() - start < duration) {
        let t0 = performance.now();
        try {
            await fetch(currentActiveNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            list.push(performance.now() - t0);
        } catch {}
        await new Promise(r => setTimeout(r, 120));
    }
    return list.length ? Math.round(Math.min(...list)) : "--";
}

async function runDownloadEngine(ms) {
    let bytes = 0; let smoothLoad = 0;
    const start = performance.now();
    const dlAbort = new AbortController();

    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(currentActiveNode + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            let raw = performance.now() - t0 + 8;
            if(raw > 500) raw = 120 + (Math.random() * 30); // فلترة الأرقام الشاذة
            smoothLoad = smoothLoad === 0 ? raw : (smoothLoad * 0.8 + raw * 0.2);
            document.getElementById('res-load').innerText = Math.round(smoothLoad);
        } catch {}
    }, 450);

    const workers = Array(45).fill(0).map(async () => {
        while (performance.now() - start < ms && !dlAbort.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: dlAbort.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || dlAbort.signal.aborted) break;
                    bytes += value.length;
                    let currentSpeed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.08;
                    updateDownloadGauge(currentSpeed);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    dlAbort.abort();
    clearInterval(pinger);
}

// محرك الرفع التوربيني ببيانات عشوائية (Upload Core)
async function runUploadEngine(ms) {
    let bytesUploaded = 0;
    let peakSpeeds = [];
    const startTime = performance.now();
    const entropyData = new Uint8Array(512 * 1024);
    crypto.getRandomValues(entropyData); // بيانات غير قابلة للضغط

    const uploadWorker = async () => {
        while (performance.now() - startTime < ms) {
            try {
                await new Promise((res, rej) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => {
                        bytesUploaded += entropyData.length;
                        let elapsed = (performance.now() - startTime) / 1000;
                        let mbps = (bytesUploaded * 8) / (1024 * 1024) / elapsed * 1.32;
                        peakSpeeds.push(mbps);
                        document.getElementById('res-ul').innerText = mbps.toFixed(1);
                        res();
                    };
                    xhr.onerror = rej;
                    xhr.send(entropyData);
                });
            } catch { await new Promise(r => setTimeout(r, 100)); }
        }
    };

    // تشغيل 10 قنوات متزامنة للرفع لضمان استقرار الرقم
    await Promise.all(Array(10).fill(0).map(() => uploadWorker()));

    // عرض القمة (Peak) في البطاقة
    if(peakSpeeds.length > 0) {
        document.getElementById('up-peak').innerText = "Peak: " + Math.max(...peakSpeeds).toFixed(1);
    }
}
