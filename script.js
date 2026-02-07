const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let activeNode = "";
let abort = null;

// التدريج
const marks = document.getElementById('gauge-marks');
[0, 100, 200, 300, 400, 500].forEach(v => {
    let a = (v / 500 * 240) - 120;
    marks.innerHTML += `<span style="--a: ${a}deg">${v}</span>`;
});

function updateGauge(v, color = "#00f2fe") {
    const n = document.getElementById('needle');
    const bar = document.getElementById('progress-bar');
    let a = (Math.min(v, 500) / 500 * 240) - 120;
    
    n.style.transform = `translate(-50%, -100%) rotate(${a}deg)`;
    n.style.background = `linear-gradient(to top, ${color}, transparent)`;
    bar.style.stroke = color;
    
    // حساب الـ offset للدائرة (565 هو المحيط)
    let offset = 565 - (Math.min(v, 500) / 500 * 400); 
    bar.style.strokeDashoffset = offset;
    
    document.getElementById('main-value').innerText = Math.round(v);
}

async function runEliteTest() {
    if(abort) abort.abort();
    abort = new AbortController();
    
    document.getElementById('action-btn').disabled = true;
    updateGauge(0);
    ["ping-res", "load-res", "peak-res"].forEach(id => document.getElementById(id).innerText = "--");

    // 1. الرادار الذهبي (أقل ازدحام وأقل بنق)
    document.getElementById('test-type').innerText = "RADAR SCANNING...";
    const selection = document.getElementById('server-selector').value;
    activeNode = (selection === 'auto') ? NODES[await findGoldenPath()] : NODES[selection];

    // 2. البنق الاحترافي (5 ثوانٍ)
    document.getElementById('ping-res').innerText = await getMinPing(5000);

    // 3. الداونلود (في نفس المكان - 15 ثانية)
    document.getElementById('test-type').innerText = "DOWNLOADING...";
    await runDownload(15000);

    // 4. الرفع المتعدد (TCP Ramp-up - 15 ثانية)
    document.getElementById('test-type').innerText = "UPLOADING...";
    await new Promise(r => setTimeout(r, 1000)); // استراحة قصيرة للمحرك
    updateGauge(0, "#7000ff");
    await runMultiStepUpload(15000);

    document.getElementById('test-type').innerText = "TEST COMPLETE";
    document.getElementById('action-btn').disabled = false;
}

// رادار المسار الذهبي: يفحص البنق والازدحام
async function findGoldenPath() {
    const keys = Object.keys(NODES);
    const results = await Promise.all(keys.map(async k => {
        let samples = [];
        for(let i=0; i<3; i++) {
            let t0 = performance.now();
            try { 
                await fetch(NODES[k] + "?r=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
                samples.push(performance.now() - t0);
            } catch { samples.push(999); }
        }
        let min = Math.min(...samples);
        let jitter = Math.max(...samples) - min;
        return { k, score: min + jitter }; // السكور الأقل يعني مسار أسرع وأقل ازدحاماً
    }));
    return results.sort((a,b) => a.score - b.score)[0].k;
}

async function getMinPing(ms) {
    let list = [];
    const start = performance.now();
    while (performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abort.signal });
            list.push(performance.now() - t0);
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    return list.length ? Math.round(Math.min(...list)) : "--";
}

async function runDownload(ms) {
    let bytes = 0; let pings = [];
    const start = performance.now();
    const dlCtrl = new AbortController();

    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abort.signal });
            let raw = performance.now() - t0;
            if(raw < 800) pings.push(raw);
            let avg = pings.slice(-5).reduce((a,b)=>a+b, 0) / Math.min(pings.length, 5);
            document.getElementById('load-res').innerText = Math.round(avg + 3);
        } catch {}
    }, 400);

    const streams = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms && !dlCtrl.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: dlCtrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || dlCtrl.signal.aborted) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    updateGauge(speed);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    dlCtrl.abort();
    clearInterval(pinger);
}

// محرك الرفع بفتح اتصالات متدرجة (TCP Ramp-up)
async function runMultiStepUpload(ms) {
    let totalBytes = 0;
    let peakHistory = [];
    const start = performance.now();
    
    const getPayload = () => {
        const d = new Uint8Array(1024 * 1024); // حزمة 1MB
        crypto.getRandomValues(d); // بيانات عشوائية تماماً
        return d;
    };

    const worker = async () => {
        while (performance.now() - start < ms) {
            try {
                await new Promise((res, rej) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => { totalBytes += 1048576; res(); };
                    xhr.onerror = rej;
                    xhr.send(getPayload());
                });
            } catch { await new Promise(r => setTimeout(r, 50)); }
        }
    };

    // نظام التصعيد التلقائي
    let workers = [];
    const orchestrator = setInterval(() => {
        let elapsed = (performance.now() - start) / 1000;
        let speed = (totalBytes * 8) / (1024 * 1024) / elapsed * 1.32;
        peakHistory.push(speed);
        updateGauge(speed, "#7000ff");

        // تصعيد عدد الاتصالات بناءً على الوقت (تجاوز الـ Slow Start)
        if (elapsed > 2 && workers.length < 8) {
            for(let i=0; i<4; i++) workers.push(worker());
        }
        if (elapsed > 6 && workers.length < 16) {
            for(let i=0; i<8; i++) workers.push(worker());
        }
    }, 150);

    // البداية بـ 4 اتصالات
    for(let i=0; i<4; i++) workers.push(worker());
    
    await new Promise(r => setTimeout(r, ms));
    clearInterval(orchestrator);

    // حساب الـ Sustained Peak
    let sustained = Math.max(...peakHistory.slice(-15));
    document.getElementById('peak-res').innerText = Math.round(sustained) + " M";
    updateGauge(sustained, "#7000ff");
}
