const CONFIG = {
    dlUrl: "https://speed.cloudflare.com/__down?bytes=50000000",
    pingUrl: "https://1.1.1.1/cdn-cgi/trace",
    pingDuration: 5000,    // 5 ثواني
    testDuration: 15000,   // 15 ثانية
    threads: 6             // مسارات متوازية للدقة
};

async function runProfessionalTest() {
    const btn = document.getElementById('start-btn');
    const status = document.getElementById('status');
    btn.disabled = true;

    // 1. فحص البينق الخامل (مدة 5 ثواني)
    status.innerText = "جاري فحص البينق الخامل (5 ثواني)...";
    document.getElementById('card-ping').classList.add('active');
    const idlePing = await runTimedPing(CONFIG.pingDuration);
    document.getElementById('res-ping').innerText = idlePing.toFixed(1);
    document.getElementById('card-ping').classList.remove('active');

    // 2. فحص التحميل + البينق المثقل (مدة 15 ثانية)
    status.innerText = "جاري فحص التحميل والبينق المثقل (15 ثانية)...";
    document.getElementById('card-dl').classList.add('active');
    document.getElementById('card-loaded').classList.add('active');
    const dlData = await runTimedDownload(CONFIG.testDuration);
    document.getElementById('res-dl').innerText = dlData.speed;
    document.getElementById('res-loaded').innerText = dlData.loadedPing.toFixed(1);
    document.getElementById('card-dl').classList.remove('active');
    document.getElementById('card-loaded').classList.remove('active');

    // 3. فحص الرفع (مدة 15 ثانية)
    status.innerText = "جاري فحص الرفع (15 ثانية)...";
    document.getElementById('card-ul').classList.add('active');
    const ulSpeed = await runTimedUpload(CONFIG.testDuration);
    document.getElementById('res-ul').innerText = ulSpeed;
    document.getElementById('card-ul').classList.remove('active');

    status.innerText = "اكتمل الاختبار بدقة احترافية";
    btn.disabled = false;
}

// دالة البينق الخامل لمدة محددة
async function runTimedPing(ms) {
    let pings = [];
    const start = Date.now();
    while (Date.now() - start < ms) {
        const pStart = performance.now();
        await fetch(CONFIG.pingUrl, { mode: 'no-cors', cache: 'no-cache' });
        pings.push(performance.now() - pStart);
        await new Promise(r => setTimeout(r, 100)); // فاصل بسيط بين النبضات
    }
    return pings.reduce((a, b) => a + b) / pings.length;
}

// دالة التحميل والرفع المجدولة زمنياً (15 ثانية)
async function runTimedDownload(ms) {
    let totalBytes = 0;
    let loadedPings = [];
    const startTest = performance.now();
    
    // مراقب البينق المثقل
    const pingInterval = setInterval(async () => {
        const pStart = performance.now();
        await fetch(CONFIG.pingUrl, { mode: 'no-cors' });
        loadedPings.push(performance.now() - pStart);
    }, 200);

    // التحميل المتوازي
    const controller = new AbortController();
    const downloadThreads = Array(CONFIG.threads).fill(0).map(async () => {
        while (performance.now() - startTest < ms) {
            try {
                const response = await fetch(CONFIG.dlUrl + "&cache=" + Math.random(), { signal: controller.signal });
                const reader = response.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - startTest >= ms)) break;
                    totalBytes += value.length;
                    
                    const elapsed = (performance.now() - startTest) / 1000;
                    const mbps = ((totalBytes * 8) / (1024 * 1024) / elapsed).toFixed(2);
                    document.getElementById('big-speed').innerText = Math.floor(mbps);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms)); // الانتظار لانتهاء المدة
    controller.abort(); // إيقاف التحميل فوراً
    clearInterval(pingInterval);

    const finalMbps = ((totalBytes * 8) / (1024 * 1024) / (ms / 1000)).toFixed(2);
    return {
        speed: finalMbps,
        loadedPing: loadedPings.reduce((a, b) => a + b, 0) / loadedPings.length
    };
}

async function runTimedUpload(ms) {
    let totalUploaded = 0;
    const startTest = performance.now();
    const data = new Uint8Array(2 * 1024 * 1024); // 2MB chunk

    while (performance.now() - startTest < ms) {
        try {
            await fetch('https://httpbin.org/post', {
                method: 'POST',
                body: data,
                mode: 'no-cors'
            });
            totalUploaded += data.length;
            const elapsed = (performance.now() - startTest) / 1000;
            const mbps = ((totalUploaded * 8) / (1024 * 1024) / elapsed).toFixed(2);
            document.getElementById('big-speed').innerText = Math.floor(mbps);
        } catch (e) { break; }
    }

    return ((totalUploaded * 8) / (1024 * 1024) / (ms / 1000)).toFixed(2);
}
