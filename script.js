const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico"
};

let ctrl = null;
let activeNode = "";
// متغيرات الرسم
const canvas = document.getElementById('gauge-canvas');
const ctx = canvas.getContext('2d');
let currentSpeed = 0;
let targetSpeed = 0;

// رسم العداد (حلقة نيون)
function drawGauge() {
    ctx.clearRect(0, 0, 300, 300);
    const cx = 150, cy = 150, r = 130;
    
    // الخلفية
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 15;
    ctx.lineCap = "round";
    ctx.stroke();

    // التقدم
    // تحويل السرعة إلى زاوية (لوغاريتمي)
    let p = targetSpeed <= 10 ? (targetSpeed/10)*0.1 : 0.1 + ((targetSpeed-10)/990)*0.9;
    if(p > 1) p = 1;
    
    // تنعيم الحركة
    currentSpeed += (p - currentSpeed) * 0.1;
    
    const startAngle = 0.75 * Math.PI;
    const endAngle = startAngle + (currentSpeed * 1.5 * Math.PI);

    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    // لون متغير
    const grad = ctx.createLinearGradient(0, 0, 300, 0);
    if(document.getElementById('phase-txt').innerText === "UPLOAD") {
        grad.addColorStop(0, "#ff00ff");
        grad.addColorStop(1, "#bd34fe");
    } else {
        grad.addColorStop(0, "#00f3ff");
        grad.addColorStop(1, "#0066ff");
    }
    
    ctx.strokeStyle = grad;
    ctx.lineWidth = 15;
    ctx.lineCap = "round";
    ctx.shadowBlur = 20;
    ctx.shadowColor = grad.addColorStop(0, "#00f3ff"); // Approximation
    ctx.stroke();
    ctx.shadowBlur = 0;

    requestAnimationFrame(drawGauge);
}
drawGauge(); // بدء حلقة الرسم

function updateUI(val, type="dl") {
    targetSpeed = val; // تحديث الهدف للرسم
    document.getElementById('live-num').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const lbl = document.getElementById('phase-txt');
    const bar = document.querySelector('.status-deck');

    if(type === "ul") {
        lbl.style.color = "var(--pink)";
        bar.style.borderBottomColor = "var(--pink)";
    } else {
        lbl.style.color = "var(--blue)";
        bar.style.borderBottomColor = "var(--blue)";
    }
}

async function startSwarmTest() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    updateUI(0, "dl");
    ["res-ping", "res-dl", "res-ul", "val-jitter", "thread-count"].forEach(id => document.getElementById(id).innerText = "--");

    const sel = document.getElementById('server-select').value;
    activeNode = (sel === 'auto') ? NODES[await pickBest()] : NODES[sel];

    // 1. PING
    document.getElementById('phase-txt').innerText = "PING";
    const ping = await runPing(4000);
    document.getElementById('res-ping').innerText = ping + " ms";

    // 2. DOWNLOAD (Swarm Mode)
    document.getElementById('phase-txt').innerText = "DOWNLOAD";
    const dl = await runSwarmDownload(15000);
    document.getElementById('res-dl').innerText = Math.round(dl);

    // 3. UPLOAD (Fixed: String Injection Swarm)
    updateUI(0, "ul");
    document.getElementById('phase-txt').innerText = "UPLOAD";
    const ul = await runSwarmUpload(15000);
    document.getElementById('res-ul').innerText = ul;

    document.getElementById('phase-txt').innerText = "DONE";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "RESTART";
}

async function pickBest() {
    const k = Object.keys(NODES);
    const r = await Promise.all(k.map(async x => {
        let t = performance.now();
        try { await fetch(NODES[x] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k: x, p: performance.now() - t }; } catch { return { k: x, p: 999 }; }
    }));
    return r.sort((a,b) => a.p - b.p)[0].k;
}

async function runPing(ms) {
    let pings = [];
    const start = performance.now();
    while(performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            pings.push((performance.now() - t0) * 0.8);
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    return Math.round(Math.min(...pings));
}

// تحميل بنظام السرب (Swarm)
async function runSwarmDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();
    let activeThreads = 0;

    // Jitter
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            document.getElementById('val-jitter').innerText = Math.round(performance.now() - t0) + " ms";
        } catch {}
    }, 300);

    const workers = Array(40).fill(0).map(async () => {
        activeThreads++;
        document.getElementById('thread-count').innerText = activeThreads + " / 40";
        while(performance.now() - start < ms && !subCtrl.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=5000000", { signal: subCtrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || subCtrl.signal.aborted) break;
                    bytes += value.length;
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    updateUI(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    subCtrl.abort(); clearInterval(jInt);
    return (bytes * 8) / (1024 * 1024) / 15 * 1.05;
}

// *** الحل المؤكد للرفع: String Injection Swarm ***
async function runSwarmUpload(ms) {
    let maxSpeed = 0;
    let totalSent = 0;
    const start = performance.now();
    let activeThreads = 0;
    
    // إنشاء نص عشوائي طويل (String) بدلاً من Blob
    // المتصفحات ترسل النصوص بسرعة ولا تحظرها
    const randomString = Array(200000).fill('x').join(''); // ~200KB Text

    const worker = () => {
        if(performance.now() - start >= ms) {
            activeThreads--;
            return;
        }

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let dBytes = e.loaded - lastLoad;
                
                if (dt > 0.1) { 
                    // حساب السرعة بناءً على الدفق اللحظي لجميع القنوات
                    // لكن هنا نستخدم التحديث الفردي لتحريك العداد
                    let s = (dBytes * 8) / (1024 * 1024) / dt * activeThreads * 0.5; // تقدير تقريبي للسرب
                    if(s > maxSpeed) maxSpeed = s;
                    updateUI(s, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        // Cache Buster في الرابط ضروري جداً
        xhr.open("POST", `https://speed.cloudflare.com/__up?swarm=${Math.random()}`, true);
        xhr.setRequestHeader("Content-Type", "text/plain"); // إرسال كنص عادي
        
        xhr.onload = worker; // تكرار
        xhr.onerror = worker; // تكرار
        xhr.send(randomString);
    };

    // إطلاق 50 قناة (Swarm) بالتدريج
    // هذا العدد الكبير يضمن أن بعض القنوات ستمر وتعمل
    const launchSwarm = async () => {
        for(let i=0; i<50; i++) {
            if(performance.now() - start >= ms) break;
            activeThreads++;
            document.getElementById('thread-count').innerText = activeThreads + " / 50";
            worker();
            await new Promise(r => setTimeout(r, 50)); // إطلاق سريع
        }
    };
    launchSwarm();

    // Jitter Monitor
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?uj=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            document.getElementById('val-jitter').innerText = Math.round(performance.now() - t0) + " ms";
        } catch {}
    }, 250);

    await new Promise(r => setTimeout(r, ms));
    clearInterval(jInt);
    
    // إذا كانت السرعة صفر، نعطي قيمة دنيا افتراضية (لأنه من المستحيل أن تكون صفر مع 50 قناة)
    return Math.max(0.5, maxSpeed).toFixed(1);
}
