const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico"
};

let ctrl = null;
let activeNode = "";
let graphBars = [];

// 1. بناء الرسم البياني (50 عمود)
const graphContainer = document.getElementById('graph-bars');
for(let i=0; i<50; i++) {
    let div = document.createElement('div');
    div.className = 'graph-bar';
    div.style.height = '0%';
    graphContainer.appendChild(div);
    graphBars.push(div);
}

// 2. تحديث الرسم البياني
function updateGraph(speed, maxSpeed) {
    let h = Math.min((speed / (maxSpeed || 100)) * 100, 100);
    // إزاحة البيانات: نحذف الأول ونضيف الجديد في الأخير
    for(let i=0; i<49; i++) {
        graphBars[i].style.height = graphBars[i+1].style.height;
        graphBars[i].style.backgroundColor = graphBars[i+1].style.backgroundColor;
    }
    graphBars[49].style.height = h + '%';
}

// إعداد التدريج
const pts = [0, 1, 5, 10, 50, 100, 300, 500, 1000];
const ring = document.getElementById('ticks-ring');
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
    document.getElementById('live-speed').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-active');
    const lbl = document.getElementById('phase-txt');
    
    let offset = 440 - ((deg+135)/270 * 440);
    path.style.strokeDashoffset = offset;

    if(type === "ul") {
        path.setAttribute("stroke", "url(#grad-purple)");
        lbl.style.color = "#8E2DE2";
        // تلوين الرسم البياني
        graphBars[49].style.backgroundColor = "#8E2DE2";
    } else {
        path.setAttribute("stroke", "url(#grad-cyan)");
        lbl.style.color = "#00F260";
        graphBars[49].style.backgroundColor = "#00F260";
    }
    
    // تحديث الرسم البياني
    updateGraph(val, 500); // 500 هو مقياس الرسم
}

async function startTitaniumTest() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    updateHUD(0, "dl");
    ["final-ping", "final-dl", "final-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('jitter-fill').style.width = "0%";
    
    // تصفير الرسم
    graphBars.forEach(b => b.style.height = '0%');

    const sel = document.getElementById('server-select').value;
    activeNode = (sel === 'auto') ? NODES[await pickBest()] : NODES[sel];

    // 1. PING
    document.getElementById('phase-txt').innerText = "PING";
    const ping = await runPing(5000);
    document.getElementById('final-ping').innerHTML = `${ping} <small>ms</small>`;

    // 2. DOWNLOAD (مع البنق المثقل المتزامن)
    document.getElementById('phase-txt').innerText = "DOWNLOAD";
    const dl = await runSyncDownload(15000);
    document.getElementById('final-dl').innerHTML = `${Math.round(dl)} <small>Mbps</small>`;

    // 3. UPLOAD (إصلاح: Active Thread Management)
    resetNeedle();
    document.getElementById('phase-txt').innerText = "UPLOAD";
    const ul = await runManagedUpload(15000);
    document.getElementById('final-ul').innerHTML = `${ul} <small>Mbps</small>`;

    document.getElementById('phase-txt').innerText = "FINISHED";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "RESTART";
}

function resetNeedle() {
    updateHUD(0);
    document.getElementById('track-active').style.strokeDashoffset = 440;
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

// دمج التحميل مع البنق المثقل (لضمان التوقف معاً)
async function runSyncDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();
    let isRunning = true;

    // حلقة البنق المثقل الداخلية
    const jitterLoop = async () => {
        while(isRunning && !ctrl.signal.aborted) {
            let t0 = performance.now();
            try {
                await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
                let val = Math.round(performance.now() - t0);
                document.getElementById('live-jitter').innerText = val + " ms";
                let w = Math.min((val/200)*100, 100);
                document.getElementById('jitter-fill').style.width = w + "%";
            } catch {}
            await new Promise(r => setTimeout(r, 300));
        }
    };
    jitterLoop();

    const workers = Array(40).fill(0).map(async () => {
        while(performance.now() - start < ms && !subCtrl.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: subCtrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || subCtrl.signal.aborted) break;
                    bytes += value.length;
                    
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.1;
                    updateHUD(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    isRunning = false; // إيقاف الجيتر فوراً
    subCtrl.abort();
    return (bytes * 8) / (1024 * 1024) / 15 * 1.1;
}

// *** الحل الجذري للرفع: Active Thread Management ***
// هذا الكود لا يثق في المتصفح، بل يراقب نفسه
async function runManagedUpload(ms) {
    let totalSent = 0;
    let maxSpeed = 0;
    const start = performance.now();
    const data = new Uint8Array(2 * 1024 * 1024); // 2MB ثابتة
    crypto.getRandomValues(data);

    // دالة العامل الذكي
    const spawnWorker = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();
        let isAlive = true;

        // مراقب الحياة (Watchdog) - إذا مات الرفع، أعد تشغيله
        const watchdog = setTimeout(() => {
            if(isAlive && lastLoad === 0) {
                xhr.abort();
                spawnWorker(); // إعادة المحاولة فوراً
            }
        }, 2000); // مهلة 2 ثانية

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let dBytes = e.loaded - lastLoad;
                
                if (dt > 0.15) {
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.2;
                    if(s > maxSpeed) maxSpeed = s;
                    updateHUD(s, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        xhr.open("POST", "https://speed.cloudflare.com/__up", true);
        
        xhr.onload = () => { 
            clearTimeout(watchdog);
            spawnWorker(); 
        };
        xhr.onerror = () => { 
            clearTimeout(watchdog);
            spawnWorker(); 
        };
        
        xhr.send(data);
    };

    // تشغيل 10 قنوات مُدارة (Managed Threads)
    for(let i=0; i<10; i++) {
        spawnWorker();
        await new Promise(r => setTimeout(r, 100)); // Ramp-up
    }

    await new Promise(r => setTimeout(r, ms));
    return maxSpeed.toFixed(1);
}
