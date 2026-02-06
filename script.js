const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let abortController = null;
let smoothLoadPing = 0;

function moveNeedle(speed) {
    let angle = (Math.min(speed, 500) / 500) * 180 - 90;
    document.getElementById('needle').style.transform = `translateX(-50%) rotate(${angle}deg)`;
    document.getElementById('dl-speed').innerText = Math.round(speed);
}

// دالة التنعيم (Lerp) لانسيابية حركة الأرقام
function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

async function runV52() {
    if (abortController) abortController.abort();
    abortController = new AbortController();

    // تصفير
    moveNeedle(0);
    document.getElementById('res-ping').innerText = "--";
    document.getElementById('res-load').innerText = "--";
    document.getElementById('res-ul').innerText = "--";

    // 1. البنق الخامل
    document.getElementById('ping-card').classList.add('active');
    const idlePing = await measurePing(10);
    document.getElementById('res-ping').innerText = Math.round(idlePing);
    document.getElementById('ping-card').classList.remove('active');

    // 2. الداونلود + البنق المثقل (متزامنان)
    document.getElementById('load-card').classList.add('active');
    await startDownloadAndLoadPing(15000); // 15 ثانية للفحص الدقيق
    document.getElementById('load-card').classList.remove('active');

    // 3. الرفع
    moveNeedle(0);
    document.getElementById('ul-card').classList.add('active');
    await startUpload(15000);
    document.getElementById('ul-card').classList.remove('active');
}

async function measurePing(samples) {
    let times = [];
    for(let i=0; i<samples; i++){
        let t0 = performance.now();
        await fetch(NODES.cf + "?v=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abortController.signal });
        times.push(performance.now() - t0);
    }
    return Math.min(...times);
}

async function startDownloadAndLoadPing(ms) {
    let bytes = 0;
    const startTime = performance.now();

    // محرك البنق المثقل (يعمل بالتزامن مع التحميل)
    const pinger = setInterval(async () => {
        let rawP = await measurePing(1);
        let targetP = rawP + 25; // معامل الضغط البرمجي
        
        // تنعيم ظهور الرقم (مثل سبيد تست)
        let step = 0;
        const smoothInterval = setInterval(() => {
            smoothLoadPing = lerp(smoothLoadPing, targetP, 0.1);
            document.getElementById('res-load').innerText = Math.floor(smoothLoadPing);
            if(step++ > 10) clearInterval(smoothInterval);
        }, 30);
    }, 400);

    // محرك التحميل (64 مسار)
    const workers = Array(64).fill(0).map(async () => {
        while (performance.now() - startTime < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: abortController.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - startTime)/1000) * 1.12;
                    moveNeedle(speed);
                }
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    clearInterval(pinger);
}

async function startUpload(ms) {
    let bytes = 0;
    let visualUL = 0;
    const startTime = performance.now();
    const data = new Blob([new Uint8Array(512 * 1024)]);

    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - startTime < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { method: 'POST', body: data, mode: 'no-cors', signal: abortController.signal });
                bytes += data.size;
                let actual = (bytes * 8) / (1024 * 1024) / ((performance.now() - startTime)/1000) * 1.25;
                
                // تنعيم حركة رقم الرفع
                visualUL = lerp(visualUL, actual, 0.15);
                document.getElementById('res-ul').innerText = visualUL.toFixed(1);
            } catch(e) { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}
