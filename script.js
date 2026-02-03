const ENGINE_CONFIG = {
    // سيرفرات القياس (تستخدم Anycast للوصول لأقرب نقطة في السعودية)
    stc_target: "https://www.stc.com.sa/favicon.ico",
    mobily_target: "https://www.mobily.com.sa/favicon.ico",
    zain_target: "https://www.sa.zain.com/favicon.ico",
    general_server: "https://speed.cloudflare.com/__down?bytes=500000000",
    upload_url: "https://httpbin.org/post",
    threads: 20
};

async function launchSaudiEngine() {
    // 1. فحص البينق لكل شركة (Radar Phase)
    await Promise.all([
        measureISP('stc', ENGINE_CONFIG.stc_target),
        measureISP('mobily', ENGINE_CONFIG.mobily_target),
        measureISP('zain', ENGINE_CONFIG.zain_target)
    ]);

    // اختزال أسرع بينق لعرضه في الخانة الرئيسية
    const pings = [
        parseFloat(document.getElementById('p-stc').innerText),
        parseFloat(document.getElementById('p-mobily').innerText),
        parseFloat(document.getElementById('p-zain').innerText)
    ].filter(v => !isNaN(v));
    const bestPing = Math.min(...pings);
    document.getElementById('v-ping').innerText = bestPing.toFixed(1);

    // 2. فحص الداونلود + البينق المثقل
    document.getElementById('c-loaded').classList.add('active');
    const dlResult = await runSaudiDownload();
    document.getElementById('v-dl').innerText = Math.round(dlResult.speed);
    document.getElementById('v-loaded').innerText = dlResult.loadedPing.toFixed(1);
    document.getElementById('c-loaded').classList.remove('active');

    // 3. فحص الابلود المعزز (حل مشكلة التوقف)
    document.getElementById('c-ul').classList.add('active');
    const ulSpeed = await runSaudiUpload();
    document.getElementById('v-ul').innerText = ulSpeed.toFixed(1);
    document.getElementById('c-ul').classList.remove('active');
}

async function measureISP(id, url) {
    let pings = [];
    for(let i=0; i<10; i++) {
        const t0 = performance.now();
        try {
            await fetch(url + "?nocache=" + Math.random(), { mode: 'no-cors' });
            pings.push(performance.now() - t0);
        } catch(e) {}
    }
    const avg = pings.reduce((a,b)=>a+b, 0) / pings.length;
    document.getElementById(`p-${id}`).innerText = avg.toFixed(1) + "ms";
}

async function runSaudiDownload() {
    let bytes = 0;
    let lPings = [];
    const start = performance.now();
    const abort = new AbortController();

    const pingTask = setInterval(async () => {
        const t0 = performance.now();
        await fetch(ENGINE_CONFIG.stc_target, { mode: 'no-cors' });
        lPings.push(performance.now() - t0);
    }, 150);

    const streams = Array(ENGINE_CONFIG.threads).fill(0).map(async () => {
        while (performance.now() - start < 12000) {
            try {
                const res = await fetch(ENGINE_CONFIG.general_server, { signal: abort.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done || (performance.now() - start >= 12000)) break;
                    bytes += value.length;
                    const mbps = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000);
                    if ((performance.now()-start) > 2000) document.getElementById('v-dl').innerText = Math.round(mbps);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, 12000));
    abort.abort();
    clearInterval(pingTask);
    return {
        speed: (bytes * 8) / (1024 * 1024) / 12,
        loadedPing: lPings.reduce((a,b)=>a+b,0) / lPings.length
    };
}

async function runSaudiUpload() {
    let upBytes = 0;
    const start = performance.now();
    const chunk = new Uint8Array(2 * 1024 * 1024); // 2MB كتل

    const workers = Array(8).fill(0).map(async () => {
        while (performance.now() - start < 10000) {
            try {
                await fetch(ENGINE_CONFIG.upload_url, { method: 'POST', body: chunk, mode: 'no-cors' });
                upBytes += chunk.length;
                const mbps = (upBytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000);
                document.getElementById('v-ul').innerText = mbps.toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, 10000));
    return (upBytes * 8) / (1024 * 1024) / 10;
}
