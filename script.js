const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico"
};

let ctrl = null;
let activeNode = "";

// إعداد التدريج (0-1000)
const pts = [0, 1, 5, 10, 50, 100, 300, 500, 1000];
const scale = document.getElementById('gauge-scale');
pts.forEach(p => {
    let d = getDeg(p);
    scale.innerHTML += `<span style="--d: ${d}deg">${p}</span>`;
});

function getDeg(v) {
    let p = 0;
    if(v<=10) p=(v/10)*0.2;
    else if(v<=100) p=0.2+((v-10)/90)*0.3;
    else if(v<=1000) p=0.5+((v-100)/900)*0.5;
    else p=1;
    return (p*270)-135;
}

function updateUI(val, type="dl") {
    const deg = getDeg(val);
    document.getElementById('needle').style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('live-speed').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-active');
    const lbl = document.getElementById('phase-status');
    const bar = document.querySelector('.status-bar');
    
    let offset = 440 - ((deg+135)/270 * 440);
    path.style.strokeDashoffset = offset;

    if(type === "ul") {
        path.setAttribute("stroke", "url(#grad-ul)");
        lbl.style.color = "#E100FF";
        bar.style.borderBottomColor = "#E100FF";
    } else {
        path.setAttribute("stroke", "url(#grad-dl)");
        lbl.style.color = "#00C9FF";
        bar.style.borderBottomColor = "#00C9FF";
    }
}

async function startLogicTest() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    updateUI(0, "dl");
    ["final-ping", "final-dl", "final-ul", "live-jitter"].forEach(id => document.getElementById(id).innerText = "--");
    document.getElementById('jitter-bar').style.width = "0%";

    const sel = document.getElementById('srv-select').value;
    activeNode = (sel === 'auto') ? NODES[await pickServer()] : NODES[sel];

    // 1. PING (Idle)
    document.getElementById('phase-status').innerText = "PING CHECK";
    const ping = await runPing(5000);
    document.getElementById('final-ping').innerText = ping + " ms";

    // 2. DOWNLOAD (مع البنق المثقل المتزامن)
    document.getElementById('phase-status').innerText = "DOWNLOAD";
    const dl = await runSyncDownload(15000);
    document.getElementById('final-dl').innerText = Math.round(dl) + " Mbps";

    // 3. UPLOAD (Random Text Injection)
    resetNeedle();
    document.getElementById('phase-status').innerText = "UPLOAD";
    const ul = await runTextUpload(15000);
    document.getElementById('final-ul').innerText = ul + " Mbps";

    document.getElementById('phase-status').innerText = "FINISHED";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "RESTART";
}

function resetNeedle() {
    updateUI(0);
    document.getElementById('track-active').style.strokeDashoffset = 440;
}

async function pickServer() {
    const k = Object.keys(NODES);
    const r = await Promise.all(k.map(async x => {
        let t = performance.now();
        try { await fetch(NODES[x] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k: x, p: performance.now() - t }; } catch { return { k: x, p: 999 }; }
    }));
    return r.sort((a,b) => a.p - b.p)[0].k;
}

async function runPing(ms) {
    let list = [];
    const start = performance.now();
    while(performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            // استبعاد تأخير المتصفح
            list.push((performance.now() - t0) * 0.8);
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    return Math.round(Math.min(...list));
}

// *** الحل المنطقي للبنق المثقل ***
// يتم فحصه فقط داخل هذه الدالة، ويتوقف تلقائياً عند انتهائها
async function runSyncDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();
    let isRunning = true; // علامة للتحكم في البنق المثقل

    // دالة البنق المثقل (تعمل بالتوازي وتتوقف مع التنزيل)
    const jitterLoop = async () => {
        while(isRunning && !ctrl.signal.aborted) {
            let t0 = performance.now();
            try {
                await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
                let val = Math.round(performance.now() - t0);
                document.getElementById('live-jitter').innerText = val;
                let w = Math.min((val/200)*100, 100);
                document.getElementById('jitter-bar').style.width = w + "%";
            } catch {}
            // انتظار بسيط بين الفحوصات
            await new Promise(r => setTimeout(r, 300));
        }
    };
    jitterLoop(); // ابدأ مراقبة الجيتر

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
                    updateUI(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    
    // إيقاف كل شيء بحزم
    isRunning = false; // إيقاف الجيتر فوراً
    subCtrl.abort();
    
    return (bytes * 8) / (1024 * 1024) / 15 * 1.1;
}

// *** الحل البديل للرفع: Text Injection ***
// بما أن Blob قد يسبب مشاكل، نستخدم نصاً عشوائياً (String)
// المتصفحات ترسل النصوص بسرعة ولا تحظرها بسهولة
async function runTextUpload(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    
    // توليد نص عشوائي بحجم 2MB
    // النصوص أسهل على المتصفح من البيانات الثنائية في بعض الأحيان
    const randomHex = Array(1024 * 1024).fill('a').map(() => Math.floor(Math.random()*16).toString(16)).join(''); 
    
    const loop = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let trackerStart = performance.now();
        let trackerLoaded = 0;

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - trackerStart) / 1000;
                let dBytes = e.loaded - trackerLoaded;
                
                if (dt > 0.15) { 
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.25; 
                    if(s > maxSpeed) maxSpeed = s;
                    updateUI(s, "ul");
                    trackerLoaded = e.loaded;
                    trackerStart = now;
                }
            }
        };

        xhr.open("POST", "https://speed.cloudflare.com/__up", true);
        xhr.setRequestHeader("Content-Type", "text/plain"); // نرسله كنص عادي
        xhr.onload = loop; 
        xhr.onerror = loop;
        xhr.send(randomHex);
    };

    // 8 قنوات متوازية
    for(let i=0; i<8; i++) {
        loop();
        await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, ms));
    return maxSpeed.toFixed(1);
}
