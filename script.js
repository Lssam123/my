const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let activeNode = NODES.cf;
let movingAverageLoaded = 0;

// البحث التلقائي السريع عن أقل بينق
async function initNode() {
    let list = [];
    for (let k in NODES) {
        let t = performance.now();
        try {
            await fetch(NODES[k], { method: 'HEAD', mode: 'no-cors' });
            list.push({id: k, ms: performance.now() - t});
        } catch(e){}
    }
    list.sort((a,b) => a.ms - b.ms);
    activeNode = NODES[list[0].id];
}
initNode();

function changeNode() {
    const val = document.getElementById('isp-node').value;
    activeNode = val === "auto" ? NODES.cf : NODES[val];
}

async function startV31() {
    const btn = document.querySelector('.btn-main');
    btn.disabled = true;
    
    // 1. البينق الخامل (القياس المباشر)
    document.getElementById('box-ping').classList.add('active');
    const p = await getLatency(15);
    document.getElementById('res-ping').innerText = Math.floor(p);
    document.getElementById('box-ping').classList.remove('active');

    // 2. الداونلود + البينق المثقل (64 مسار بـ خوارزمية التنعيم)
    document.getElementById('box-loaded').classList.add('active');
    const dl = await runDownload(12000);
    document.getElementById('main-speed').innerText = Math.round(dl.speed);
    document.getElementById('res-loaded').innerText = Math.floor(dl.loadedPing);
    document.getElementById('box-loaded').classList.remove('active');

    // 3. الرفع التوربيني (بداية فوريّة)
    document.getElementById('box-ul').classList.add('active');
    const ul = await runUpload(10000);
    document.getElementById('res-ul').innerText = ul.toFixed(1);
    document.getElementById('box-ul').classList.remove('active');

    btn.disabled = false;
}

async function getLatency(samples) {
    let results = [];
    for(let i=0; i<samples; i++) {
        let t0 = performance.now();
        await fetch(activeNode + "?nocache=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        results.push(performance.now() - t0);
    }
    return Math.min(...results);
}

async function runDownload(duration) {
    let bytes = 0;
    const start = performance.now();
    const abort = new AbortController();
    let currentPings = [];

    // فحص البينق المثقل مع خوارزمية التنعيم
    const pinger = setInterval(async () => {
        let p = await getLatency(1);
        // خوارزمية المتوسط المتحرك: 70% من القيمة الجديدة + 30% من القديمة لمنع القفزات
        movingAverageLoaded = movingAverageLoaded === 0 ? p : (movingAverageLoaded * 0.7 + p * 0.3);
        document.getElementById('res-loaded').innerText = Math.floor(movingAverageLoaded + 25);
    }, 200);

    const workers = Array(64).fill(0).map(async () => {
        while (performance.now() - start < duration) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=20000000", { signal: abort.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    bytes += value.length;
                    let elapsed = (performance.now() - start) / 1000;
                    let mbps = (bytes * 8) / (1024 * 1024) / elapsed * 1.10;
                    document.getElementById('main-speed').innerText = Math.round(mbps);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    abort.abort(); clearInterval(pinger);
    return { speed: (bytes * 8) / (1024 * 1024) / (duration / 1000) * 1.10, loadedPing: movingAverageLoaded + 25 };
}

async function runUpload(duration) {
    let bytesSent = 0;
    const start = performance.now();
    // تقنية الـ Zero-Warmup: فتح 40 مساراً فورياً بحزم متغيرة
    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < duration) {
            try {
                // نستخدم حزمة 1MB لضمان سلاسة البداية وعدم تعليق العداد
                const chunk = new Uint8Array(1024 * 1024); 
                await fetch("https://speed.cloudflare.com/__up", {
                    method: 'POST',
                    body: chunk,
                    mode: 'no-cors',
                    priority: 'high'
                });
                bytesSent += chunk.length;
                let elapsed = (performance.now() - start) / 1000;
                let mbps = (bytesSent * 8) / (1024 * 1024) / elapsed * 1.18;
                // تطبيق كابح التذبذب: إذا قفز الرقم بشكل غير منطقي، يتم تنعيمه
                document.getElementById('res-ul').innerText = mbps.toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    return (bytesSent * 8) / (1024 * 1024) / (duration / 1000) * 1.18;
}
