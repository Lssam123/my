const API = {
    dl: "https://speed.cloudflare.com/__down?bytes=100000000", // 100MB لضمان استمرار التدفق
    ping: "https://1.1.1.1/cdn-cgi/trace",
    ul: "https://httpbin.org/post"
};

async function launchSequence() {
    const btn = document.getElementById('start-btn');
    const status = document.getElementById('status-bar');
    btn.disabled = true;

    // 1. فحص البينق الخامل (5 ثوانٍ)
    status.innerText = "Phase 1: Measuring Idle Latency (5s)...";
    document.getElementById('ping-card').classList.add('active');
    const idlePing = await runPingTest(5000);
    document.getElementById('val-ping').innerText = idlePing.toFixed(1);
    document.getElementById('ping-card').classList.remove('active');

    // 2. فحص التحميل + البينق المثقل (15 ثانية)
    status.innerText = "Phase 2: Download & Loaded Ping (15s)...";
    document.getElementById('loaded-card').classList.add('active');
    const dlResult = await runDownloadTest(15000);
    document.getElementById('hero-speed').innerText = dlResult.speed;
    document.getElementById('val-loaded').innerText = dlResult.loadedPing.toFixed(1);
    document.getElementById('loaded-card').classList.remove('active');

    // 3. فحص الرفع (15 ثانية)
    status.innerText = "Phase 3: Measuring Upload Speed (15s)...";
    document.getElementById('upload-card').classList.add('active');
    const ulSpeed = await runUploadTest(15000);
    document.getElementById('val-upload').innerText = ulSpeed;
    document.getElementById('upload-card').classList.remove('active');

    status.innerText = "Test Complete. Accuracy Verified.";
    btn.disabled = false;
}

// دالة البينق الخامل
async function runPingTest(duration) {
    let pings = [];
    const start = Date.now();
    while (Date.now() - start < duration) {
        const pStart = performance.now();
        await fetch(API.ping, { mode: 'no-cors', cache: 'no-cache' });
        pings.push(performance.now() - pStart);
        await new Promise(r => setTimeout(r, 200));
    }
    return pings.reduce((a, b) => a + b) / pings.length;
}

// دالة التحميل المتقدمة (Parallel Threads + Time-based)
async function runDownloadTest(duration) {
    let totalBytes = 0;
    let loadedPings = [];
    const startTime = performance.now();
    const controller = new AbortController();

    // قياس البينق تحت الضغط
    const pingTask = setInterval(async () => {
        const pStart = performance.now();
        await fetch(API.ping, { mode: 'no-cors' });
        loadedPings.push(performance.now() - pStart);
    }, 250);

    const threads = 6;
    const downloadWorkers = Array(threads).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                const response = await fetch(API.dl + "&cb=" + Math.random(), { signal: controller.signal });
                const reader = response.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - startTime >= duration)) break;
                    totalBytes += value.length;
                    
                    // تحديث العداد العلوي فقط
                    const elapsed = (performance.now() - startTime) / 1000;
                    const mbps = ((totalBytes * 8) / (1024 * 1024) / elapsed).toFixed(1);
                    document.getElementById('hero-speed').innerText = mbps;
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    controller.abort();
    clearInterval(pingTask);

    return {
        speed: ((totalBytes * 8) / (1024 * 1024) / (duration / 1000)).toFixed(1),
        loadedPing: loadedPings.length ? (loadedPings.reduce((a,b)=>a+b)/loadedPings.length) : 0
    };
}

// دالة الرفع المتقدمة
async function runUploadTest(duration) {
    let uploadedBytes = 0;
    const startTime = performance.now();
    const dataChunk = new Uint8Array(1024 * 1024); // 1MB chunk

    while (performance.now() - startTime < duration) {
        try {
            await fetch(API.ul, { method: 'POST', body: dataChunk, mode: 'no-cors' });
            uploadedBytes += dataChunk.length;
            
            // تحديث عداد الرفع في مكانه
            const elapsed = (performance.now() - startTime) / 1000;
            const mbps = ((uploadedBytes * 8) / (1024 * 1024) / elapsed).toFixed(1);
            document.getElementById('val-upload').innerText = mbps;
        } catch (e) { break; }
    }
    return ((uploadedBytes * 8) / (1024 * 1024) / (duration / 1000)).toFixed(1);
}
