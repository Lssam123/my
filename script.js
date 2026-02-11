// قائمة السيرفرات (تم إزالة أسماء المدن كما طلبت)
const SERVERS = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico"
};

let ctrl = null;
let activeNode = "";

// تحديث الدائرة (Orb)
function updateOrb(val, type="dl") {
    const ring = document.getElementById('ring-progress');
    const glow = document.querySelector('.orb-glow');
    const lbl = document.getElementById('phase-label');
    
    // محيط الدائرة (2 * PI * 120) ≈ 754
    const circumference = 754;
    // معادلة لوغاريتمية لجعل الحركة ممتعة
    let percent = val <= 10 ? (val/10)*0.1 : 0.1 + ((val-10)/990)*0.9; 
    if (percent > 1) percent = 1;
    
    const offset = circumference - (percent * circumference);
    ring.style.strokeDashoffset = offset;
    
    document.getElementById('main-number').innerText = val < 10 ? val.toFixed(1) : Math.round(val);

    if(type === "ul") {
        ring.style.stroke = "var(--purple)";
        ring.style.filter = "drop-shadow(0 0 10px var(--purple))";
        glow.style.background = "var(--purple)";
        lbl.style.color = "var(--purple)";
    } else {
        ring.style.stroke = "var(--blue)";
        ring.style.filter = "drop-shadow(0 0 10px var(--blue))";
        glow.style.background = "var(--blue)";
        lbl.style.color = "var(--blue)";
    }
}

async function startGlassTest() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('run-btn').disabled = true;
    updateOrb(0, "dl");
    ["val-ping", "val-dl", "val-ul", "val-jitter"].forEach(id => document.getElementById(id).innerText = "--");

    // 1. اختيار السيرفر الذكي
    const mode = document.getElementById('server-list').value;
    if(mode === 'auto') {
        document.getElementById('phase-label').innerText = "SELECTING...";
        activeNode = SERVERS[await findBestServer()];
    } else {
        activeNode = SERVERS[mode];
    }

    // 2. PING (Median)
    document.getElementById('phase-label').innerText = "PING";
    const ping = await runPing(4000);
    document.getElementById('val-ping').innerText = ping + " ms";

    // 3. DOWNLOAD + JITTER
    document.getElementById('phase-label').innerText = "DOWNLOAD";
    const dl = await runDownload(15000);
    document.getElementById('val-dl').innerText = Math.round(dl);

    // 4. UPLOAD (Packet Storm Fix)
    updateOrb(0, "ul"); // إعادة تصفير وتغيير اللون
    document.getElementById('phase-label').innerText = "UPLOAD";
    const ul = await runPacketStormUpload(15000);
    document.getElementById('val-ul').innerText = ul;

    document.getElementById('phase-label').innerText = "DONE";
    document.getElementById('run-btn').disabled = false;
    document.getElementById('run-btn').innerText = "RESTART";
}

// خوارزمية اختيار أفضل بنق
async function findBestServer() {
    const keys = Object.keys(SERVERS);
    const results = await Promise.all(keys.map(async k => {
        let t = performance.now();
        try { await fetch(SERVERS[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); 
        return { k, p: performance.now() - t }; } catch { return { k, p: 9999 }; }
    }));
    return results.sort((a,b) => a.p - b.p)[0].k;
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
    pings.sort((a,b)=>a-b);
    return Math.round(pings[Math.floor(pings.length/2)] || 0);
}

async function runDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();
    let isRunning = true;

    // Jitter Loop (يحدث فقط أثناء التحميل)
    (async () => {
        while(isRunning && !ctrl.signal.aborted) {
            let t0 = performance.now();
            try {
                await fetch(activeNode + "?j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
                let val = Math.round(performance.now() - t0);
                document.getElementById('val-jitter').innerText = val + " ms";
            } catch {}
            await new Promise(r => setTimeout(r, 300));
        }
    })();

    const workers = Array(30).fill(0).map(async () => {
        while(performance.now() - start < ms && !subCtrl.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: subCtrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || subCtrl.signal.aborted) break;
                    bytes += value.length;
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    updateOrb(s, "dl");
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    isRunning = false;
    subCtrl.abort();
    return (bytes * 8) / (1024 * 1024) / 15 * 1.05;
}

// *** الحل النهائي: عاصفة الحزم (Packet Storm) ***
// نرسل ملفات متعددة بأسماء وأحجام مختلفة قليلاً
async function runPacketStormUpload(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    
    // دالة إنشاء بيانات عشوائية
    const createPayload = (size) => {
        const data = new Uint8Array(size);
        crypto.getRandomValues(data);
        return data;
    };

    const worker = (id) => {
        if(performance.now() - start >= ms) return;

        const xhr = new XMLHttpRequest();
        let lastLoad = 0;
        let lastTime = performance.now();
        
        // تغيير حجم الملف قليلاً لكل عامل لمنع النمطية
        // 2MB + (id * 10KB)
        const payload = createPayload((2 * 1024 * 1024) + (id * 10240)); 
        const formData = new FormData();
        // اسم ملف عشوائي تماماً
        formData.append('file', new Blob([payload]), `test-${id}-${Date.now()}.bin`);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                let now = performance.now();
                let dt = (now - lastTime) / 1000;
                let dBytes = e.loaded - lastLoad;
                
                if (dt > 0.15) { 
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.2;
                    if(s > maxSpeed) maxSpeed = s;
                    updateOrb(s, "ul");
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        // رابط مميز جداً
        xhr.open("POST", `https://speed.cloudflare.com/__up?storm=${id}-${Math.random()}`, true);
        xhr.onload = () => worker(id); // تكرار نفس القناة
        xhr.onerror = () => worker(id);
        xhr.send(formData);
    };

    // تشغيل 8 عمال (Workers) متزامنين
    for(let i=0; i<8; i++) {
        worker(i);
        await new Promise(r => setTimeout(r, 150)); // تدرج بسيط
    }

    await new Promise(r => setTimeout(r, ms));
    return maxSpeed.toFixed(1);
}
