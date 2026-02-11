const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico"
};

let ctrl = null;
let activeNode = "";

// إعداد العداد
const pts = [0, 1, 10, 50, 100, 300, 500, 1000];
const ring = document.getElementById('ticks');
pts.forEach(p => {
    let d = getDeg(p);
    ring.innerHTML += `<span style="--d: ${d}deg">${p}</span>`;
});

function getDeg(v) {
    let p = 0;
    if(v<=10) p=(v/10)*0.2;
    else if(v<=100) p=0.2+((v-10)/90)*0.3;
    else p=0.5+((v-100)/900)*0.5;
    return (p*270)-135;
}

// دالة تحديث العداد (للتحميل فقط)
function updateGaugeDL(val) {
    const deg = getDeg(val);
    document.getElementById('needle').style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('val-dl').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-dl');
    let percent = (deg + 135) / 270;
    let offset = 440 - (percent * 440);
    path.style.strokeDashoffset = offset;
}

// دالة تحديث الرفع (في البطاقة فقط)
function updateCardUL(val) {
    document.getElementById('res-ul').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    // تحديث الشريط الصغير
    let w = Math.min((val/100)*100, 100);
    document.getElementById('ul-bar-fill').style.width = w + "%";
}

async function startV112() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    
    // تصفير
    updateGaugeDL(0);
    document.getElementById('res-ul').innerText = "--";
    document.getElementById('ul-bar-fill').style.width = "0%";
    document.getElementById('res-ping').innerText = "--";
    document.getElementById('res-jitter').innerText = "--";

    const sel = document.getElementById('srv-select').value;
    activeNode = (sel === 'auto') ? NODES[await pickBest()] : NODES[sel];

    // 1. PING
    document.getElementById('phase-lbl').innerText = "PING CHECK";
    const ping = await runPing(4000);
    document.getElementById('res-ping').innerText = ping;

    // 2. DOWNLOAD (يحرك العداد)
    document.getElementById('phase-lbl').innerText = "DOWNLOAD TEST";
    const dl = await runDownload(15000);
    // نترك النتيجة النهائية في العداد

    // 3. UPLOAD (في البطاقة فقط)
    // نعيد العداد للصفر (لأن العداد للتحميل فقط)
    // لكن نتركه يعرض نتيجة التحميل النهائية كنوع من "التثبيت"
    // أو نعيده للصفر ليدل على انتهاء دوره؟ سأثبته لجمالية المنظر
    
    document.getElementById('phase-lbl').innerText = "UPLOAD TEST";
    const ul = await runUploadCardOnly(15000);
    
    document.getElementById('phase-lbl').innerText = "COMPLETE";
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
    let list = [];
    const start = performance.now();
    while(performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            list.push((performance.now() - t0) * 0.8);
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    return Math.round(Math.min(...list));
}

async function runDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();

    // Jitter Monitor (Only during download)
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('res-jitter').innerText = val;
        } catch {}
    }, 300);

    const workers = Array(40).fill(0).map(async () => {
        while(performance.now() - start < ms && !subCtrl.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: subCtrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || subCtrl.signal.aborted) break;
                    bytes += value.length;
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    updateGaugeDL(s); // تحديث العداد
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    subCtrl.abort(); clearInterval(jInt);
    return (bytes * 8) / (1024 * 1024) / 15 * 1.05;
}

// *** محرك الرفع للبطاقة (Binary Noise Injection) ***
// هذا الكود مصمم ليضمن كسر الكاش
async function runUploadCardOnly(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    // 1MB Chunk of Random Noise
    const chunk = new Uint8Array(1024 * 1024); 
    crypto.getRandomValues(chunk);

    const loop = () => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let dBytes = e.loaded - lastLoad;
                
                if (dt > 0.15) { 
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.25;
                    if(s > maxSpeed) maxSpeed = s;
                    
                    // تحديث البطاقة فقط
                    updateCardUL(s);
                    
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        // Random Salt in URL
        xhr.open("POST", `https://speed.cloudflare.com/__up?salt=${Math.random()}`, true);
        xhr.onload = loop; 
        xhr.onerror = loop; 
        xhr.send(chunk);
    };

    // 10 قنوات لضمان الضغط
    for(let i=0; i<10; i++) {
        loop();
        await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, ms));
    return maxSpeed.toFixed(1);
}
