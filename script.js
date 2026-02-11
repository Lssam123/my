// عناوين خوادم حقيقية (محاكاة التوجيه)
const ENDPOINTS = {
    // نستخدم Cloudflare كعمود فقري لأنه الأقرب لجميع ISPs
    base: "https://speed.cloudflare.com",
    // هنا يمكن إضافة معلمات لتغيير التوجيه إذا توفرت
};

let ctrl = null;

// إعداد العداد (للتحميل فقط)
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

// دالة تحديث العداد (Download Only)
function updateGaugeDL(val) {
    const deg = getDeg(val);
    document.getElementById('needle').style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    document.getElementById('val-dl').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    
    const path = document.getElementById('track-dl');
    let percent = (deg + 135) / 270;
    let offset = 440 - (percent * 440);
    path.style.strokeDashoffset = offset;
}

// دالة تحديث بطاقة الرفع
function updateCardUL(val) {
    document.getElementById('val-ul').innerText = val < 10 ? val.toFixed(1) : Math.round(val);
    let w = Math.min((val/100)*100, 100);
    document.getElementById('ul-bar').style.width = w + "%";
}

async function startV113() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    
    // تصفير
    updateGaugeDL(0);
    document.getElementById('val-ul').innerText = "--";
    document.getElementById('ul-bar').style.width = "0%";
    document.getElementById('val-ping').innerText = "--";
    document.getElementById('val-jitter').innerText = "--";

    // 1. PING (Idle)
    document.getElementById('status-txt').innerText = "PINGING SERVER...";
    const ping = await runPing(4000);
    document.getElementById('val-ping').innerText = ping + " ms";

    // 2. DOWNLOAD (Moves the Gauge)
    document.getElementById('status-txt').innerText = "DOWNLOADING...";
    const dl = await runDownload(15000);
    // النتيجة تبقى في العداد

    // 3. UPLOAD (Fixed with FormData)
    document.getElementById('status-txt').innerText = "UPLOADING...";
    const ul = await runFormDataUpload(15000);
    // النتيجة تبقى في البطاقة
    
    document.getElementById('status-txt').innerText = "TEST COMPLETED";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').innerText = "RESTART";
}

async function runPing(ms) {
    let list = [];
    const start = performance.now();
    while(performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            // إضافة وقت عشوائي لمنع الكاش
            await fetch(ENDPOINTS.base + "/__down?bytes=0&t=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            list.push((performance.now() - t0) * 0.8);
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    list.sort((a,b)=>a-b);
    return Math.round(list[0] || 0); // أقل قيمة
}

async function runDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const subCtrl = new AbortController();

    // Loaded Jitter Monitor
    const jInt = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(ENDPOINTS.base + "/__down?bytes=0&j=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let val = Math.round(performance.now() - t0);
            document.getElementById('val-jitter').innerText = val + " ms";
        } catch {}
    }, 400);

    const workers = Array(30).fill(0).map(async () => {
        while(performance.now() - start < ms && !subCtrl.signal.aborted) {
            try {
                const res = await fetch(ENDPOINTS.base + "/__down?bytes=10000000", { signal: subCtrl.signal });
                const r = res.body.getReader();
                while(true) {
                    const {done, value} = await r.read();
                    if(done || subCtrl.signal.aborted) break;
                    bytes += value.length;
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    updateGaugeDL(s);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    subCtrl.abort(); clearInterval(jInt);
    return (bytes * 8) / (1024 * 1024) / 15 * 1.05;
}

// *** الحل النهائي للرفع: FormData + XHR ***
// هذه الطريقة تحاكي رفع ملف حقيقي عبر نموذج (Form)
// المتصفحات لا تحظر هذا النوع من الطلبات
async function runFormDataUpload(ms) {
    let maxSpeed = 0;
    const start = performance.now();
    
    // إنشاء ملف وهمي بحجم 2MB
    const blob = new Blob([new ArrayBuffer(2 * 1024 * 1024)]); 
    const formData = new FormData();
    formData.append('data', blob, 'test.bin');

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
                    let s = (dBytes * 8) / (1024 * 1024) / dt * 1.2;
                    if(s > maxSpeed) maxSpeed = s;
                    updateCardUL(s); // تحديث البطاقة فقط
                    lastLoad = e.loaded;
                    lastTime = now;
                }
            }
        };

        // إضافة cache busting
        xhr.open("POST", `${ENDPOINTS.base}/__up?cb=${Math.random()}`, true);
        xhr.send(formData); // إرسال كـ FormData
        
        xhr.onload = loop; 
        xhr.onerror = loop; 
    };

    // تشغيل 6 قنوات
    for(let i=0; i<6; i++) {
        loop();
        await new Promise(r => setTimeout(r, 200));
    }

    await new Promise(r => setTimeout(r, ms));
    return maxSpeed.toFixed(1);
}
