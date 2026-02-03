const CONFIG = {
    dl_url: "https://speed.cloudflare.com/__down?bytes=500000000", // 500MB
    ul_url: "https://httpbin.org/post", 
    ping_url: "https://1.1.1.1/cdn-cgi/trace",
    threads: 16, // عدد المسارات للسرعات العالية
    test_time: 12000 // 12 ثانية لكل فحص
};

async function masterEngine() {
    const btn = document.getElementById('start-btn');
    btn.disabled = true;
    
    // 1. فحص البينق الدقيق (Idle)
    document.getElementById('card-ping').classList.add('active');
    const idlePing = await runPrecisionPing();
    document.getElementById('v-ping').innerText = idlePing.toFixed(1) + " ms";
    document.getElementById('card-ping').classList.remove('active');

    // 2. فحص التحميل + البينق المثقل (Loaded)
    document.getElementById('card-loaded').classList.add('active');
    const dlResult = await runTurboDownload();
    document.getElementById('main-val').innerText = Math.round(dlResult.speed);
    document.getElementById('v-loaded').innerText = dlResult.loadedPing.toFixed(1) + " ms";
    document.getElementById('card-loaded').classList.remove('active');

    // 3. فحص الرفع (حل مشكلة التوقف)
    document.getElementById('card-upload').classList.add('active');
    const ulSpeed = await runTurboUpload();
    document.getElementById('v-upload').innerText = ulSpeed.toFixed(1) + " Mbps";
    document.getElementById('card-upload').classList.remove('active');

    btn.disabled = false;
    document.getElementById('log').innerText = "اكتمل الفحص بدقة عالية";
}

// دالة البينق (أقرب سيرفر + دقة Microseconds)
async function runPrecisionPing() {
    let samples = [];
    for(let i=0; i<20; i++) {
        const t0 = performance.now();
        await fetch(CONFIG.ping_url, { mode: 'no-cors', cache: 'no-cache' });
        samples.push(performance.now() - t0);
    }
    samples.sort((a,b)=>a-b);
    return samples[Math.floor(samples.length/2)]; // اختيار القيمة الوسيطة لدقة أعلى
}

// محرك التحميل للسرعات العالية (16 مسار)
async function runTurboDownload() {
    let totalBytes = 0;
    let pings = [];
    const start = performance.now();
    const controller = new AbortController();

    // قياس البينق المثقل أثناء التحميل
    const pingInterval = setInterval(async () => {
        const t0 = performance.now();
        await fetch(CONFIG.ping_url, { mode: 'no-cors' });
        pings.push(performance.now() - t0);
    }, 100);

    const streams = Array(CONFIG.threads).fill(0).map(async () => {
        while (performance.now() - start < CONFIG.test_time) {
            try {
                const res = await fetch(CONFIG.dl_url + "&r=" + Math.random(), { signal: controller.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - start >= CONFIG.test_time)) break;
                    totalBytes += value.length;
                    // تحديث الواجهة
                    const currentSpeed = (totalBytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000);
                    if ((performance.now()-start) > 2000) document.getElementById('main-val').innerText = Math.round(currentSpeed);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, CONFIG.test_time));
    controller.abort();
    clearInterval(pingInterval);
    return {
        speed: (totalBytes * 8) / (1024 * 1024) / (CONFIG.test_time/1000),
        loadedPing: pings.reduce((a,b)=>a+b,0)/pings.length
    };
}

// محرك الرفع المطور (حل مشكلة عدم الفحص)
async function runTurboUpload() {
    let uploadedBytes = 0;
    const start = performance.now();
    const dataChunk = new Uint8Array(2 * 1024 * 1024); // كتل 2MB

    // تشغيل عدة طلبات رفع متوازية لإشباع الـ Upload
    const uploadWorkers = Array(8).fill(0).map(async () => {
        while (performance.now() - start < CONFIG.test_time) {
            try {
                await fetch(CONFIG.ul_url, {
                    method: 'POST',
                    body: dataChunk,
                    mode: 'no-cors'
                });
                uploadedBytes += dataChunk.length;
                const currentUl = (uploadedBytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000);
                document.getElementById('v-upload').innerText = currentUl.toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, CONFIG.test_time));
    return (uploadedBytes * 8) / (1024 * 1024) / (CONFIG.test_time/1000);
}
