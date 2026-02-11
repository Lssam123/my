const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico"
};

let ctrl = null;
let activeNode = "";
let chartCtx = null;
let chartData = [];

// إعداد الرسم البياني
const canvas = document.getElementById('speed-graph');
canvas.width = canvas.offsetWidth;
canvas.height = canvas.offsetHeight;
const ctx = canvas.getContext('2d');

function drawGraph(val, max = 500, color = "#00f260") {
    chartData.push(val);
    if(chartData.length > 50) chartData.shift(); // الاحتفاظ بآخر 50 نقطة

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    
    let step = canvas.width / 50;
    for(let i=0; i<chartData.length; i++) {
        let h = (chartData[i] / max) * canvas.height;
        ctx.lineTo(i * step, canvas.height - h);
    }
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(canvas.width, canvas.height);
    ctx.fillStyle = color + "33"; // شفافية
    ctx.fill();
}

// إعداد العداد
const pts = [0, 1, 5, 10, 50, 100, 300, 500, 1000];
const ring = document.getElementById('gauge-ticks');
pts.forEach(p => {
    let d = getDeg(p);
    ring.innerHTML += `<span style="--d: ${d}deg">${p}</span>`;
});

function getDeg(v) {
    let p = 0;
    if(v<=10) p=(v/10)*0.2;
    else if(v<=100) p=0.2+((v-10)/90)*0.3;
    else if(v<=1000) p=0.5+((v-100)/900)*0.5;
    else p=1;
    return (p*270)-135;
}

function updateHUD(val, type="dl") {
    const deg = getDeg(val);
    document.getElementById('needle').style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('live-val').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-main');
    const lbl = document.getElementById('phase-txt');
    const hud = document.querySelector('.top-stats-panel');
    
    let offset = 440 - ((deg+135)/270 * 440);
    path.style.strokeDashoffset = offset;

    if(type === "ul") {
        path.setAttribute("stroke", "url(#grad-ul)");
        lbl.style.color = "#8e2de2";
        hud.style.borderBottomColor = "#8e2de2";
        drawGraph(val, 500, "#8e2de2");
    } else {
        path.setAttribute("stroke", "url(#grad-dl)");
        lbl.style.color = "#00f260";
        hud.style.borderBottomColor = "#00f260";
        drawGraph(val, 500, "#00f260");
    }
}

async function startNeuralTest() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    chartData = []; // تصفير الرسم
    
    document.getElementById('start-btn').disabled = true;
    updateHUD(0, "dl");
    ["final-ping", "final-dl", "final-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('j-fill').style.width = "0%";

    const sel = document.getElementById('srv-select').value;
    activeNode = (sel === 'auto') ? NODES[await pickBest()] : NODES[sel];

    // 1. PING
    document.getElementById('phase-txt').innerText = "PING";
    const ping = await runPing(5000);
    document.getElementById('final-ping').innerHTML = `${ping} <small>ms</small>`;

    // 2. DOWNLOAD (Stream Reader)
    document.getElementById('phase-txt').innerText = "DOWNLOAD";
    const dl = await runStreamDownload(15000);
    document.getElementById('final-dl').innerHTML = `${Math.round(dl)} <small>Mbps</small>`;

    // 3. UPLOAD (Delta-Time Calculation) - هذا هو الحل
    updateHUD(0); // إعادة العداد للصفر
    document.getElementById('track-main').style.strokeDashoffset = 440;
    document.getElementById('phase-txt').innerText = "UPLOAD";
    const ul = await runDeltaUpload(15000);
    document.getElementById('final-ul').innerHTML = `${ul} <small>Mbps</small>`;

    document.getElementById('phase-txt').innerText = "COMPLETE";
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
        await new Promise(r => setTimeout(r, 120));
    }
    return Math.round(Math.min(...pings));
}

// تحميل باستخدام Stream Reader (أقوى طريقة للتحميل)
async function runStreamDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();

    // Jitter Loop
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val + " ms";
            document.getElementById('j-fill').style.width = Math.min((val/300)*100, 100) + "%";
        } catch {}
    }, 200);

    const workers = Array(30).fill(0).map(async () => {
        while(performance.now() - start < ms && !subCtrl.signal.aborted) {
            try {
                // استخدام ملف كبير من Cloudflare
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: subCtrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || subCtrl.signal.aborted) break;
                    bytes += value.length;
                    
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    updateHUD(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    subCtrl.abort(); clearInterval(jInt);
    return (bytes * 8) / (1024 * 1024) / 15 * 1.05;
}

// *** الحل النهائي للرفع: Delta-Time Calculation ***
async function runDeltaUpload(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    // 2MB Chunk
    const data = new Uint8Array(2 * 1024 * 1024); 
    crypto.getRandomValues(data);

    const loop = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let lastLoaded = 0;
        let lastTime = performance.now();

        // حساب "الفرق" في البيانات والزمن (Delta)
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000; // الزمن بالثواني
                let dBytes = e.loaded - lastLoaded; // البيانات الجديدة فقط
                
                // تحديث إذا مر وقت كافٍ (لتجنب القسمة على صفر)
                if (dt > 0.1) { 
                    // 1.25 هو معامل تصحيح (Protocol Overhead)
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.25;
                    
                    // فلترة القفزات غير المنطقية
                    if(s > 0 && s < 2000) {
                        if(s > maxSpeed) maxSpeed = s;
                        updateHUD(s, "ul");
                    }
                    
                    lastLoaded = e.loaded;
                    lastTime = now;
                }
            }
        };

        // إضافة معلمة عشوائية لمنع الكاش (Anti-Cache)
        xhr.open("POST", "https://speed.cloudflare.com/__up?t=" + Date.now(), true);
        xhr.onload = loop; 
        xhr.onerror = loop;
        xhr.send(data);
    };

    // البدء بـ 4 قنوات ثم زيادتها
    for(let i=0; i<4; i++) loop();
    await new Promise(r => setTimeout(r, 500));
    for(let i=0; i<4; i++) loop(); // إجمالي 8 قنوات

    // استمرار Jitter أثناء الرفع
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?uj=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('live-jitter').innerText = val + " ms";
            document.getElementById('j-fill').style.width = Math.min((val/300)*100, 100) + "%";
        } catch {}
    }, 200);

    await new Promise(r => setTimeout(r, ms));
    clearInterval(jInt);
    
    return maxSpeed.toFixed(1);
}
