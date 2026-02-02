const ENDPOINTS = {
    download: "https://speed.cloudflare.com/__down?bytes=150000000", // 150MB
    ping: "https://1.1.1.1/cdn-cgi/trace",
    upload: "https://httpbin.org/post"
};

async function startSystem() {
    const btn = document.getElementById('run-btn');
    const status = document.getElementById('status');
    btn.disabled = true;

    // 1. فحص الاستجابة الخاملة (Unloaded Ping)
    status.innerText = "جاري فحص جودة الاتصال...";
    document.getElementById('card-ping').classList.add('active');
    const idlePing = await measurePing(5000); // 5 ثواني
    document.getElementById('val-ping').innerText = idlePing.toFixed(0);
    document.getElementById('card-ping').classList.remove('active');

    // 2. فحص التحميل والاستجابة المُثقلة (Loaded Ping)
    status.innerText = "جاري فحص سرعة الاستقبال...";
    document.getElementById('card-loaded').classList.add('active');
    const dlResult = await measureDownload(15000); // 15 ثانية
    document.getElementById('dl-speed').innerText = dlResult.speed;
    document.getElementById('val-loaded').innerText = dlResult.loadedPing.toFixed(0);
    document.getElementById('card-loaded').classList.remove('active');

    // 3. فحص الرفع
    status.innerText = "جاري فحص سرعة الإرسال...";
    document.getElementById('card-ul').classList.add('active');
    const ulSpeed = await measureUpload(15000); // 15 ثانية
    document.getElementById('val-upload').innerText = ulSpeed;
    document.getElementById('card-ul').classList.remove('active');

    status.innerText = "اكتمل الفحص بنجاح";
    btn.disabled = false;
}

// دالة قياس البينق
async function measurePing(duration) {
    let results = [];
    const start = Date.now();
    while (Date.now() - start < duration) {
        const t0 = performance.now();
        await fetch(ENDPOINTS.ping, { mode: 'no-cors', cache: 'no-cache' });
        results.push(performance.now() - t0);
        await new Promise(r => setTimeout(r, 150));
    }
    return results.reduce((a, b) => a + b) / results.length;
}

// دالة التحميل المتقدمة
async function measureDownload(duration) {
    let bytesReceived = 0;
    let loadedPings = [];
    const startTime = performance.now();
    const abort = new AbortController();

    const pingTask = setInterval(async () => {
        const t0 = performance.now();
        await fetch(ENDPOINTS.ping, { mode: 'no-cors' });
        loadedPings.push(performance.now() - t0);
    }, 300);

    const threads = 6;
    const workers = Array(threads).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                const res = await fetch(ENDPOINTS.download + "&r=" + Math.random(), { signal: abort.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - startTime >= duration)) break;
                    bytesReceived += value.length;
                    
                    const elapsed = (performance.now() - startTime) / 1000;
                    const mbps = ((bytesReceived * 8) / (1024 * 1024) / elapsed).toFixed(1);
                    document.getElementById('dl-speed').innerText = mbps;
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    abort.abort();
    clearInterval(pingTask);

    return {
        speed: ((bytesReceived * 8) / (1024 * 1024) / (duration / 1000)).toFixed(1),
        loadedPing: loadedPings.length ? (loadedPings.reduce((a,b)=>a+b)/loadedPings.length) : 0
    };
}

// دالة الرفع المتقدمة
async function measureUpload(duration) {
    let bytesUploaded = 0;
    const startTime = performance.now();
    const chunk = new Uint8Array(1024 * 1024); // 1MB

    while (performance.now() - startTime < duration) {
        try {
            await fetch(ENDPOINTS.upload, { method: 'POST', body: chunk, mode: 'no-cors' });
            bytesUploaded += chunk.length;
            const elapsed = (performance.now() - startTime) / 1000;
            const mbps = ((bytesUploaded * 8) / (1024 * 1024) / elapsed).toFixed(1);
            document.getElementById('val-upload').innerText = mbps;
        } catch (e) { break; }
    }
    return ((bytesUploaded * 8) / (1024 * 1024) / (duration / 1000)).toFixed(1);
}
