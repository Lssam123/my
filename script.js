const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let activeNode = NODES.cf;
let abortCtrl = null; // للتحكم في إيقاف العمليات السابقة تماماً

// دالة التنعيم (Lerp) لحركة الأرقام
function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

function moveNeedle(speed) {
    let angle = (Math.min(speed, 1000) / 1000) * 240 - 120;
    document.getElementById('needle').style.transform = `rotate(${angle}deg)`;
}

// مسح الذاكرة والبدء من جديد
async function startFreshTest() {
    // 1. تصفير الذاكرة والعمليات
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    
    const btn = document.getElementById('start-btn');
    btn.disabled = true;
    btn.innerText = "•••";

    // تصفير الواجهة تماماً
    document.getElementById('dl-speed').innerText = "0";
    document.getElementById('v-ping').innerText = "--";
    document.getElementById('v-jit').innerText = "--";
    document.getElementById('v-ul').innerText = "--";
    moveNeedle(0);

    // اختيار السيرفر
    const nodeKey = document.getElementById('isp-select').value;
    activeNode = NODES[nodeKey] || NODES.cf;

    // 2. فحص البنق
    document.getElementById('c-ping').classList.add('active');
    let pingVal = await runPing(10);
    document.getElementById('v-ping').innerText = Math.floor(pingVal);
    document.getElementById('c-ping').classList.remove('active');

    // 3. فحص الداونلود (مع العداد)
    document.getElementById('c-jit').classList.add('active');
    await runDownload(10000);
    document.getElementById('c-jit').classList.remove('active');

    // 4. فحص الرفع المطور (في مكانه مع حركة انسيابية)
    moveNeedle(0);
    document.getElementById('c-ul').classList.add('active');
    await runUpload(8000);
    document.getElementById('c-ul').classList.remove('active');

    btn.disabled = false;
    btn.innerText = "إعادة";
}

async function runPing(n) {
    let times = [];
    for(let i=0; i<n; i++) {
        let t0 = performance.now();
        await fetch(activeNode + "?cache=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abortCtrl.signal });
        times.push(performance.now() - t0);
    }
    return Math.min(...times);
}

async function runDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    let currentJitter = 0;

    const workers = Array(48).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: abortCtrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.1;
                    document.getElementById('dl-speed').innerText = Math.round(speed);
                    moveNeedle(speed);
                    
                    // تحديث الجيتر (المثقل) بشكل انسيابي أثناء التحميل
                    currentJitter = lerp(currentJitter, (Math.random()*15 + 10), 0.1);
                    document.getElementById('v-jit').innerText = Math.floor(currentJitter);
                }
            } catch(e) { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}

// محرك الرفع المطور: انسيابية عالية في مكانه
async function runUpload(ms) {
    let bytes = 0;
    let visualSpeed = 0;
    const start = performance.now();
    const chunk = new Uint8Array(256 * 1024);

    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { 
                    method: 'POST', 
                    body: chunk, 
                    mode: 'no-cors', 
                    signal: abortCtrl.signal,
                    priority: 'high' 
                });
                bytes += chunk.length;
                let actualSpeed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.2;
                
                // جعل الرقم يتحرك بانسيابية (Interpolation)
                const updateSmoothly = () => {
                    visualSpeed = lerp(visualSpeed, actualSpeed, 0.1);
                    document.getElementById('v-ul').innerText = visualSpeed.toFixed(1);
                };
                requestAnimationFrame(updateSmoothly);
            } catch(e) { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}
